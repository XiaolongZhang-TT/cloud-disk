import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CloudUpload,
  Eye,
  EyeOff,
  FolderOpen,
  Moon,
  Share2,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { useTheme } from '../lib/theme'
import { useToast } from '../lib/toast'
import { Logo } from '../components/Logo'
import { FileTypeIcon } from '../components/FileTypeIcon'
import { Button, TextField } from '../components/ui'

interface AuthPageProps {
  mode: 'login' | 'setup'
}

export function AuthPage({ mode }: AuthPageProps) {
  const { status, login, setup, register, allowRegistration, serverName, version } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { resolved, setMode } = useTheme()

  const [variant, setVariant] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const from =
    (location.state as { from?: string } | null)?.from && mode === 'login'
      ? (location.state as { from?: string }).from ?? '/'
      : '/'

  if (status?.authenticated) return <Navigate to={from} replace />
  if (status?.setupRequired && mode !== 'setup') return <Navigate to="/setup" replace />
  if (!status?.setupRequired && mode === 'setup') return <Navigate to="/login" replace />

  const isSetup = mode === 'setup'
  const isRegister = !isSetup && variant === 'register'
  const showConfirm = isSetup || isRegister

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!username.trim()) {
      setError('请输入用户名')
      return
    }
    if (!password) {
      setError('请输入密码')
      return
    }
    if (showConfirm) {
      if (password.length < 6) {
        setError('密码至少需要 6 个字符')
        return
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致')
        return
      }
    }
    setSubmitting(true)
    try {
      if (isSetup) {
        const user = await setup({
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
        })
        toast.success(`欢迎，${user.displayName || user.username}`)
        navigate('/', { replace: true })
      } else if (isRegister) {
        const user = await register({
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
        })
        toast.success(`欢迎加入，${user.displayName || user.username}`)
        navigate('/', { replace: true })
      } else {
        const user = await login(username.trim(), password, remember)
        toast.success(`欢迎回来，${user.displayName || user.username}`)
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const headline = isSetup
    ? ['先为这座云屿', '创建一位管理员。']
    : ['把文件安放在', '属于你自己的云上。']
  const eyebrow = isSetup ? '首次运行' : '私有云盘'
  const lead = isSetup
    ? '这台服务器还没有账户。创建第一个管理员账户后，就可以开始使用了。'
    : '云屿 CloudDisk 是一个安静、简单的私有云盘。文件只保存在你自己的服务器里。'

  const cardTitle = isSetup ? '创建管理员账户' : isRegister ? '创建账户' : '欢迎回来'
  const cardDesc = isSetup
    ? '完成设置后即可开始上传和管理文件。'
    : isRegister
      ? '在这台服务器上创建属于你的独立空间。'
      : '登录后继续访问你的文件。'
  const submitLabel = isSetup ? '创建并进入' : isRegister ? '创建账户' : '登录'

  return (
    <div className="auth-page">
      <button
        type="button"
        className="auth-theme-toggle"
        onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
        aria-label={resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        title={resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      >
        {resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <section className="auth-hero" aria-label="云屿 CloudDisk 介绍">
        <div className="auth-hero-inner">
          <div className="auth-brand">
            <Logo size={42} />
          </div>

          <div className="auth-hero-copy">
            <span className="auth-eyebrow">{eyebrow}</span>
            <h1>
              {headline[0]}
              <br />
              {headline[1]}
            </h1>
            <p className="auth-lead">{lead}</p>

            <ul className="auth-features">
              <li>
                <span className="auth-feature-icon">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <strong>完全私有</strong>
                  <span>数据只保存在你的服务器，不上传第三方。</span>
                </div>
              </li>
              <li>
                <span className="auth-feature-icon">
                  <FolderOpen size={18} />
                </span>
                <div>
                  <strong>随手整理</strong>
                  <span>拖拽上传、收藏、最近访问，一应俱全。</span>
                </div>
              </li>
              <li>
                <span className="auth-feature-icon">
                  <Share2 size={18} />
                </span>
                <div>
                  <strong>安心分享</strong>
                  <span>生成带密码与有效期的分享链接。</span>
                </div>
              </li>
            </ul>
          </div>

          <div className="auth-demo" aria-hidden="true">
            <div className="demo-card demo-card-a">
              <FileTypeIcon kind="image" size={34} />
              <div>
                <p>旅行照片</p>
                <span>24 个项目 · 刚更新</span>
              </div>
            </div>
            <div className="demo-card demo-card-b">
              <FileTypeIcon kind="folder" size={34} />
              <div>
                <p>设计稿</p>
                <span>8 个文件夹</span>
              </div>
            </div>
            <div className="demo-upload-card">
              <span className="demo-upload-icon">
                <CloudUpload size={19} />
              </span>
              <div className="demo-upload-main">
                <div className="demo-upload-top">
                  <p>产品视频.mp4</p>
                  <span>72%</span>
                </div>
                <div className="demo-progress">
                  <span />
                </div>
                <span className="demo-upload-meta">12.4 MB / 17.2 MB · 正在上传</span>
              </div>
            </div>
            <div className="demo-share-card">
              <span className="demo-share-icon">
                <Share2 size={16} />
              </span>
              <div>
                <p>分享链接已创建</p>
                <span>有效期 24 小时 · 已复制</span>
              </div>
            </div>
          </div>

          <footer className="auth-hero-foot">
            <span>{serverName}</span>
            <span className="auth-foot-dot">·</span>
            <span>v{version}</span>
          </footer>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-head">
            <h2>{cardTitle}</h2>
            <p>{cardDesc}</p>
          </div>

          {error && (
            <div className="auth-error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={submit} noValidate>
            <TextField
              label="用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              leading={<UserRound size={16} />}
            />

            {showConfirm && (
              <TextField
                label="显示名称（可选）"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：张三"
                maxLength={80}
                autoComplete="nickname"
              />
            )}

            <TextField
              label="密码"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSetup || isRegister ? '至少 6 个字符' : '请输入密码'}
              autoComplete={isSetup || isRegister ? 'new-password' : 'current-password'}
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

            {showConfirm && (
              <TextField
                label="确认密码"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="请再次输入密码"
                autoComplete="new-password"
              />
            )}

            {!isSetup && !isRegister && (
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span>记住我</span>
              </label>
            )}

            <Button type="submit" className="auth-submit" loading={submitting}>
              {submitLabel}
            </Button>
          </form>

          {!isSetup && allowRegistration && (
            <p className="auth-switch">
              {isRegister ? (
                <>
                  已经有账户？
                  <button type="button" onClick={() => setVariant('login')}>
                    返回登录
                  </button>
                </>
              ) : (
                <>
                  没有账户？
                  <button type="button" onClick={() => setVariant('register')}>
                    创建一个
                  </button>
                </>
              )}
            </p>
          )}
          {isSetup && (
            <p className="auth-switch auth-switch-note">此步骤仅在服务器首次运行时出现。</p>
          )}
        </div>

        <p className="auth-panel-foot">
          {isSetup ? '设置完成后即可登录' : '仅供授权用户使用'}
          <span className="auth-foot-dot">·</span>
          云屿 CloudDisk
        </p>
      </section>
    </div>
  )
}
