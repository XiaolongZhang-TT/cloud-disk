import { useEffect, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  CloudUpload,
  RotateCcw,
  X,
} from 'lucide-react'
import { useUpload } from '../lib/upload'
import type { UploadItem } from '../lib/upload'
import { formatBytes } from '../lib/format'
import { Spinner } from './ui'

function StatusIcon({ item }: { item: UploadItem }) {
  if (item.status === 'uploading') return <Spinner size={14} />
  if (item.status === 'done') return <CheckCircle2 size={15} className="upload-status-done" />
  if (item.status === 'error') return <CircleAlert size={15} className="upload-status-error" />
  if (item.status === 'canceled') return <Ban size={15} className="upload-status-muted" />
  return <Clock3 size={15} className="upload-status-muted" />
}

export function UploadPanel() {
  const { items, cancel, retry, clearFinished, activeCount } = useUpload()
  const [collapsed, setCollapsed] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (activeCount > 0) {
      setCollapsed(false)
      setHidden(false)
    }
  }, [activeCount])

  if (items.length === 0 || hidden) return null

  const doneCount = items.filter((item) => item.status === 'done').length
  const errorCount = items.filter((item) => item.status === 'error').length
  const progress = Math.round(
    items.reduce((sum, item) => sum + (item.status === 'done' ? 100 : item.progress), 0) /
      items.length,
  )

  if (collapsed) {
    return (
      <button
        type="button"
        className="upload-pill"
        onClick={() => setCollapsed(false)}
        aria-label="展开上传队列"
      >
        <CloudUpload size={16} />
        <span>
          {activeCount > 0 ? `上传中 ${doneCount}/${items.length}` : `上传任务 ${items.length}`}
        </span>
        <span className="upload-pill-progress">{progress}%</span>
        <ChevronUp size={15} />
      </button>
    )
  }

  const closePanel = () => {
    if (activeCount > 0) {
      setCollapsed(true)
      return
    }
    if (errorCount > 0) {
      setHidden(true)
      return
    }
    clearFinished()
    setHidden(true)
  }

  return (
    <section className="upload-panel" aria-label="上传队列">
      <header className="upload-head">
        <div className="upload-head-title">
          <span className={`upload-head-icon ${activeCount > 0 ? 'is-active' : ''}`}>
            <CloudUpload size={17} />
          </span>
          <div>
            <h2>{activeCount > 0 ? '正在上传' : errorCount > 0 ? '上传完成（有失败）' : '上传完成'}</h2>
            <p>
              {items.length} 个文件 · {progress}%
            </p>
          </div>
        </div>
        <div className="upload-head-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setCollapsed(true)}
            aria-label="最小化上传队列"
          >
            <ChevronDown size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={closePanel} aria-label="关闭上传队列">
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="upload-list">
        {items.map((item) => (
          <div key={item.id} className={`upload-item is-${item.status}`}>
            <span className="upload-item-status">
              <StatusIcon item={item} />
            </span>
            <div className="upload-item-main">
              <div className="upload-item-top">
                <span className="upload-item-name" title={item.name}>
                  {item.name}
                </span>
                <span className="upload-item-percent">
                  {item.status === 'error'
                    ? '失败'
                    : item.status === 'canceled'
                      ? '已取消'
                      : `${item.progress}%`}
                </span>
              </div>
              <div className="upload-progress">
                <span
                  className={`upload-progress-bar is-${item.status}`}
                  style={{ width: `${item.status === 'done' ? 100 : item.progress}%` }}
                />
              </div>
              <div className="upload-item-sub">
                <span>
                  {formatBytes(item.size)}
                  {item.parentName ? ` · 上传到「${item.parentName}」` : ''}
                </span>
                {item.error && <span className="upload-item-error">{item.error}</span>}
              </div>
            </div>
            <div className="upload-item-actions">
              {(item.status === 'uploading' || item.status === 'queued') && (
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => cancel(item.id)}
                  aria-label={`取消上传 ${item.name}`}
                  title="取消上传"
                >
                  <X size={14} />
                </button>
              )}
              {item.status === 'error' && (
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => retry(item.id)}
                  aria-label={`重试上传 ${item.name}`}
                  title="重试"
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <footer className="upload-foot">
        <span>
          {doneCount} 个已完成
          {errorCount > 0 ? ` · ${errorCount} 个失败` : ''}
        </span>
        <button type="button" className="link-btn" onClick={clearFinished}>
          清除已完成
        </button>
      </footer>
    </section>
  )
}
