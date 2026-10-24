import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Download,
  Eye,
  FolderOpen,
  History,
  Info,
  Move,
  Pencil,
  Share2,
  Star,
  Trash2,
} from 'lucide-react'
import type { DirNode } from './types'
import { api, errorMessage, nodeDownloadUrl } from './api'
import { triggerDownload } from './format'
import { useAppData } from './appData'
import { useConfirm } from './confirm'
import { useToast } from './toast'
import { ContextMenu } from '../components/ContextMenu'
import type { ContextMenuItem } from '../components/ContextMenu'
import { DetailsDialog, MoveDialog, RenameDialog, ShareDialog, VersionHistoryDialog } from '../components/NodeDialogs'
import { PreviewModal } from '../components/PreviewModal'

interface MenuState {
  node: DirNode
  x: number
  y: number
}

interface PreviewState {
  nodes: DirNode[]
  index: number
}

interface NodeActionsValue {
  open: (node: DirNode, siblings?: DirNode[]) => void
  preview: (nodes: DirNode[], nodeId: string) => void
  rename: (node: DirNode) => void
  move: (node: DirNode) => void
  share: (node: DirNode) => void
  history: (node: DirNode) => void
  details: (node: DirNode) => void
  trash: (node: DirNode) => Promise<void>
  trashMany: (nodes: DirNode[]) => Promise<void>
  toggleStar: (node: DirNode) => Promise<void>
  download: (node: DirNode) => void
  downloadMany: (nodes: DirNode[]) => void
  menu: (node: DirNode, event: ReactMouseEvent<HTMLElement>) => void
  menuAt: (node: DirNode, x: number, y: number) => void
}

const NodeActionsContext = createContext<NodeActionsValue | null>(null)

