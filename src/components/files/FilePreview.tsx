import { useEffect, useState } from 'react'
import {
  Download, Copy, Check, Maximize2, Minimize2, ExternalLink, X, Loader2, AlertCircle, FileWarning,
} from 'lucide-react'
import { MarkdownContent } from '../chat/MarkdownContent'
import { CodeView } from './CodeView'
import { WorkspaceImage, VideoPlayer } from '../chat/WorkspaceMedia'
import { AudioPlayer } from '../chat/AudioPlayer'
import { fileDescriptor } from '../../lib/attachments'
import { previewMode, fmtBytes } from '../../lib/artifacts'
import { readHostFile, saveHostFileAs, type HostFile } from '../../lib/fileContent'
import { popOutFile } from '../../lib/filePopout'

// The one viewer, used at every zoom level: inside the drawer, expanded over the
// content area, and as the root of a pop-out window. Read-only — the models author
// these documents; the app shows them. See docs/files-drawer.md.

export interface FilePreviewProps {
  path: string
  name?: string
  /** Hide the header when the host chrome already names the file (pop-out window). */
  chrome?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  onClose?: () => void
  /** Hidden in a pop-out window — it's already popped out. */
  canPopOut?: boolean
}

export function FilePreview({
  path, name, chrome = true, expanded, onToggleExpand, onClose, canPopOut = true,
}: FilePreviewProps) {
  const [file, setFile] = useState<HostFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState('')

  const label = name || (path.split('/').pop() ?? path)
  const mode = previewMode(path)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setFile(null)
    void (async () => {
      // Media renders from its own component (which resolves the path itself), so we
      // only fetch bytes here for the textual modes and for the size readout.
      const res = mode === 'image' || mode === 'video' || mode === 'audio'
        ? { ok: true, path } as HostFile
        : await readHostFile(path)
      if (!cancelled) { setFile(res); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [path, mode])

  const handleCopy = async () => {
    if (!file?.text) return
    try {
      await navigator.clipboard.writeText(file.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked — nothing useful to say */ }
  }

  const handleSave = async () => {
    setSaving(true); setSaveNote('')
    const res = await saveHostFileAs(path, label)
    setSaving(false)
    if (res.canceled) return
    setSaveNote(res.ok ? 'Saved' : (res.error ?? 'Could not save'))
    setTimeout(() => setSaveNote(''), 2600)
  }

  return (
    <div className="flex flex-col min-h-0" style={{ flex: 1, background: 'var(--bg-primary)' }}>
      {chrome && (
        <div
          className="flex items-center gap-2 px-3 shrink-0"
          style={{ minHeight: 44, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <FileGlyph path={path} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={label}>{label}</div>
            <div className="text-xs truncate" style={{ color: 'var(--text-secondary)', fontSize: 10 }} title={file?.path ?? path}>
              {file?.path ?? path}{file?.size != null ? ` · ${fmtBytes(file.size)}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {saveNote && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{saveNote}</span>}
            {file?.text != null && (
              <IconBtn title="Copy contents" onClick={handleCopy}>
                {copied ? <Check size={13} style={{ color: 'var(--success)' }} /> : <Copy size={13} />}
              </IconBtn>
            )}
            <IconBtn title="Save a copy to this machine" onClick={handleSave}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            </IconBtn>
            {canPopOut && (
              <IconBtn title="Open in its own window" onClick={() => popOutFile(path, label)}>
                <ExternalLink size={13} />
              </IconBtn>
            )}
            {onToggleExpand && (
              <IconBtn title={expanded ? 'Collapse' : 'Expand'} onClick={onToggleExpand}>
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </IconBtn>
            )}
            {onClose && <IconBtn title="Close" onClick={onClose}><X size={13} /></IconBtn>}
          </div>
        </div>
      )}

      {/* `text-sm` matches the chat bubble exactly. Without it the preview inherited
          `body`, which the <768px rules raise to 15px while `text-sm` stays at
          0.875rem — so file text rendered noticeably larger than the same markdown in
          a chat message. */}
      <div className="flex-1 min-h-0 overflow-y-auto text-sm" style={{ padding: mode === 'markdown' ? '14px 18px' : 12 }}>
        {loading ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Loader2 size={13} className="animate-spin" /> Reading from the gateway host…
          </div>
        ) : file && !file.ok ? (
          <Failed error={file.error} />
        ) : (
          <Body mode={mode} path={path} label={label} file={file} />
        )}
      </div>
    </div>
  )
}

function Body({ mode, path, label, file }: { mode: ReturnType<typeof previewMode>; path: string; label: string; file: HostFile | null }) {
  if (mode === 'image') return <WorkspaceImage src={path} alt={label} />
  if (mode === 'video') return <VideoPlayer src={path} name={label} />
  if (mode === 'audio') return <AudioPlayer attachment={{ type: 'audio', url: path, name: label }} />

  if (mode === 'binary') {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-2" style={{ padding: '32px 16px' }}>
        <FileWarning size={28} style={{ color: 'var(--text-secondary)', opacity: 0.5 }} />
        <div className="text-xs" style={{ color: 'var(--text-secondary)', maxWidth: 320, lineHeight: 1.6 }}>
          There's no preview for {fileDescriptor(undefined, label).label} files. Save a copy to open it
          with an app on this machine.
        </div>
      </div>
    )
  }

  const text = file?.text ?? ''
  if (!text.trim()) return <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>(empty file)</div>

  return (
    <>
      {mode === 'markdown'
        ? <MarkdownContent text={text} />
        : mode === 'code'
          ? <CodeView text={text} path={path} />
          : (
            <pre
              style={{
                // Relative, like the code blocks in chat — so it tracks the app's font
                // size and UI zoom instead of pinning itself to 12px.
                margin: 0, fontSize: '0.85em', fontFamily: 'monospace', lineHeight: 1.55,
                color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >{text}</pre>
          )}
      {file?.truncated && (
        <div className="text-xs" style={{ color: 'var(--text-secondary)', marginTop: 12, opacity: 0.8 }}>
          Showing the first {fmtBytes(new Blob([text]).size)} — save a copy for the whole file.
        </div>
      )}
    </>
  )
}

function Failed({ error }: { error?: string }) {
  return (
    <div className="flex items-start gap-2" style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.6 }}>
      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{error ?? 'Could not read the file.'}</span>
    </div>
  )
}

export function FileGlyph({ path, size = 14 }: { path: string; size?: number }) {
  const d = fileDescriptor(undefined, path.split('/').pop() ?? path)
  return (
    <span
      className="flex items-center justify-center shrink-0 font-semibold"
      style={{
        width: size + 10, height: size + 10, borderRadius: 4, fontSize: size - 5,
        background: `color-mix(in srgb, ${d.color} 18%, transparent)`, color: d.color,
      }}
      title={d.label}
    >
      {(d.ext || '?').slice(0, 3).toUpperCase()}
    </span>
  )
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex items-center justify-center"
      style={{
        width: 26, height: 26, borderRadius: 5, border: '1px solid transparent',
        background: 'none', color: 'var(--text-secondary)', cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'transparent' }}
    >
      {children}
    </button>
  )
}
