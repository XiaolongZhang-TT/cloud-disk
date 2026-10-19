import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { DirNode } from '../lib/types'
import { api, errorMessage } from '../lib/api'
import { describeNode, formatBytes, formatRelative } from '../lib/format'
import { useAppData, useAutoRefresh } from '../lib/appData'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import { NodeIcon } from '../components/FileTypeIcon'
import { Button, EmptyState, ErrorState, Skeleton } from '../components/ui'

export function TrashPage() {
  const { version, refresh, storage } = useAppData()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const [items, setItems] = useState<DirNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [emptying, setEmptying] = useState(false)
  const versionRef = useRef(version)

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const { items: next } = await api.trash.list({ sort: 'trashed' })
      setItems(next)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    if (versionRef.current === version) return
    versionRef.current = version
    void load(true)
  }, [version, load])

  useAutoRefresh(() => {
    void load(true)
  }, 30_000)

  const restore = async (node: DirNode) => {
    try {
      await api.trash.restore(node.id)
      toast.success(`已恢复「${node.name}」`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const removeForever = async (node: DirNode) => {
    const ok = await confirm({
      title: '永久删除？',
      message: `「${node.name}」将被永久删除，此操作无法撤销。`,
      confirmText: '永久删除',
      danger: true,
    })
    if (!ok) return
    try {
      await api.trash.remove(node.id)
      toast.success('已永久删除')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const emptyTrash = async () => {
    const ok = await confirm({
      title: '清空回收站？',
      message: `回收站中的 ${items.length} 个项目将被永久删除，此操作无法撤销。`,
      confirmText: '清空回收站',
      danger: true,
    })
    if (!ok) return
    setEmptying(true)
    try {
      await api.trash.empty()
      toast.success('回收站已清空')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setEmptying(false)
    }
  }

  const totalSize = items.reduce((sum, item) => sum + (item.type === 'file' ? item.size : 0), 0)

  return (
    <div className="trash-page">
      <div className="page-head">
        <div className="page-title-row">
          <div className="page-title">
            <h1>回收站</h1>
            <p className="page-subtitle">
              已删除的项目会保留在这里，可随时恢复
              {!loading && items.length > 0
                ? ` · ${items.length} 个项目${
                    storage?.trashSize ? ` · ${formatBytes(storage.trashSize)}` : ''
                  }`
                : ''}
            </p>
          </div>
          {items.length > 0 && (
            <div className="page-actions">
              <Button
                variant="ghost"
                className="danger-text"
                icon={<Trash2 size={16} />}
                loading={emptying}
                onClick={() => void emptyTrash()}
              >
                清空回收站
              </Button>
            </div>
          )}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="trash-list" aria-busy="true" aria-label="正在加载回收站">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="trash-row is-skeleton" key={index}>
              <Skeleton className="skeleton-icon" />
              <div className="trash-row-main">
                <Skeleton className="skeleton-line" style={{ width: `${35 + index * 8}%` }} />
                <Skeleton className="skeleton-line is-small" style={{ width: '24%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <ErrorState description={error} onRetry={() => void load(false)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Trash2 size={28} />}
          title="回收站是空的"
          description="删除的文件和文件夹会先来到这里，你可以在这里恢复它们。"
          action={
            <Button variant="soft" onClick={() => navigate('/')}>
              返回我的文件
            </Button>
          }
        />
      ) : (
        <div className="trash-list">
          {items.map((node) => (
            <div className="trash-row" key={node.id}>
              <NodeIcon node={node} size={40} />
              <div className="trash-row-main">
                <span className="trash-row-name" title={node.name}>
                  {node.name}
                </span>
                <span className="trash-row-meta">
                  {node.type === 'folder' ? describeNode(node) : formatBytes(node.size)}
                  {node.trashedAt ? ` · 删除于 ${formatRelative(node.trashedAt)}` : ''}
                </span>
              </div>
              <div className="trash-row-actions">
                <Button
                  variant="soft"
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={() => void restore(node)}
                >
                  恢复
                </Button>
                <button
                  type="button"
                  className="icon-btn is-danger"
                  onClick={() => void removeForever(node)}
                  aria-label={`永久删除 ${node.name}`}
                  title="永久删除"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <p className="trash-note">
          回收站目前占用 {formatBytes(storage?.trashSize ?? totalSize)}，清空后无法恢复。
        </p>
      )}
    </div>
  )
}
