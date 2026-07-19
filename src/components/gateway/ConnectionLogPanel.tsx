import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Check, Search } from 'lucide-react'
import { gatewayClient, type ConnLog, REQUESTED_OPERATOR_SCOPES, CRITICAL_OPERATOR_SCOPES } from '../../lib/gateway'
import { useConnectionStore } from '../../store/connection'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'

type DirFilter = 'all' | 'info' | 'out' | 'in'

const DIR_FILTERS: { id: DirFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'info', label: 'Status' },
  { id: 'out', label: 'Sent' },
  { id: 'in', label: 'Received' }
]

// Live view of the gateway connection log (handshake, granted scopes, raw frames).
// Lives under Gateway → Connection so it's reachable *after* connecting — the
// connect screen's copy of this log disappears once the handshake succeeds, which
// is exactly when a scope/permission problem needs inspecting.
export function ConnectionLogPanel(): React.ReactElement {
  const [log, setLog] = useState<ConnLog[]>([])
  const [copied, setCopied] = useState(false)
  const [dir, setDir] = useState<DirFilter>('all')
  const [query, setQuery] = useState('')
  const [hideNoise, setHideNoise] = useState(true)
  const [issuesOnly, setIssuesOnly] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // Granted scopes come straight from the handshake response (reactive via the
  // store) — no need to hunt for them in the raw frames.
  const granted = useConnectionStore(s => s.grantedScopes)
  const status = useConnectionStore(s => s.status)
  const withheld = useMemo(
    () => REQUESTED_OPERATOR_SCOPES.filter(s => !granted.includes(s)),
    [granted]
  )
  const criticalMissing = useMemo(
    () => CRITICAL_OPERATOR_SCOPES.filter(s => !granted.includes(s)),
    [granted]
  )

  useEffect(() => {
    setLog(gatewayClient.getLog().slice(-100))
    return gatewayClient.onLogEntry(entry => setLog(prev => [...prev.slice(-99), entry]))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return log.filter(e => {
      if (dir !== 'all' && e.dir !== dir) return false
      // Periodic health/tick/presence pushes flood the log and drown the frames
      // that actually matter (handshake, errors). Hidden by default.
      if (hideNoise && isNoise(e)) return false
      // "Issues only" — failed responses and anything mentioning a scope/permission
      // or error, so a permission problem is one click away.
      if (issuesOnly && !isIssue(e)) return false
      if (q && !e.text.toLowerCase().includes(q)) return false
      return true
    })
  }, [log, dir, query, hideNoise, issuesOnly])

  // Auto-scroll to the newest visible entry.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [filtered])

  const copyAll = async () => {
    const text = filtered.map(fmtLine).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked — no-op; the log stays selectable in the panel.
    }
  }

  return (
    <div className="space-y-3">
      {/* Granted / withheld scopes — the answer to most permission problems, up front. */}
      {status === 'connected' && (
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Operator scopes granted by the gateway</p>
          <div className="flex flex-wrap gap-1.5">
            {REQUESTED_OPERATOR_SCOPES.map(s => {
              const ok = granted.includes(s)
              return <ScopeChip key={s} label={s} ok={ok} />
            })}
          </div>
          {withheld.length > 0 && (
            <div className="text-xs mt-2 space-y-1" style={{ color: 'var(--danger)' }}>
              <p>
                Withheld: <b>{withheld.join(', ')}</b> — actions needing these will be rejected.
                {criticalMissing.length > 0 && <> The app can’t function without <b>{criticalMissing.join(', ')}</b>.</>}
              </p>
              <p style={{ color: 'var(--text-secondary)' }}>
                This is a gateway-side authorization for your token, not an app setting — the app can
                only request scopes, it can’t grant them. To fix, on the gateway host re-issue the
                operator token with the current scopes (re-pair the device, or rotate its token), then
                paste the new token above and reconnect. Usually happens after an OpenClaw upgrade
                added a scope your older token predates.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Filter controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1" style={{ minWidth: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <Input value={query} onChange={setQuery} placeholder="Filter log (e.g. scope, connect, error)…" style={{ fontSize: 12, paddingLeft: 28 }} />
        </div>
        <div className="flex gap-1">
          {DIR_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setDir(f.id)}
              className="px-2 py-1 text-xs rounded"
              style={{
                background: dir === f.id ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : 'var(--bg-elevated)',
                color: dir === f.id ? 'var(--accent)' : 'var(--text-secondary)',
                border: '1px solid var(--border)', cursor: 'pointer'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Btn size="sm" variant="outline" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={copyAll} disabled={filtered.length === 0}>
          {copied ? 'Copied' : 'Copy'}
        </Btn>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-xs" style={{ color: 'var(--text-secondary)' }}>
        <label className="flex items-center gap-1.5" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={hideNoise} onChange={e => setHideNoise(e.target.checked)} />
          Hide heartbeat / health noise
        </label>
        <label className="flex items-center gap-1.5" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={issuesOnly} onChange={e => setIssuesOnly(e.target.checked)} />
          Issues only (errors &amp; permissions)
        </label>
        <span className="ml-auto opacity-60">{filtered.length} / {log.length} shown</span>
      </div>

      <div
        ref={logRef}
        className="overflow-auto"
        style={{
          maxHeight: 360,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          fontFamily: 'monospace',
          fontSize: 11,
          lineHeight: 1.5
        }}
      >
        {filtered.length === 0 && (
          <p className="px-3 py-2 italic" style={{ color: 'var(--text-secondary)' }}>
            {log.length === 0 ? 'No log entries yet — reconnect to capture the handshake.' : 'No entries match the filter.'}
          </p>
        )}
        {filtered.map((entry, i) => (
          <div key={i} className="flex gap-2 px-3 py-0.5 border-b" style={{ borderColor: 'var(--border)', borderBottomWidth: 1 }}>
            <span style={{ color: 'var(--text-secondary)', flexShrink: 0, fontSize: 10, paddingTop: 1 }}>
              {new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span
              style={{
                flexShrink: 0, fontSize: 10, paddingTop: 1, fontWeight: 600,
                color: entry.dir === 'in' ? 'var(--success)' : entry.dir === 'out' ? 'var(--accent)' : 'var(--text-secondary)'
              }}
            >
              {entry.dir === 'in' ? '←' : entry.dir === 'out' ? '→' : '·'}
            </span>
            <span
              style={{
                color: entry.dir === 'info'
                  ? 'var(--text-secondary)'
                  : entry.dir === 'in' ? 'var(--text-primary)' : 'var(--accent)',
                whiteSpace: 'pre',
                flex: 1
              }}
            >
              {entry.dir !== 'info' ? tryPretty(entry.text) : entry.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScopeChip({ label, ok }: { label: string; ok: boolean }): React.ReactElement {
  return (
    <span
      className="px-2 py-0.5 text-xs rounded font-mono"
      style={{
        background: ok ? 'color-mix(in srgb, var(--success) 14%, transparent)' : 'color-mix(in srgb, var(--danger) 14%, transparent)',
        color: ok ? 'var(--success)' : 'var(--danger)',
        border: `1px solid ${ok ? 'color-mix(in srgb, var(--success) 40%, transparent)' : 'color-mix(in srgb, var(--danger) 40%, transparent)'}`,
        textDecoration: ok ? 'none' : 'line-through'
      }}
    >
      {label}
    </span>
  )
}

// Periodic gateway pushes that dominate the log by volume but carry no
// per-request signal — matched on the raw frame so we don't parse every entry.
function isNoise(e: ConnLog): boolean {
  if (e.dir !== 'in') return false
  return /"event"\s*:\s*"(health|tick|presence)"/.test(e.text)
}

// Failed responses and anything referencing a scope/permission/error, so a
// permission problem surfaces with one toggle instead of a scroll hunt.
function isIssue(e: ConnLog): boolean {
  const t = e.text.toLowerCase()
  return t.includes('"ok": false') || t.includes('"ok":false')
    || t.includes('error') || t.includes('scope') || t.includes('rejected')
    || t.includes('denied') || t.includes('unauthorized')
}

function fmtLine(e: ConnLog): string {
  const t = new Date(e.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const arrow = e.dir === 'in' ? '←' : e.dir === 'out' ? '→' : '·'
  return `${t} ${arrow} ${e.dir !== 'info' ? tryPretty(e.text) : e.text}`
}

function tryPretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
