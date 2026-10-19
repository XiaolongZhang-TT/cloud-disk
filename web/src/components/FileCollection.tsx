import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  MoreHorizontal,
  Star,
} from 'lucide-react'
import type { DirNode, SortBy, SortOrder, ViewMode } from '../lib/types'
import { describeNode, fileKind, formatBytes, formatRelative } from '../lib/format'
import { nodeThumbUrl } from '../lib/api'
import { useNodeActions } from '../lib/nodeActions'
import { FileTypeIcon } from './FileTypeIcon'
import { Skeleton } from './ui'

export interface SortState {
  by: SortBy
  order: SortOrder
  onChange: (by: SortBy) => void
}

interface FileCollectionProps {
  nodes: DirNode[]
  view: ViewMode
  selected: Set<string>
  loading: boolean
  onOpen: (node: DirNode) => void
  onToggleSelect: (node: DirNode) => void
  onSelectAll?: () => void
  sort?: SortState
  empty?: ReactNode
}

function SortIndicator({ active, order }: { active: boolean; order: SortOrder }) {
  if (!active) return null
  return order === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
}

export function FileCollection({
  nodes,
  view,
  selected,
  loading,
  onOpen,
  onToggleSelect,
  onSelectAll,
  sort,
  empty,
}: FileCollectionProps) {
  const actions = useNodeActions()
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(() => new Set())

  if (loading) {
    return view === 'grid' ? <GridSkeleton /> : <ListSkeleton />
  }

  if (nodes.length === 0) return <>{empty}</>

  const handleActivate = (node: DirNode, event: ReactMouseEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      onToggleSelect(node)
      return
    }
    onOpen(node)
  }

  const handleKeyDown = (node: DirNode, event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(node)
    } else if (event.key === ' ') {
      event.preventDefault()
      onToggleSelect(node)
    }
  }

  const handleContextMenu = (node: DirNode, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    actions.menuAt(node, event.clientX, event.clientY)
  }

  const markThumbFailed = (id: string) => {
    setFailedThumbs((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  if (view === 'grid') {
    return (
      <div className="file-grid" role="list" aria-label="文件列表">
        {nodes.map((node) => {
          const kind = fileKind(node)
          const isSelected = selected.has(node.id)
          const showThumb = kind === 'image' && !failedThumbs.has(node.id)
          return (
            <div
              key={node.id}
              role="listitem"
              className={`file-card ${isSelected ? 'is-selected' : ''}`}
              tabIndex={0}
              aria-label={`${node.name}，${node.type === 'folder' ? '文件夹' : '文件'}`}
              onClick={(event) => handleActivate(node, event)}
              onDoubleClick={() => onOpen(node)}
              onKeyDown={(event) => handleKeyDown(node, event)}
              onContextMenu={(event) => handleContextMenu(node, event)}
            >
              <div className={`file-thumb kind-${kind} ${showThumb ? 'has-image' : ''}`}>
                {showThumb ? (
                  <img
                    src={nodeThumbUrl(node.id)}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={() => markThumbFailed(node.id)}
                  />
                ) : (
                  <FileTypeIcon kind={kind} size={54} />
                )}
                <button
                  type="button"
                  className={`select-box ${isSelected ? 'is-checked' : ''}`}
                  aria-label={isSelected ? `取消选择 ${node.name}` : `选择 ${node.name}`}
                  aria-pressed={isSelected}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleSelect(node)
                  }}
                >
                  {isSelected && <Check size={13} strokeWidth={3} />}
                </button>
                <button
                  type="button"
                  className="card-more"
                  aria-label={`${node.name} 的更多操作`}
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.menu(node, event)
                  }}
                >
                  <MoreHorizontal size={17} />
                </button>
                {node.starred && (
                  <span className="card-star" title="已收藏" aria-label="已收藏">
                    <Star size={13} fill="currentColor" />
                  </span>
                )}
              </div>
              <div className="file-card-body">
                <div className="file-name" title={node.name}>
                  {node.name}
                </div>
                <div className="file-meta">{describeNode(node)}</div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const allSelected = nodes.length > 0 && nodes.every((node) => selected.has(node.id))

  return (
    <div className="file-list" role="table" aria-label="文件列表">
      <div className="list-head" role="row">
        <span className="list-check-col" role="columnheader">
          {onSelectAll && (
            <button
              type="button"
              className={`select-box on-light ${allSelected ? 'is-checked' : ''}`}
              aria-label={allSelected ? '取消全选' : '全选'}
              aria-pressed={allSelected}
              onClick={onSelectAll}
            >
              {allSelected && <Check size={13} strokeWidth={3} />}
            </button>
          )}
        </span>
        <button
          type="button"
          className={`list-head-btn name-col ${sort?.by === 'name' ? 'is-active' : ''}`}
          onClick={() => sort?.onChange('name')}
          disabled={!sort}
          role="columnheader"
        >
          名称 <SortIndicator active={sort?.by === 'name'} order={sort?.order ?? 'asc'} />
        </button>
        <button
          type="button"
          className={`list-head-btn size-col ${sort?.by === 'size' ? 'is-active' : ''}`}
          onClick={() => sort?.onChange('size')}
          disabled={!sort}
          role="columnheader"
        >
          大小 <SortIndicator active={sort?.by === 'size'} order={sort?.order ?? 'asc'} />
        </button>
        <button
          type="button"
          className={`list-head-btn modified-col ${sort?.by === 'modified' ? 'is-active' : ''}`}
          onClick={() => sort?.onChange('modified')}
          disabled={!sort}
          role="columnheader"
        >
          修改时间 <SortIndicator active={sort?.by === 'modified'} order={sort?.order ?? 'asc'} />
        </button>
        <span className="list-actions-col" role="columnheader">
          <span className="visually-hidden">操作</span>
        </span>
      </div>
      {nodes.map((node) => {
        const kind = fileKind(node)
        const isSelected = selected.has(node.id)
        return (
          <div
            key={node.id}
            role="row"
            tabIndex={0}
            className={`file-row ${isSelected ? 'is-selected' : ''}`}
            onClick={(event) => handleActivate(node, event)}
            onKeyDown={(event) => handleKeyDown(node, event)}
            onContextMenu={(event) => handleContextMenu(node, event)}
          >
            <span className="list-check-col" role="cell">
              <button
                type="button"
                className={`select-box on-light ${isSelected ? 'is-checked' : ''}`}
                aria-label={isSelected ? `取消选择 ${node.name}` : `选择 ${node.name}`}
                aria-pressed={isSelected}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleSelect(node)
                }}
              >
                {isSelected && <Check size={13} strokeWidth={3} />}
              </button>
            </span>
            <span className="name-col cell-name" role="cell">
              <FileTypeIcon kind={kind} size={36} />
              <span className="cell-name-text">
                <span className="cell-name-title" title={node.name}>
                  {node.name}
                  {node.starred && (
                    <Star
                      size={12}
                      className="cell-star"
                      fill="currentColor"
                      aria-label="已收藏"
                    />
                  )}
                </span>
                <span className="cell-name-sub">
                  {node.type === 'folder' ? '文件夹' : formatBytes(node.size)}
                </span>
              </span>
            </span>
            <span className="size-col cell-muted" role="cell">
              {node.type === 'folder' ? describeNode(node) : formatBytes(node.size)}
            </span>
            <span className="modified-col cell-muted" role="cell">
              {formatRelative(node.updatedAt)}
            </span>
            <span className="list-actions-col" role="cell">
              <button
                type="button"
                className="icon-btn row-more"
                aria-label={`${node.name} 的更多操作`}
                onClick={(event) => {
                  event.stopPropagation()
                  actions.menu(node, event)
                }}
              >
                <MoreHorizontal size={17} />
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="file-grid" aria-busy="true" aria-label="正在加载文件">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="file-card is-skeleton">
          <Skeleton className="skeleton-thumb" />
          <div className="file-card-body">
            <Skeleton className="skeleton-line" style={{ width: '74%' }} />
            <Skeleton className="skeleton-line is-small" style={{ width: '42%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({ count = 7 }: { count?: number }) {
  return (
    <div className="file-list" aria-busy="true" aria-label="正在加载文件">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="file-row is-skeleton">
          <Skeleton className="skeleton-icon" />
          <div className="skeleton-row-text">
            <Skeleton className="skeleton-line" style={{ width: `${30 + ((index * 13) % 35)}%` }} />
            <Skeleton className="skeleton-line is-small" style={{ width: '18%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

