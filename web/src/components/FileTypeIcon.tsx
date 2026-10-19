import {
  File,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Presentation,
} from 'lucide-react'
import type { DirNode, FileKind } from '../lib/types'
import { fileKind } from '../lib/format'

const ICONS = {
  folder: null,
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileText,
  word: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  archive: FileArchive,
  code: FileCode2,
  text: FileText,
  other: File,
} as const

interface FileTypeIconProps {
  kind: FileKind
  size?: number
  className?: string
}

export function FileTypeIcon({ kind, size = 36, className = '' }: FileTypeIconProps) {
  if (kind === 'folder') {
    return (
      <span
        className={`file-type kind-folder ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 48 48" width={Math.round(size * 0.72)} height={Math.round(size * 0.72)}>
          <path
            d="M5 14.6c0-2.9 2.3-5.2 5.2-5.2h7.9c1.3 0 2.6.5 3.5 1.5l2.3 2.3c.4.4 1 .6 1.6.6H37.8c2.9 0 5.2 2.3 5.2 5.2v15.4c0 2.9-2.3 5.2-5.2 5.2H10.2C7.3 39.6 5 37.3 5 34.4V14.6Z"
            fill="currentColor"
            fillOpacity="0.38"
          />
          <path
            d="M5 20.2c0-2.9 2.3-5.2 5.2-5.2h27.6c2.9 0 5.2 2.3 5.2 5.2v12.8c0 2.9-2.3 5.2-5.2 5.2H10.2C7.3 38.2 5 35.9 5 33V20.2Z"
            fill="currentColor"
            fillOpacity="0.88"
          />
          <path
            d="M6.2 22.4h35.6"
            stroke="#fff"
            strokeOpacity="0.28"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
    )
  }

  const Icon = ICONS[kind]
  return (
    <span
      className={`file-type kind-${kind} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.54)} strokeWidth={1.7} />
    </span>
  )
}

export function NodeIcon({
  node,
  size = 36,
  className = '',
}: {
  node: Pick<DirNode, 'type' | 'name' | 'mime'>
  size?: number
  className?: string
}) {
  return <FileTypeIcon kind={fileKind(node)} size={size} className={className} />
}
