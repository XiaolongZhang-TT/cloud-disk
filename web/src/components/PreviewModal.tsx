import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileQuestion, X } from 'lucide-react'
import type { DirNode } from '../lib/types'
import { fetchNodeText, errorMessage, nodeContentUrl, nodeDownloadUrl } from '../lib/api'
import { fileKind, formatBytes, kindLabel, previewMode } from '../lib/format'
import { NodeIcon } from './FileTypeIcon'
import { Spinner } from './ui'

interface PreviewModalProps {
  nodes: DirNode[]
  index: number
  onChangeIndex: (index: number) => void
  onClose: () => void
}

export function PreviewModal({ nodes, index, onChangeIndex, onClose }: PreviewModalProps) {
  const node = nodes[index]
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const changeIndexRef = useRef(onChangeIndex)
  const count = nodes.length

  useEffect(() => {
    onCloseRef.current = onClose
    changeIndexRef.current = onChangeIndex
  })

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault()
        changeIndexRef.current(index - 1)
      } else if (event.key === 'ArrowRight' && index < count - 1) {
        event.preventDefault()
        changeIndexRef.current(index + 1)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
    }
  }, [index, count])

  if (!node) return null

  const kind = fileKind(node)

  return (
    <div
      className="preview-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="preview-shell" role="dialog" aria-modal="true" aria-label={`预览 ${node.name}`}>
        <header className="preview-head">
          <div className="preview-title">
            <NodeIcon node={node} size={36} />
            <div className="preview-title-text">
              <h2 title={node.name}>{node.name}</h2>
              <p>
                {kindLabel(kind)} · {formatBytes(node.size)}
                {count > 1 ? ` · ${index + 1} / ${count}` : ''}
              </p>
            </div>
          </div>
          <div className="preview-actions">
            <a
              className="icon-btn preview-action"
              href={nodeDownloadUrl(node.id)}
              download
              aria-label="下载文件"
              title="下载"
            >
              <Download size={18} />
            </a>
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-btn preview-action preview-close"
              onClick={onClose}
              aria-label="关闭预览"
              title="关闭（Esc）"
            >
              <X size={19} />
            </button>
          </div>
        </header>

        <div className={`preview-body mode-${previewMode(kind) ?? 'none'}`}>
          <PreviewContent key={node.id} node={node} />
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              className="preview-nav is-prev"
              disabled={index === 0}
              onClick={() => onChangeIndex(index - 1)}
              aria-label="上一个文件"
              title="上一个（←）"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="preview-nav is-next"
              disabled={index === count - 1}
              onClick={() => onChangeIndex(index + 1)}
              aria-label="下一个文件"
              title="下一个（→）"
            >
              <ChevronRight size={22} />
            </button>
            <div className="preview-hint">
              <span>← →</span> 切换文件 <span className="preview-hint-dot">·</span> <span>Esc</span>{' '}
              关闭
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PreviewFallback({ node, note }: { node: DirNode; note?: string }) {
  return (
    <div className="preview-fallback">
      <div className="preview-fallback-icon">
        <FileQuestion size={30} />
      </div>
      <p>{note ?? '这种文件暂时不支持在线预览'}</p>
      <a className="btn btn-soft" href={nodeDownloadUrl(node.id)} download>
        <Download size={16} />
        <span>下载文件</span>
      </a>
    </div>
  )
}

function PreviewContent({ node }: { node: DirNode }) {
  const kind = fileKind(node)
  const mode = previewMode(kind)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [textError, setTextError] = useState<string | null>(null)
  const url = nodeContentUrl(node.id)

  useEffect(() => {
    if (mode !== 'text') return
    if (node.size > 2 * 1024 * 1024) return
    let cancelled = false
    setText(null)
    setTextError(null)
    fetchNodeText(node.id)
      .then((value) => {
        if (!cancelled) setText(value)
      })
      .catch((error: unknown) => {
        if (!cancelled) setTextError(errorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [mode, node.id, node.size])

  if (mode === 'image') {
    return (
      <div className="preview-media">
        {!imageError && (
          <img
            src={url}
            alt={node.name}
            className={`preview-image ${imageLoaded ? 'is-ready' : ''}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        )}
        {!imageLoaded && !imageError && (
          <div className="preview-loading" role="status">
            <Spinner size={28} />
            <span>正在加载图片…</span>
          </div>
        )}
        {imageError && <PreviewFallback node={node} note="图片加载失败，请下载后查看" />}
      </div>
    )
  }

  if (mode === 'video') {
    return (
      <div className="preview-media">
        <video className="preview-video" src={url} controls playsInline preload="metadata" />
      </div>
    )
  }

  if (mode === 'audio') {
    return (
      <div className="preview-audio">
        <div className="preview-audio-art">
          <NodeIcon node={node} size={96} />
        </div>
        <p className="preview-audio-name">{node.name}</p>
        <p className="preview-audio-meta">
          {kindLabel(kind)} · {formatBytes(node.size)}
        </p>
        <audio className="preview-audio-player" src={url} controls preload="metadata" />
      </div>
    )
  }

  if (mode === 'pdf') {
    return (
      <div className="preview-pdf-wrap">
        <iframe src={url} title={node.name} className="preview-pdf" />
      </div>
    )
  }

  if (mode === 'text') {
    if (node.size > 2 * 1024 * 1024) {
      return <PreviewFallback node={node} note="文件较大，在线预览已省略，请下载后查看" />
    }
    if (textError) {
      return <PreviewFallback node={node} note={`文本读取失败：${textError}`} />
    }
    if (text === null) {
      return (
        <div className="preview-loading on-dark" role="status">
          <Spinner size={26} />
          <span>正在读取文本…</span>
        </div>
      )
    }
    return (
      <pre className="preview-text" tabIndex={0}>
        {text || '（空文件）'}
      </pre>
    )
  }

  return <PreviewFallback node={node} />
}
