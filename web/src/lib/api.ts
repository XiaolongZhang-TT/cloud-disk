import type {
  AdminUserInput,
  AdminUserPatch,
  AuthStatus,
  DirNode,
  FolderListing,
  MeUpdate,
  NodeVersion,
  Overview,
  PublicConfig,
  PublicShare,
  Share,
  SortBy,
  SortOrder,
  StorageInfo,
  UnlockResult,
  User,
} from './types'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type QueryValue = string | number | boolean | undefined | null

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    sp.set(key, String(value))
  }
  const qs = sp.toString()
  return qs ? `${path}?${qs}` : path
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
})

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError(0, 'network_error', '无法连接到服务器，请检查服务是否正在运行。')
  }

  if (!res.ok) {
    let code = 'http_error'
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as {
        error?: { code?: string; message?: string }
      }
      if (data?.error) {
        code = data.error.code || code
        message = data.error.message || message
      }
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(res.status, code, message)
  }

  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return (await res.text()) as unknown as T
  }
  return (await res.json()) as T
}

async function fetchText(url: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'network_error', '无法读取文件内容。')
  }
  if (!res.ok) {
    throw new ApiError(res.status, 'content_error', `无法读取文件内容（${res.status}）。`)
  }
  return res.text()
}

export interface UploadHandle {
  promise: Promise<DirNode>
  abort: () => void
}

interface UploadOptions {
  parentId?: string | null
  onProgress?: (percent: number) => void
}

const RESUMABLE_THRESHOLD = 32 * 1024 * 1024

async function uploadChunked(file: File, opts: UploadOptions, signal: AbortSignal): Promise<DirNode> {
  const created = await request<{ upload: { id: string; chunkSize: number; chunksTotal: number } }>(
    '/api/uploads',
    jsonInit('POST', {
      name: file.name,
      size: file.size,
      parentId: opts.parentId || null,
    }),
  )
  const upload = created.upload
  let sent = 0
  for (let index = 0; index < upload.chunksTotal; index += 1) {
    if (signal.aborted) throw new ApiError(0, 'aborted', '上传已取消')
    const start = index * upload.chunkSize
    const end = Math.min(file.size, start + upload.chunkSize)
    const chunk = file.slice(start, end)
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(
          `/api/uploads/${encodeURIComponent(upload.id)}/chunks/${index}`,
          {
            method: 'PUT',
            credentials: 'same-origin',
            body: chunk,
            headers: { 'Content-Type': 'application/octet-stream' },
            signal,
          },
        )
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null
          throw new ApiError(
            response.status,
            data?.error?.code || 'upload_failed',
            data?.error?.message || `上传分片失败（${response.status}）`,
          )
        }
        sent = end
        const percent = file.size > 0 ? Math.round((sent / file.size) * 99) : 99
        opts.onProgress?.(percent)
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (signal.aborted) throw new ApiError(0, 'aborted', '上传已取消')
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error
        await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    if (lastError) throw lastError
  }
  const completed = await request<{ node: DirNode }>(
    `/api/uploads/${encodeURIComponent(upload.id)}/complete`,
    { method: 'POST' },
  )
  opts.onProgress?.(100)
  return completed.node
}

/** Upload a single file with real progress events (XHR). */
export function uploadNode(file: File, opts: UploadOptions = {}): UploadHandle {
  const controller = new AbortController()
  if (file.size >= RESUMABLE_THRESHOLD) {
    return {
      promise: uploadChunked(file, opts, controller.signal),
      abort: () => controller.abort(),
    }
  }
  const promise = new Promise<DirNode>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', buildUrl('/api/nodes/upload', { parentId: opts.parentId || 'root' }))
    xhr.withCredentials = true
    xhr.responseType = 'json'

    const onAbort = () => xhr.abort()
    controller.signal.addEventListener('abort', onAbort)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const percent = event.total > 0 ? Math.round((event.loaded / event.total) * 100) : 0
      opts.onProgress?.(percent)
    }
    xhr.onload = () => {
      controller.signal.removeEventListener('abort', onAbort)
      const body = xhr.response as
        | { items?: DirNode[]; error?: { code?: string; message?: string } }
        | null
      if (xhr.status >= 200 && xhr.status < 300) {
        const node = body?.items?.[0]
        if (node) {
          opts.onProgress?.(100)
          resolve(node)
        } else {
          reject(new ApiError(xhr.status, 'upload_failed', '服务器没有返回上传结果。'))
        }
        return
      }
      reject(
        new ApiError(
          xhr.status,
          body?.error?.code || 'upload_failed',
          body?.error?.message || `上传失败（${xhr.status}）`,
        ),
      )
    }
    xhr.onerror = () => {
      controller.signal.removeEventListener('abort', onAbort)
      reject(new ApiError(0, 'network_error', '上传失败，请检查网络连接。'))
    }
    xhr.onabort = () => {
      reject(new ApiError(0, 'aborted', '上传已取消'))
    }

    const form = new FormData()
    form.append('files', file, file.name)
    xhr.send(form)
  })

  return { promise, abort: () => controller.abort() }
}

