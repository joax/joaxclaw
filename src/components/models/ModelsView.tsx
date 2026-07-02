import { useEffect, useState } from 'react'
import { Plus, Trash2, ChevronRight, Cpu, KeyRound, Link, Pencil, Check, X, RefreshCw, AlertCircle, Save, BarChart2, Plug, HardDriveDownload } from 'lucide-react'
import { useModelsStore } from '../../store/models'
import { LocalModelsPanel } from './LocalModelsPanel'
import { useSessionsStore } from '../../store/sessions'
import { useCronsStore } from '../../store/crons'
import { gatewayClient } from '../../lib/gateway'
import type { GwModelDef, GwModelProvider, SecretRef } from '../../lib/types'
import { isSecretRef } from '../../lib/channels'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { ProviderLogo, hasProviderLogo } from '../ui/ProviderLogo'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTokens(n?: number): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

function fmtCost(v?: number): string {
  if (v === undefined || v === null) return '—'
  if (v === 0) return '$0'
  // Values stored per-token → display per 1M
  const perM = v * 1_000_000
  if (perM >= 1) return `$${perM % 1 === 0 ? perM.toFixed(0) : perM.toFixed(2)}`
  return `$${perM.toPrecision(3)}`
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const tdStyle: React.CSSProperties = { padding: '7px 10px', verticalAlign: 'middle' }
const thStyle: React.CSSProperties = { padding: '7px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }
const inlineInputStyle: React.CSSProperties = { width: '100%', padding: '5px 8px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }
const iconBtnStyle: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, color: 'var(--text-secondary)' }

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{ width: 32, height: 18, borderRadius: 9, cursor: 'pointer', border: 'none', background: value ? 'var(--accent)' : 'var(--border)', transition: 'background 0.15s', position: 'relative', flexShrink: 0 }}
    >
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: value ? 17 : 3, transition: 'left 0.15s' }} />
    </button>
  )
}

// ── Input modality badges ─────────────────────────────────────────────────────

const MODALITIES = ['text', 'image', 'audio', 'video'] as const
const MODALITY_COLORS: Record<string, string> = { text: 'var(--text-secondary)', image: '#3b82f6', audio: '#8b5cf6', video: '#ec4899' }

function ModalityBadge({ type }: { type: string }) {
  const color = MODALITY_COLORS[type] ?? 'var(--text-secondary)'
  return (
    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, border: `1px solid ${color}44`, background: `${color}11`, color, whiteSpace: 'nowrap' }}>
      {type}
    </span>
  )
}

function ModalitySelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (m: string) => onChange(value.includes(m) ? value.filter(x => x !== m) : [...value, m])
  return (
    <div className="flex gap-1.5 flex-wrap">
      {MODALITIES.map(m => {
        const active = value.includes(m)
        const color = MODALITY_COLORS[m]
        return (
          <button
            key={m}
            type="button"
            onClick={() => toggle(m)}
            style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${active ? color : 'var(--border)'}`,
              background: active ? `${color}22` : 'var(--bg-elevated)',
              color: active ? color : 'var(--text-secondary)',
              transition: 'all 0.1s',
            }}
          >{m}</button>
        )
      })}
    </div>
  )
}

// ── LabeledField ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  )
}

// ── Model row ─────────────────────────────────────────────────────────────────

function ModelRow({ model, providerId, onDelete }: { model: GwModelDef; providerId: string; onDelete: () => void }) {
  const { setModel } = useModelsStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GwModelDef>(model)

  const handleSave = () => { setModel(providerId, draft); setEditing(false) }
  const handleCancel = () => { setDraft(model); setEditing(false) }

  if (editing) {
    return (
      <tr style={{ background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-elevated))' }}>
        <td colSpan={9} style={{ padding: 12 }}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Model ID">
                <input value={draft.id} onChange={e => setDraft(d => ({ ...d, id: e.target.value }))} style={inlineInputStyle} />
              </Field>
              <Field label="Display name">
                <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={inlineInputStyle} />
              </Field>
              <Field label="Context window (tokens)">
                <input type="number" value={draft.contextWindow ?? ''} onChange={e => setDraft(d => ({ ...d, contextWindow: e.target.value ? Number(e.target.value) : undefined }))} style={inlineInputStyle} placeholder="—" />
              </Field>
              <Field label="Max tokens (output)">
                <input type="number" value={draft.maxTokens ?? ''} onChange={e => setDraft(d => ({ ...d, maxTokens: e.target.value ? Number(e.target.value) : undefined }))} style={inlineInputStyle} placeholder="—" />
              </Field>
              <Field label="Input cost ($ per 1M tokens)">
                <input type="number" step="any" value={draft.cost?.input != null ? +(draft.cost.input * 1e6).toPrecision(6) : ''} onChange={e => setDraft(d => ({ ...d, cost: { ...d.cost ?? { input:0, output:0, cacheRead:0, cacheWrite:0 }, input: Number(e.target.value) / 1e6 } }))} style={inlineInputStyle} placeholder="0" />
              </Field>
              <Field label="Output cost ($ per 1M tokens)">
                <input type="number" step="any" value={draft.cost?.output != null ? +(draft.cost.output * 1e6).toPrecision(6) : ''} onChange={e => setDraft(d => ({ ...d, cost: { ...d.cost ?? { input:0, output:0, cacheRead:0, cacheWrite:0 }, output: Number(e.target.value) / 1e6 } }))} style={inlineInputStyle} placeholder="0" />
              </Field>
              <Field label="Cache read cost ($ per 1M tokens)">
                <input type="number" step="any" value={draft.cost?.cacheRead != null ? +(draft.cost.cacheRead * 1e6).toPrecision(6) : ''} onChange={e => setDraft(d => ({ ...d, cost: { ...d.cost ?? { input:0, output:0, cacheRead:0, cacheWrite:0 }, cacheRead: Number(e.target.value) / 1e6 } }))} style={inlineInputStyle} placeholder="0" />
              </Field>
              <Field label="Cache write cost ($ per 1M tokens)">
                <input type="number" step="any" value={draft.cost?.cacheWrite != null ? +(draft.cost.cacheWrite * 1e6).toPrecision(6) : ''} onChange={e => setDraft(d => ({ ...d, cost: { ...d.cost ?? { input:0, output:0, cacheRead:0, cacheWrite:0 }, cacheWrite: Number(e.target.value) / 1e6 } }))} style={inlineInputStyle} placeholder="0" />
              </Field>
              <Field label="Input modalities">
                <ModalitySelect value={draft.input ?? []} onChange={v => setDraft(d => ({ ...d, input: v }))} />
              </Field>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none text-sm" style={{ color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={!!draft.reasoning} onChange={e => setDraft(d => ({ ...d, reasoning: e.target.checked }))} />
                Reasoning / thinking
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none text-sm" style={{ color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={!!draft.compat?.supportsTools} onChange={e => setDraft(d => ({ ...d, compat: { ...d.compat, supportsTools: e.target.checked } }))} />
                Supports tools
              </label>
            </div>
            <div className="flex gap-2">
              <Btn size="sm" onClick={handleSave} icon={<Check size={12} />}>Save</Btn>
              <Btn size="sm" variant="ghost" onClick={handleCancel} icon={<X size={12} />}>Cancel</Btn>
            </div>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="group" style={{ borderBottom: '1px solid var(--border)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td style={tdStyle}>
        <div className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{model.id}</div>
        {model.name !== model.id && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{model.name}</div>}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{fmtTokens(model.contextWindow)}</span>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtTokens(model.maxTokens)}</span>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{fmtCost(model.cost?.input)}</span>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{fmtCost(model.cost?.output)}</span>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtCost(model.cost?.cacheRead)}</div>
        <div className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtCost(model.cost?.cacheWrite)}</div>
      </td>
      <td style={tdStyle}>
        <div className="flex gap-1 flex-wrap">
          {(model.input ?? []).map(t => <ModalityBadge key={t} type={t} />)}
        </div>
      </td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        <div className="flex items-center justify-center gap-2">
          {model.reasoning && <span className="text-xs" style={{ color: '#f59e0b' }} title="Reasoning">🧠</span>}
          {model.compat?.supportsTools && <span className="text-xs" title="Tools">⚙</span>}
        </div>
      </td>
      <td style={{ ...tdStyle, width: 52 }}>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} style={iconBtnStyle} title="Edit"
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-primary)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)')}
          ><Pencil size={13} /></button>
          <button onClick={onDelete} style={iconBtnStyle} title="Delete"
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--danger)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)')}
          ><Trash2 size={13} /></button>
        </div>
      </td>
    </tr>
  )
}

// ── Add model form ────────────────────────────────────────────────────────────

function AddModelForm({ providerId, onDone }: { providerId: string; onDone: () => void }) {
  const { setModel } = useModelsStore()
  const [id, setId] = useState('')
  const [name, setName] = useState('')

  const handleAdd = () => {
    if (!id.trim()) return
    setModel(providerId, {
      id: id.trim(),
      name: name.trim() || id.trim(),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      input: ['text'],
      compat: { supportsTools: true },
    })
    onDone()
  }

  return (
    <div className="p-4 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Add model</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Model ID">
          <input value={id} onChange={e => setId(e.target.value)} style={inlineInputStyle} placeholder="e.g. qwen3:8b" autoFocus
            onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        </Field>
        <Field label="Display name (optional)">
          <input value={name} onChange={e => setName(e.target.value)} style={inlineInputStyle} placeholder="Same as ID if blank"
            onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Btn size="sm" onClick={handleAdd} icon={<Plus size={12} />}>Add</Btn>
        <Btn size="sm" variant="ghost" onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  )
}

// ── Inline editable config field ──────────────────────────────────────────────

function ConfigField({ icon, label, value, onSave, placeholder }: {
  icon: React.ReactNode; label: string; value?: string | SecretRef; onSave: (v: string) => void; placeholder?: string
}) {
  const isRef = isSecretRef(value)
  const literal = typeof value === 'string' ? value : ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(literal)

  const commit = () => { onSave(draft.trim()); setEditing(false) }

  // SecretRef indirections are surfaced read-only — edit them in the raw config.
  if (isRef) {
    return (
      <div className="flex items-center gap-3">
        <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{icon}</span>
        <span className="text-xs w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="font-mono text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>
          secret ref → {value.id} (edit in raw config to change)
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{icon}</span>
      <span className="text-xs w-20 shrink-0" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {editing ? (
        <div className="flex items-center gap-2 flex-1">
          <input value={draft} onChange={e => setDraft(e.target.value)} style={{ ...inlineInputStyle, flex: 1 }} autoFocus placeholder={placeholder}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
          <Btn size="sm" onClick={commit} icon={<Check size={11} />} />
          <Btn size="sm" variant="ghost" onClick={() => setEditing(false)} icon={<X size={11} />} />
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1">
          <span className="font-mono text-xs flex-1 truncate" style={{ color: literal ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {literal || 'Not set'}
          </span>
          <button onClick={() => { setDraft(literal); setEditing(true) }} style={iconBtnStyle} title="Edit"
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-primary)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)')}
          ><Pencil size={13} /></button>
        </div>
      )}
    </div>
  )
}

// ── Provider panel ────────────────────────────────────────────────────────────

function ProviderPanel({ id, provider }: { id: string; provider: GwModelProvider }) {
  const { updateProviderConfig, deleteModel } = useModelsStore()
  const [addingModel, setAddingModel] = useState(false)

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}>
          {hasProviderLogo(id) ? <ProviderLogo provider={id} size={18} /> : <Cpu size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{id}</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
            {provider.api && <> · <span className="font-mono">{provider.api}</span></>}
          </p>
        </div>
      </div>

      {/* Config fields */}
      <div className="px-5 py-3 flex flex-col gap-2.5" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <ConfigField icon={<Link size={13} />} label="Base URL" value={provider.baseUrl} placeholder="https://…"
          onSave={v => updateProviderConfig(id, { baseUrl: v || undefined })} />
        <ConfigField icon={<KeyRound size={13} />} label="API key" value={provider.apiKey} placeholder="sk-… or env var name"
          onSave={v => updateProviderConfig(id, { apiKey: v || undefined })} />
      </div>

      {/* Models table */}
      <div className="flex-1 min-h-0 overflow-auto">
        {provider.models.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ ...thStyle, textAlign: 'left' }}>Model</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Context</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Max out</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>In /1M</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Out /1M</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Cache /1M</th>
                <th style={thStyle}>Modalities</th>
                <th style={thStyle}>Caps</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {provider.models.map(m => (
                <ModelRow key={m.id} model={m} providerId={id} onDelete={() => deleteModel(id, m.id)} />
              ))}
            </tbody>
          </table>
        ) : !addingModel ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Cpu size={28} style={{ color: 'var(--text-secondary)', opacity: 0.25 }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No models configured</p>
            <Btn size="sm" variant="outline" icon={<Plus size={12} />} onClick={() => setAddingModel(true)}>Add model</Btn>
          </div>
        ) : null}

        {addingModel && <AddModelForm providerId={id} onDone={() => setAddingModel(false)} />}
      </div>

      {!addingModel && provider.models.length > 0 && (
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <Btn size="sm" variant="outline" icon={<Plus size={12} />} onClick={() => setAddingModel(true)}>Add model</Btn>
        </div>
      )}
    </div>
  )
}

// ── Add provider form ─────────────────────────────────────────────────────────

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const { addProvider } = useModelsStore()
  const [id, setId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState('')

  const handleAdd = () => {
    if (!id.trim()) return
    addProvider(id.trim(), { baseUrl: baseUrl.trim() || undefined, api: api.trim() || undefined, models: [] })
    onDone()
  }

  return (
    <div className="p-3 flex flex-col gap-2" style={{ borderTop: '1px solid var(--border)' }}>
      <Input value={id} onChange={setId} placeholder="Provider ID (e.g. mistral)" autoFocus style={{ fontSize: 12 }} />
      <Input value={baseUrl} onChange={setBaseUrl} placeholder="Base URL (optional)" style={{ fontSize: 12 }} />
      <Input value={api} onChange={setApi} placeholder="API type (e.g. openai)" style={{ fontSize: 12 }} />
      <div className="flex gap-2">
        <Btn size="sm" onClick={handleAdd}>Add</Btn>
        <Btn size="sm" variant="ghost" onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

// ── Usage tab ─────────────────────────────────────────────────────────────────

function fmtTokensBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtUsd(n: number): string {
  if (n === 0) return '—'
  if (n < 0.01) return `$${n.toPrecision(3)}`
  return `$${n.toFixed(4)}`
}

function UsageTab() {
  const { sessions, fetch: fetchSessions } = useSessionsStore()
  const { jobs, runs, fetch: fetchJobs, fetchRuns } = useCronsStore()
  const { providers } = useModelsStore()
  const [fetchingRuns, setFetchingRuns] = useState(false)

  useEffect(() => {
    fetchSessions()
    fetchJobs()
  }, [])

  // Once jobs are loaded, fetch all their run history
  useEffect(() => {
    if (jobs.length === 0) return
    setFetchingRuns(true)
    Promise.all(jobs.map(j => fetchRuns(j.id, true))).finally(() => setFetchingRuns(false))
  }, [jobs.length])

  type Row = {
    model: string; provider: string
    sessionCount: number; cronRuns: number
    inputTokens: number; outputTokens: number; estimatedCostUsd: number
  }

  const acc: Record<string, Row> = {}

  // Sessions
  sessions.forEach(s => {
    if (!s.model) return
    const key = s.model
    if (!acc[key]) acc[key] = { model: s.model, provider: s.modelProvider ?? '', sessionCount: 0, cronRuns: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }
    acc[key].sessionCount++
    acc[key].inputTokens      += s.inputTokens      ?? 0
    acc[key].outputTokens     += s.outputTokens     ?? 0
    acc[key].estimatedCostUsd += s.estimatedCostUsd ?? 0
  })

  // Cron runs
  Object.values(runs).forEach(jobRuns => {
    jobRuns.forEach(run => {
      if (!run.model || !run.usage) return
      const key = run.model
      if (!acc[key]) {
        const slash = run.model.indexOf('/')
        acc[key] = { model: run.model, provider: slash >= 0 ? run.model.slice(0, slash) : '', sessionCount: 0, cronRuns: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }
      }
      acc[key].cronRuns++
      acc[key].inputTokens  += run.usage.input_tokens  ?? 0
      acc[key].outputTokens += run.usage.output_tokens ?? 0
    })
  })

  const byModel = Object.values(acc).sort((a, b) => b.inputTokens - a.inputTokens)

  function computedCost(row: Row): number {
    if (row.estimatedCostUsd > 0) return row.estimatedCostUsd
    const slash = row.model.indexOf('/')
    const pid = slash >= 0 ? row.model.slice(0, slash) : row.provider
    const mid = slash >= 0 ? row.model.slice(slash + 1) : row.model
    const def = providers[pid]?.models.find(m => m.id === mid)
    if (!def?.cost) return 0
    return row.inputTokens * def.cost.input + row.outputTokens * def.cost.output
  }

  const totalInput  = byModel.reduce((s, r) => s + r.inputTokens, 0)
  const totalOutput = byModel.reduce((s, r) => s + r.outputTokens, 0)
  const totalCost   = byModel.reduce((s, r) => s + computedCost(r), 0)

  if (byModel.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--text-secondary)' }}>
        <BarChart2 size={32} style={{ opacity: 0.2 }} />
        <p className="text-sm">{fetchingRuns ? 'Loading…' : 'No usage data yet'}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Totals bar */}
      <div className="flex gap-8 px-5 py-3 shrink-0 text-sm" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div>
          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Total input</span>
          <p className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtTokensBig(totalInput)}</p>
        </div>
        <div>
          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Total output</span>
          <p className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtTokensBig(totalOutput)}</p>
        </div>
        <div>
          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Estimated cost</span>
          <p className="font-mono font-semibold" style={{ color: totalCost > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{totalCost > 0 ? fmtUsd(totalCost) : '—'}</p>
        </div>
        {fetchingRuns && (
          <div className="flex items-center gap-1.5 ml-auto text-xs" style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> Loading cron history…
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={{ ...thStyle, textAlign: 'left' }}>Model</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Sessions</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Cron runs</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Input tokens</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Output tokens</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {byModel.map(row => {
              const cost = computedCost(row)
              const slash = row.model.indexOf('/')
              const pid = slash >= 0 ? row.model.slice(0, slash) : row.provider
              const mid = slash >= 0 ? row.model.slice(slash + 1) : row.model
              return (
                <tr key={row.model} style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={tdStyle}>
                    <div className="flex items-center gap-2">
                      <ProviderLogo provider={row.model || pid} size={14} style={{ color: 'var(--text-secondary)' }} />
                      <div>
                        <div className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{mid}</div>
                        {pid && <div className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>{pid}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 12 }}>{row.sessionCount || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 12 }}>{row.cronRuns || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-primary)',   fontFamily: 'monospace', fontSize: 12 }}>{fmtTokensBig(row.inputTokens)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 12 }}>{fmtTokensBig(row.outputTokens)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: cost > 0 ? 'var(--success)' : 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 12 }}>{fmtUsd(cost)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ModelsView() {
  const { providers, pluginProviderIds, pluginEnabled, selectedId, loading, error, dirty, saving, load, selectProvider, setProviderEnabled, deleteProvider, save } = useModelsStore()
  const [addingProvider, setAddingProvider] = useState(false)
  const [tab, setTab] = useState<'providers' | 'local' | 'usage'>('providers')

  useEffect(() => { load() }, [])

  const selectedProvider = selectedId ? providers[selectedId] : null

  // Config-origin providers first (alphabetical), then plugin-only ones (alphabetical)
  const allProviderIds = [
    ...Object.keys(providers).filter(pid => !pluginProviderIds.has(pid)).sort(),
    ...Object.keys(providers).filter(pid => pluginProviderIds.has(pid)).sort(),
  ]

  const tabBtn = (t: typeof tab, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => setTab(t)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
        fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none',
        borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
        background: 'none', color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
        transition: 'color 0.1s',
      }}
    >
      {icon}{label}
    </button>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar */}
      <div className="flex items-center px-2 shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        {tabBtn('providers', 'Providers', <Cpu size={12} />)}
        {tabBtn('local', 'Local models', <HardDriveDownload size={12} />)}
        {tabBtn('usage', 'Usage', <BarChart2 size={12} />)}
      </div>

      {tab === 'local' && <LocalModelsPanel />}
      {tab === 'usage' && <UsageTab />}
      {tab === 'providers' && <>
      {/* Dirty / save bar */}
      {(dirty || saving) && (
        <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-surface))', borderBottom: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}>
          <AlertCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <span className="text-xs flex-1" style={{ color: 'var(--warning)' }}>Unsaved changes</span>
          <Btn size="sm" variant="outline" onClick={load} disabled={saving}>Discard</Btn>
          <Btn size="sm" loading={saving} icon={<Save size={12} />} onClick={save}>Save to gateway</Btn>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="flex flex-col shrink-0" style={{ width: 220, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <span>Providers</span>
            <button onClick={load} style={{ ...iconBtnStyle, opacity: loading ? 0.5 : 1 }} title="Reload from gateway">
              <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>

          {error && (
            <div className="mx-2 mt-2 px-2 py-1.5 rounded text-xs flex items-center gap-1.5" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
              <AlertCircle size={11} /> {error}
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-1">
            {allProviderIds.length === 0 && !loading && (
              <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>No providers in config</p>
            )}
            {allProviderIds.map(pid => {
              const active = pid === selectedId
              const enabled = pluginEnabled[pid] !== false
              const isPlugin = pluginProviderIds.has(pid)
              return (
                <div key={pid}
                  className="group relative flex items-center gap-2.5 px-3 py-2.5 cursor-pointer"
                  onClick={() => selectProvider(pid)}
                  style={{ background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'transparent', borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`, transition: 'background 0.1s' }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  {isPlugin
                    ? <Plug size={11} style={{ color: enabled ? 'var(--success)' : 'var(--border)', flexShrink: 0 }} />
                    : <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: enabled ? 'var(--success)' : 'var(--border)' }} />
                  }
                  <ProviderLogo provider={pid} size={15} style={{ color: 'var(--text-secondary)', opacity: enabled ? 0.9 : 0.4 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)', opacity: enabled ? 1 : 0.5 }}>{pid}</p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{providers[pid]?.models.length ?? 0} models</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Toggle value={enabled} onChange={v => setProviderEnabled(pid, v)} />
                    {active && <ChevronRight size={11} style={{ color: 'var(--text-secondary)' }} />}
                  </div>
                  {!isPlugin && (
                    <button
                      onClick={e => { e.stopPropagation(); deleteProvider(pid) }}
                      className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ ...iconBtnStyle }}
                      title="Remove provider"
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--danger)')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)')}
                    ><Trash2 size={13} /></button>
                  )}
                </div>
              )
            })}
          </div>

          {addingProvider ? (
            <AddProviderForm onDone={() => setAddingProvider(false)} />
          ) : (
            <div className="p-2" style={{ borderTop: '1px solid var(--border)' }}>
              <Btn size="sm" variant="outline" icon={<Plus size={12} />} onClick={() => setAddingProvider(true)} style={{ width: '100%' }}>Add provider</Btn>
            </div>
          )}
        </div>

        {/* Right panel */}
        {selectedId && selectedProvider ? (
          <ProviderPanel key={selectedId} id={selectedId} provider={selectedProvider} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ background: 'var(--bg-primary)' }}>
            <Cpu size={36} style={{ color: 'var(--text-secondary)', opacity: 0.2 }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {loading ? 'Loading from gateway…' : 'Select a provider'}
            </p>
          </div>
        )}
      </div>
      </>}
    </div>
  )
}
