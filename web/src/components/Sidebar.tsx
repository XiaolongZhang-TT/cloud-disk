import { NavLink, useNavigate } from 'react-router-dom'
import {
  ChevronUp,
  Clock3,
  FolderOpen,
  HardDrive,
  LogOut,
  Settings,
  Share2,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useAppData } from '../lib/appData'
import { useToast } from '../lib/toast'
import { formatBytes, formatQuota, usagePercent } from '../lib/format'
import { Logo } from './Logo'
import { Avatar, Dropdown, Spinner } from './ui'

const NAV_ITEMS = [
  { to: '/', label: '全部文件', icon: FolderOpen, end: true },
  { to: '/recent', label: '最近', icon: Clock3, end: false },
  { to: '/starred', label: '收藏', icon: Star, end: false },
  { to: '/shares', label: '分享', icon: Share2, end: false },
  { to: '/trash', label: '回收站', icon: Trash2, end: false },
]

function StorageMeter({ onNavigate }: { onNavigate: () => void }) {
  const { storage, storageLoading } = useAppData()
  const navigate = useNavigate()
  const used = storage?.used ?? 0
  const quota = storage?.quota ?? 0
  const percent = usagePercent(used, quota)
  const near = quota > 0 && percent >= 85

  return (
    <button
      type="button"
      className="storage-card"
      onClick={() => {
        onNavigate()
        navigate('/settings#storage')
      }}
      aria-label="查看存储空间设置"
    >
      <div className="storage-card-head">
        <span className="storage-card-label">
          <HardDrive size={14} /> 存储空间
        </span>
        {storageLoading ? (
          <Spinner size={12} />
        ) : (
          <span className={`storage-percent ${near ? 'is-near' : ''}`}>
            {quota > 0 ? `${Math.round(percent)}%` : '∞'}
          </span>
        )}
      </div>
      <div className={`meter ${quota <= 0 ? 'is-unlimited' : ''}`} aria-hidden="true">
        <span
          className={`meter-fill ${near ? 'is-near' : ''}`}
          style={{ width: quota > 0 ? `${Math.max(percent, 2)}%` : '100%' }}
        />
      </div>
      <div className="storage-card-foot">
        <span>{formatBytes(used)} 已用</span>
        <span>{formatQuota(quota)}</span>
      </div>
    </button>
  )
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  if (!user) return null

  const handleLogout = async () => {
    await logout()
    toast.info('已退出登录')
    navigate('/login', { replace: true })
  }

  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="主导航">
      <div className="sidebar-head">
        <Logo size={34} />
        <button
          type="button"
          className="icon-btn sidebar-close"
          onClick={onClose}
          aria-label="关闭菜单"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="sidebar-nav">
        <p className="nav-label">云盘</p>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
            onClick={onClose}
          >
            <item.icon size={18} strokeWidth={1.9} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <StorageMeter onNavigate={onClose} />

      <Dropdown
        trigger={
          <>
            <Avatar name={user.displayName || user.username} size={34} />
            <span className="user-meta">
              <span className="user-name">{user.displayName || user.username}</span>
              <span className="user-role">{user.role === 'admin' ? '管理员' : '成员'}</span>
            </span>
            <ChevronUp size={15} className="user-chevron" />
          </>
        }
        triggerClassName="user-chip"
        ariaLabel="账户菜单"
        direction="up"
        align="start"
        menuWidth={224}
        header={
          <div className="user-pop-head">
            <Avatar name={user.displayName || user.username} size={38} />
            <div>
              <p className="user-pop-name">{user.displayName || user.username}</p>
              <p className="user-pop-username">@{user.username}</p>
            </div>
          </div>
        }
        items={[
          {
            key: 'settings',
            label: '设置',
            icon: <Settings size={16} />,
            onClick: () => navigate('/settings'),
          },
          {
            key: 'storage',
            label: '存储空间',
            icon: <HardDrive size={16} />,
            onClick: () => navigate('/settings#storage'),
          },
          { key: 'sep', label: '', separator: true },
          {
            key: 'logout',
            label: '退出登录',
            icon: <LogOut size={16} />,
            danger: true,
            onClick: () => void handleLogout(),
          },
        ]}
      />
    </aside>
  )
}
