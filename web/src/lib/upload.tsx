import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, errorMessage, uploadNode } from './api'
import { useAppData } from './appData'
import { useToast } from './toast'

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled'

export interface UploadItem {
  id: string
  name: string
  size: number
  parentId: string | null
  parentName?: string
  progress: number
  status: UploadStatus
  error?: string
}

interface QueueEntry {
  file: File
  parentId: string | null
}

interface UploadContextValue {
  items: UploadItem[]
  enqueue: (files: File[], parentId: string | null, parentName?: string) => void
  cancel: (id: string) => void
  retry: (id: string) => void
  clearFinished: () => void
  activeCount: number
  totalCount: number
}

const UploadContext = createContext<UploadContextValue | null>(null)

const MAX_CONCURRENT = 2

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([])
  const entriesRef = useRef(new Map<string, QueueEntry>())
  const queueRef = useRef<string[]>([])
  const activeRef = useRef(0)
  const handlesRef = useRef(new Map<string, { abort: () => void }>())
  const pumpRef = useRef<() => void>(() => {})
  const { refresh } = useAppData()
  const toast = useToast()

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const pump = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT) {
      const id = queueRef.current.shift()
      if (!id) return
      const entry = entriesRef.current.get(id)
      if (!entry) continue
      activeRef.current += 1
      updateItem(id, { status: 'uploading', progress: 0, error: undefined })
      const handle = uploadNode(entry.file, {
        parentId: entry.parentId,
        onProgress: (percent) => updateItem(id, { progress: percent }),
      })
      handlesRef.current.set(id, handle)
      handle.promise
        .then(() => {
          updateItem(id, { status: 'done', progress: 100 })
          toast.success(`已上传「${entry.file.name}」`)
          refresh()
        })
        .catch((error: unknown) => {
          const aborted = error instanceof ApiError && error.code === 'aborted'
          updateItem(id, {
            status: aborted ? 'canceled' : 'error',
            error: aborted ? undefined : errorMessage(error),
          })
          if (!aborted) toast.error(`上传失败：${entry.file.name}`)
        })
        .finally(() => {
          activeRef.current = Math.max(0, activeRef.current - 1)
          handlesRef.current.delete(id)
          pumpRef.current()
        })
    }
  }, [refresh, toast, updateItem])

  useEffect(() => {
    pumpRef.current = pump
  }, [pump])

  const enqueue = useCallback(
    (files: File[], parentId: string | null, parentName?: string) => {
      if (files.length === 0) return
      const next: UploadItem[] = files.map((file) => {
        const id = newId()
        entriesRef.current.set(id, { file, parentId })
        return {
          id,
          name: file.name,
          size: file.size,
          parentId,
          parentName,
          progress: 0,
          status: 'queued',
        }
      })
      setItems((prev) => [...prev, ...next])
      queueRef.current.push(...next.map((item) => item.id))
      pumpRef.current()
    },
    [],
  )

  const cancel = useCallback((id: string) => {
    const handle = handlesRef.current.get(id)
    if (handle) {
      handle.abort()
      return
    }
    queueRef.current = queueRef.current.filter((queuedId) => queuedId !== id)
    entriesRef.current.delete(id)
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'canceled' } : item)),
    )
  }, [])

  const retry = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: 'queued', progress: 0, error: undefined }
          : item,
      ),
    )
    queueRef.current.push(id)
    pumpRef.current()
  }, [])

  const clearFinished = useCallback(() => {
    setItems((prev) =>
      prev.filter((item) => item.status === 'queued' || item.status === 'uploading'),
    )
  }, [])

  const activeCount = items.filter(
    (item) => item.status === 'queued' || item.status === 'uploading',
  ).length

  const value = useMemo<UploadContextValue>(
    () => ({
      items,
      enqueue,
      cancel,
      retry,
      clearFinished,
      activeCount,
      totalCount: items.length,
    }),
    [items, enqueue, cancel, retry, clearFinished, activeCount],
  )

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
}

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext)
  if (!ctx) throw new Error('useUpload must be used inside UploadProvider')
  return ctx
}
