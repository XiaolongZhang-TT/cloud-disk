import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Download,
  Home,
  LayoutGrid,
  List,
  Trash2,
  X,
} from 'lucide-react'
import type { Crumb, SortBy, SortOrder, ViewMode } from '../lib/types'
import { Dropdown } from './ui'

export function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode
  onChange: (view: ViewMode) => void
}) {
  return (
    <div className="segmented view-toggle" role="group" aria-label="视图切换">
      <button
        type="button"
        className={view === 'grid' ? 'is-active' : ''}
        aria-pressed={view === 'grid'}
        onClick={() => onChange('grid')}
        title="网格视图"
      >
        <LayoutGrid size={16} />
        <span className="visually-hidden">网格视图</span>
      </button>
      <button
        type="button"
        className={view === 'list' ? 'is-active' : ''}
        aria-pressed={view === 'list'}
        onClick={() => onChange('list')}
        title="列表视图"
      >
        <List size={16} />
        <span className="visually-hidden">列表视图</span>
      </button>
    </div>
  )
}

export function SortMenu({
  by,
  order,
  onChange,
  onOrderChange,
}: {
  by: SortBy
  order: SortOrder
  onChange: (by: SortBy) => void
  onOrderChange: (order: SortOrder) => void
}) {
  const labels: Record<SortBy, string> = { name: '名称', modified: '修改时间', size: '大小' }
  return (
    <Dropdown
      trigger={
        <>
          <ArrowUpDown size={16} />
          <span className="sort-btn-label">排序</span>
        </>
      }
      triggerClassName="btn btn-ghost btn-sm sort-btn"
      ariaLabel={`排序方式：${labels[by]} ${order === 'asc' ? '升序' : '降序'}`}
      title="排序方式"
      menuWidth={190}
      items={[
        { key: 'name', label: '名称', checked: by === 'name', onClick: () => onChange('name') },
        {
          key: 'modified',
          label: '修改时间',
          checked: by === 'modified',
          onClick: () => onChange('modified'),
        },
        { key: 'size', label: '大小', checked: by === 'size', onClick: () => onChange('size') },
        { key: 'sep', label: '', separator: true },
        {
          key: 'asc',
          label: '升序排列',
          icon: <ArrowUp size={15} />,
          checked: order === 'asc',
          onClick: () => onOrderChange('asc'),
        },
        {
          key: 'desc',
          label: '降序排列',
          icon: <ArrowDown size={15} />,
          checked: order === 'desc',
          onClick: () => onOrderChange('desc'),
        },
      ]}
    />
  )
}

export function Breadcrumbs({
  crumbs,
  onNavigate,
}: {
  crumbs: Crumb[]
  onNavigate: (id: string | null) => void
}) {
  return (
    <nav className="breadcrumbs" aria-label="当前路径">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <span className="crumb" key={`${crumb.id ?? 'root'}-${index}`}>
            {index > 0 && <ChevronRight size={14} className="crumb-sep" aria-hidden="true" />}
            {isLast ? (
              <span className="crumb-current" aria-current="page">
                {crumb.name}
              </span>
            ) : (
              <button type="button" className="crumb-link" onClick={() => onNavigate(crumb.id)}>
                {index === 0 && <Home size={14} aria-hidden="true" />}
                {crumb.name}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export function BulkBar({
  count,
  onDownload,
  onDelete,
  onClear,
}: {
  count: number
  onDownload: () => void
  onDelete: () => void
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div className="bulkbar" role="toolbar" aria-label="批量操作">
      <span className="bulk-count">
        已选择 <strong>{count}</strong> 项
      </span>
      <span className="bulk-divider" aria-hidden="true" />
      <button type="button" className="bulk-btn" onClick={onDownload}>
        <Download size={16} />
        <span>下载</span>
      </button>
      <button type="button" className="bulk-btn is-danger" onClick={onDelete}>
        <Trash2 size={16} />
        <span>删除</span>
      </button>
      <button type="button" className="bulk-clear" onClick={onClear} aria-label="取消选择">
        <X size={16} />
      </button>
    </div>
  )
}
