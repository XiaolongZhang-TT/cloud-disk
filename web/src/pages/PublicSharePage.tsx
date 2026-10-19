import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertCircle,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Unlink,
} from 'lucide-react'
import type { PublicShare } from '../lib/types'
import {
  ApiError,
  api,
  errorMessage,
  fetchShareText,
  publicShareContentUrl,
} from '../lib/api'
import {
  fileKind,
  formatBytes,
  formatExpiry,
  kindLabel,
  previewMode,
} from '../lib/format'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { Logo } from '../components/Logo'
import { NodeIcon } from '../components/FileTypeIcon'
import { Avatar, Button, Spinner, TextField } from '../components/ui'

function ShareTextPreview({ token, accessToken }: { token: string; accessToken: string | null }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setText(null)
    setError(null)
    fetchShareText(token, accessToken)
      .then((value) => {
        if (!cancelled) setText(value)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [token, accessToken])

  if (error) {
    return (
      <div className="public-preview-fallback">
        <p>无法读取内容：{error}</p>
      </div>
    )
  }
  if (text === null) {
    return (
      <div className="public-preview-loading">
        <Spinner size={20} />
        <span>正在读取文本…</span>
      </div>
    )
  }
  return <pre className="public-text-preview">{text || '（空文件）'}</pre>
}

function ShareImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="public-preview-fallback">
        <p>图片加载失败，请尝试下载后查看。</p>
      </div>
    )
  }
  return (
    <div className="public-image-wrap">
      {!loaded && (
        <div className="public-preview-loading">
          <Spinner size={22} />
          <span>正在加载图片…</span>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`public-image ${loaded ? 'is-ready' : ''}`}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export function PublicSharePage() {
  const { token } = useParams<{ token: string }>()
  const { serverName, version } = useAuth()
  const { resolved, setMode } = useTheme()

  const [share, setShare] = useState<PublicShare | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    if (!token) return null
    try {
      return sessionStorage.getItem(`cd.share.${token}`)
    } catch {
      return null
    }
  })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const { share: next } = await api.publicShares.get(token)
      setShare(next)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true)
      else setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (share?.node.name) document.title = `${share.node.name} · Tern`
    return () => {
      document.title = 'Tern'
    }
  }, [share?.node.name])

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    if (!password) {
      setUnlockError('请输入访问密码')
      return
    }
    setUnlocking(true)
    setUnlockError(null)
    try {
      const result = await api.publicShares.unlock(token, password)
      setAccessToken(result.accessToken)
      try {
        sessionStorage.setItem(`cd.share.${token}`, result.accessToken)
      } catch {
        // ignore storage failures
      }
      setPassword('')
    } catch (err) {
      setUnlockError(errorMessage(err))
    } finally {
      setUnlocking(false)
    }
  }

  const kind = share ? fileKind(share.node) : 'other'
  const mode = previewMode(kind)
  const isFolder = share?.node.type === 'folder'
  const expired = share?.expired ?? false
  const gate = Boolean(share?.hasPassword && !accessToken)
  const contentUrl =
    token && share ? publicShareContentUrl(token, accessToken) : ''
  const downloadUrl =
    token && share ? publicShareContentUrl(token, accessToken, true) : ''

  return (
    <div className="public-page">
      <header className="public-topbar">
        <Link to="/" className="public-brand" aria-label="Tern 首页">
          <Logo size={30} />
        </Link>
        <div className="public-top-actions">
          <span className="public-server-name">{serverName}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
            aria-label={resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="public-main">
        {loading ? (
          <div className="public-card public-state-card">
            <Spinner size={26} />
            <p>正在打开分享…</p>
          </div>
        ) : notFound ? (
          <div className="public-card public-state-card">
            <span className="public-state-icon">
              <Unlink size={28} />
            </span>
            <h1>分享不存在或已过期</h1>
            <p>这个链接可能已被删除、已经过期，或者地址不完整。</p>
            <Link className="btn btn-soft" to="/">
              返回 Tern
            </Link>
          </div>
        ) : error ? (
          <div className="public-card public-state-card">
            <span className="public-state-icon">
              <AlertCircle size={28} />
            </span>
            <h1>无法打开分享</h1>
            <p>{error}</p>
            <Button variant="soft" icon={<RefreshCw size={15} />} onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : share ? (
          expired ? (
            <div className="public-card public-state-card">
              <span className="public-state-icon">
                <Unlink size={28} />
              </span>
              <h1>分享已过期</h1>
              <p>这条分享链接已经超过有效期，请联系分享者重新创建一个。</p>
              <Link className="btn btn-soft" to="/">
                返回 Tern
              </Link>
            </div>
          ) : (
            <article className="public-card public-share-card">
              <header className="public-owner">
                <Avatar name={share.ownerName} size={38} />
                <div>
                  <p>
                    <strong>{share.ownerName}</strong> 分享了{isFolder ? '一个文件夹' : '一个文件'}
                  </p>
                  <span>{formatExpiry(share.expiresAt)}</span>
                </div>
                <span className="public-secure">
                  <ShieldCheck size={14} /> 安全分享
                </span>
              </header>

              <div className="public-file-head">
                <NodeIcon node={share.node} size={52} />
                <div className="public-file-title">
                  <h1 title={share.node.name}>{share.node.name}</h1>
                  <p>
                    {kindLabel(kind)}
                    {!isFolder ? ` · ${formatBytes(share.node.size)}` : ''}
                  </p>
                </div>
              </div>

              {gate ? (
                <div className="public-gate">
                  <span className="public-gate-icon">
                    <Lock size={24} />
                  </span>
                  <h2>此分享受密码保护</h2>
                  <p>输入分享者提供的密码即可访问。</p>
                  <form className="public-gate-form" onSubmit={unlock}>
                    <TextField
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="请输入访问密码"
                      aria-label="访问密码"
                      autoFocus
                      trailing={
                        <button
                          type="button"
                          className="input-eye"
                          onClick={() => setShowPassword((value) => !value)}
                          aria-label={showPassword ? '隐藏密码' : '显示密码'}
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      }
                    />
                    <Button type="submit" loading={unlocking} icon={<Lock size={15} />}>
                      访问文件
                    </Button>
                  </form>
                  {unlockError && (
                    <p className="field-error" role="alert">
                      {unlockError}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className={`public-preview is-${mode ?? 'none'}`}>
                    {isFolder ? (
                      <div className="public-preview-fallback">
                        <NodeIcon node={share.node} size={72} />
                        <p>文件夹内容会打包为 ZIP 下载。</p>
                      </div>
                    ) : mode === 'image' ? (
                      <ShareImage src={contentUrl} alt={share.node.name} />
                    ) : mode === 'video' ? (
                      <video className="public-video" src={contentUrl} controls playsInline preload="metadata" />
                    ) : mode === 'audio' ? (
                      <div className="public-audio">
                        <NodeIcon node={share.node} size={64} />
                        <audio src={contentUrl} controls preload="metadata" />
                      </div>
                    ) : mode === 'pdf' ? (
                      <iframe src={contentUrl} title={share.node.name} className="public-pdf" />
                    ) : mode === 'text' ? (
                      share.node.size > 2 * 1024 * 1024 ? (
                        <div className="public-preview-fallback">
                          <p>文件较大，请下载后查看。</p>
                        </div>
                      ) : (
                        <ShareTextPreview token={token ?? ''} accessToken={accessToken} />
                      )
                    ) : (
                      <div className="public-preview-fallback">
                        <NodeIcon node={share.node} size={64} />
                        <p>这种文件类型暂不支持在线预览，请下载后查看。</p>
                      </div>
                    )}
                  </div>

                  <div className="public-actions">
                    <a className="btn btn-primary" href={downloadUrl} download>
                      <Download size={16} />
                      <span>{isFolder ? '下载 ZIP' : '下载文件'}</span>
                    </a>
                    {!isFolder && mode && mode !== 'text' && (
                      <a
                        className="btn btn-ghost"
                        href={contentUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={15} />
                        <span>新窗口打开</span>
                      </a>
                    )}
                  </div>
                </>
              )}

              <footer className="public-share-foot">
                <ShieldCheck size={14} />
                <span>
                  由 {serverName} 提供 · v{version}
                </span>
              </footer>
            </article>
          )
        ) : null}
      </main>

      <footer className="public-page-foot">
        <Logo size={22} showWordmark={false} />
        <span>Tern · 私有云盘</span>
        <span className="auth-foot-dot">·</span>
        <Link to="/">登录我的云盘</Link>
      </footer>
    </div>
  )
}
