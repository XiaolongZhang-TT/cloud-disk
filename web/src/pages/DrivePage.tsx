import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CloudUpload,
  FolderOpen,
  FolderPlus,
  Upload,
} from 'lucide-react'
import type { ChangeEvent, DragEvent as ReactDragEvent } from 'react'
import { api, errorMessage } from '../lib/api'
import type { Crumb, FolderListing, SortBy, SortOrder, ViewMode } from '../lib/types'
import { formatBytes, formatNumber } from '../lib/format'
import { useAppData, useAutoRefresh, useSelection } from '../lib/appData'
import { useNodeActions } from '../lib/nodeActions'
import { useToast } from '../lib/toast'
import { useDeleteShortcut } from '../lib/shortcuts'
import { useUpload } from '../lib/upload'
import { FileCollection } from '../components/FileCollection'
import { Breadcrumbs, BulkBar, SortMenu, ViewToggle } from '../components/FileBrowserBits'
import {
  Button,
  EmptyState,
  ErrorState,
  Modal,
  TextField,
} from '../components/ui'

const VIEW_KEY = 'cd.view'
const SORT_KEY = 'cd.sort'

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function readSort(): { by: SortBy; order: SortOrder } {
  try {
    const raw = localStorage.getItem(SORT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { by?: string; order?: string }
      if (
        (parsed.by === 'name' || parsed.by === 'modified' || parsed.by === 'size') &&
        (parsed.order === 'asc' || parsed.order === 'desc')
      ) {
        return { by: parsed.by, order: parsed.order }
      }
    }
  } catch {
    // ignore malformed values
  }
  return { by: 'name', order: 'asc' }
}

