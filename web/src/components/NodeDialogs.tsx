import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  History,
  Link2,
  Lock,
  ShieldCheck,
} from 'lucide-react'
import type { Crumb, DirNode, NodeVersion, Share } from '../lib/types'
import { api, errorMessage, nodeDownloadUrl, nodeVersionDownloadUrl } from '../lib/api'
import {
  copyText,
  describeNode,
  fileKind,
  formatBytes,
  formatDateTime,
  formatExpiry,
  joinShareUrl,
  kindLabel,
} from '../lib/format'
import { useAppData } from '../lib/appData'
import { useToast } from '../lib/toast'
import { Button, EmptyState, Modal, SelectField, Spinner, Switch, TextField } from './ui'
import { NodeIcon } from './FileTypeIcon'

/* -------------------------------- rename --------------------------------- */

export function RenameDialog({ node, onClose }: { node: DirNode | null; onClose: () => void }) {
  const [name, setName] = useState(node?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { refresh } = useAppData()
  const toast = useToast()

  useEffect(() => {
    if (!node) return
    setName(node.name)
    setError(null)
    setSaving(false)
  }, [node])

  const submit = async () => {
    if (!node) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('名称不能为空')
      return
    }
    if (trimmed === node.name) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.nodes.update(node.id, { name: trimmed })
      toast.success('已重命名')
      refresh()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={node !== null}
      onClose={onClose}
      title="重命名"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            保存
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <TextField
          label="名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          autoFocus
          error={error}
          hint="支持中文、英文与空格，最长 200 个字符"
        />
      </form>
    </Modal>
  )
}

/* --------------------------------- move ---------------------------------- */

const ROOT_CRUMB: Crumb = { id: null, name: '全部文件' }

