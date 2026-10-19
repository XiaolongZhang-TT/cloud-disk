import type { DirNode, FileKind } from './types'

const IMAGE_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
  'ico',
  'heic',
  'heif',
  'tif',
  'tiff',
])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ogv', 'mpeg', 'mpg'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'weba'])
const WORD_EXT = new Set(['doc', 'docx', 'odt', 'rtf', 'pages'])
const SHEET_EXT = new Set(['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'])
const SLIDES_EXT = new Set(['ppt', 'pptx', 'odp', 'key'])
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'dmg', 'iso'])
const CODE_EXT = new Set([
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'json',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'fish',
  'sql',
  'yml',
  'yaml',
  'toml',
  'xml',
  'ini',
  'conf',
  'env',
  'lua',
  'pl',
  'r',
  'dart',
  'vue',
  'svelte',
  'dockerfile',
  'makefile',
])
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'rtf', 'srt', 'vtt'])

export function extensionOf(name: string): string {
  const base = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  return base.toLowerCase()
}

export function fileKind(node: Pick<DirNode, 'type' | 'name' | 'mime'>): FileKind {
  if (node.type === 'folder') return 'folder'
  const mime = (node.mime || '').toLowerCase()
  const ext = extensionOf(node.name)
  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image'
  if (mime.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video'
  if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime.includes('word') || WORD_EXT.has(ext)) return 'word'
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    SHEET_EXT.has(ext) ||
    ext === 'csv'
  )
    return 'sheet'
  if (mime.includes('presentation') || mime.includes('powerpoint') || SLIDES_EXT.has(ext))
    return 'slides'
  if (
    mime.includes('zip') ||
    mime.includes('tar') ||
    mime.includes('compressed') ||
    ARCHIVE_EXT.has(ext)
  )
    return 'archive'
  if (CODE_EXT.has(ext)) return 'code'
  if (mime.startsWith('text/') || TEXT_EXT.has(ext)) return 'text'
  return 'other'
}

const KIND_LABELS: Record<FileKind, string> = {
  folder: '文件夹',
  image: '图片',
  video: '视频',
  audio: '音频',
  pdf: 'PDF 文档',
  word: 'Word 文档',
  sheet: '表格',
  slides: '演示文稿',
  archive: '压缩包',
  code: '代码',
  text: '文本',
  other: '文件',
}

export function kindLabel(kind: FileKind): string {
  return KIND_LABELS[kind]
}

export type PreviewMode = 'image' | 'video' | 'audio' | 'pdf' | 'text'

export function previewMode(kind: FileKind): PreviewMode | null {
  switch (kind) {
    case 'image':
    case 'video':
    case 'audio':
    case 'pdf':
      return kind
    case 'text':
    case 'code':
      return 'text'
    default:
      return null
  }
}

export function isPreviewable(kind: FileKind): boolean {
  return previewMode(kind) !== null
}

function trimNumber(value: number): string {
  return value
    .toFixed(2)
    .replace(/\.0+$/, '')
    .replace(/(\.\d)0$/, '$1')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, index)
  if (index === 0) return `${Math.round(value)} B`
  return `${trimNumber(value)} ${units[index]}`
}

export function formatQuota(quota: number): string {
  if (!quota || quota <= 0) return '不限容量'
  return formatBytes(quota)
}

export function usagePercent(used: number, quota: number): number {
  if (!quota || quota <= 0) return 0
  return Math.max(0, Math.min(100, (used / quota) * 100))
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const diff = Date.now() - date.getTime()
  if (diff < 0) return formatDate(iso)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 45) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  if (date.getFullYear() === new Date().getFullYear()) {
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)
  }
  return formatDate(iso)
}

export function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return '永久有效'
  return `有效期至 ${formatDateTime(iso)}`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function initials(name: string): string {
  const clean = (name || '').trim()
  if (!clean) return '云'
  if (/^[a-zA-Z0-9]/.test(clean)) {
    return clean.slice(0, 2).toUpperCase()
  }
  return clean.slice(0, 1)
}

const AVATAR_GRADIENTS = [
  ['#6366f1', '#8b5cf6'],
  ['#0ea5e9', '#22d3ee'],
  ['#f59e0b', '#f97316'],
  ['#10b981', '#14b8a6'],
  ['#ec4899', '#f43f5e'],
  ['#8b5cf6', '#d946ef'],
  ['#0f766e', '#2dd4bf'],
  ['#6366f1', '#ec4899'],
]

export function avatarGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const [from, to] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]
  return `linear-gradient(135deg, ${from}, ${to})`
}

export function joinShareUrl(url: string): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy copy
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

export function triggerDownload(url: string): void {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  link.download = ''
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => link.remove(), 0)
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  )
}

export function describeNode(node: Pick<DirNode, 'type' | 'size' | 'childCount'>): string {
  if (node.type === 'folder') {
    return `${node.childCount ?? 0} 个项目`
  }
  return formatBytes(node.size)
}
