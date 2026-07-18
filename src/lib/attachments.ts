// Attachment classification shared by the composer (pending previews) and the chat
// bubbles (sent-message rendering), so a file looks the same everywhere.
//
// `kind` picks the render strategy (image thumbnail / video player / audio player /
// file card). `fileDescriptor` derives a human label, colored icon key, and short
// extension for the file-card UI. Framework-free on purpose — the icon key is mapped
// to a Lucide component in AttachmentCard so this stays a pure module.

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file'

export function classifyKind(mime: string | undefined, name?: string): AttachmentKind {
  const m = (mime ?? '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  // Some files arrive with an empty/generic mime (application/octet-stream) — fall
  // back to the extension so e.g. a .png dragged from a zip still previews.
  const ext = extOf(name)
  if (!m || m === 'application/octet-stream') {
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'].includes(ext)) return 'image'
    if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext)) return 'video'
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'].includes(ext)) return 'audio'
  }
  return 'file'
}

export type FileIconKey = 'pdf' | 'doc' | 'sheet' | 'slides' | 'text' | 'code' | 'archive' | 'image' | 'video' | 'audio' | 'file'

export interface FileDescriptor {
  label: string      // short type label, e.g. "PDF", "DOCX", "CSV"
  ext: string        // lowercase extension without dot, e.g. "pdf"
  icon: FileIconKey
  color: string      // accent hex for the icon tile (reads on light + dark)
}

function extOf(name?: string): string {
  if (!name) return ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

// Maps extension → (icon, color). mime is a secondary signal for the ambiguous cases.
const BY_EXT: Record<string, { icon: FileIconKey; color: string }> = {}
const define = (icon: FileIconKey, color: string, exts: string[]) => exts.forEach(e => { BY_EXT[e] = { icon, color } })
define('pdf', '#e5484d', ['pdf'])
define('doc', '#4c7ef3', ['doc', 'docx', 'odt', 'rtf', 'pages'])
define('sheet', '#30a46c', ['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'])
define('slides', '#e5751f', ['ppt', 'pptx', 'odp', 'key'])
define('text', '#8b95a5', ['txt', 'md', 'markdown', 'log', 'text'])
define('code', '#9d5bd2', ['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cc', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql', 'html', 'htm', 'css', 'scss', 'vue', 'svelte'])
define('archive', '#d9a441', ['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'])

// Order matters: the Office openxml mimes all contain "officedocument", so match the
// specific sub-type (spreadsheetml/presentationml/wordprocessingml) before any generic
// "document" fallback.
const MIME_HINTS: { test: RegExp; icon: FileIconKey; color: string }[] = [
  { test: /pdf/, icon: 'pdf', color: '#e5484d' },
  { test: /spreadsheet|excel|csv/, icon: 'sheet', color: '#30a46c' },
  { test: /presentation|powerpoint/, icon: 'slides', color: '#e5751f' },
  { test: /wordprocessing|msword|opendocument\.text/, icon: 'doc', color: '#4c7ef3' },
  { test: /zip|compress|tar|x-7z|rar/, icon: 'archive', color: '#d9a441' },
  { test: /json|xml|yaml|javascript|typescript|x-sh|x-python/, icon: 'code', color: '#9d5bd2' },
  { test: /^text\//, icon: 'text', color: '#8b95a5' },
]

export function fileDescriptor(mime: string | undefined, name?: string): FileDescriptor {
  const ext = extOf(name)
  const m = (mime ?? '').toLowerCase()
  let hit = ext ? BY_EXT[ext] : undefined
  if (!hit) hit = MIME_HINTS.find(h => h.test.test(m))
  const icon = hit?.icon ?? 'file'
  const color = hit?.color ?? '#8b95a5'
  const label = ext ? ext.toUpperCase() : (m.split('/')[1]?.toUpperCase() || 'FILE')
  return { label, ext, icon, color }
}
