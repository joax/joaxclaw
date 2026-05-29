import { useEffect, useState } from 'react'
import { Plus, Trash2, ChevronRight, Cpu, KeyRound, Link, Pencil, Check, X, RefreshCw, AlertCircle, Save } from 'lucide-react'
import { useModelsStore } from '../../store/models'
import type { GwModelDef, GwModelProvider } from '../../lib/types'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'

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

function ModalityBadge({ type }: { type: string }) {
  const colors: Record<string, string> = { text: 'var(--text-secondary)', image: '#3b82f6', audio: '#8b5cf6', video: '#ec4899' }
  const color = colors[type] ?? 'var(--text-secondary)'
  return (
    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, border: `1px solid ${color}44`, background: `${color}11`, color, whiteSpace: 'nowrap' }}>
      {type}
    </span>
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
              <Field label="Input cost (per token)">
                <input type="number" step="any" value={draft.cost?.input ?? ''} onChange={e => setDraft(d => ({ ...d, cost: { ...d.cost ?? { input:0, output:0, cacheRead:0, cacheWrite:0 }, input: Number(e.target.value) } }))} style={inlineInputStyle} placeholder="0" />
              </Field>
              <Field label="Output cost (per token)">
                <input type="number" step="any" value={draft.cost?.output ?? ''} onChange={e => setDraft(d => ({ ...d, cost: { ...d.cost ?? { input:0, output:0, cacheRead:0, cacheWrite:0 }, output: Number(e.target.value) } }))} style={inlineInputStyle} placeholder="0" />
              </Field>
              <Field label="Cache read cost (per token)">
                <input type="number" step="any" value={draft.cost?.cacheRead ?? ''} onChange={e => setDraft(d => ({ ...d, cost: { ...d.cost ?? { input:0, output:0, cacheRead:0, cacheWrite:0 }, cacheRead: Number(e.target.value) } }))} style={inlineInputStyle} placeholder="0" />
              </Field>
              <Field label="Cache write cost (per token)">
                <input type="number" step="any" value={draft.cost?.cacheWrite ?? ''} onChange={e => setDraft(d => ({ ...d, cost: { ...d.cost ?? { input:0, output:0, cacheRead:0, cacheWrite:0 }, cacheWrite: Number(e.target.value) } }))} style={inlineInputStyle} placeholder="0" />
              </Field>
              <Field label="Input modalities (comma-separated)">
                <input value={(draft.input ?? []).join(', ')} onChange={e => setDraft(d => ({ ...d, input: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} style={inlineInputStyle} placeholder="text, image" />
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
              <label className="flex items-center gap-2 cursor-pointer select-none text-sm" style={{ color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={!!draft.compat?.supportsVision} onChange={e => setDraft(d => ({ ...d, compat: { ...d.compat, supportsVision: e.target.checked } }))} />
                Vision
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
          {model.compat?.supportsVision && <span className="text-xs" title="Vision">👁</span>}
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
  icon: React.ReactNode; label: string; value?: string; onSave: (v: string) => void; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  const commit = () => { onSave(draft.trim()); setEditing(false) }

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
          <span className="font-mono text-xs flex-1 truncate" style={{ color: value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {value || 'Not set'}
          </span>
          <button onClick={() => { setDraft(value ?? ''); setEditing(true) }} style={iconBtnStyle} title="Edit"
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
          <Cpu size={16} />
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

export function ModelsView() {
  const { providers, pluginEnabled, selectedId, loading, error, dirty, saving, load, selectProvider, setProviderEnabled, deleteProvider, save } = useModelsStore()
  const [addingProvider, setAddingProvider] = useState(false)

  useEffect(() => { load() }, [])

  const selectedProvider = selectedId ? providers[selectedId] : null
  const providerIds = Object.keys(providers)

  return (
    <div className="flex flex-col flex-1 min-h-0">
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
            {providerIds.length === 0 && !loading && (
              <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>No providers in config</p>
            )}
            {providerIds.map(pid => {
              const active = pid === selectedId
              const enabled = pluginEnabled[pid] !== false
              return (
                <div key={pid}
                  className="group relative flex items-center gap-2.5 px-3 py-2.5 cursor-pointer"
                  onClick={() => selectProvider(pid)}
                  style={{ background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'transparent', borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`, transition: 'background 0.1s' }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: enabled ? 'var(--success)' : 'var(--border)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)', opacity: enabled ? 1 : 0.5 }}>{pid}</p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{providers[pid]?.models.length ?? 0} models</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Toggle value={enabled} onChange={v => setProviderEnabled(pid, v)} />
                    {active && <ChevronRight size={11} style={{ color: 'var(--text-secondary)' }} />}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); deleteProvider(pid) }}
                    className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ ...iconBtnStyle }}
                    title="Remove provider"
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--danger)')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)')}
                  ><Trash2 size={13} /></button>
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
    </div>
  )
}