export function NodeActionsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { refresh } = useAppData()
  const confirm = useConfirm()
  const toast = useToast()

  const [menuState, setMenuState] = useState<MenuState | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [renaming, setRenaming] = useState<DirNode | null>(null)
  const [moving, setMoving] = useState<DirNode | null>(null)
  const [sharing, setSharing] = useState<DirNode | null>(null)
  const [history, setHistory] = useState<DirNode | null>(null)
  const [details, setDetails] = useState<DirNode | null>(null)

  const previewFiles = useCallback((nodes: DirNode[], nodeId: string) => {
    const files = nodes.filter((item) => item.type === 'file')
    const target = files.find((item) => item.id === nodeId)
    if (!target) {
      const single = nodes.find((item) => item.id === nodeId)
      if (single) setPreview({ nodes: [single], index: 0 })
      return
    }
    setPreview({ nodes: files, index: files.indexOf(target) })
  }, [])

  const open = useCallback(
    (node: DirNode, siblings?: DirNode[]) => {
      if (node.type === 'folder') {
        navigate(`/?folder=${encodeURIComponent(node.id)}`)
        return
      }
      previewFiles(siblings ?? [node], node.id)
    },
    [navigate, previewFiles],
  )

  const download = useCallback((node: DirNode) => {
    triggerDownload(nodeDownloadUrl(node.id))
  }, [])

  const downloadMany = useCallback(
    (nodes: DirNode[]) => {
      if (nodes.length === 0) return
      toast.info(`正在开始下载 ${nodes.length} 个项目…`)
      nodes.forEach((node, index) => {
        window.setTimeout(() => triggerDownload(nodeDownloadUrl(node.id)), index * 280)
      })
    },
    [toast],
  )

  const trash = useCallback(
    async (node: DirNode) => {
      const ok = await confirm({
        title: '移到回收站？',
        message: `「${node.name}」将被移入回收站，之后可以随时恢复。`,
        confirmText: '移到回收站',
        danger: true,
      })
      if (!ok) return
      try {
        await api.nodes.remove(node.id)
        toast.success('已移到回收站')
        refresh()
      } catch (error) {
        toast.error(errorMessage(error))
      }
    },
    [confirm, refresh, toast],
  )

  const trashMany = useCallback(
    async (nodes: DirNode[]) => {
      if (nodes.length === 0) return
      const ok = await confirm({
        title: `删除 ${nodes.length} 个项目？`,
        message: '这些项目将被移入回收站，之后可以随时恢复。',
        confirmText: '移到回收站',
        danger: true,
      })
      if (!ok) return
      try {
        await Promise.all(nodes.map((node) => api.nodes.remove(node.id)))
        toast.success(`已将 ${nodes.length} 个项目移到回收站`)
        refresh()
      } catch (error) {
        toast.error(errorMessage(error))
        refresh()
      }
    },
    [confirm, refresh, toast],
  )

  const toggleStar = useCallback(
    async (node: DirNode) => {
      try {
        await api.nodes.update(node.id, { starred: !node.starred })
        toast.success(node.starred ? '已取消收藏' : '已收藏')
        refresh()
      } catch (error) {
        toast.error(errorMessage(error))
      }
    },
    [refresh, toast],
  )

  const menuAt = useCallback((node: DirNode, x: number, y: number) => {
    setMenuState({ node, x, y })
  }, [])

  const menu = useCallback((node: DirNode, event: ReactMouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 224
    setMenuState({
      node,
      x: Math.min(rect.right - width, window.innerWidth - width - 8),
      y: rect.bottom + 6,
    })
  }, [])

  const value = useMemo<NodeActionsValue>(
    () => ({
      open,
      preview: previewFiles,
      rename: (node) => setRenaming(node),
      move: (node) => setMoving(node),
      share: (node) => setSharing(node),
      history: (node) => setHistory(node),
      details: (node) => setDetails(node),
      trash,
      trashMany,
      toggleStar,
      download,
      downloadMany,
      menu,
      menuAt,
    }),
    [
      open,
      previewFiles,
      trash,
      trashMany,
      toggleStar,
      download,
      downloadMany,
      menu,
      menuAt,
    ],
  )

  const menuItems: ContextMenuItem[] = menuState
    ? [
        {
          key: 'open',
          label: menuState.node.type === 'folder' ? '打开' : '预览',
          icon: menuState.node.type === 'folder' ? <FolderOpen size={16} /> : <Eye size={16} />,
          onClick: () => open(menuState.node),
        },
        {
          key: 'download',
          label: menuState.node.type === 'folder' ? '下载 ZIP' : '下载',
          icon: <Download size={16} />,
          onClick: () => download(menuState.node),
        },
        { key: 'sep-1', label: '', separator: true },
        {
          key: 'rename',
          label: '重命名',
          icon: <Pencil size={16} />,
          onClick: () => setRenaming(menuState.node),
        },
        {
          key: 'move',
          label: '移动到…',
          icon: <Move size={16} />,
          onClick: () => setMoving(menuState.node),
        },
        {
          key: 'star',
          label: menuState.node.starred ? '取消收藏' : '收藏',
          icon: <Star size={16} fill={menuState.node.starred ? 'currentColor' : 'none'} />,
          onClick: () => void toggleStar(menuState.node),
        },
        {
          key: 'share',
          label: '分享',
          icon: <Share2 size={16} />,
          onClick: () => setSharing(menuState.node),
        },
        ...(menuState.node.type === 'file'
          ? [{
              key: 'history',
              label: '历史版本',
              icon: <History size={16} />,
              onClick: () => setHistory(menuState.node),
            }]
          : []),
        {
          key: 'details',
          label: '详细信息',
          icon: <Info size={16} />,
          onClick: () => setDetails(menuState.node),
        },
        { key: 'sep-2', label: '', separator: true },
        {
          key: 'trash',
          label: '移到回收站',
          icon: <Trash2 size={16} />,
          danger: true,
          onClick: () => void trash(menuState.node),
        },
      ]
    : []

  return (
    <NodeActionsContext.Provider value={value}>
      {children}
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={menuItems}
          onClose={() => setMenuState(null)}
        />
      )}
      {preview && (
        <PreviewModal
          nodes={preview.nodes}
          index={preview.index}
          onChangeIndex={(index) => setPreview((prev) => (prev ? { ...prev, index } : prev))}
          onClose={() => setPreview(null)}
        />
      )}
      <RenameDialog node={renaming} onClose={() => setRenaming(null)} />
      <MoveDialog node={moving} onClose={() => setMoving(null)} />
      <ShareDialog node={sharing} onClose={() => setSharing(null)} />
      <VersionHistoryDialog node={history} onClose={() => setHistory(null)} />
      <DetailsDialog node={details} onClose={() => setDetails(null)} />
    </NodeActionsContext.Provider>
  )
}

export function useNodeActions(): NodeActionsValue {
  const ctx = useContext(NodeActionsContext)
  if (!ctx) throw new Error('useNodeActions must be used inside NodeActionsProvider')
  return ctx
}
