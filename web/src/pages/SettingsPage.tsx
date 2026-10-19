import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Check,
  Database,
  HardDrive,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Server,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react'
import type { ThemeMode } from '../lib/theme'
import { useTheme } from '../lib/theme'
import { useAuth } from '../lib/auth'
import { useAppData } from '../lib/appData'
import { api, errorMessage } from '../lib/api'
import { formatBytes, formatDateTime, formatNumber, formatQuota, usagePercent } from '../lib/format'
import { useToast } from '../lib/toast'
import { Avatar, Badge, Button, Spinner, TextField } from '../components/ui'
import { AdminMembers } from './AdminMembers'

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

export function SettingsPage() {
  const { user, setUser, serverName, version, maxUploadBytes, allowRegistration } = useAuth()
  const { storage, storageLoading } = useAppData()
  const { mode, setMode } = useTheme()
  const toast = useToast()
  const location = useLocation()

  const [profileName, setProfileName] = useState(user?.displayName ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    setProfileName(user?.displayName ?? '')
  }, [user?.displayName])

  useEffect(() => {
    if (location.hash !== '#storage') return
    const element = document.getElementById('storage')
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash, storageLoading])

  if (!user) return null

  const percent = usagePercent(storage?.used ?? 0, storage?.quota ?? 0)
  const unlimited = !storage?.quota || storage.quota <= 0

  const saveProfile = async () => {
    const name = profileName.trim()
    if (!name) {
      toast.error('显示名称不能为空')
      return
    }
    if (name === user.displayName) {
      toast.info('没有需要保存的更改')
      return
    }
    setSavingProfile(true)
    try {
      const { user: updated } = await api.auth.updateMe({ displayName: name })
      setUser(updated)
      toast.success('显示名称已更新')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async () => {
    if (!currentPassword) {
      toast.error('请输入当前密码')
      return
    }
    if (newPassword.length < 6) {
      toast.error('新密码至少需要 6 个字符')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致')
      return
    }
    setSavingPassword(true)
    try {
      const { user: updated } = await api.auth.updateMe({ currentPassword, newPassword })
      setUser(updated)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('密码已更新')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="settings-page">
      <div className="page-head">
        <div className="page-title-row">
          <div className="page-title">
            <h1>设置</h1>
            <p className="page-subtitle">管理账户、安全、存储与外观偏好</p>
          </div>
        </div>
      </div>

      <div className="settings-grid">
        <section className="panel profile-panel">
          <div className="panel-head">
            <div className="panel-head-text">
              <h2 className="panel-title">
                <UserRound size={18} /> 个人资料
              </h2>
              <p className="panel-desc">这些信息会显示在侧边栏与成员列表中。</p>
            </div>
          </div>
          <div className="profile-hero">
            <Avatar name={user.displayName || user.username} size={64} />
            <div className="profile-hero-text">
              <p className="profile-name">{user.displayName || user.username}</p>
              <p className="profile-username">@{user.username}</p>
              <div className="profile-badges">
                <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>
                  {user.role === 'admin' ? '管理员' : '成员'}
                </Badge>
                <span className="profile-since">加入于 {formatDateTime(user.createdAt)}</span>
              </div>
            </div>
          </div>
          <div className="profile-form">
            <TextField
              label="显示名称"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              maxLength={80}
              placeholder="你的名字"
              hint={`用户名 @${user.username} 不可修改`}
            />
            <div className="form-actions">
              <Button
                onClick={() => void saveProfile()}
                loading={savingProfile}
                disabled={profileName.trim() === user.displayName}
              >
                保存资料
              </Button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-text">
              <h2 className="panel-title">
                <KeyRound size={18} /> 密码与安全
              </h2>
              <p className="panel-desc">定期更换密码可以让你的云盘更安全。</p>
            </div>
          </div>
          <div className="stack-form">
            <TextField
              label="当前密码"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
            <TextField
              label="新密码"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              hint="至少 6 个字符"
            />
            <TextField
              label="确认新密码"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
            <div className="form-actions">
              <Button
                variant="soft"
                icon={<ShieldCheck size={16} />}
                onClick={() => void changePassword()}
                loading={savingPassword}
              >
                更新密码
              </Button>
            </div>
          </div>
        </section>

        <section className="panel storage-panel" id="storage">
          <div className="panel-head">
            <div className="panel-head-text">
              <h2 className="panel-title">
                <HardDrive size={18} /> 存储空间
              </h2>
              <p className="panel-desc">这是你在服务器上使用的空间。</p>
            </div>
            <span className="storage-big-percent">
              {unlimited ? '不限' : `${Math.round(percent)}%`}
            </span>
          </div>
          <div className="storage-big">
            <div className="storage-big-figures">
              <span className="storage-used">{formatBytes(storage?.used ?? 0)}</span>
              <span className="storage-total">
                / {formatQuota(storage?.quota ?? 0)}
              </span>
            </div>
            <div className={`meter is-large ${unlimited ? 'is-unlimited' : ''}`} aria-hidden="true">
              <span
                className={`meter-fill ${percent >= 85 ? 'is-near' : ''}`}
                style={{ width: unlimited ? '100%' : `${Math.max(percent, 2)}%` }}
              />
            </div>
            {storageLoading && (
              <div className="storage-loading">
                <Spinner size={14} />
                <span>正在读取存储信息…</span>
              </div>
            )}
          </div>
          <div className="storage-stats">
            <div className="stat">
              <span className="stat-value">{formatNumber(storage?.fileCount ?? 0)}</span>
              <span className="stat-label">文件</span>
            </div>
            <div className="stat">
              <span className="stat-value">{formatNumber(storage?.folderCount ?? 0)}</span>
              <span className="stat-label">文件夹</span>
            </div>
            <div className="stat">
              <span className="stat-value">{formatNumber(storage?.trashCount ?? 0)}</span>
              <span className="stat-label">回收站项目</span>
            </div>
            <div className="stat">
              <span className="stat-value">{formatBytes(storage?.trashSize ?? 0)}</span>
              <span className="stat-label">回收站占用</span>
            </div>
          </div>
          {!unlimited && (
            <p className="panel-note">
              容量由管理员分配，如需更多空间请联系服务器管理员。
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-text">
              <h2 className="panel-title">
                <Palette size={18} /> 外观
              </h2>
              <p className="panel-desc">选择你喜欢的界面主题，设置会保存在此设备。</p>
            </div>
          </div>
          <div className="theme-options">
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon
              const active = mode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`theme-option ${active ? 'is-active' : ''}`}
                  onClick={() => setMode(option.value)}
                  aria-pressed={active}
                >
                  <span className="theme-option-icon">
                    <Icon size={19} />
                  </span>
                  <span className="theme-option-label">{option.label}</span>
                  {active && <Check size={15} className="theme-option-check" />}
                </button>
              )
            })}
          </div>
        </section>

        <section className="panel server-panel">
          <div className="panel-head">
            <div className="panel-head-text">
              <h2 className="panel-title">
                <Server size={18} /> 服务信息
              </h2>
              <p className="panel-desc">关于这台云盘服务器的信息。</p>
            </div>
          </div>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>服务器名称</dt>
              <dd>{serverName}</dd>
            </div>
            <div className="detail-row">
              <dt>版本</dt>
              <dd>v{version}</dd>
            </div>
            <div className="detail-row">
              <dt>单次上传上限</dt>
              <dd>{maxUploadBytes > 0 ? formatBytes(maxUploadBytes) : '由服务器决定'}</dd>
            </div>
            <div className="detail-row">
              <dt>开放注册</dt>
              <dd>{allowRegistration ? '已开启' : '已关闭'}</dd>
            </div>
            <div className="detail-row">
              <dt>数据存储</dt>
              <dd>私有部署 · SQLite + 本地存储</dd>
            </div>
          </dl>
          <div className="server-note">
            <Database size={15} />
            <span>文件保存在你自己的服务器上，不会上传到任何第三方服务。</span>
          </div>
        </section>

        {user.role === 'admin' && <AdminMembers />}
      </div>
    </div>
  )
}
