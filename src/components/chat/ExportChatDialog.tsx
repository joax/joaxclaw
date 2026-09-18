import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Share2 } from 'lucide-react'
import { Overlay } from '../ui/Overlay'
import { BottomSheet } from '../ui/BottomSheet'
import { Btn } from '../ui/Btn'
import { ProgressTrack } from '../ui/ProgressTrack'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { exportFilename, hasExportableMessages, renderExport, type ExportMeta } from '../../lib/chatExport'
import { readFullHistory, readErrorMessage, type FullHistory } from '../../lib/chatHistoryReader'
import { saveBytesAs, shareOrDownload, canShareFiles } from '../../lib/saveFile'
import { SAVE_MAX_BYTES } from '../../lib/fileContent'
import { agentIdFromSessionKey } from '../../lib/sessionName'
import { useAgentsStore } from '../../store/agents'
import { useChatExportStore, type ExportTarget } from '../../store/chatExport'

// Export a chat as Markdown or JSON (PRD 05): a dialog on desktop, a share sheet on a
// phone. It reads the whole history from the gateway (lib/chatHistoryReader), not what's
// on screen, and never saves a partial read. Rendered once by ChatView for whichever
// chat the header menu or a chat-list row asked for.

/** The file's heading and meta line for a session: its title and agent. */
export function exportMetaFor(target: ExportTarget, exportedAt = new Date()): Omit<ExportMeta, 'running'> {
  const agentId = agentIdFromSessionKey(target.sessionKey)
  const agent = useAgentsStore.getState().agents.find(a => a.id === agentId)
  return { title: target.title, sessionKey: target.sessionKey, agentId, agentName: agent?.identity?.name ?? agent?.name ?? agentId, exportedAt }
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

/** Mounted once; shows the dialog for the store's current target. */
export function ExportChatHost() {
  const target = useChatExportStore(s => s.target)
  const close = useChatExportStore(s => s.close)
  if (!target) return null
  return <ExportChatDialog key={target.sessionKey} target={target} onClose={close} />
}

type Result = { tone: 'success' | 'danger'; text: string } | null

function ExportChatDialog({ target, onClose }: { target: ExportTarget; onClose: () => void }) {
  const narrow = useIsNarrow()
  const share = narrow && canShareFiles()
  const prefs = useChatExportStore(s => s.prefs)
  const setPrefs = useChatExportStore(s => s.setPrefs)
  const [attempt, setAttempt] = useState(0)
  const [progress, setProgress] = useState<{ read: number; total?: number }>({ read: 0 })
  const [history, setHistory] = useState<FullHistory | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [result, setResult] = useState<Result>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const exportedAt = useRef(new Date()).current

  // Read the whole history as soon as the dialog opens (and on Try again). Closing aborts.
  useEffect(() => {
    const ctrl = new AbortController()
    setHistory(null); setReadError(null); setProgress({ read: 0 })
    readFullHistory(target.sessionKey, { signal: ctrl.signal, onProgress: (read, total) => setProgress({ read, total }) })
      .then(setHistory)
      .catch(err => { if (!ctrl.signal.aborted) setReadError(readErrorMessage(err)) })
    return () => ctrl.abort()
  }, [target.sessionKey, attempt])

  const meta = useMemo(() => exportMetaFor(target, exportedAt), [target, exportedAt])
  const empty = !!history && !hasExportableMessages(history.raw)
  const text = useMemo(() => history && !empty ? renderExport(history, meta, prefs.format, prefs) : '', [history, empty, meta, prefs])
  const markdown = useMemo(() => history && !empty ? renderExport(history, meta, 'md', prefs) : '', [history, empty, meta, prefs])
  const preview = useMemo(() => text.split('\n').slice(0, 40).join('\n'), [text])
  const filename = exportFilename(target.title, exportedAt, prefs.format)
  const mediaType = prefs.format === 'json' ? 'application/json' : 'text/markdown'
  const ready = !!history && !empty

  const save = async () => {
    const bytes = new TextEncoder().encode(text)
    if (bytes.length > SAVE_MAX_BYTES) { setResult({ tone: 'danger', text: 'This chat is too large to save from the app (over 32 MB).' }); return }
    setSaving(true); setResult(null)
    try {
      if (share) {
        const res = await shareOrDownload(filename, bytes, mediaType, target.title)
        if (res.downloaded) setResult({ tone: 'success', text: `Downloaded ${filename}` })
        else if (res.error) setResult({ tone: 'danger', text: `Couldn't save the file: ${res.error}` })
      } else {
        const res = await saveBytesAs(filename, bytes, mediaType)
        if (res.ok && res.path) setResult({ tone: 'success', text: `Saved to ${res.path}` })
        else if (res.ok && res.downloaded) setResult({ tone: 'success', text: `Downloaded ${filename}` })
        else if (!res.canceled && res.error) setResult({ tone: 'danger', text: `Couldn't save the file: ${res.error}` })
      }
    } finally { setSaving(false) }
  }

  const copy = async () => {
    if (await copyText(markdown)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else setResult({ tone: 'danger', text: "Couldn't copy. Use Save instead." })
  }

  const status = readError ? null
    : !history ? (progress.total ? `Reading ${progress.total.toLocaleString()} messages…` : 'Reading messages…')
    : null

  const body = (
    <div className="flex flex-col gap-3" style={{ padding: narrow ? '0 16px 12px' : '16px 20px', overflowY: 'auto', minHeight: 0, flex: 1 }}>
      <Field label="Format">
        <div role="radiogroup" aria-label="Format" className="flex items-center gap-1 p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', width: 'fit-content' }}>
          {(['md', 'json'] as const).map(f => (
            <button
              key={f}
              role="radio"
              aria-checked={prefs.format === f}
              onClick={() => setPrefs({ format: f })}
              style={{
                border: 'none', cursor: 'pointer', padding: narrow ? '8px 16px' : '4px 14px', fontSize: 13, fontWeight: 500,
                borderRadius: 'calc(var(--radius) - 2px)',
                background: prefs.format === f ? 'var(--bg-surface)' : 'transparent',
                color: prefs.format === f ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: prefs.format === f ? '0 1px 2px rgba(0,0,0,0.15)' : 'none',
              }}
            >{f === 'md' ? 'Markdown' : 'JSON'}</button>
          ))}
        </div>
      </Field>

      {prefs.format === 'md' ? (
        <Field label="Include">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Check2 label="Tool calls, folded" checked={prefs.tools} onChange={v => setPrefs({ tools: v })} />
            <Check2 label="Reasoning" checked={prefs.reasoning} onChange={v => setPrefs({ reasoning: v })} />
            <Check2 label="Timestamps" checked={prefs.timestamps} onChange={v => setPrefs({ timestamps: v })} />
          </div>
        </Field>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>JSON has every message exactly as the gateway sent it.</p>
      )}

      {/* Progress and results are announced. */}
      <div aria-live="polite" className="flex flex-col gap-2">
        {status && (
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="shrink-0">{status}</span>
            <div style={{ flex: 1, minWidth: 60 }}>
              <ProgressTrack pct={progress.total ? Math.min(100, (progress.read / progress.total) * 100) : null} label="Reading the chat" />
            </div>
            {progress.total ? <span className="font-mono shrink-0">{progress.read.toLocaleString()}/{progress.total.toLocaleString()}</span> : null}
          </div>
        )}
        {readError && (
          <Notice tone="danger">
            <span style={{ flex: 1 }}>Couldn't read this chat from the gateway: {readError}. Try again.</span>
            <Btn size="sm" variant="outline" onClick={() => setAttempt(a => a + 1)}>Try again</Btn>
          </Notice>
        )}
        {empty && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>This chat has no messages yet.</p>}
        {history && !empty && history.unavailable && (
          <Notice tone="warning">The gateway can't show this chat's full history (it's too large). The file will contain what it returned.</Notice>
        )}
        {history && !empty && !history.pagingSupported && (
          <Notice tone="warning">Only the latest {history.raw.length.toLocaleString()} messages could be read.</Notice>
        )}
        {history && !empty && history.truncatedCount > 0 && (
          <Notice tone="warning">{history.truncatedCount.toLocaleString()} long messages were shortened by the gateway.</Notice>
        )}
        {history && !empty && history.activeRun && (
          <Notice tone="warning">This chat is still running. The file has what exists so far.</Notice>
        )}
        {result && <p className="text-xs" style={{ color: result.tone === 'success' ? 'var(--success)' : 'var(--danger)' }}>{result.text}</p>}
        {copied && <span className="sr-only">Copied</span>}
      </div>

      {ready && (
        <pre
          aria-label="Preview"
          style={{
            margin: 0, padding: '10px 12px', maxHeight: narrow ? 160 : 260, overflow: 'auto',
            fontSize: '0.8em', fontFamily: 'monospace', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          }}
        >{preview}</pre>
      )}
    </div>
  )

  const copyLabel = copied ? 'Copied' : narrow ? 'Copy' : 'Copy as Markdown'
  const footer = (
    <div className="flex items-center gap-2 shrink-0" style={{ padding: narrow ? '8px 16px 4px' : '12px 20px', borderTop: narrow ? 'none' : '1px solid var(--border)', justifyContent: 'flex-end' }}>
      <Btn size={narrow ? 'md' : 'sm'} variant="outline" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={copy} disabled={!ready}
        style={narrow ? { flex: 1, minHeight: 40 } : { marginRight: 'auto' }}>
        {copyLabel}
      </Btn>
      {!narrow && <Btn size="sm" variant="ghost" onClick={onClose}>Cancel</Btn>}
      <Btn size={narrow ? 'md' : 'sm'} icon={share ? <Share2 size={13} /> : undefined} onClick={save} disabled={!ready} loading={saving}
        style={narrow ? { flex: 1, minHeight: 40 } : undefined}>
        {share ? 'Share' : 'Save…'}
      </Btn>
    </div>
  )

  if (narrow) {
    return (
      <BottomSheet title={`${share ? 'Share' : 'Export'} "${target.title}"`} onClose={onClose} maxHeight="88vh">
        {body}
        {footer}
      </BottomSheet>
    )
  }
  return (
    <Overlay title={`Export "${target.title}"`} width={480} onClose={onClose} footer={footer}>
      {body}
    </Overlay>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs shrink-0" style={{ width: 56, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </div>
  )
}

function Check2({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-primary)', cursor: 'pointer', minHeight: 28 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
      {label}
    </label>
  )
}

function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
  const color = tone === 'warning' ? 'var(--warning)' : 'var(--danger)'
  return (
    <div className="flex items-center gap-2 text-xs" style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 10%, transparent)`, color: 'var(--text-primary)' }}>
      <AlertTriangle size={12} style={{ color, flexShrink: 0 }} />
      {children}
    </div>
  )
}
