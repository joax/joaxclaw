import { useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronUp, ChevronDown, Square, MessageSquare, Trash2, Heart, Pencil, Cpu } from 'lucide-react'
import { ModelIcon } from '../ui/ModelIcon'
import { useSessionsStore } from '../../store/sessions'
import { useChatStore } from '../../store/chat'
import type { Session } from '../../lib/types'
import { agentIdFromSessionKey as sessionAgentId } from '../../lib/sessionName'
import { Btn } from '../ui/Btn'

type SortKey = 'updatedAt' | 'status' | 'key' | 'model'
interface Props { onOpenChat: () => void }


function sessionLabel(s: Session, customLabels: Record<string, string>, derivedNames: Record<string, string>): string {
  return customLabels[s.key] ?? derivedNames[s.key] ?? s.displayName ?? s.label ?? sessionAgentId(s.key)
}

const TERMINAL_STATUSES = new Set(['idle', 'done', 'failed', 'killed', 'timeout'])

function sessionStatus(s: Session): string {
  // hasActiveRun: false overrides a stale 'running' status stored in the session file
  if (s.hasActiveRun === false) {
    if (s.status && TERMINAL_STATUSES.has(s.status)) return s.status
    return 'idle'
  }
  if (s.status) return s.status
  return s.hasActiveRun ? 'running' : 'idle'
}

function isRunning(s: Session): boolean {
  if (s.status && TERMINAL_STATUSES.has(s.status)) return false
  // hasActiveRun: false explicitly means no in-process run, overrides stale stored status
  if (s.hasActiveRun === false) return false
  if (s.status === 'running') return true
  return s.hasActiveRun ?? false
}

function statusColor(status: string): { bg: string; color: string; dot: string } {
  switch (status) {
    case 'running': return { bg: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)', dot: 'var(--success)' }
    case 'done': return { bg: 'var(--bg-elevated)', color: 'var(--text-secondary)', dot: 'var(--border)' }
    case 'failed': case 'killed': case 'timeout':
      return { bg: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)', dot: 'var(--danger)' }
    default: return { bg: 'color-mix(in srgb, var(--warning) 15%, transparent)', color: 'var(--warning)', dot: 'var(--warning)' }
  }
}

function formatTs(ts: number | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString()
}

