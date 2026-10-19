import { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react'
import type { User, UserRole } from '../lib/types'
import { api, errorMessage } from '../lib/api'
import { formatBytes, formatDate, formatQuota, usagePercent } from '../lib/format'
import { useAppData } from '../lib/appData'
import { useAuth } from '../lib/auth'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  Modal,
  SelectField,
  Skeleton,
  TextField,
} from '../components/ui'

const ROLE_OPTIONS = [
  { value: 'member', label: '成员' },
  { value: 'admin', label: '管理员' },
]

interface MemberDialogProps {
  member: User | null
  onClose: () => void
}

function MemberDialog({ member, onClose }: MemberDialogProps) {
  const isNew = member === null
  const [username, setUsername] = useState(member?.username ?? '')
  const [displayName, setDisplayName] = useState(member?.displayName ?? '')
  const [password, setPassword] = useState('')
  const [quotaGb, setQuotaGb] = useState(
    member ? String(Math.round((member.quota / 1024 ** 3) * 10) / 10) : '0',
  )
  const [role, setRole] = useState<UserRole>(member?.role ?? 'member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { refresh } = useAppData()
  const toast = useToast()

  const submit = async () => {
    setError(null)
    if (isNew) {
      if (!username.trim()) {
        setError('请输入用户名')
        return
      }
      if (/\s/.test(username.trim())) {
        setError('用户名不能包含空格')
        return
      }
    }
    if (isNew && password.length < 6) {
      setError('密码至少需要 6 个字符')
      return
    }
    if (!isNew && password.length > 0 && password.length < 6) {
      setError('新密码至少需要 6 个字符')
      return
    }
    const quota = Number(quotaGb)
    if (!Number.isFinite(quota) || quota < 0) {
      setError('容量配额需要是大于等于 0 的数字（0 表示不限制）')
      return
    }
    setSaving(true)
    try {
      if (isNew) {
        await api.admin.create({
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
          quotaGb: quota,
          role,
        })
        toast.success(`已添加成员「${displayName.trim() || username.trim()}」`)
      } else if (member) {
        await api.admin.update(member.id, {
          displayName: displayName.trim(),
          quotaGb: quota,
          role,
          ...(password ? { password } : {}),
        })
        toast.success('成员信息已更新')
      }
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
      open
      onClose={onClose}
      title={isNew ? '添加成员' : `编辑成员「${member?.displayName || member?.username}」`}
      description={isNew ? '新成员可以立即登录并拥有独立的空间。' : undefined}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {isNew ? '添加成员' : '保存修改'}
          </Button>
        </>
      }
    >
      <form
        className="member-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <TextField
          label="用户名"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={!isNew}
          placeholder="例如：zhangsan"
          autoComplete="off"
          autoFocus={isNew}
          hint={isNew ? '用于登录，创建后不可修改' : '用户名不可修改'}
        />
        <TextField
          label="显示名称"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="例如：张三"
          maxLength={80}
        />
        <TextField
          label={isNew ? '登录密码' : '重置密码'}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={isNew ? '至少 6 个字符' : '留空则不修改'}
          autoComplete="new-password"
          hint={isNew ? undefined : '填写后会立即覆盖该成员的原密码'}
        />
        <div className="member-form-row">
          <TextField
            label="容量配额（GB）"
            type="number"
            min={0}
            step={0.5}
            value={quotaGb}
            onChange={(event) => setQuotaGb(event.target.value)}
            hint="0 表示不限制容量"
          />
          <SelectField
            label="角色"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            options={ROLE_OPTIONS}
          />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

export function AdminMembers() {
  const { version, refresh } = useAppData()
  const { user } = useAuth()
  const confirm = useConfirm()
  const toast = useToast()
  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<User | 'new' | null>(null)
  const versionRef = useRef(version)

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const { items } = await api.admin.users()
      setMembers(items)
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

  const removeMember = async (member: User) => {
    const ok = await confirm({
      title: `删除成员「${member.displayName || member.username}」？`,
      message: '该成员账户及其全部文件数据将被永久删除，此操作无法撤销。',
      confirmText: '删除成员',
      danger: true,
    })
    if (!ok) return
    try {
      await api.admin.remove(member.id)
      toast.success('成员已删除')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="panel admin-panel">
      <div className="panel-head">
        <div className="panel-head-text">
          <h2 className="panel-title">
            <Users size={18} /> 成员管理
          </h2>
          <p className="panel-desc">管理这台服务器上的用户、容量配额与角色。</p>
        </div>
        <Button size="sm" icon={<Plus size={15} />} onClick={() => setDialog('new')}>
          添加成员
        </Button>
      </div>

      {loading && members.length === 0 ? (
        <div className="member-list" aria-busy="true" aria-label="正在加载成员">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="member-row is-skeleton" key={index}>
              <Skeleton className="skeleton-avatar" />
              <div className="member-row-main">
                <Skeleton className="skeleton-line" style={{ width: `${30 + index * 9}%` }} />
                <Skeleton className="skeleton-line is-small" style={{ width: '45%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : error && members.length === 0 ? (
        <ErrorState description={error} onRetry={() => void load(false)} />
      ) : members.length === 0 ? (
        <EmptyState
          compact
          icon={<Users size={24} />}
          title="还没有其他成员"
          description="添加成员后，每个人都会拥有独立的空间。"
        />
      ) : (
        <div className="member-list">
          {members.map((member) => {
            const percent = usagePercent(member.used, member.quota)
            const unlimited = !member.quota || member.quota <= 0
            return (
              <div className="member-row" key={member.id}>
                <Avatar name={member.displayName || member.username} size={40} />
                <div className="member-row-main">
                  <div className="member-row-name">
                    <span>{member.displayName || member.username}</span>
                    <span className="member-username">@{member.username}</span>
                    {member.role === 'admin' && <Badge tone="accent">管理员</Badge>}
                    {member.id === user?.id && <Badge tone="neutral">我</Badge>}
                  </div>
                  <div className="member-quota">
                    <div className="meter is-small" aria-hidden="true">
                      <span
                        className={`meter-fill ${percent >= 85 ? 'is-near' : ''}`}
                        style={{ width: unlimited ? '8%' : `${Math.max(percent, 2)}%` }}
                      />
                    </div>
                    <span className="member-quota-text">
                      {formatBytes(member.used)} / {formatQuota(member.quota)}
                    </span>
                    <span className="member-created">加入于 {formatDate(member.createdAt)}</span>
                  </div>
                </div>
                <div className="member-row-actions">
                  <Dropdown
                    trigger={<MoreHorizontal size={17} />}
                    ariaLabel={`${member.displayName || member.username} 的管理操作`}
                    items={[
                      {
                        key: 'edit',
                        label: '编辑成员',
                        icon: <Pencil size={15} />,
                        onClick: () => setDialog(member),
                      },
                      {
                        key: 'sep',
                        label: '',
                        separator: true,
                      },
                      {
                        key: 'delete',
                        label: '删除成员',
                        icon: <Trash2 size={15} />,
                        danger: true,
                        disabled: member.id === user?.id,
                        onClick: () => void removeMember(member),
                      },
                    ]}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="admin-foot">
        <span>共 {members.length} 位成员 · 容量变更即时生效</span>
      </div>

      {dialog !== null && (
        <MemberDialog member={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} />
      )}
    </section>
  )
}
