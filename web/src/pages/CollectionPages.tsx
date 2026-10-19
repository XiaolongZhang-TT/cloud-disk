import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Clock3, SearchX, Search as SearchIcon, Star } from 'lucide-react'
import type { DirNode, ViewMode } from '../lib/types'
import { api, errorMessage } from '../lib/api'
import { useAppData, useAutoRefresh, useSelection } from '../lib/appData'
import { useNodeActions } from '../lib/nodeActions'
import { useDeleteShortcut } from '../lib/shortcuts'
import { FileCollection } from '../components/FileCollection'
import { BulkBar, ViewToggle } from '../components/FileBrowserBits'
import { Button, EmptyState, ErrorState } from '../components/ui'

const VIEW_KEY = 'cd.view'

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

interface CollectionPageProps {
  title: string
  subtitle: string
  fetcher: () => Promise<DirNode[]>
  empty: ReactNode
}

function CollectionPage({ title, subtitle, fetcher, empty }: CollectionPageProps) {
  const { version } = useAppData()
  const actions = useNodeActions()
  const selection = useSelection()
  const [items, setItems] = useState<DirNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>(readView)
  const fetcherRef = useRef(fetcher)
  const versionRef = useRef(version)

  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      // ignore
    }
  }, [view])

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const next = await fetcherRef.current()
      setItems(next)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void load(false)
  }, [fetcher, load])

  useEffect(() => {
    if (versionRef.current === version) return
    versionRef.current = version
    void load(true)
  }, [version, load])

  useAutoRefresh(() => {
    void load(true)
  }, 30_000)

  const { retain } = selection
  useEffect(() => {
    retain(items.map((item) => item.id))
  }, [items, retain])

  const selectedNodes = items.filter((node) => selection.selected.has(node.id))

  useDeleteShortcut(selection.selected.size > 0, () => {
    void actions.trashMany(selectedNodes)
  })

  return (
    <div className="collection-page">
      <div className="page-head">
        <div className="page-title-row">
          <div className="page-title">
            <h1>{title}</h1>
            <p className="page-subtitle">
              {subtitle}
              {!loading && items.length > 0 ? ` · ${items.length} 个项目` : ''}
            </p>
          </div>
          <div className="page-actions">
            <ViewToggle view={view} onChange={setView} />
          </div>
        </div>
      </div>

      {error && items.length === 0 ? (
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
          empty={empty}
        />
      )}

      <BulkBar
        count={selection.selected.size}
        onDownload={() => actions.downloadMany(selectedNodes)}
        onDelete={() => void actions.trashMany(selectedNodes)}
        onClear={selection.clear}
      />
    </div>
  )
}

export function RecentPage() {
  const navigate = useNavigate()
  const fetcher = useCallback(async () => (await api.recent(60)).items, [])
  return (
    <CollectionPage
      title="最近"
      subtitle="最近修改和上传的项目"
      fetcher={fetcher}
      empty={
        <EmptyState
          icon={<Clock3 size={28} />}
          title="还没有最近项目"
          description="你上传或修改过的文件会出现在这里。"
          action={
            <Button variant="soft" onClick={() => navigate('/')}>
              去我的文件
            </Button>
          }
        />
      }
    />
  )
}

export function StarredPage() {
  const navigate = useNavigate()
  const fetcher = useCallback(async () => {
    const { items } = await api.starred(100)
    return items
  }, [])
  return (
    <CollectionPage
      title="收藏"
      subtitle="你标记为重要的项目"
      fetcher={fetcher}
      empty={
        <EmptyState
          icon={<Star size={28} />}
          title="还没有收藏"
          description="在文件上打开更多菜单，选择「收藏」，就能在这里快速找到它。"
          action={
            <Button variant="soft" onClick={() => navigate('/')}>
              浏览我的文件
            </Button>
          }
        />
      }
    />
  )
}

export function SearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const query = (params.get('q') ?? '').trim()
  const fetcher = useCallback(async () => {
    if (!query) return []
    const result = await api.search(query, 80)
    return result.items
  }, [query])

  useEffect(() => {
    if (!query) return
    document.title = `搜索「${query}」 · 云屿 CloudDisk`
    return () => {
      document.title = '云屿 CloudDisk'
    }
  }, [query])

  if (!query) {
    return (
      <div className="collection-page">
        <div className="page-head">
          <div className="page-title-row">
            <div className="page-title">
              <h1>搜索</h1>
              <p className="page-subtitle">在文件与文件夹名称中查找内容</p>
            </div>
          </div>
        </div>
        <EmptyState
          icon={<SearchIcon size={28} />}
          title="搜索你的云屿"
          description="在顶部搜索框中输入文件名或文件夹名，按回车开始搜索。"
        />
      </div>
    )
  }

  return (
    <CollectionPage
      title={`搜索“${query}”`}
      subtitle="匹配文件与文件夹名称"
      fetcher={fetcher}
      empty={
        <EmptyState
          icon={<SearchX size={28} />}
          title={`没有找到与“${query}”相关的内容`}
          description="试试更短的关键词，或检查一下有没有输入错误。"
          action={
            <Button variant="soft" onClick={() => navigate('/')}>
              返回全部文件
            </Button>
          }
        />
      }
    />
  )
}