export function MoveDialog({ node, onClose }: { node: DirNode | null; onClose: () => void }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([ROOT_CRUMB])
  const [folders, setFolders] = useState<DirNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { refresh } = useAppData()
  const toast = useToast()

  const browse = useCallback(async (id: string | null, nextCrumbs: Crumb[]) => {
    setLoading(true)
    setError(null)
    try {
      const listing = await api.nodes.list({ parentId: id, sort: 'name', order: 'asc' })
      setFolders(listing.items.filter((item) => item.type === 'folder'))
      setCrumbs(nextCrumbs)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!node) return
    setSaving(false)
    setFolders([])
    void browse(null, [ROOT_CRUMB])
  }, [node, browse])

  if (!node) {
    return <Modal open={false} onClose={onClose} title="移动到" children={null} />
  }

  const destination = crumbs[crumbs.length - 1]
  const isSamePlace = (node.parentId ?? null) === destination.id
  const isSelf = node.id === destination.id
  const listed = folders.filter((folder) => folder.id !== node.id)

  const move = async () => {
    if (isSamePlace || isSelf) return
    setSaving(true)
    setError(null)
    try {
      await api.nodes.update(node.id, { parentId: destination.id })
      toast.success(
        destination.id ? `已移动到「${destination.name}」` : '已移动到「全部文件」',
      )
      refresh()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={node !== null}
      onClose={onClose}
      title={`移动「${node.name}」`}
      size="md"
      footer={
        <>
          <span className="modal-foot-note">
            目标：<strong>{destination.name}</strong>
          </span>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => void move()}
            loading={saving}
            disabled={isSamePlace || isSelf}
            title={isSamePlace ? '文件已在此位置' : isSelf ? '不能移动到自身' : undefined}
          >
            移动到此处
          </Button>
        </>
      }
    >
      <div className="move-picker">
        <nav className="move-crumbs" aria-label="选择目标文件夹">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.id ?? 'root'}-${index}`} className="move-crumb">
              {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
              <button
                type="button"
                className="move-crumb-btn"
                onClick={() => {
                  void browse(crumb.id, crumbs.slice(0, index + 1))
                }}
                aria-current={index === crumbs.length - 1 ? 'page' : undefined}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="move-list" aria-busy={loading}>
          {loading ? (
            <div className="move-loading">
              <Spinner size={18} />
              <span>正在读取文件夹…</span>
            </div>
          ) : error ? (
            <div className="move-error">
              <span>{error}</span>
              <Button variant="soft" size="sm" onClick={() => void browse(destination.id, crumbs)}>
                重试
              </Button>
            </div>
          ) : listed.length === 0 ? (
            <EmptyState
              compact
              icon={<FolderOpen size={22} />}
              title="没有子文件夹"
              description="可直接移动到当前位置，或返回上一级。"
            />
          ) : (
            <ul className="move-folder-list">
              {listed.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    className="move-folder"
                    onClick={() => {
                      void browse(folder.id, [
                        ...crumbs,
                        { id: folder.id, name: folder.name },
                      ])
                    }}
                  >
                    <NodeIcon node={folder} size={34} />
                    <span className="move-folder-name">{folder.name}</span>
                    <span className="move-folder-meta">{describeNode(folder)}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && !loading && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

/* --------------------------------- share --------------------------------- */

const EXPIRY_OPTIONS = [
  { value: '0', label: '永久有效' },
  { value: '1', label: '1 小时后过期' },
  { value: '24', label: '24 小时后过期' },
  { value: '168', label: '7 天后过期' },
  { value: '720', label: '30 天后过期' },
]

export function ShareDialog({ node, onClose }: { node: DirNode | null; onClose: () => void }) {
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [password, setPassword] = useState('')
  const [expiry, setExpiry] = useState('0')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<Share | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { refresh } = useAppData()
  const toast = useToast()

  useEffect(() => {
    if (!node) return
    setPasswordEnabled(false)
    setPassword('')
    setExpiry('0')
    setCreating(false)
    setCreated(null)
    setError(null)
  }, [node])

  if (!node) {
    return <Modal open={false} onClose={onClose} title="分享" children={null} />
  }

  const create = async () => {
    if (passwordEnabled && password.trim().length < 4) {
      setError('分享密码至少需要 4 个字符')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const hours = Number(expiry)
      const { share } = await api.shares.create({
        nodeId: node.id,
        ...(passwordEnabled && password.trim() ? { password: password.trim() } : {}),
        ...(hours > 0 ? { expiresInHours: hours } : {}),
      })
      setCreated(share)
      refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  const link = created ? joinShareUrl(created.url) : ''

  const copyLink = async () => {
    const ok = await copyText(link)
    if (ok) toast.success('分享链接已复制')
    else toast.error('复制失败，请手动选择链接复制')
  }

  return (
    <Modal
      open={node !== null}
      onClose={onClose}
      title={created ? '分享链接已创建' : `分享「${node.name}」`}
      description={
        created ? undefined : '任何拥有链接的人都可以在浏览器中访问这个文件。'
      }
      size="md"
      footer={
        created ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              完成
            </Button>
            <Button icon={<Copy size={15} />} onClick={() => void copyLink()}>
              复制链接
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() => void create()}
              loading={creating}
              icon={<Link2 size={15} />}
            >
              创建分享链接
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="share-result">
          <div className="share-success-icon">
            <CheckCircle2 size={26} />
          </div>
          <p className="share-result-title">链接已就绪</p>
          <div className="share-link-box">
            <input readOnly value={link} aria-label="分享链接" onFocus={(event) => event.target.select()} />
            <Button variant="soft" size="sm" onClick={() => void copyLink()} icon={<Copy size={14} />}>
              复制
            </Button>
          </div>
          <div className="share-result-meta">
            <span>
              <ShieldCheck size={14} /> {created.hasPassword ? '密码保护' : '无密码'}
            </span>
            <span>{formatExpiry(created.expiresAt)}</span>
          </div>
          {created.hasPassword && (
            <div className="share-password-note">
              <Lock size={14} /> 分享密码：<strong>{password}</strong>
              <span>（请立即保存，关闭后将无法再次查看）</span>
            </div>
          )}
          <a
            className="btn btn-ghost share-open-link"
            href={link}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            <span>在新标签页预览</span>
          </a>
        </div>
      ) : (
        <div className="share-form">
          <div className="share-option-row">
            <div>
              <p className="share-option-title">密码保护</p>
              <p className="share-option-desc">访问者需要输入密码才能查看</p>
            </div>
            <Switch
              checked={passwordEnabled}
              onChange={(checked) => {
                setPasswordEnabled(checked)
                if (!checked) setPassword('')
              }}
              label="启用分享密码"
            />
          </div>
          {passwordEnabled && (
            <TextField
              label="分享密码"
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 4 个字符"
              autoComplete="new-password"
              containerClassName="share-password-field"
            />
          )}
          <SelectField
            label="有效期"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            options={EXPIRY_OPTIONS}
          />
          <div className="share-summary">
            <Link2 size={16} />
            <span>
              将为这个
              <strong>{node.type === 'folder' ? '文件夹创建 ZIP 下载链接' : '文件创建公开链接'}</strong>
            </span>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

/* ----------------------------- version history --------------------------- */

export function VersionHistoryDialog({ node, onClose }: { node: DirNode | null; onClose: () => void }) {
  const [items, setItems] = useState<NodeVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { refresh } = useAppData()
  const toast = useToast()

  useEffect(() => {
    if (!node) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api.nodes
      .versions(node.id)
      .then((result) => {
        if (!cancelled) setItems(result.items)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [node])

  if (!node) {
    return <Modal open={false} onClose={onClose} title="历史版本" children={null} />
  }

  const restore = async (version: NodeVersion) => {
    setRestoring(version.id)
    setError(null)
    try {
      await api.nodes.restoreVersion(node.id, version.id)
      toast.success(`已恢复到 ${formatDateTime(version.createdAt)} 的版本`)
      refresh()
      const result = await api.nodes.versions(node.id)
      setItems(result.items)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRestoring(null)
    }
  }

  return (
    <Modal
      open={node !== null}
      onClose={onClose}
      title={`「${node.name}」的历史版本`}
      description="每次覆盖文件都会保留旧内容，默认保留 30 天。"
      size="md"
      footer={
        <Button variant="ghost" onClick={onClose}>
          完成
        </Button>
      }
    >
      {loading ? (
        <div className="dialog-loading"><Spinner /></div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History size={28} />}
          title="还没有历史版本"
          description="文件第一次被覆盖或通过客户端更新后，旧内容会出现在这里。"
        />
      ) : (
        <div className="version-list">
          {items.map((version) => (
            <div className="version-row" key={version.id}>
              <div className="version-main">
                <div className="version-title">版本 {version.version}</div>
                <div className="version-meta">
                  {formatDateTime(version.createdAt)} · {formatBytes(version.size)}
                </div>
              </div>
              <div className="version-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Download size={14} />}
                  onClick={() => {
                    window.location.href = nodeVersionDownloadUrl(node.id, version.id)
                  }}
                >
                  下载
                </Button>
                <Button
                  size="sm"
                  variant="soft"
                  loading={restoring === version.id}
                  onClick={() => void restore(version)}
                >
                  恢复
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

/* -------------------------------- details -------------------------------- */

export function DetailsDialog({ node, onClose }: { node: DirNode | null; onClose: () => void }) {
  if (!node) {
    return <Modal open={false} onClose={onClose} title="详细信息" children={null} />
  }
  const kind = fileKind(node)
  const rows: Array<[string, string]> = [
    ['名称', node.name],
    ['类型', kindLabel(kind)],
    ['大小', node.type === 'folder' ? `${node.childCount ?? 0} 个项目` : formatBytes(node.size)],
    ['格式', node.mime || '—'],
    ['位置', node.parentId ? '子文件夹' : '全部文件（根目录）'],
    ['创建时间', formatDateTime(node.createdAt)],
    ['修改时间', formatDateTime(node.updatedAt)],
    ['收藏', node.starred ? '已收藏' : '未收藏'],
  ]
  if (node.type === 'folder') rows.push(['子项数量', String(node.childCount ?? 0)])

  return (
    <Modal
      open={node !== null}
      onClose={onClose}
      title="详细信息"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <a className="btn btn-soft" href={nodeDownloadUrl(node.id)} download>
            <Download size={15} />
            <span>下载</span>
          </a>
        </>
      }
    >
      <div className="details-head">
        <NodeIcon node={node} size={56} />
        <div>
          <h3 className="details-name">{node.name}</h3>
          <p className="details-sub">{kindLabel(kind)}</p>
        </div>
      </div>
      <dl className="detail-list">
        {rows.map(([label, value]) => (
          <div key={label} className="detail-row">
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}
