import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Pencil, Trash2, ChevronDown, Loader2, Brain, KeyRound, Check, X } from 'lucide-react'
import { useMemoryStore } from '../../store/memory'
import { useIsRemoteGateway, useConnectionStore } from '../../store/connection'
import { gatewayHost } from '../../lib/ollamaHealth'
import { buildPluginInstallPrompt } from '../../lib/joaxclawFsInstall'
import { sendViaAgent } from '../../lib/agentPrompt'
import { MEMORY_PROVIDERS, memoryProvider } from '../../lib/memory/providers'
import { isEnvRef } from '../../lib/memory/secrets'
import type { MemoryAccess, MemoryConnection, MemoryLocation } from '../../lib/memory/types'
import { ForceGraph } from '../obsidian/ForceGraph'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { Server, Wrench, BookOpen } from 'lucide-react'

const ACCESS_LABEL: Record<MemoryAccess, string> = { 'off': 'Off', 'read-only': 'Read-only', 'read-write': 'Read & write' }
const LOCATION_LABEL: Record<MemoryLocation, string> = { 'server-local': 'On the server', 'cloud': 'Cloud' }

function configSummary(conn: MemoryConnection): string {
  return conn.config.url || conn.config.path || conn.config.space || ''
}

export function MemoryView({ onOpenChat }: { onOpenChat?: () => void } = {}) {
  const {
    connections, selectedId, select, setEnabled, setAccess, removeConnection,
    loading, progress, graph, items, info, error, preview, openItem,
    remoteReady, probePlugin,
  } = useMemoryStore()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<MemoryConnection | null>(null)
  const remote = useIsRemoteGateway()
  const status = useConnectionStore(s => s.status)
  const gwHost = useConnectionStore(s => gatewayHost(s.connection?.url))

  // On a remote gateway, memory is managed by the joaxclaw-fs plugin — probe for it
  // whenever the connection/remoteness changes.
  useEffect(() => { void probePlugin() }, [remote, status, probePlugin])

  // Select + load the first connection on mount if nothing is active yet.
  useEffect(() => {
    if (!selectedId && connections.length > 0) void select(connections[0].id)
    else if (selectedId && !graph && !items && !loading) void select(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Management (add / access / skill install) works on a local gateway, or a remote
  // gateway once the plugin is confirmed. Browsing content is local-gateway-only in P1.
  const showManagement = !remote || remoteReady === true

  const selected = connections.find(c => c.id === selectedId) ?? null

  const groups: { location: MemoryLocation; conns: MemoryConnection[] }[] = useMemo(() => {
    const out: { location: MemoryLocation; conns: MemoryConnection[] }[] = []
    for (const location of ['server-local', 'cloud'] as MemoryLocation[]) {
      const conns = connections.filter(c => memoryProvider(c.providerId)?.location === location)
      if (conns.length) out.push({ location, conns })
    }
    return out
  }, [connections])

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Memory</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Connect your agents to knowledge stores, and see what they remember.
          </p>
        </div>
        {showManagement && <Btn size="sm" icon={<Plus size={13} />} onClick={() => { setEditing(null); setAdding(true) }}>Add memory</Btn>}
      </div>

      {remote && remoteReady === null ? (
        <CheckingPlugin />
      ) : remote && remoteReady === false ? (
        <RemoteMemoryInstallNotice host={gwHost} onOpenChat={onOpenChat} />
      ) : connections.length === 0 ? (
        <EmptyState onAdd={() => { setEditing(null); setAdding(true) }} />
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Connections list */}
          <div className="flex flex-col shrink-0 overflow-y-auto py-3 px-2.5 gap-1" style={{ width: 246, borderRight: '1px solid var(--border)' }}>
            {groups.map(g => (
              <div key={g.location} className="flex flex-col gap-1">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider px-2 pt-2 pb-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                  {LOCATION_LABEL[g.location]}
                </div>
                {g.conns.map(c => <ConnRow key={c.id} conn={c} active={c.id === selectedId} onClick={() => void select(c.id)} />)}
              </div>
            ))}
          </div>

          {/* Detail */}
          {selected ? (
            <Detail
              key={selected.id}
              conn={selected}
              remote={remote}
              loading={loading} progress={progress} graph={graph} items={items} info={info} error={error}
              preview={preview}
              onOpenItem={openItem}
              onSetEnabled={setEnabled}
              onSetAccess={setAccess}
              onEdit={() => { setEditing(selected); setAdding(true) }}
              onRemove={() => removeConnection(selected.id)}
            />
          ) : (
            <div className="flex-1" />
          )}
        </div>
      )}

      {adding && (
        <ConnectSheet
          edit={editing}
          onClose={() => { setAdding(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function ConnRow({ conn, active, onClick }: { conn: MemoryConnection; active: boolean; onClick: () => void }) {
  const def = memoryProvider(conn.providerId)
  const off = !conn.enabled || conn.access === 'off'
  return (
    <button
      onClick={onClick}
      className="grid items-center gap-2.5 px-2 py-2 rounded text-left"
      style={{
        gridTemplateColumns: '30px 1fr auto', border: '1px solid transparent',
        background: active ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
        borderColor: active ? 'color-mix(in srgb, var(--accent) 34%, transparent)' : 'transparent',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <span className="grid place-items-center text-[15px]" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-elevated)', opacity: off ? 0.5 : 1 }}>{def?.icon ?? '🧠'}</span>
      <span className="min-w-0" style={{ opacity: off ? 0.6 : 1 }}>
        <span className="block text-[13.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{conn.name}</span>
        <span className="block text-[11.5px] truncate" style={{ color: 'var(--text-secondary)' }}>{def?.label ?? conn.providerId}</span>
      </span>
      <span title={off ? 'Off' : 'Enabled'} style={{ width: 7, height: 7, borderRadius: '50%', background: off ? 'var(--border)' : 'var(--success)', boxShadow: off ? 'none' : '0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent)' }} />
    </button>
  )
}

function Detail({ conn, remote, loading, progress, graph, items, info, error, preview, onOpenItem, onSetEnabled, onSetAccess, onEdit, onRemove }: {
  conn: MemoryConnection
  remote: boolean
  loading: boolean; progress: number
  graph: ReturnType<typeof useMemoryStore.getState>['graph']
  items: ReturnType<typeof useMemoryStore.getState>['items']
  info: ReturnType<typeof useMemoryStore.getState>['info']
  error: string | null
  preview: ReturnType<typeof useMemoryStore.getState>['preview']
  onOpenItem: (id: string) => void
  onSetEnabled: (id: string, v: boolean) => void
  onSetAccess: (id: string, a: MemoryAccess) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const def = memoryProvider(conn.providerId)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const off = !conn.enabled || conn.access === 'off'
  const skillActive = conn.enabled && conn.access !== 'off'

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Detail header */}
      <div className="flex flex-col gap-2.5 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <span className="grid place-items-center text-[20px] shrink-0" style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-elevated)' }}>{def?.icon ?? '🧠'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{conn.name}</div>
            <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span className="text-[10.5px] uppercase tracking-wide px-1.5 py-px rounded-full" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>{def && LOCATION_LABEL[def.location]}</span>
              {def?.label} · <code className="font-mono text-[11.5px]" style={{ color: 'var(--text-secondary)', opacity: 0.75 }}>{configSummary(conn)}</code>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <AccessMenu access={conn.access} onChange={a => onSetAccess(conn.id, a)} />
            <Toggle on={conn.enabled} onClick={() => onSetEnabled(conn.id, !conn.enabled)} />
            <IconBtn title="Edit" onClick={onEdit}><Pencil size={13} /></IconBtn>
            {confirmRemove ? (
              <>
                <Btn size="sm" variant="danger" onClick={onRemove}>Remove</Btn>
                <Btn size="sm" variant="outline" onClick={() => setConfirmRemove(false)}>Cancel</Btn>
              </>
            ) : (
              <IconBtn title="Remove" onClick={() => setConfirmRemove(true)} danger><Trash2 size={13} /></IconBtn>
            )}
          </div>
        </div>
        <div className="text-xs" style={{ color: off ? 'var(--warning)' : 'var(--text-secondary)' }}>
          {off
            ? 'Off — agents can’t use this yet. Set access to Read-only or Read & write to generate its skill.'
            : conn.access === 'read-write'
              ? 'Agents can read and update this store during runs.'
              : 'Agents can read this store during runs (read-only).'}
        </div>
      </div>

      {/* Browse — the graph is a local-gateway richness; on a remote gateway every store
          browses as a notes list + preview (served by the plugin's memory.list/read). */}
      <div className="flex flex-col flex-1 min-h-0">
        {error ? (
          <div className="m-4 px-3 py-2 rounded text-sm" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>{error}</div>
        ) : loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3" style={{ color: 'var(--text-secondary)' }}>
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <span className="text-sm">Loading{def?.viewer === 'graph' && !remote ? ` graph… ${Math.round(progress * 100)}%` : '…'}</span>
          </div>
        ) : def?.viewer === 'graph' && !remote ? (
          <GraphPane graph={graph} info={info} />
        ) : (
          <NotesPane items={items} preview={preview} onOpen={onOpenItem} />
        )}

        <div className="flex items-center gap-2 text-xs px-5 py-2.5" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
          {skillActive ? (
            <><KeyRound size={12} style={{ color: 'var(--accent)' }} /> Exposed to agents via the <code className="font-mono px-1.5 py-px rounded" style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }}>{def?.skillSlug}</code> skill on the gateway host.</>
          ) : (
            <>No skill is generated while access is Off.</>
          )}
        </div>
      </div>
    </div>
  )
}

function GraphPane({ graph, info }: { graph: ReturnType<typeof useMemoryStore.getState>['graph']; info: ReturnType<typeof useMemoryStore.getState>['info'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="relative flex-1 min-h-0">
      {graph && size.w > 0 && <ForceGraph data={graph} width={size.w} height={size.h} />}
      {graph && (
        <div className="absolute left-4 bottom-3 flex gap-2">
          <Stat label="notes" value={graph.nodes.length} />
          <Stat label="links" value={graph.edges.length} />
        </div>
      )}
      {graph && graph.nodes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-sm" style={{ color: 'var(--text-secondary)' }}>No notes found{info?.note ? ` · ${info.note}` : ''}.</div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'color-mix(in srgb, var(--bg-surface) 82%, transparent)', border: '1px solid var(--border)', backdropFilter: 'blur(4px)', color: 'var(--text-secondary)' }}>
      <b style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</b> {label}
    </span>
  )
}

function NotesPane({ items, preview, onOpen }: {
  items: ReturnType<typeof useMemoryStore.getState>['items']
  preview: ReturnType<typeof useMemoryStore.getState>['preview']
  onOpen: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const filtered = (items ?? []).filter(i => !q || i.title.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="grid flex-1 min-h-0" style={{ gridTemplateColumns: '240px 1fr' }}>
      <div className="flex flex-col min-h-0" style={{ borderRight: '1px solid var(--border)' }}>
        <div className="px-2.5 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <Search size={12} style={{ color: 'var(--text-secondary)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search files…" className="flex-1 bg-transparent outline-none text-xs" style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {filtered.length === 0 && <p className="text-xs px-2 py-3" style={{ color: 'var(--text-secondary)' }}>{items === null ? 'Loading…' : 'No files.'}</p>}
          {filtered.map(it => (
            <button key={it.id} onClick={() => onOpen(it.id)} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-[13px]"
              style={{ background: preview?.id === it.id ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent', color: preview?.id === it.id ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}
              onMouseEnter={e => { if (preview?.id !== it.id) e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={e => { if (preview?.id !== it.id) e.currentTarget.style.background = 'transparent' }}>
              <span className="truncate">{it.title}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-y-auto p-6">
        {preview ? (
          <>
            <div className="font-mono text-[11.5px] mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{preview.id}</div>
            <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ color: 'var(--text-primary)', fontFamily: 'inherit' }}>{preview.content || '—'}</pre>
          </>
        ) : (
          <div className="h-full grid place-items-center text-sm" style={{ color: 'var(--text-secondary)' }}>Select a file to read it.</div>
        )}
      </div>
    </div>
  )
}

function AccessMenu({ access, onChange }: { access: MemoryAccess; onChange: (a: MemoryAccess) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const isOn = access !== 'off'
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-[12.5px] font-medium px-2.5 py-1.5 rounded"
        style={{
          border: `1px solid ${isOn ? 'color-mix(in srgb, var(--accent) 34%, transparent)' : 'var(--border)'}`,
          background: isOn ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
          color: isOn ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer',
        }}>
        {ACCESS_LABEL[access]} <ChevronDown size={11} style={{ opacity: 0.7 }} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 py-1 rounded" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', minWidth: 150 }}>
          {(['off', 'read-only', 'read-write'] as MemoryAccess[]).map(a => (
            <button key={a} onClick={() => { onChange(a); setOpen(false) }} className="flex items-center justify-between w-full px-3 py-1.5 text-[12.5px] text-left"
              style={{ background: 'transparent', color: a === access ? 'var(--accent)' : 'var(--text-primary)', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {ACCESS_LABEL[a]} {a === access && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={on ? 'Enabled' : 'Disabled'} className="relative shrink-0" style={{ width: 38, height: 22, borderRadius: 999, border: on ? 'none' : '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--bg-elevated)', cursor: 'pointer' }}>
      <span className="absolute" style={{ top: 2, left: on ? 18 : 3, width: 16, height: 16, borderRadius: '50%', background: on ? '#fff' : 'var(--text-secondary)', transition: 'left 0.15s' }} />
    </button>
  )
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} className="grid place-items-center" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: danger ? 'var(--danger)' : 'var(--text-secondary)', cursor: 'pointer' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
      {children}
    </button>
  )
}

// While we check whether the remote gateway has the joaxclaw-fs memory plugin.
function CheckingPlugin() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3" style={{ color: 'var(--text-secondary)' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
      <span className="text-sm">Checking the gateway for memory support…</span>
    </div>
  )
}

// Shown on a remote gateway whose joaxclaw-fs plugin doesn't expose memory.* yet. The
// plugin manages the SKILL.md files on the host; "Install via agent" hands the install
// to an agent running there (the same flow Teams/Processes use), then the tab lights up.
function RemoteMemoryInstallNotice({ host, onOpenChat }: { host?: string; onOpenChat?: () => void }) {
  const probePlugin = useMemoryStore(s => s.probePlugin)
  const [phase, setPhase] = useState<'idle' | 'working' | 'error'>('idle')
  const [err, setErr] = useState('')

  const install = async () => {
    setPhase('working'); setErr('')
    const built = await buildPluginInstallPrompt()
    if (!built.ok || !built.prompt) { setPhase('error'); setErr(built.error ?? 'Failed to prepare the install'); return }
    sendViaAgent(built.prompt, onOpenChat)
    setPhase('idle')
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8" style={{ background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 470, textAlign: 'center', padding: 30, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <Server size={38} style={{ color: 'var(--text-secondary)', opacity: 0.45, marginBottom: 14 }} />
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)', margin: '0 0 8px' }}>Install the plugin to manage memory remotely</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
          Memory skills live on the gateway host
          {host ? <> (<b style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{host}</b>)</> : null}.
          Install the <b style={{ color: 'var(--text-primary)' }}>joaxclaw-fs</b> plugin (v0.8+) on that host once, and this
          tab can add, manage, and browse memory connections over the connection — the same plugin that powers Teams &amp; Processes.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <Btn size="sm" icon={phase === 'working' ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />} loading={phase === 'working'} onClick={install}>Install via agent</Btn>
          <Btn size="sm" variant="ghost" icon={<BookOpen size={13} />} onClick={() => void probePlugin()}>Re-check</Btn>
        </div>
        {phase === 'error' && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '12px 0 0' }}>{err}</p>}
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', opacity: 0.75, lineHeight: 1.6, margin: '14px 0 0' }}>
          Install via agent opens a chat and asks an agent on the host to run it (you approve the command). On a gateway
          running on this machine, memory works without the plugin.
        </p>
      </div>
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6" style={{ color: 'var(--text-secondary)' }}>
      <Brain size={40} style={{ opacity: 0.3 }} />
      <div className="text-center" style={{ maxWidth: 380 }}>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Connect your first memory</p>
        <p className="text-xs mt-1 leading-relaxed">Give your agents a knowledge store to read and write — an Obsidian vault, or a plain Markdown folder on the gateway host. They reach it through a generated skill.</p>
      </div>
      <Btn size="sm" icon={<Plus size={13} />} onClick={onAdd}>Add memory</Btn>
    </div>
  )
}

// ── Add / edit connection sheet ──────────────────────────────────────────────
function ConnectSheet({ edit, onClose }: { edit: MemoryConnection | null; onClose: () => void }) {
  const { addConnection, updateConnection, test } = useMemoryStore()
  const [providerId, setProviderId] = useState<string | null>(edit?.providerId ?? null)
  const [name, setName] = useState(edit?.name ?? '')
  const [config, setConfig] = useState<Record<string, string>>(edit?.config ?? {})
  const [testState, setTestState] = useState<{ phase: 'idle' | 'testing' | 'ok' | 'err'; msg?: string }>({ phase: 'idle' })

  const def = providerId ? memoryProvider(providerId) : null
  const byLocation = (loc: MemoryLocation) => MEMORY_PROVIDERS.filter(p => p.location === loc)

  const pick = (id: string) => {
    setProviderId(id)
    setTestState({ phase: 'idle' })
    if (!name) setName(memoryProvider(id)?.label ?? '')
  }

  const runTest = async () => {
    if (!def) return
    setTestState({ phase: 'testing' })
    const r = await test(def.id, config)
    setTestState(r.ok ? { phase: 'ok', msg: r.info?.note } : { phase: 'err', msg: r.error })
  }

  const canSave = def && def.fields.every(f => !f.required || (config[f.key] ?? '').trim())
  const save = () => {
    if (!def || !canSave) return
    if (edit) updateConnection(edit.id, { name, config })
    else addConnection(def.id, name, config, 'read-write')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" style={{ top: 36, background: 'color-mix(in srgb, var(--bg-primary) 55%, transparent)', backdropFilter: 'blur(3px)', padding: '40px 20px' }} onClick={onClose}>
      <div className="flex flex-col" style={{ width: 'min(600px, 100%)', maxHeight: '82vh', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 30px 80px -20px rgba(0,0,0,0.7)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
          <b style={{ color: 'var(--text-primary)', fontSize: 15 }}>{edit ? 'Edit memory' : 'Add memory'}</b>
          <button onClick={onClose} className="grid place-items-center" style={{ width: 28, height: 28, borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={15} /></button>
        </div>

        <div className="overflow-y-auto p-5">
          {!edit && (['server-local', 'cloud'] as MemoryLocation[]).map(loc => byLocation(loc).length > 0 && (
            <div key={loc} className="mb-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{LOCATION_LABEL[loc]}</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {byLocation(loc).map(p => (
                  <button key={p.id} onClick={() => pick(p.id)} className="flex items-start gap-2.5 px-3 py-2.5 rounded text-left"
                    style={{ border: `1px solid ${providerId === p.id ? 'var(--accent)' : 'var(--border)'}`, background: providerId === p.id ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-elevated)', cursor: 'pointer' }}>
                    <span className="text-[19px]">{p.icon}</span>
                    <span className="min-w-0"><b className="block text-[13.5px]" style={{ color: 'var(--text-primary)' }}>{p.label}</b><span className="text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>{p.blurb}</span></span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {def && (
            <div className={edit ? '' : 'mt-3 pt-4'} style={edit ? undefined : { borderTop: '1px solid var(--border)' }}>
              <div className="mb-3">
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Name</label>
                <Input value={name} onChange={setName} placeholder={def.label} style={{ fontSize: 12.5 }} />
              </div>
              {def.fields.map(f => {
                const envRef = f.kind === 'secret' && isEnvRef(config[f.key])
                return (
                <div key={f.key} className="mb-3">
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
                  <Input value={config[f.key] ?? ''} onChange={v => { setConfig(c => ({ ...c, [f.key]: v })); setTestState({ phase: 'idle' }) }}
                    type={f.kind === 'secret' && !envRef ? 'password' : 'text'} placeholder={f.placeholder}
                    style={{ fontSize: 12.5, fontFamily: (f.kind === 'path' || f.kind === 'url' || envRef) ? 'monospace' : undefined }} />
                  {f.help && <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{f.help}</p>}
                  {f.kind === 'secret' && (
                    <p className="text-[11.5px] mt-1" style={{ color: envRef ? 'var(--success)' : 'var(--text-secondary)', opacity: envRef ? 1 : 0.7 }}>
                      {envRef
                        ? 'Referencing a host environment variable — the secret is not stored here or in the skill.'
                        : 'Tip: enter env:VAR_NAME to reference a host environment variable instead of storing the key.'}
                    </p>
                  )}
                </div>
              )})}
              <div className="flex items-center gap-2 mt-4">
                <Btn size="sm" variant="outline" loading={testState.phase === 'testing'} onClick={runTest}>Test connection</Btn>
                <Btn size="sm" disabled={!canSave} onClick={save}>{edit ? 'Save' : 'Add & connect'}</Btn>
                {testState.phase === 'ok' && <span className="text-xs flex items-center gap-1" style={{ color: 'var(--success)' }}><Check size={12} /> Connected{testState.msg ? ` · ${testState.msg}` : ''}</span>}
                {testState.phase === 'err' && <span className="text-xs" style={{ color: 'var(--danger)' }}>{testState.msg}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
