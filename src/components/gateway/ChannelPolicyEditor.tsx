import { useMemo, useState } from 'react'
import { Plus, X, Loader2, ShieldCheck } from 'lucide-react'
import { Input } from '../ui/Input'
import { useChannelsStore } from '../../store/channels'
import {
  channelPolicySpec, nestedPatch, readPolicyPath, readAllowlist, isActionAllowed,
  type PolicyField,
} from '../../lib/channelPolicy'

// Per-channel policy editor (the "Policy" tab in the channel Edit modal). Edits the
// access + action-permission knobs under channels.<id> — and the same shape under a
// chosen account (channels.<id>.accounts.<accId>) or group (…​.groups.<gid>) override.
// Writes immediately via the store (config.patch), so the editor reads live channel
// state rather than a stale snapshot.

type Scope = { kind: 'channel' } | { kind: 'account'; id: string } | { kind: 'group'; id: string }

export function ChannelPolicyEditor({ channelId }: { channelId: string }) {
  const channel = useChannelsStore(s => s.channels.find(c => c.id === channelId))
  const updateSettings = useChannelsStore(s => s.updateSettings)
  const spec = channelPolicySpec(channelId)

  const [scope, setScope] = useState<Scope>({ kind: 'channel' })
  const [extraGroups, setExtraGroups] = useState<string[]>([])
  const [newGroup, setNewGroup] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const raw = channel?.raw ?? {}
  const groupIds = useMemo(() => {
    const fromCfg = Object.keys((raw.groups as Record<string, unknown>) ?? {})
    return [...new Set([...fromCfg, ...extraGroups])]
  }, [raw.groups, extraGroups])

  if (!spec || !channel) {
    return <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Policy controls aren’t curated for this channel — edit it via Advanced raw config.</p>
  }

  // The config block the current scope edits.
  const block: Record<string, unknown> | undefined =
    scope.kind === 'channel' ? raw
    : scope.kind === 'account' ? (raw.accounts as Record<string, Record<string, unknown>>)?.[scope.id]
    : (raw.groups as Record<string, Record<string, unknown>>)?.[scope.id]

  // Write a single field for the current scope. `isArray` marks allowlist writes so
  // the store passes replacePaths (array shrink needs it).
  const write = async (fieldPath: string, value: unknown, isArray = false) => {
    setErr(''); setSaving(fieldPath)
    const inner = nestedPatch(fieldPath, value)
    let patch: Record<string, unknown>
    let fullPath: string
    if (scope.kind === 'channel') {
      patch = inner; fullPath = `channels.${channelId}.${fieldPath}`
    } else if (scope.kind === 'account') {
      patch = { accounts: { [scope.id]: inner } }; fullPath = `channels.${channelId}.accounts.${scope.id}.${fieldPath}`
    } else {
      patch = { groups: { [scope.id]: inner } }; fullPath = `channels.${channelId}.groups.${scope.id}.${fieldPath}`
    }
    try { await updateSettings(channelId, patch, isArray ? [fullPath] : undefined) }
    catch (e) { setErr(String(e)) }
    finally { setSaving(null) }
  }

  const scopeLabel = scope.kind === 'channel' ? 'the whole channel'
    : scope.kind === 'account' ? `account ${scope.id}`
    : `group ${scope.id}`

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 px-2.5 py-2 rounded text-xs" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <ShieldCheck size={13} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>Who may reach the agent and what it’s allowed to do on this platform. Changes save immediately and apply to <b style={{ color: 'var(--text-primary)' }}>{scopeLabel}</b>.</span>
      </div>

      {/* Scope selector */}
      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Applies to</label>
        <div className="flex flex-wrap gap-1.5">
          <ScopeChip active={scope.kind === 'channel'} onClick={() => setScope({ kind: 'channel' })}>Channel (default)</ScopeChip>
          {channel.accounts.map(a => (
            <ScopeChip key={`a:${a.id}`} active={scope.kind === 'account' && scope.id === a.id} onClick={() => setScope({ kind: 'account', id: a.id })}>
              @{a.name || a.id}
            </ScopeChip>
          ))}
          {groupIds.map(g => (
            <ScopeChip key={`g:${g}`} active={scope.kind === 'group' && scope.id === g} onClick={() => setScope({ kind: 'group', id: g })}>
              group {g}
            </ScopeChip>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <Input value={newGroup} onChange={setNewGroup} placeholder="Group / chat ID for a per-group override" style={{ fontSize: 11 }} />
          <button
            onClick={() => {
              const id = newGroup.trim()
              if (!id) return
              if (!extraGroups.includes(id)) setExtraGroups(g => [...g, id])
              setScope({ kind: 'group', id }); setNewGroup('')
            }}
            title="Add group override"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--text-secondary)', padding: '5px 8px', display: 'flex' }}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Access policy */}
      <Section title="Access">
        {spec.access.map(f => (
          <AccessRow key={f.path} field={f} block={block} saving={saving === f.path} onWrite={write} />
        ))}
      </Section>

      {/* Action permissions */}
      <Section title="Action permissions" subtitle="What the agent may do on the platform. All allowed by default; turn off to restrict.">
        <div className="grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          {spec.actions.map(key => {
            const allowed = isActionAllowed(block, key)
            return (
              <button
                key={key}
                onClick={() => write(`actions.${key}`, !allowed)}
                className="flex items-center gap-2 py-1"
                style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                <Check on={allowed} busy={saving === `actions.${key}`} />
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: allowed ? 'var(--text-primary)' : 'var(--text-secondary)', textDecoration: allowed ? 'none' : 'line-through' }}>{key}</span>
              </button>
            )
          })}
        </div>
      </Section>

      {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
    </div>
  )
}

