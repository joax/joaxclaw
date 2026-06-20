import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, RefreshCw, X, Play, Square, LogOut, Trash2, Pencil, QrCode,
  CheckCircle2, AlertCircle, Bot, Search, ExternalLink, Loader2, Star, Users,
} from 'lucide-react'
import { Btn } from '../ui/Btn'
import { Input, Textarea } from '../ui/Input'
import { useChannelsStore, statusForChannel } from '../../store/channels'
import { useAgentsStore } from '../../store/agents'
import { gatewayClient } from '../../lib/gateway'
import {
  CHANNELS, channelDef, isQrChannel, isSecretRef, fieldLiteral,
  scopesForChannel, buildMatch, bindingScopeLabel, bindingKey,
  type ChannelConfig, type ChannelDef, type BindingScopeKind,
} from '../../lib/channels'
import { channelPolicySpec } from '../../lib/channelPolicy'
import { ChannelPolicyEditor } from './ChannelPolicyEditor'

const DOCS_BASE = 'https://docs.openclaw.com/channels'

// ── Panel ─────────────────────────────────────────────────────────────────────

export function ChannelsPanel({ connected }: { connected: boolean }) {
  const { channels, status, loading, error, fetch, refreshStatus } = useChannelsStore()
  const agents = useAgentsStore(s => s.agents)
  const fetchAgents = useAgentsStore(s => s.fetch)

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ChannelConfig | null>(null)
  const [qrChannel, setQrChannel] = useState<{ id: string; account?: string } | null>(null)

  useEffect(() => {
    if (!connected) return
    fetch()
    if (agents.length === 0) fetchAgents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  if (!connected) {
    return (
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-6 flex flex-col gap-4" style={{ maxWidth: 760 }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Channels</h2>
          <div className="px-4 py-6 rounded text-sm flex items-center gap-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <AlertCircle size={15} />
            Connect to a gateway to manage channels.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="p-6 flex flex-col gap-4" style={{ maxWidth: 760 }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Channels</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Messaging platforms the gateway talks on. Configure credentials and assign each to an agent.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Btn variant="outline" size="sm" icon={<RefreshCw size={12} />} loading={loading} onClick={() => { fetch(); refreshStatus(true) }}>Refresh</Btn>
            <Btn size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>Add channel</Btn>
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 rounded text-sm flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {channels.length === 0 && !loading && (
          <div className="px-4 py-8 rounded text-sm text-center" style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border)', color: 'var(--text-secondary)' }}>
            No channels configured yet. Click <b>Add channel</b> to connect Telegram, Slack, WhatsApp, Discord and more.
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {channels.map(ch => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              statuses={statusForChannel(status, ch.id)}
              agents={agents}
              onEdit={() => setEditing(ch)}
              onLink={(account) => setQrChannel({ id: ch.id, account })}
            />
          ))}
        </div>
      </div>

      {adding && <ChannelFormModal mode="add" onClose={() => setAdding(false)} />}
      {editing && <ChannelFormModal mode="edit" existing={editing} onClose={() => setEditing(null)} />}
      {qrChannel && <QrLoginModal channelId={qrChannel.id} account={qrChannel.account} onClose={() => setQrChannel(null)} />}
    </div>
  )
}

// ── Channel card ────────────────────────────────────────────────────────────

function ChannelCard({ channel, statuses, agents, onEdit, onLink }: {
  channel: ChannelConfig
  statuses: ReturnType<typeof statusForChannel>
  agents: { id: string; name?: string }[]
  onEdit: () => void
  onLink: (account?: string) => void
}) {
  const def = channelDef(channel.id)
  const { setEnabled, deleteChannel, startChannel, stopChannel, logoutChannel, busy, removeBinding, removeAccount, setDefaultAccount } = useChannelsStore()
  const bindings = useChannelsStore(s => s.bindings)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [showBinding, setShowBinding] = useState(false)
  const [showAddAccount, setShowAddAccount] = useState(false)

  const running = statuses.some(s => s.running)
  const configured = statuses.length > 0 ? statuses.some(s => s.configured) : true
  const isBusy = busy === channel.id

  const runAction = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    const res = await fn()
    setActionMsg(res.message ?? (res.ok ? 'Done' : 'Failed'))
    setTimeout(() => setActionMsg(''), 4000)
  }

  const agentName = (id: string) => agents.find(a => a.id === id)?.name || id
  const channelBindings = bindings.filter(b => b.match?.channel === channel.id)

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', opacity: channel.enabled ? 1 : 0.65 }}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: def.color, boxShadow: running ? `0 0 0 3px color-mix(in srgb, ${def.color} 30%, transparent)` : 'none' }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{def.label}</span>
            <StatusBadge running={running} configured={configured} enabled={channel.enabled} />
            {channel.accounts.length > 1 && (
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{channel.accounts.length} accounts</span>
            )}
          </div>
          {def.blurb && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{def.blurb}</p>}
        </div>

        {/* Enable toggle */}
        <Toggle on={channel.enabled} onClick={() => setEnabled(channel.id, !channel.enabled)} />
      </div>

      {/* Accounts */}
      <div className="px-3.5 py-2.5 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <span className="text-xs flex items-center gap-1.5 shrink-0" style={{ color: 'var(--text-secondary)' }}><Users size={13} /> Accounts:</span>
        {channel.accounts.length === 0 && (
          <span className="text-xs italic" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>default</span>
        )}
        {channel.accounts.map(acc => {
          const isDefault = channel.defaultAccount === acc.id
          return (
            <span key={acc.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <button title={isDefault ? 'Default account' : 'Make default'} onClick={() => !isDefault && setDefaultAccount(channel.id, acc.id)} style={{ background: 'none', border: 'none', cursor: isDefault ? 'default' : 'pointer', color: isDefault ? 'var(--warning)' : 'var(--text-secondary)', padding: 0, display: 'flex' }}>
                <Star size={11} fill={isDefault ? 'var(--warning)' : 'none'} />
              </button>
              {acc.name ? <span>{acc.name}</span> : null}
              <span style={{ fontFamily: 'monospace', opacity: acc.name ? 0.6 : 1 }}>{acc.id}</span>
              <button title="Remove account" onClick={() => removeAccount(channel.id, acc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}>
                <X size={11} />
              </button>
            </span>
          )
        })}
        <button onClick={() => setShowAddAccount(true)} className="text-xs inline-flex items-center gap-0.5" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: '2px 4px' }}>
          <Plus size={11} /> add
        </button>
      </div>

      {/* Routing (scoped agent bindings) */}
      <div className="px-3.5 py-2.5 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="text-xs flex items-center gap-1.5 shrink-0" style={{ color: 'var(--text-secondary)' }}><Bot size={13} /> Routing:</span>
        {channelBindings.length === 0 && (
          <span className="text-xs italic" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>default agent (no binding)</span>
        )}
        {channelBindings.map(b => (
          <span key={bindingKey(b)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs" style={{ background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))', color: 'var(--accent)' }}>
            <span style={{ fontWeight: 500 }}>{agentName(b.agentId)}</span>
            <span style={{ opacity: 0.7 }}>· {bindingScopeLabel(b.match)}</span>
            <button title="Remove binding" onClick={() => removeBinding(b)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }}>
              <X size={11} />
            </button>
          </span>
        ))}
        <button onClick={() => setShowBinding(true)} className="text-xs inline-flex items-center gap-0.5" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: '2px 4px' }}>
          <Plus size={11} /> add binding
        </button>
      </div>

      {/* Actions */}
      <div className="px-3.5 py-2.5 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
        {isQrChannel(channel.id) ? (
          <Btn variant="outline" size="sm" icon={<QrCode size={12} />} onClick={() => onLink()}>Link (QR)</Btn>
        ) : (
          <>
            <Btn variant="outline" size="sm" icon={isBusy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} disabled={isBusy} onClick={() => runAction(() => startChannel(channel.id))}>Start</Btn>
            <Btn variant="outline" size="sm" icon={<Square size={12} />} disabled={isBusy} onClick={() => runAction(() => stopChannel(channel.id))}>Stop</Btn>
          </>
        )}
        <Btn variant="outline" size="sm" icon={<LogOut size={12} />} disabled={isBusy} onClick={() => runAction(() => logoutChannel(channel.id))}>Logout</Btn>
        <Btn variant="outline" size="sm" icon={<Pencil size={12} />} onClick={onEdit}>Edit</Btn>
        <a href={`${DOCS_BASE}/${def.docs ?? channel.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
          <ExternalLink size={11} /> Docs
        </a>
        <div className="flex-1" />
        {actionMsg && <span className="text-xs truncate" style={{ color: 'var(--text-secondary)', maxWidth: 240 }}>{actionMsg}</span>}
        {confirmDelete ? (
          <span className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--danger)' }}>Remove?</span>
            <Btn variant="danger" size="sm" onClick={() => deleteChannel(channel.id)}>Yes</Btn>
            <Btn variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>No</Btn>
          </span>
        ) : (
          <Btn variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => setConfirmDelete(true)}>Remove</Btn>
        )}
      </div>

      {showBinding && (
        <BindingEditor channel={channel} agents={agents} onClose={() => setShowBinding(false)} />
      )}
      {showAddAccount && (
        <AddAccountModal channelId={channel.id} onClose={() => setShowAddAccount(false)} />
      )}
    </div>
  )
}

// ── Scoped binding editor ─────────────────────────────────────────────────────

function BindingEditor({ channel, agents, onClose }: {
  channel: ChannelConfig
  agents: { id: string; name?: string }[]
  onClose: () => void
}) {
  const def = channelDef(channel.id)
  const addBinding = useChannelsStore(s => s.addBinding)
  const existing = useChannelsStore(s => s.bindings)
  const scopes = scopesForChannel(channel.id)

  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [kind, setKind] = useState<BindingScopeKind>('channel')
  const [scopeId, setScopeId] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const scope = scopes.find(s => s.kind === kind) ?? scopes[0]
  const needsId = kind !== 'channel'
  // Account scope is easiest to pick from configured accounts.
  const accountOptions = channel.accounts.map(a => a.id)

  const submit = async () => {
    setErr('')
    if (!agentId) { setErr('Pick an agent.'); return }
    if (needsId && !scopeId.trim()) { setErr(`${scope.idLabel} is required.`); return }
    const match = buildMatch(channel.id, kind, scopeId)
    if (existing.some(b => bindingKey(b) === bindingKey({ agentId, match }))) {
      setErr('That binding already exists.'); return
    }
    setSaving(true)
    try { await addBinding(agentId, match); onClose() }
    catch (e) { setErr(String(e)); setSaving(false) }
  }

  return (
    <Overlay onClose={onClose} title={`Route ${def.label} → agent`} width={460} headerColor={def.color}>
      <div className="px-5 py-4 space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Send matching messages to a specific agent. The gateway picks the most specific
          binding first (peer → guild → team → account → channel), falling back to the default agent.
        </p>

        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Agent</label>
          <select value={agentId} onChange={e => setAgentId(e.target.value)} style={selectStyle}>
            {agents.length === 0 && <option value="">No agents</option>}
            {agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Applies to</label>
          <select value={kind} onChange={e => { setKind(e.target.value as BindingScopeKind); setScopeId('') }} style={selectStyle}>
            {scopes.map(s => <option key={s.kind} value={s.kind}>{s.label}</option>)}
          </select>
        </div>

        {needsId && (
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{scope.idLabel}</label>
            {kind === 'account' && accountOptions.length > 0 ? (
              <select value={scopeId} onChange={e => setScopeId(e.target.value)} style={selectStyle}>
                <option value="">Select account…</option>
                {accountOptions.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            ) : (
              <Input value={scopeId} onChange={setScopeId} placeholder={scope.idPlaceholder} style={{ fontSize: 12, fontFamily: 'monospace' }} />
            )}
          </div>
        )}

        {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3.5 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <Btn variant="outline" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" loading={saving} onClick={submit}>Add binding</Btn>
      </div>
    </Overlay>
  )
}

// ── Add account ───────────────────────────────────────────────────────────────

function AddAccountModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const def = channelDef(channelId)
  const addAccount = useChannelsStore(s => s.addAccount)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    const accId = id.trim()
    if (!accId) { setErr('Account ID is required.'); return }
    if (!/^[a-zA-Z0-9_-]+$/.test(accId)) { setErr('Use letters, numbers, dashes or underscores.'); return }
    setSaving(true)
    try { await addAccount(channelId, accId, name); onClose() }
    catch (e) { setErr(String(e)); setSaving(false) }
  }

  return (
    <Overlay onClose={onClose} title={`Add ${def.label} account`} width={440} headerColor={def.color}>
      <div className="px-5 py-4 space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Adds a second account/workspace under <code>channels.{channelId}.accounts</code>. Configure
          its credentials in <b>Edit → Advanced</b>, then route messages to it from the binding editor.
        </p>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Account ID</label>
          <Input value={id} onChange={setId} placeholder="work" autoFocus style={{ fontSize: 12, fontFamily: 'monospace' }} />
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Display name <span style={{ opacity: 0.6 }}>(optional)</span></label>
          <Input value={name} onChange={setName} placeholder="Work workspace" style={{ fontSize: 12 }} />
        </div>
        {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3.5 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <Btn variant="outline" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" loading={saving} onClick={submit}>Add account</Btn>
      </div>
    </Overlay>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 13,
  borderRadius: 'var(--radius)', border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer',
}

function StatusBadge({ running, configured, enabled }: { running: boolean; configured: boolean; enabled: boolean }) {
  const [label, color] = !enabled
    ? ['disabled', 'var(--text-secondary)']
    : running
      ? ['running', 'var(--success)']
      : configured
        ? ['stopped', 'var(--warning)']
        : ['not configured', 'var(--danger)']
  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={on ? 'Enabled' : 'Disabled'} style={{
      width: 36, height: 20, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
      background: on ? 'var(--accent)' : 'var(--border)', transition: 'background 0.15s',
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
    </button>
  )
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────

function ChannelFormModal({ mode, existing, onClose }: { mode: 'add' | 'edit'; existing?: ChannelConfig; onClose: () => void }) {
  const { createChannel, updateSettings } = useChannelsStore()
  // Select the stable array ref, then map — mapping inside the selector returns
  // a new array every render and sends useSyncExternalStore into an infinite loop.
  const configuredIds = useChannelsStore(s => s.channels).map(c => c.id)
  const [picked, setPicked] = useState<ChannelDef | null>(existing ? channelDef(existing.id) : null)

  if (!picked) {
    return <CatalogPicker configuredIds={configuredIds} onPick={setPicked} onClose={onClose} />
  }

  return (
    <ChannelCredentialForm
      def={picked}
      existing={existing}
      onBack={mode === 'add' ? () => setPicked(null) : undefined}
      onClose={onClose}
      onSubmit={async (settings) => {
        if (mode === 'add') await createChannel(picked.id, settings)
        else await updateSettings(picked.id, settings)
        onClose()
      }}
    />
  )
}

function CatalogPicker({ configuredIds, onPick, onClose }: { configuredIds: string[]; onPick: (d: ChannelDef) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return CHANNELS.filter(c => !needle || c.label.toLowerCase().includes(needle) || c.id.includes(needle))
  }, [q])

  return (
    <Overlay onClose={onClose} title="Add a channel" width={620}>
      <div className="px-5 pt-3 pb-2">
        <div className="relative">
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <Input value={q} onChange={setQ} placeholder="Search channels…" autoFocus style={{ paddingLeft: 32, fontSize: 13 }} />
        </div>
      </div>
      <div className="overflow-y-auto px-5 pb-5" style={{ maxHeight: '56vh' }}>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          {list.map(c => {
            const already = configuredIds.includes(c.id)
            return (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                className="flex items-start gap-2.5 p-2.5 text-left rounded"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', cursor: 'pointer' }}
              >
                <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: c.color }} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.label}</span>
                    {already && <span className="text-xs px-1 rounded" style={{ color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 14%, transparent)' }}>configured</span>}
                    {c.setup === 'qr' && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>QR</span>}
                    {c.needsPlugin && <span className="text-xs" style={{ color: 'var(--warning)' }}>plugin</span>}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>{c.blurb}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </Overlay>
  )
}

function ChannelCredentialForm({ def, existing, onBack, onClose, onSubmit }: {
  def: ChannelDef
  existing?: ChannelConfig
  onBack?: () => void
  onClose: () => void
  onSubmit: (settings: Record<string, unknown>) => Promise<void>
}) {
  const curated = def.fields.length > 0
  const raw = existing?.raw ?? {}

  // Policy editing is only meaningful for an already-configured channel that has a
  // curated policy spec. Shown as a second tab next to the credential form.
  const hasPolicy = !!existing && !!channelPolicySpec(def.id)
  const [tab, setTab] = useState<'credentials' | 'policy'>('credentials')

  // Curated-field literal values.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of def.fields) init[f.key] = fieldLiteral(raw, f.key)
    return init
  })
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  // Raw JSON editor (advanced channels, or "Advanced" toggle).
  const [showRaw, setShowRaw] = useState(!curated)
  const [rawText, setRawText] = useState(() => {
    // Strip enabled — managed by the toggle — and show the rest.
    const { enabled: _enabled, accounts: _accounts, ...rest } = raw as Record<string, unknown>
    void _enabled; void _accounts
    return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '{\n  \n}'
  })
  const [rawError, setRawError] = useState('')

  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr(''); setRawError('')
    let settings: Record<string, unknown> = {}

    if (curated && !showRaw) {
      for (const f of def.fields) {
        const v = values[f.key]?.trim() ?? ''
        // Preserve a SecretRef the user didn't touch; otherwise write the literal.
        if (isSecretRef(raw[f.key]) && v === '') { settings[f.key] = raw[f.key]; continue }
        if (v !== '') settings[f.key] = v
      }
      const missing = def.fields.find(f => f.required && !settings[f.key])
      if (missing) { setErr(`${missing.label} is required.`); return }
    } else {
      try {
        const parsed = rawText.trim() ? JSON.parse(rawText) : {}
        if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Must be a JSON object')
        settings = parsed as Record<string, unknown>
      } catch (e) {
        setRawError(`Invalid JSON: ${String(e instanceof Error ? e.message : e)}`)
        return
      }
    }

    setSaving(true)
    try {
      await onSubmit(settings)
    } catch (e) {
      setErr(String(e)); setSaving(false)
    }
  }

  return (
    <Overlay onClose={onClose} title={`${existing ? 'Edit' : 'Add'} ${def.label}`} width={520} headerColor={def.color}>
      {hasPolicy && (
        <div className="flex gap-1 px-5 pt-3" style={{ borderBottom: '1px solid var(--border)' }}>
          {(['credentials', 'policy'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="text-xs"
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px 8px',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: tab === t ? 600 : 400,
                borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1, textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {tab === 'policy' && hasPolicy ? (
        <div className="overflow-y-auto px-5 py-4" style={{ maxHeight: '60vh' }}>
          <ChannelPolicyEditor channelId={def.id} />
        </div>
      ) : (
      <div className="overflow-y-auto px-5 py-4 space-y-3" style={{ maxHeight: '60vh' }}>
        <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{def.blurb}</p>
        {def.needsPlugin && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded text-xs" style={{ background: 'color-mix(in srgb, var(--warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)', color: 'var(--text-secondary)' }}>
            <AlertCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
            <span>This channel needs its plugin installed: <code>openclaw plugins install {def.id}</code></span>
          </div>
        )}

        {isQrChannel(def.id) && (
          <div className="px-2.5 py-2 rounded text-xs" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {def.label} links by scanning a QR code — no token needed. Save to create the channel, then use <b>Link (QR)</b> on its card to pair.
          </div>
        )}

        {curated && !showRaw && def.fields.map(f => {
          const isRef = isSecretRef(raw[f.key])
          return (
            <div key={f.key}>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                {f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
              </label>
              {isRef ? (
                <div className="text-xs px-2.5 py-2 rounded font-mono" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  secret ref → {(raw[f.key] as { id?: string }).id} (edit in raw config to change)
                </div>
              ) : (
                <div className="relative">
                  <Input
                    value={values[f.key] ?? ''}
                    onChange={v => setValues(s => ({ ...s, [f.key]: v }))}
                    type={f.kind === 'secret' && !reveal[f.key] ? 'password' : 'text'}
                    placeholder={f.placeholder}
                    style={{ fontSize: 12, fontFamily: f.kind === 'secret' ? 'monospace' : undefined, paddingRight: f.kind === 'secret' ? 32 : undefined }}
                  />
                  {f.kind === 'secret' && (
                    <button onClick={() => setReveal(s => ({ ...s, [f.key]: !s[f.key] }))} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11 }}>
                      {reveal[f.key] ? 'hide' : 'show'}
                    </button>
                  )}
                </div>
              )}
              {f.help && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.75 }}>{f.help}</p>}
            </div>
          )
        })}

        {showRaw && (
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              Channel config (JSON) — written under <code>channels.{def.id}</code>
            </label>
            <Textarea value={rawText} onChange={setRawText} rows={10} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            {rawError && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{rawError}</p>}
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
              Tip: secrets can be <code>{'{ source: "env", provider: "default", id: "VAR" }'}</code> instead of literals.
            </p>
          </div>
        )}

        {curated && (
          <button onClick={() => setShowRaw(s => !s)} className="text-xs" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0 }}>
            {showRaw ? '← Back to form' : 'Advanced: edit raw config'}
          </button>
        )}

        {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
      </div>
      )}

      <div className="flex items-center justify-between gap-2 px-5 py-3.5 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        {onBack ? <Btn variant="ghost" size="sm" onClick={onBack}>← Channels</Btn> : <span />}
        {tab === 'policy' ? (
          <Btn size="sm" onClick={onClose}>Done</Btn>
        ) : (
          <span className="flex items-center gap-2">
            <Btn variant="outline" size="sm" onClick={onClose}>Cancel</Btn>
            <Btn size="sm" loading={saving} onClick={submit}>{existing ? 'Save' : 'Create channel'}</Btn>
          </span>
        )}
      </div>
    </Overlay>
  )
}

// ── WhatsApp QR login modal ──────────────────────────────────────────────────
// Uses the gateway's web.login.start / web.login.wait RPCs (the same flow the
// official control-ui uses). start() returns the first QR as a PNG data URL and
// stops the channel; wait() long-polls, returning a refreshed QR or connected:true
// (after which the gateway auto-starts the channel). Works for remote gateways.

interface WebLoginResult { qrDataUrl?: string; connected?: boolean; message?: string }

function QrLoginModal({ channelId, account, onClose }: { channelId: string; account?: string; onClose: () => void }) {
  const def = channelDef(channelId)
  const refreshStatus = useChannelsStore(s => s.refreshStatus)
  const [qr, setQr] = useState('')
  const [message, setMessage] = useState('')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const genRef = useRef(0)

  // Run one login session (generation `gen`). force=true regenerates the QR.
  const runLogin = (gen: number, force: boolean) => {
    const accParam = account ? { accountId: account } : {}
    let currentQr = ''
    const apply = (r: WebLoginResult) => {
      if (gen !== genRef.current) return false
      if (r.message) setMessage(r.message)
      if (typeof r.connected === 'boolean') setConnected(r.connected)
      if (r.qrDataUrl) { currentQr = r.qrDataUrl; setQr(r.qrDataUrl) }
      else if (r.connected) setQr('')
      return true
    }
    const poll = async () => {
      while (gen === genRef.current) {
        try {
          const r = await gatewayClient.request<WebLoginResult>('web.login.wait', { timeoutMs: 120000, currentQrDataUrl: currentQr || undefined, ...accParam })
          if (!apply(r)) return
          if (r.connected) { void refreshStatus(false); return }
        } catch (e) {
          if (gen === genRef.current) setError(String(e))
          return
        }
      }
    }
    setBusy(true); setError('')
    gatewayClient.request<WebLoginResult>('web.login.start', { force, timeoutMs: 30000, ...accParam })
      .then(r => { if (!apply(r)) return; if (!r.connected) void poll() })
      .catch(e => { if (gen === genRef.current) setError(String(e)) })
      .finally(() => { if (gen === genRef.current) setBusy(false) })
  }

  useEffect(() => {
    const gen = ++genRef.current
    runLogin(gen, false)
    // Bump the generation on unmount so any in-flight poll loop self-cancels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { genRef.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const regenerate = () => { const gen = ++genRef.current; setConnected(false); setQr(''); runLogin(gen, true) }

  return (
    <Overlay onClose={onClose} title={`Link ${def.label}`} width={420} headerColor={def.color}>
      <div className="px-5 py-4 flex flex-col items-center gap-3">
        {!connected && (
          <p className="text-xs text-center" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            On your phone, open {def.label} → <b>Linked devices</b> → <b>Link a device</b>, then scan:
          </p>
        )}

        <div className="flex items-center justify-center rounded" style={{ width: 260, height: 260, background: '#fff', border: '1px solid var(--border)' }}>
          {connected ? (
            <div className="flex flex-col items-center gap-2" style={{ color: 'var(--success)' }}>
              <CheckCircle2 size={48} />
              <span className="text-sm font-medium">Linked!</span>
            </div>
          ) : qr ? (
            <img src={qr} alt="WhatsApp QR code" style={{ width: 240, height: 240, imageRendering: 'pixelated' }} />
          ) : (
            <div className="flex flex-col items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={28} className="animate-spin" />
              <span className="text-xs">{busy ? 'Generating QR…' : 'No QR'}</span>
            </div>
          )}
        </div>

        {message && <p className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>{message}</p>}
        {error && (
          <p className="text-xs text-center flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
            <AlertCircle size={13} /> {error}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-5 py-3.5 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <Btn variant="outline" size="sm" icon={<RefreshCw size={12} />} disabled={busy && !qr} onClick={regenerate}>Regenerate QR</Btn>
        <Btn size="sm" onClick={onClose}>{connected ? 'Done' : 'Close'}</Btn>
      </div>
    </Overlay>
  )
}

// ── Shared overlay shell ─────────────────────────────────────────────────────

function Overlay({ title, width, headerColor, onClose, children }: {
  title: string; width: number; headerColor?: string; onClose: () => void; children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 flex flex-col" style={{
        transform: 'translate(-50%, -50%)', width, maxHeight: '84vh',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}>
        <div className="flex items-center justify-between px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            {headerColor && <span className="w-2.5 h-2.5 rounded-full" style={{ background: headerColor }} />}
            <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