export const nodeDownloadUrl = (id: string) => `/api/nodes/${encodeURIComponent(id)}/download`
export const nodeVersionDownloadUrl = (id: string, versionId: string) =>
  `/api/nodes/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/content`
export const nodeContentUrl = (id: string) => `/api/nodes/${encodeURIComponent(id)}/content`
export const nodeThumbUrl = (id: string) => `/api/nodes/${encodeURIComponent(id)}/content`

export function publicShareContentUrl(
  token: string,
  accessToken?: string | null,
  download = false,
): string {
  return buildUrl(`/api/public/shares/${encodeURIComponent(token)}/content`, {
    accessToken: accessToken || undefined,
    download: download ? 1 : undefined,
  })
}

export async function fetchNodeText(id: string): Promise<string> {
  return fetchText(nodeContentUrl(id))
}

export async function fetchShareText(token: string, accessToken?: string | null): Promise<string> {
  return fetchText(publicShareContentUrl(token, accessToken))
}

export const api = {
  auth: {
    status: () => request<AuthStatus>('/api/auth/status'),
    setup: (body: { username: string; password: string; displayName?: string }) =>
      request<{ user: User }>('/api/auth/setup', jsonInit('POST', body)),
    login: (body: { username: string; password: string; remember?: boolean }) =>
      request<{ user: User }>('/api/auth/login', jsonInit('POST', body)),
    register: (body: { username: string; password: string; displayName?: string }) =>
      request<{ user: User }>('/api/auth/register', jsonInit('POST', body)),
    logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
    me: () => request<{ user: User }>('/api/me'),
    updateMe: (body: MeUpdate) => request<{ user: User }>('/api/me', jsonInit('PATCH', body)),
  },
  config: () => request<PublicConfig>('/api/config'),
  nodes: {
    list: (params: { parentId?: string | null; sort?: SortBy; order?: SortOrder } = {}) =>
      request<FolderListing>(
        buildUrl('/api/nodes', {
          parentId: params.parentId || 'root',
          sort: params.sort,
          order: params.order,
        }),
      ),
    get: (id: string) => request<{ node: DirNode }>(`/api/nodes/${encodeURIComponent(id)}`),
    createFolder: (body: { parentId?: string | null; name: string }) =>
      request<{ node: DirNode }>(
        '/api/nodes/folder',
        jsonInit('POST', { ...body, parentId: body.parentId || null }),
      ),
    update: (id: string, body: { name?: string; parentId?: string | null; starred?: boolean }) =>
      request<{ node: DirNode }>(`/api/nodes/${encodeURIComponent(id)}`, jsonInit('PATCH', body)),
    copy: (id: string, parentId?: string | null) =>
      request<{ node: DirNode }>(
        `/api/nodes/${encodeURIComponent(id)}/copy`,
        jsonInit('POST', { parentId: parentId ?? null }),
      ),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    versions: (id: string) =>
      request<{ items: NodeVersion[] }>(`/api/nodes/${encodeURIComponent(id)}/versions`),
    restoreVersion: (id: string, versionId: string) =>
      request<{ node: DirNode }>(
        `/api/nodes/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
        { method: 'POST' },
      ),
  },
  trash: {
    list: (params: { sort?: 'trashed' | 'name' | 'size' } = {}) =>
      request<{ items: DirNode[] }>(buildUrl('/api/trash', params)),
    restore: (id: string) =>
      request<{ node: DirNode }>(`/api/trash/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
      }),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/trash/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    empty: () => request<{ ok: true }>('/api/trash', { method: 'DELETE' }),
  },
  starred: (limit = 100) => request<{ items: DirNode[] }>(buildUrl('/api/starred', { limit })),
  recent: (limit = 60) => request<{ items: DirNode[] }>(buildUrl('/api/recent', { limit })),
  search: (q: string, limit = 60) =>
    request<{ query: string; items: DirNode[] }>(buildUrl('/api/search', { q, limit })),
  storage: () => request<StorageInfo>('/api/storage'),
  overview: () => request<Overview>('/api/overview'),
  shares: {
    create: (body: { nodeId: string; password?: string; expiresInHours?: number }) =>
      request<{ share: Share }>('/api/shares', jsonInit('POST', body)),
    list: () => request<{ items: Share[] }>('/api/shares'),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  publicShares: {
    get: (token: string) =>
      request<{ share: PublicShare }>(`/api/public/shares/${encodeURIComponent(token)}`),
    unlock: (token: string, password: string) =>
      request<UnlockResult>(
        `/api/public/shares/${encodeURIComponent(token)}/unlock`,
        jsonInit('POST', { password }),
      ),
  },
  admin: {
    users: () => request<{ items: User[] }>('/api/admin/users'),
    create: (body: AdminUserInput) =>
      request<{ user: User }>('/api/admin/users', jsonInit('POST', body)),
    update: (id: string, body: AdminUserPatch) =>
      request<{ user: User }>(`/api/admin/users/${encodeURIComponent(id)}`, jsonInit('PATCH', body)),
    remove: (id: string) =>
      request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return '发生未知错误，请稍后再试。'
}
