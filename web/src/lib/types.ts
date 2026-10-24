export type NodeType = 'folder' | 'file'

export interface DirNode {
  id: string
  parentId: string | null
  name: string
  type: NodeType
  size: number
  mime: string
  starred: boolean
  createdAt: string
  updatedAt: string
  trashedAt: string | null
  childCount?: number
  sha256?: string | null
}

export interface NodeVersion {
  id: string
  version: number
  size: number
  mime: string | null
  sha256: string | null
  createdAt: string
}

export type UserRole = 'admin' | 'member'

export interface User {
  id: string
  username: string
  displayName: string
  role: UserRole
  quota: number
  used: number
  createdAt: string
}

export interface AuthStatus {
  authenticated: boolean
  setupRequired: boolean
  user?: User
  serverName: string
  version: string
  allowRegistration: boolean
  maxUploadBytes: number
}

export interface PublicConfig {
  serverName: string
  version: string
  allowRegistration: boolean
  maxUploadBytes: number
}

export interface Crumb {
  id: string | null
  name: string
}

export interface FolderListing {
  folder: DirNode | null
  breadcrumb: Array<{ id: string | null; name: string }>
  items: DirNode[]
}

export interface StorageInfo {
  used: number
  quota: number
  fileCount: number
  folderCount: number
  trashCount: number
  trashSize: number
}

export interface Overview {
  storage: StorageInfo
  recent: DirNode[]
  starred: DirNode[]
}

export interface ShareNode {
  id?: string
  name: string
  type: NodeType
  size: number
  mime: string
}

export interface Share {
  id: string
  token: string
  url: string
  node: ShareNode
  hasPassword: boolean
  expiresAt: string | null
  createdAt: string
  downloadCount: number
}

export interface PublicShare {
  token?: string
  node: ShareNode
  ownerName: string
  expired: boolean
  hasPassword: boolean
  expiresAt: string | null
  createdAt?: string
}

export interface UnlockResult {
  accessToken: string
  expiresAt: string
}

export interface MeUpdate {
  displayName?: string
  currentPassword?: string
  newPassword?: string
}

export interface AdminUserInput {
  username: string
  password: string
  displayName?: string
  quotaGb?: number
  role?: UserRole
}

export interface AdminUserPatch {
  displayName?: string
  password?: string
  quotaGb?: number
  role?: UserRole
}

export type SortBy = 'name' | 'modified' | 'size'
export type SortOrder = 'asc' | 'desc'
export type ViewMode = 'grid' | 'list'

export type FileKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'word'
  | 'sheet'
  | 'slides'
  | 'archive'
  | 'code'
  | 'text'
  | 'other'
