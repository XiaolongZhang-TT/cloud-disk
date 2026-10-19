import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  ExternalLink,
  Link2,
  Lock,
  Share2,
  Trash2,
} from 'lucide-react'
import type { Share } from '../lib/types'
import { api, errorMessage } from '../lib/api'
import {
  copyText,
  formatDateTime,
  formatExpiry,
  joinShareUrl,
} from '../lib/format'
import { useAppData, useAutoRefresh } from '../lib/appData'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import { NodeIcon } from '../components/FileTypeIcon'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
} from '../components/ui'

function isExpired(share: Share): boolean {
  if (!share.expiresAt) return false
  return new Date(share.expiresAt).getTime() < Date.now()
}

export function SharesPage() {
  const { version, refresh } = useAppData()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const versionRef = useRef(version)

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const { items } = await api.shares.list()
      setShares(items)
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

  const copyLink = async (share: Share) => {
    const ok = await copyText(joinShareUrl(share.url))
    if (ok) toast.success('分享链接已复制')
    else toast.error('复制失败，请手动复制链接')
  }

  const removeShare = async (share: Share) => {
    const ok = await confirm({
      title: '删除分享链接？',
      message: `「${share.node.name}」的公开链接将立即失效，文件本身不会被删除。`,
      confirmText: '删除链接',
      danger: true,
    })
    if (!ok) return
    try {
      await api.shares.remove(share.id)
      toast.success('分享链接已删除')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const activeCount = shares.filter((share) => !isExpired(share)).length

  return (
    <div className="shares-page">
      <div className="page-head">
        <div className="page-title-row">
          <div className="page-title">
            <h1>分享</h1>
            <p className="page-subtitle">
              集中管理你的公开分享链接
              {!loading && shares.length > 0 ? ` · ${activeCount} 个有效` : ''}
            </p>
          </div>
        </div>
      </div>

      {loading && shares.length === 0 ? (
        <div className="share-list" aria-busy="true" aria-label="正在加载分享">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="share-row is-skeleton" key={index}>
              <Skeleton className="skeleton-icon is-large" />
              <div className="share-row-main">
                <Skeleton className="skeleton-line" style={{ width: '38%' }} />
                <Skeleton className="skeleton-line is-small" style={{ width: '58%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : error && shares.length === 0 ? (
        <ErrorState description={error} onRetry={() => void load(false)} />
      ) : shares.length === 0 ? (
        <EmptyState
          icon={<Share2 size={28} />}
          title="还没有分享链接"
          description="在任意文件或文件夹的更多菜单中选择「分享」，就能生成一个可发送给朋友的公开链接。"
          action={
            <Button variant="soft" onClick={() => navigate('/')}>
              去挑选要分享的文件
            </Button>
          }
        />
      ) : (
        <div className="share-list">
          {shares.map((share) => {
            const expired = isExpired(share)
            const link = joinShareUrl(share.url)
            return (
              <article className={`share-row ${expired ? 'is-expired' : ''}`} key={share.id}>
                <NodeIcon node={share.node} size={44} />
                <div className="share-row-main">
                  <div className="share-row-top">
                    <span className="share-row-name" title={share.node.name}>
                      {share.node.name}
                    </span>
                    {share.hasPassword && (
                      <Badge tone="neutral">
                        <Lock size={11} /> 密码保护
                      </Badge>
                    )}
                    {expired ? (
                      <Badge tone="danger">已过期</Badge>
                    ) : (
                      <Badge tone="success">有效</Badge>
                    )}
                  </div>
                  <div className="share-row-meta">
                    <span>{formatExpiry(share.expiresAt)}</span>
                    <span>创建于 {formatDateTime(share.createdAt)}</span>
                    <span>{share.downloadCount} 次下载</span>
                  </div>
                </div>
                <div className="share-row-actions">
                  <Button
                    variant="soft"
                    size="sm"
                    icon={<Copy size={14} />}
                    onClick={() => void copyLink(share)}
                  >
                    复制链接
                  </Button>
                  <a
                    className="icon-btn"
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`打开 ${share.node.name} 的分享页`}
                    title="打开分享页"
                  >
                    <ExternalLink size={17} />
                  </a>
                  <button
                    type="button"
                    className="icon-btn is-danger"
                    onClick={() => void removeShare(share)}
                    aria-label={`删除 ${share.node.name} 的分享链接`}
                    title="删除分享链接"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {shares.length > 0 && (
        <div className="share-tip">
          <Link2 size={15} />
          <span>分享链接可随时删除；删除后访客将无法继续访问，但原文件会保留。</span>
        </div>
      )}
    </div>
  )
}
