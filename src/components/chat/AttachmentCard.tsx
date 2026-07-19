import { FileText, FileSpreadsheet, FileCode, FileArchive, File as FileIcon, Presentation, FileVideo, FileAudio } from 'lucide-react'
import { fileDescriptor, type FileIconKey } from '../../lib/attachments'
import { formatBytes } from '../../lib/ollama'

const ICONS: Record<FileIconKey, typeof FileText> = {
  pdf: FileText, doc: FileText, sheet: FileSpreadsheet, slides: Presentation,
  text: FileText, code: FileCode, archive: FileArchive,
  image: FileIcon, video: FileVideo, audio: FileAudio, file: FileIcon,
}

interface Props {
  name?: string
  mediaType?: string
  size?: number
  // Data URL or remote URL — when present the card becomes a download/open link.
  src?: string
  // 'input' = compact card in the composer; 'message' = card inside a chat bubble.
  variant?: 'input' | 'message'
}

// A compact file card: colored format-icon tile + filename + type/size. Used for any
// non-media attachment (PDF, docs, spreadsheets, code, archives, …) in both the
// composer preview and the sent message. Clickable to open/download when `src` is set.
export function AttachmentCard({ name, mediaType, size, src, variant = 'message' }: Props) {
  const desc = fileDescriptor(mediaType, name)
  const Icon = ICONS[desc.icon]

  const inner = (
    <div
      className="flex items-center gap-2.5"
      style={{
        maxWidth: variant === 'message' ? 280 : 200,
        padding: variant === 'message' ? '8px 12px' : '7px 9px',
        borderRadius: 'var(--radius)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: 34, height: 34, borderRadius: 8, background: `color-mix(in srgb, ${desc.color} 18%, transparent)` }}
      >
        <Icon size={18} style={{ color: desc.color }} />
      </div>
      <div className="min-w-0">
        <div className="truncate" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)' }} title={name}>
          {name ?? 'file'}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
          {desc.label}{typeof size === 'number' && size > 0 ? ` · ${formatBytes(size)}` : ''}
        </div>
      </div>
    </div>
  )

  if (!src) return inner
  return (
    <a
      href={src}
      download={name}
      target="_blank"
      rel="noreferrer"
      style={{ textDecoration: 'none', display: 'inline-block' }}
      title={`Open ${name ?? 'file'}`}
    >
      {inner}
    </a>
  )
}