export function SessionsView({ onOpenChat }: Props) {
  const { sessions, customLabels, derivedNames, loading, error, fetch, abort, delete: deleteSession, rename, aborting, abortError } = useSessionsStore()
  const { loadSessionMessages } = useChatStore()
  const [sort, setSort] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [openingKey, setOpeningKey] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => { fetch() }, [])

  const handleSort = (key: SortKey) => {
    if (sort === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setSortDir('desc') }
  }

  const filtered = sessions
    .filter(s => filterStatus === 'all' || sessionStatus(s) === filterStatus)
    .filter(s => !search || s.key.includes(search) || sessionLabel(s, customLabels, derivedNames).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0
      if (sort === 'updatedAt') cmp = (a.updatedAt ?? 0) - (b.updatedAt ?? 0)
      else if (sort === 'status') cmp = sessionStatus(a).localeCompare(sessionStatus(b))
      else if (sort === 'key') cmp = a.key.localeCompare(b.key)
      else if (sort === 'model') cmp = (a.model ?? '').localeCompare(b.model ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })

  const handleOpenInChat = async (s: Session) => {
    setOpeningKey(s.key)
    setOpenError(null)
    try {
      const convId = await loadSessionMessages(s.key, sessionAgentId(s.key), sessionLabel(s, customLabels, derivedNames))
      if (convId) {
        onOpenChat()
      } else {
        setOpenError(`Could not load session — it may have expired or been deleted.`)
      }
    } catch {
      setOpenError(`Failed to open session.`)
    } finally {
      setOpeningKey(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Sessions</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {loading ? 'Loading…' : `${sessions.length} total · ${sessions.filter(isRunning).length} active`}
          </p>
        </div>
        <Btn variant="outline" size="sm" icon={<RefreshCw size={13} />} onClick={fetch} loading={loading}>
          Refresh
        </Btn>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {openError && (
        <div className="mb-4 px-3 py-2 rounded text-sm flex items-center justify-between" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          <span>{openError}</span>
          <button onClick={() => setOpenError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sessions…"
          style={{
            padding: '5px 10px', fontSize: 12,
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none', width: 200
          }}
        />
        <FilterSelect value={filterStatus} onChange={setFilterStatus} label="Status">
          <option value="all">All statuses</option>
          <option value="running">Running</option>
          <option value="idle">Idle</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
        </FilterSelect>
      </div>

      {!loading && sessions.length === 0 && !error && (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          No sessions found on gateway
        </div>
      )}

      {/* Table */}
      {sessions.length > 0 && (
        <div
          className="flex-1 overflow-auto"
          style={{ borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
        >
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <Th>Agent / Label</Th>
                <th className="px-3 py-2.5 text-left text-xs font-medium w-8" style={{ color: 'var(--text-secondary)' }}></th>
                <Th onClick={() => handleSort('key')} sortKey="key" active={sort} dir={sortDir}>Session key</Th>
                <Th onClick={() => handleSort('status')} sortKey="status" active={sort} dir={sortDir}>Status</Th>
                <Th onClick={() => handleSort('model')} sortKey="model" active={sort} dir={sortDir}>Model</Th>
                <Th>Usage</Th>
                <Th onClick={() => handleSort('updatedAt')} sortKey="updatedAt" active={sort} dir={sortDir}>Updated</Th>
                <th className="px-3 py-2.5 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const agentId = sessionAgentId(s.key)
                const label = sessionLabel(s, customLabels, derivedNames)
                const status = sessionStatus(s)
                const sc = statusColor(status)
                return (
                  <tr
                    key={s.key}
                    style={{
                      borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                      background: 'var(--bg-primary)'
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg-surface)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg-primary)' }}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{agentId}</span>
                        <LabelCell
                          sessionKey={s.key}
                          label={label}
                          isEditing={editingKey === s.key}
                          onStartEdit={() => setEditingKey(s.key)}
                          onSave={name => { rename(s.key, name); setEditingKey(null) }}
                          onCancel={() => setEditingKey(null)}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {(s.isHeartbeat || s.key.includes(':heartbeat')) && (
                        <span title="Heartbeat session" style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <Heart size={12} style={{ color: 'var(--accent)', opacity: 0.8 }} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {s.key.slice(0, 24)}{s.key.length > 24 ? '…' : ''}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1.5 text-xs px-2 py-0.5" style={{ background: sc.bg, color: sc.color, borderRadius: 999, width: 'fit-content' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                        {status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <ModelCell session={s} running={isRunning(s)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <UsageCell session={s} />
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatTs(s.updatedAt ?? s.startedAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 justify-end">
                        {confirmDelete === s.key ? (
                          <>
                            <Btn size="sm" variant="danger" onClick={() => { deleteSession(s.key); setConfirmDelete(null) }}>Delete</Btn>
                            <Btn size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
                          </>
                        ) : (
                          <>
                            <Btn size="sm" variant="outline" icon={<MessageSquare size={11} />} loading={openingKey === s.key} onClick={() => handleOpenInChat(s)}>
                              Open
                            </Btn>
                            {(isRunning(s) || aborting.has(s.key)) && (
                              <Btn
                                size="sm"
                                variant="ghost"
                                icon={<Square size={11} />}
                                loading={aborting.has(s.key)}
                                onClick={() => abort(s.key)}
                                style={{ color: 'var(--danger)' }}
                              >
                                Abort
                              </Btn>
                            )}
                            {abortError[s.key] && (
                              <span
                                className="text-xs px-2 py-0.5 rounded cursor-help"
                                style={{ background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                title={abortError[s.key]}
                              >
                                {abortError[s.key]}
                              </span>
                            )}
                            <Btn size="sm" variant="ghost" icon={<Trash2 size={11} />} onClick={() => setConfirmDelete(s.key)} style={{ color: 'var(--danger)' }} />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                    No sessions match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function fmtCost(usd: number): string {
  if (usd < 0.0001) return '<$0.0001'
  if (usd < 0.01)   return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

function UsageCell({ session }: { session: Session }) {
  const inp  = session.inputTokens
  const out  = session.outputTokens
  const cost = session.estimatedCostUsd
  if (inp == null && out == null && (cost == null || cost === 0)) {
    return <span style={{ color: 'var(--text-secondary)', opacity: 0.3, fontSize: 11 }}>—</span>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {(inp != null || out != null) && (
        <div style={{ display: 'flex', gap: 6, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)' }}>
          {inp != null && <span title="Input tokens">↑{fmtTokens(inp)}</span>}
          {out != null && <span title="Output tokens">↓{fmtTokens(out)}</span>}
        </div>
      )}
      {cost != null && cost > 0 && (
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: cost > 0.1 ? 'var(--warning)' : 'var(--text-secondary)' }}>
          {fmtCost(cost)}
        </span>
      )}
    </div>
  )
}

function ModelCell({ session, running }: { session: Session; running: boolean }) {
  const model = session.model
  const ctx = session.contextTokens
  if (!model) return <span style={{ color: 'var(--text-secondary)', opacity: 0.3, fontSize: 11 }}>—</span>

  // Strip provider prefix for display (e.g. "ollama/qwen3.5:9b" → "qwen3.5:9b")
  const slash = model.indexOf('/')
  const displayModel = slash >= 0 ? model.slice(slash + 1) : model

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {running && (
          <Cpu size={10} className="animate-pulse" style={{ color: 'var(--success)', flexShrink: 0 }} />
        )}
        <ModelIcon model={model} size={10} />
        <span
          className="text-xs font-mono truncate"
          style={{ color: running ? 'var(--success)' : 'var(--text-secondary)', maxWidth: 160 }}
          title={model}
        >
          {displayModel}
        </span>
      </div>
      {ctx != null && ctx > 0 && (
        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
          {fmtTokens(ctx)} ctx tokens
        </span>
      )}
    </div>
  )
}

function LabelCell({ sessionKey, label, isEditing, onStartEdit, onSave, onCancel }: {
  sessionKey: string
  label: string
  isEditing: boolean
  onStartEdit: () => void
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (isEditing) {
      setDraft(label !== sessionKey ? label : '')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isEditing])

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(draft) }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={() => onSave(draft)}
        placeholder="Custom label…"
        style={{
          fontSize: 12, padding: '1px 6px',
          borderRadius: 4, border: '1px solid var(--accent)',
          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
          outline: 'none', width: 180
        }}
        onClick={e => e.stopPropagation()}
      />
    )
  }

  const hasCustom = label !== sessionKey
  return (
    <div
      className="flex items-center gap-1 group/label"
      style={{ minHeight: 18 }}
    >
      {hasCustom && (
        <span className="text-xs truncate max-w-48" style={{ color: 'var(--text-primary)' }}>{label}</span>
      )}
      <button
        onClick={e => { e.stopPropagation(); onStartEdit() }}
        className="opacity-0 group-hover/label:opacity-100 transition-opacity"
        title="Rename session"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)', padding: '1px 3px',
          borderRadius: 3, display: 'flex', alignItems: 'center'
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)' }}
      >
        <Pencil size={10} />
      </button>
    </div>
  )
}

function Th({ children, onClick, sortKey, active, dir }: {
  children: React.ReactNode; onClick?: () => void; sortKey?: string; active?: string; dir?: 'asc' | 'desc'
}) {
  const isActive = sortKey && active === sortKey
  return (
    <th
      className="px-3 py-2.5 text-left text-xs font-medium cursor-pointer select-none"
      style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
      onClick={onClick}
    >
      <div className="flex items-center gap-1">
        {children}
        {isActive && dir === 'asc' && <ChevronUp size={11} />}
        {isActive && dir === 'desc' && <ChevronDown size={11} />}
      </div>
    </th>
  )
}

function FilterSelect({ value, onChange, children, label }: { value: string; onChange: (v: string) => void; children: React.ReactNode; label: string }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={label}
      style={{
        padding: '5px 8px', fontSize: 12,
        borderRadius: 'var(--radius)', border: '1px solid var(--border)',
        background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer'
      }}
    >
      {children}
    </select>
  )
}