export function DrivePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = searchParams.get('folder')
  const { version, refresh } = useAppData()
  const { enqueue } = useUpload()
  const actions = useNodeActions()
  const selection = useSelection()
  const toast = useToast()

  const [listing, setListing] = useState<FolderListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>(readView)
  const [sort, setSort] = useState(readSort)
  const [dragging, setDragging] = useState(false)
  const dragCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const versionRef = useRef(version)

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderError, setNewFolderError] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true)
      setError(null)
      try {
        const data = await api.nodes.list({
          parentId: folderId,
          sort: sort.by,
          order: sort.order,
        })
        setListing(data)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setLoading(false)
      }
    },
    [folderId, sort.by, sort.order],
  )

  const clearSelection = selection.clear
  const retainSelection = selection.retain

  useEffect(() => {
    clearSelection()
    void load(false)
  }, [load, clearSelection])

  useEffect(() => {
    if (versionRef.current === version) return
    versionRef.current = version
    void load(true)
  }, [version, load])

  useEffect(() => {
    if (!listing) return
    retainSelection(listing.items.map((item) => item.id))
  }, [listing, retainSelection])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      // ignore
    }
  }, [view])

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(sort))
    } catch {
      // ignore
    }
  }, [sort])

  useAutoRefresh(() => {
    void load(true)
  }, 30_000)

  const items = listing?.items ?? []
  const title = listing?.folder?.name ?? '全部文件'
  const folderCount = items.filter((item) => item.type === 'folder').length
  const fileCount = items.length - folderCount
  const totalSize = items.reduce((sum, item) => sum + (item.type === 'file' ? item.size : 0), 0)

  const crumbs = useMemo<Crumb[]>(() => {
    const raw = (listing?.breadcrumb ?? []).map((crumb) => ({
      id: crumb.id === 'root' || !crumb.id ? null : crumb.id,
      name: crumb.name,
    }))
    const base: Crumb[] = [{ id: null, name: '全部文件' }]
    for (const crumb of raw) {
      if (crumb.id === null) continue
      base.push(crumb)
    }
    if (listing?.folder && base[base.length - 1]?.id !== listing.folder.id) {
      base.push({ id: listing.folder.id, name: listing.folder.name })
    }
    return base
  }, [listing])

  const subtitle = loading
    ? '正在加载…'
    : items.length === 0
      ? '这里还是空的'
      : `${formatNumber(folderCount)} 个文件夹 · ${formatNumber(fileCount)} 个文件${
          totalSize > 0 ? ` · ${formatBytes(totalSize)}` : ''
        }`

  const navigateTo = (id: string | null) => {
    if (id) setSearchParams({ folder: id })
    else setSearchParams({})
  }

  const handleSortChange = (by: SortBy) => {
    setSort((prev) =>
      prev.by === by
        ? { by, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : { by, order: by === 'name' ? 'asc' : 'desc' },
    )
  }

  const startUpload = (files: File[]) => {
    if (files.length === 0) return
    enqueue(files, folderId, listing?.folder?.name ?? '全部文件')
  }

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    startUpload(files)
    event.target.value = ''
  }

  const isFileDrag = (event: ReactDragEvent) => event.dataTransfer.types.includes('Files')

  const onDragEnter = (event: ReactDragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragCounter.current += 1
    setDragging(true)
  }

  const onDragOver = (event: ReactDragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (event: ReactDragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setDragging(false)
  }

  const onDrop = (event: ReactDragEvent) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    startUpload(Array.from(event.dataTransfer.files ?? []))
  }

  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) {
      setNewFolderError('请输入文件夹名称')
      return
    }
    setCreatingFolder(true)
    setNewFolderError(null)
    try {
      await api.nodes.createFolder({ parentId: folderId, name })
      toast.success(`文件夹「${name}」已创建`)
      setNewFolderOpen(false)
      setNewFolderName('')
      refresh()
    } catch (err) {
      setNewFolderError(errorMessage(err))
    } finally {
      setCreatingFolder(false)
    }
  }

  const selectedNodes = items.filter((node) => selection.selected.has(node.id))

  useDeleteShortcut(selection.selected.size > 0, () => {
    void actions.trashMany(selectedNodes)
  })

  const openNewFolder = () => {
    setNewFolderName('')
    setNewFolderError(null)
    setNewFolderOpen(true)
  }

  const closeNewFolder = () => {
    setNewFolderOpen(false)
    setNewFolderError(null)
  }


  return (
    <div
      className={`drive-page ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="visually-hidden"
        onChange={onFilePicked}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="page-head">
        {folderId && <Breadcrumbs crumbs={crumbs} onNavigate={navigateTo} />}
        <div className="page-title-row">
          <div className="page-title">
            <h1>{title}</h1>
            <p className="page-subtitle">{subtitle}</p>
          </div>
          <div className="page-actions">
            <SortMenu
              by={sort.by}
              order={sort.order}
              onChange={handleSortChange}
              onOrderChange={(order) => setSort((prev) => ({ ...prev, order }))}
            />
            <ViewToggle view={view} onChange={setView} />
            <Button
              variant="soft"
              icon={<FolderPlus size={16} />}
              onClick={openNewFolder}
              className="new-folder-btn"
              aria-label="新建文件夹"
              title="新建文件夹"
            >
              <span className="hide-mobile">新建文件夹</span>
            </Button>
            <Button icon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>
              上传
            </Button>
          </div>
        </div>
      </div>

      {error && !listing ? (
        <ErrorState description={error} onRetry={() => void load(false)} />
      ) : (
        <FileCollection
          nodes={items}
          view={view}
          selected={selection.selected}
          loading={loading}
          onOpen={(node) => actions.open(node, items)}
          onToggleSelect={(node) => selection.toggle(node.id)}
          onSelectAll={() => selection.selectAll(items.map((item) => item.id))}
          sort={{ by: sort.by, order: sort.order, onChange: handleSortChange }}
          empty={
            <EmptyState
              icon={folderId ? <FolderOpen size={28} /> : <CloudUpload size={28} />}
              title={folderId ? '这个文件夹是空的' : '开始使用你的云屿'}
              description={
                folderId
                  ? '把文件拖到这里，或点击右上角「上传」开始整理。'
                  : '上传第一个文件，或新建一个文件夹来整理你的内容。所有数据都保存在你自己的服务器上。'
              }
              action={
                <div className="empty-actions">
                  <Button icon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>
                    上传文件
                  </Button>
                  <Button variant="soft" icon={<FolderPlus size={16} />} onClick={openNewFolder}>
                    新建文件夹
                  </Button>
                </div>
              }
            />
          }
        />
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <span className="drop-icon">
              <CloudUpload size={34} />
            </span>
            <h3>松开以上传</h3>
            <p>
              文件将保存到「{title}」{folderId ? '' : '根目录'}
            </p>
          </div>
        </div>
      )}

      <BulkBar
        count={selection.selected.size}
        onDownload={() => actions.downloadMany(selectedNodes)}
        onDelete={() => void actions.trashMany(selectedNodes)}
        onClear={selection.clear}
      />

      <Modal
        open={newFolderOpen}
        onClose={closeNewFolder}
        title="新建文件夹"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeNewFolder}>
              取消
            </Button>
            <Button onClick={() => void createFolder()} loading={creatingFolder}>
              创建
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void createFolder()
          }}
        >
          <TextField
            label="文件夹名称"
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="例如：项目资料"
            autoFocus
            maxLength={200}
            error={newFolderError}
            hint={`将创建在「${title}」`}
          />
        </form>
      </Modal>
    </div>
  )
}