function AccessRow({ field, block, saving, onWrite }: {
  field: PolicyField
  block: Record<string, unknown> | undefined
  saving: boolean
  onWrite: (path: string, value: unknown, isArray?: boolean) => void
}) {
  if (field.type === 'enum') {
    const cur = (readPolicyPath(block, field.path) as string) ?? ''
    return (
      <Field label={field.label} help={field.help} busy={saving}>
        <select
          value={cur}
          onChange={e => onWrite(field.path, e.target.value || undefined)}
          style={{ width: '100%', padding: '5px 8px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}
        >
          <option value="">(default)</option>
          {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    )
  }
  if (field.type === 'boolean') {
    const on = readPolicyPath(block, field.path) === true
    return (
      <Field label={field.label} help={field.help} busy={saving} inline>
        <button onClick={() => onWrite(field.path, !on)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
          <Check on={on} busy={saving} />
        </button>
      </Field>
    )
  }
  // allowlist
  const list = readAllowlist(block, field.path)
  return (
    <Field label={field.label} help={field.help} busy={saving}>
      <AllowlistEditor list={list} onChange={next => onWrite(field.path, next, true)} />
    </Field>
  )
}

function AllowlistEditor({ list, onChange }: { list: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || list.includes(v)) { setDraft(''); return }
    onChange([...list, v]); setDraft('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5" style={{ minHeight: list.length ? undefined : 0 }}>
        {list.map(id => (
          <span key={id} className="flex items-center gap-1" style={{ fontSize: 11, fontFamily: 'monospace', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px 1px 7px', color: 'var(--text-primary)' }}>
            {id}
            <button onClick={() => onChange(list.filter(x => x !== id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 0 }}><X size={11} /></button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Input value={draft} onChange={setDraft} placeholder="Add a sender ID…" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} style={{ fontSize: 11, fontFamily: 'monospace' }} />
        <button onClick={add} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--text-secondary)', padding: '5px 8px', display: 'flex' }}><Plus size={13} /></button>
      </div>
    </div>
  )
}

// ── small presentational bits ─────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
      <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</p>
      {subtitle && <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)', opacity: 0.75, lineHeight: 1.4 }}>{subtitle}</p>}
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function Field({ label, help, busy, inline, children }: { label: string; help?: string; busy?: boolean; inline?: boolean; children: React.ReactNode }) {
  return (
    <div className={inline ? 'flex items-center justify-between gap-3' : undefined}>
      <label className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
        {label}{busy && <Loader2 size={10} className="animate-spin" />}
      </label>
      {children}
      {help && !inline && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7, lineHeight: 1.4 }}>{help}</p>}
    </div>
  )
}

function ScopeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 11, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-elevated)',
      color: active ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400,
    }}>{children}</button>
  )
}

function Check({ on, busy }: { on: boolean; busy?: boolean }) {
  return (
    <span style={{
      width: 15, height: 15, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
      background: on ? 'var(--accent)' : 'transparent',
    }}>
      {busy ? <Loader2 size={9} className="animate-spin" style={{ color: on ? 'var(--bg-primary)' : 'var(--text-secondary)' }} />
        : on ? <svg width="9" height="9" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" fill="none" stroke="var(--bg-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        : null}
    </span>
  )
}
