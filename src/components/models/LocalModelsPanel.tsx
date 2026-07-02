import { useEffect, useMemo, useState } from 'react'
import { HardDriveDownload, Trash2, RefreshCw, AlertCircle, Loader2, Check, Plus, Power, X, Search, Wrench, Eye, Brain, Code, Binary, ChevronRight, ArrowRight, PackageOpen, Type, Image as ImageIcon, AudioLines, Video } from 'lucide-react'
import { useModelsStore } from '../../store/models'
import { useModelManagerStore } from '../../store/modelManager'
import { useMetricsStore } from '../../store/metrics'
import { detectFromConfig } from '../../lib/localEngines'
import { fmtBytes, fmtContext, ramFootprint, type ModelDetails, type InstalledModel, type RunningModel } from '../../lib/modelManager'
import { searchCatalog, modelModalities, type CatalogModel, type ModelCapability, type InputModality } from '../../lib/modelCatalog'
import type { GwModelDef } from '../../lib/types'
import { ProviderLogo, hasProviderLogo } from '../ui/ProviderLogo'

// Local models manager (Models → Local models). Two columns: on the LEFT, catalog models
// available to install (arrow → pulls them onto the engine); on the RIGHT, the models
// already installed on the engine, with load/unload, add-to-provider, details and delete.
// Routed through joaxclaw-fs engines.* so it works on a local AND a remote gateway. Ollama-only.

export function LocalModelsPanel() {
  const providers = useModelsStore(s => s.providers)
  const setModel = useModelsStore(s => s.setModel)
  const save = useModelsStore(s => s.save)
  const { installed, running, loading, error, needsPlugin, downloads, details, load, pull, remove, loadDetails, setLoaded } = useModelManagerStore()

  // Machine RAM + GPU VRAM (bytes) for the footprint bar — from the live metrics store,
  // with a one-shot fetch fallback if metrics polling isn't running while this tab is open.
  // (GPU memTotal is reported in MB → ×1048576.)
  const ramFromMetrics = useMetricsStore(s => s.metrics?.ramTotal)
  const vramMbFromMetrics = useMetricsStore(s => s.metrics?.gpu?.[0]?.memTotal ?? 0)
  const [ramTotal, setRamTotal] = useState(0)
  const [vramTotal, setVramTotal] = useState(0)
  useEffect(() => {
    if (ramFromMetrics) { setRamTotal(ramFromMetrics); setVramTotal(vramMbFromMetrics * 1048576); return }
    const api = (window as unknown as { api?: { metrics?: { get: () => Promise<{ ramTotal?: number; gpu?: { memTotal?: number }[] }> } } }).api
    api?.metrics?.get().then(r => { if (r?.ramTotal) { setRamTotal(r.ramTotal); setVramTotal((r.gpu?.[0]?.memTotal ?? 0) * 1048576) } }).catch(() => {})
  }, [ramFromMetrics, vramMbFromMetrics])

  // Ollama engines come from the configured providers (they carry the host baseUrl).
  const engines = useMemo(() => detectFromConfig(providers).filter(e => e.api === 'ollama'), [providers])
  const [engineKey, setEngineKey] = useState<string | null>(null)
  const engine = engines.find(e => e.key === engineKey) ?? engines[0]
  const baseUrl = engine?.baseUrl

  const [pullName, setPullName] = useState('')
  const [query, setQuery] = useState('')
  const installedNames = useMemo(() => new Set(installed.map(m => m.name)), [installed])
  const downloading = (name: string) => !!downloads[name] && !downloads[name].done

  useEffect(() => { if (baseUrl) load(baseUrl) }, [baseUrl])  // eslint-disable-line react-hooks/exhaustive-deps

  const configured = engine ? new Set((providers[engine.key]?.models ?? []).map(m => m.id)) : new Set<string>()
  const addToProvider = async (name: string) => {
    if (!engine) return
    const def: GwModelDef = { id: name, name, input: ['text'] }
    setModel(engine.key, def)
    await save()
  }

  // Catalog models that still have at least one variant not installed on this engine.
  const available = useMemo(
    () => searchCatalog(query).filter(m => m.variants.some(v => !installedNames.has(`${m.id}:${v.tag}`))),
    [query, installedNames],
  )
  const activeDownloads = Object.values(downloads)

  if (engines.length === 0) {
    return <Center>No Ollama engine in your model providers. Add an <b>Ollama</b> provider in the <b>Providers</b> tab first.</Center>
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Engine bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        {engines.length > 1 ? (
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            {engines.map(e => {
              const active = e.key === engine?.key
              return (
                <button key={e.key} onClick={() => setEngineKey(e.key)} title={e.baseUrl}
                  className="flex items-center gap-2.5 text-left"
                  style={{
                    padding: '6px 12px', borderRadius: 'var(--radius)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'var(--bg-elevated)',
                    cursor: 'pointer', transition: 'border-color 0.1s, background 0.1s',
                  }}>
                  <EngineLogo engineKey={e.key} color={active ? 'var(--accent)' : 'var(--text-secondary)'} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium font-mono" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{e.key}</span>
                      {e.isCron && <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.3, color: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 14%, transparent)', padding: '0 5px', borderRadius: 999 }}>CRON</span>}
                    </div>
                    <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)', opacity: 0.8 }}>{e.baseUrl}</div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-1">
            <EngineLogo engineKey={engine?.key ?? 'ollama'} color="var(--accent)" size={20} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>{engine?.key}</span>
                {engine?.isCron && <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.3, color: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 14%, transparent)', padding: '0 5px', borderRadius: 999 }}>CRON</span>}
              </div>
              <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{engine?.baseUrl}</div>
            </div>
          </div>
        )}
        <button onClick={() => baseUrl && load(baseUrl)} title="Reload" className="shrink-0" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}>
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {needsPlugin ? (
        <Center>
          <AlertCircle size={16} style={{ color: 'var(--warning)' }} />
          <span>Model management needs the <b>joaxclaw-fs</b> plugin (≥ 0.3.0) on the gateway host.
          Install it: <code style={mono}>openclaw plugins install --force openclaw-joaxclaw-fs &amp;&amp; openclaw plugins enable joaxclaw-fs</code>, then restart the gateway.</span>
        </Center>
      ) : (
        <>
          {error && <div className="px-4 pt-3"><Notice>{error}</Notice></div>}

          {/* Active downloads — models on their way onto the engine */}
          {activeDownloads.length > 0 && (
            <div className="px-4 pt-3 space-y-2 shrink-0">
              {activeDownloads.map(d => (
                <div key={d.model} className="rounded p-2.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    {d.error ? <X size={12} style={{ color: 'var(--danger)' }} /> : d.done ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />}
                    <span className="text-xs font-mono flex-1" style={{ color: 'var(--text-primary)' }}>{d.model}</span>
                    <span className="text-xs" style={{ color: d.error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                      {d.error ? 'failed' : d.status}
                      {!d.done && d.percent != null ? ` · ${d.percent}%` : ''}
                      {!d.done && d.total ? ` · ${fmtBytes(d.completed)} / ${fmtBytes(d.total)}` : ''}
                    </span>
                  </div>
                  {!d.error && (
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${d.done ? 100 : d.percent ?? 8}%`, background: 'var(--accent)', transition: 'width 0.3s' }} />
                    </div>
                  )}
                  {d.error && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{d.error}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Two columns: available → installed */}
          <div className="flex flex-1 min-h-0">
            {/* LEFT — available to install */}
            <div className="flex flex-col min-h-0" style={{ flex: 1, borderRight: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Available</span>
                <div className="relative flex-1">
                  <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="search models, e.g. vision, code, qwen…"
                    style={{ width: '100%', fontSize: 11, padding: '4px 8px 4px 26px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {available.map(m => (
                  <AvailableRow key={m.id} model={m} installedNames={installedNames} downloading={downloading}
                    onPull={name => baseUrl && pull(baseUrl, name)} />
                ))}
                {available.length === 0 && (
                  <p className="text-xs px-1 pt-2" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                    {query ? 'No catalog match — pull it by exact name below.' : 'Every catalog model is already installed. Pull another by name below.'}
                  </p>
                )}
              </div>

              {/* Pull any model by exact name */}
              <div className="shrink-0 px-3 py-2.5 flex items-center gap-2" style={{ borderTop: '1px solid var(--border)' }}>
                <input value={pullName} onChange={e => setPullName(e.target.value)} placeholder="pull by name, e.g. phi4  ·  llama3.2:3b"
                  onKeyDown={e => { if (e.key === 'Enter' && pullName.trim()) { pull(baseUrl!, pullName.trim()); setPullName('') } }}
                  style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }} />
                <button onClick={() => { if (pullName.trim()) { pull(baseUrl!, pullName.trim()); setPullName('') } }} disabled={!pullName.trim()}
                  title="Pull to this engine" className="flex items-center gap-1.5"
                  style={{ fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 'var(--radius)', border: 'none', cursor: pullName.trim() ? 'pointer' : 'not-allowed', color: 'white', background: 'var(--accent)', opacity: pullName.trim() ? 1 : 0.5 }}>
                  <HardDriveDownload size={13} /> Pull
                </button>
              </div>
            </div>

            {/* RIGHT — installed on the engine */}
            <div className="flex flex-col min-h-0" style={{ flex: 1 }}>
              <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Installed ({installed.length})</span>
                {loading && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {installed.map(m => (
                  <InstalledRow key={m.name} m={m} ramTotal={ramTotal} vramTotal={vramTotal} run={running.get(m.name)} isAdded={configured.has(m.name)} isRunning={running.has(m.name)} details={details[m.name]}
                    onAdd={() => addToProvider(m.name)}
                    onDetails={() => baseUrl && loadDetails(baseUrl, m.name)}
                    onLoad={(v) => baseUrl && setLoaded(baseUrl, m.name, v)}
                    onDelete={() => baseUrl && remove(baseUrl, m.name)} />
                ))}
                {installed.length === 0 && !loading && (
                  <div className="flex flex-col items-center justify-center gap-2 h-full text-center px-4" style={{ color: 'var(--text-secondary)' }}>
                    <PackageOpen size={22} style={{ opacity: 0.5 }} />
                    <p className="text-xs" style={{ opacity: 0.8 }}>No models installed yet.<br />Pull one from the left with <ArrowRight size={11} className="inline" />.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// The engine's provider logo (ollama, lmstudio, …), falling back to a generic glyph.
function EngineLogo({ engineKey, color, size = 16 }: { engineKey: string; color: string; size?: number }) {
  return hasProviderLogo(engineKey)
    ? <ProviderLogo provider={engineKey} size={size} style={{ color, flexShrink: 0 }} />
    : <HardDriveDownload size={size} style={{ color, flexShrink: 0 }} />
}

const CAP_ICON: Record<ModelCapability, React.ReactNode> = {
  tools: <Wrench size={9} />, vision: <Eye size={9} />, reasoning: <Brain size={9} />, code: <Code size={9} />, embedding: <Binary size={9} />,
}

const MODALITY_ICON: Record<InputModality, React.ReactNode> = {
  text: <Type size={9} />, image: <ImageIcon size={9} />, audio: <AudioLines size={9} />, video: <Video size={9} />,
}

// Map a catalog publisher to a provider-logo key (for the leading avatar).
const PUBLISHER_LOGO: Record<string, string> = {
  Meta: 'meta', Alibaba: 'alibaba', Google: 'google', 'Mistral AI': 'mistral',
  Cohere: 'cohere', DeepSeek: 'deepseek', 'Hugging Face': 'huggingface',
}

// A small identity avatar: the publisher's logo, or its initial as a fallback.
function PublisherAvatar({ publisher }: { publisher: string }) {
  const key = PUBLISHER_LOGO[publisher]
  return (
    <div className="flex items-center justify-center shrink-0" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
      {key ? <ProviderLogo provider={key} size={16} /> : <span className="text-xs font-semibold">{publisher.charAt(0).toUpperCase()}</span>}
    </div>
  )
}

// One compact, scannable row: [publisher avatar] · [name/blurb/chips] · [size + Install].
// The arrow pulls the selected variant onto the engine, after which it moves to Installed.
function AvailableRow({ model, installedNames, downloading, onPull }: {
  model: CatalogModel; installedNames: Set<string>; downloading: (name: string) => boolean; onPull: (name: string) => void
}) {
  const openVariants = model.variants.filter(v => !installedNames.has(`${model.id}:${v.tag}`))
  const [tag, setTag] = useState(openVariants[0]?.tag ?? model.variants[0].tag)
  const fullName = `${model.id}:${tag}`
  const isDownloading = downloading(fullName)
  return (
    <div className="rounded flex gap-2.5 p-2.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <PublisherAvatar publisher={model.publisher} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{model.name}</span>
          <span className="text-xs shrink-0" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{model.publisher}</span>
        </div>
        <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }} title={model.blurb}>{model.blurb}</p>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {modelModalities(model).map(mod => (
            <span key={mod} className="flex items-center gap-0.5" title={`Accepts ${mod} input`}
              style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 999 }}>
              {MODALITY_ICON[mod]} {mod}
            </span>
          ))}
          {model.capabilities.map(c => (
            <span key={c} className="flex items-center gap-0.5" style={{ fontSize: 9, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', padding: '1px 5px', borderRadius: 999 }}>
              {CAP_ICON[c]} {c}
            </span>
          ))}
        </div>
      </div>

      {/* Action column — size selector and CTA grouped and aligned down the list */}
      <div className="shrink-0 flex flex-col gap-1.5" style={{ width: 108 }}>
        <select value={tag} onChange={e => setTag(e.target.value)} title="Choose a size"
          style={{ width: '100%', fontSize: 11, padding: '3px 6px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}>
          {openVariants.map(v => <option key={v.tag} value={v.tag}>{v.params} · {v.sizeGB} GB</option>)}
        </select>
        {isDownloading ? (
          <span className="flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--text-secondary)', padding: '5px 0' }}><Loader2 size={12} className="animate-spin" /> pulling</span>
        ) : (
          <button onClick={() => onPull(fullName)} title={`Pull ${fullName} to this engine`}
            className="flex items-center justify-center gap-1" style={{ width: '100%', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 'var(--radius)', padding: '5px 0', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
            Install <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function InstalledRow({ m, ramTotal, vramTotal, run, isAdded, isRunning, details, onAdd, onDetails, onLoad, onDelete }: {
  m: InstalledModel; ramTotal: number; vramTotal: number; run?: RunningModel; isAdded: boolean; isRunning: boolean; details?: ModelDetails
  onAdd: () => void; onDetails: () => void; onLoad: (loaded: boolean) => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const toggle = () => setOpen(o => { if (!o) onDetails(); return !o })
  return (
    <div className="rounded" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={toggle} title="Details" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}>
          <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{[fmtBytes(m.sizeBytes), m.paramSize, m.quant].filter(Boolean).join(' · ')}</div>
        </div>
        {/* Fixed-width status pills so "in memory" / "in provider" line up across every row */}
        <StatusPill active={isRunning} width={80} activeColor="var(--success)"
          icon={<Power size={11} />} activeLabel="Loaded" idleLabel="Load"
          onClick={() => onLoad(!isRunning)}
          title={isRunning ? 'Loaded in memory — click to unload' : 'Load into memory'} />
        <StatusPill active={isAdded} width={104} activeColor="var(--accent)" staticWhenActive
          activeIcon={<Check size={11} />} icon={<Plus size={11} />} activeLabel="In provider" idleLabel="Add"
          onClick={onAdd}
          title={isAdded ? 'Available to agents via the provider' : 'Add to the gateway provider so agents can use it'} />
        {confirmDel ? (
          <span className="flex items-center gap-1 shrink-0">
            <button onClick={() => { setConfirmDel(false); onDelete() }} className="text-xs" style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
            <button onClick={() => setConfirmDel(false)} className="text-xs" style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDel(true)} title="Delete from engine" className="shrink-0" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}><Trash2 size={13} /></button>
        )}
      </div>
      {ramTotal > 0 && m.sizeBytes ? <RamBar sizeBytes={m.sizeBytes} paramSize={m.paramSize} ramTotal={ramTotal} vramTotal={vramTotal} run={run} /> : null}
      {open && (
        <div className="px-3 pb-2.5 pt-0.5 grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: 'auto 1fr', borderTop: '1px dashed var(--border)', marginTop: 1 }}>
          {!details ? <span className="text-xs" style={{ color: 'var(--text-secondary)', gridColumn: '1 / -1' }}><Loader2 size={10} className="animate-spin inline" /> loading…</span> : <>
            <Detail k="Family" v={details.family} />
            <Detail k="Parameters" v={details.paramSize} />
            <Detail k="Quantization" v={details.quant} />
            <Detail k="Context" v={fmtContext(details.contextLength)} />
            {details.license && <Detail k="License" v={details.license} />}
          </>}
        </div>
      )}
    </div>
  )
}

// A fixed-width status control: filled/tinted with its accent when active, muted outline
// when idle — so a column of them reads at a glance (which are loaded / in the provider).
function StatusPill({ active, width, activeColor, icon, activeIcon, activeLabel, idleLabel, onClick, title, staticWhenActive }: {
  active: boolean; width: number; activeColor: string
  icon: React.ReactNode; activeIcon?: React.ReactNode
  activeLabel: string; idleLabel: string
  onClick: () => void; title: string; staticWhenActive?: boolean
}) {
  const clickable = !(active && staticWhenActive)
  return (
    <button onClick={clickable ? onClick : undefined} disabled={!clickable} title={title}
      className="flex items-center justify-center gap-1 text-xs shrink-0"
      style={{
        width, padding: '3px 0', borderRadius: 'var(--radius)',
        border: `1px solid ${active ? `color-mix(in srgb, ${activeColor} 45%, var(--border))` : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${activeColor} 14%, transparent)` : 'transparent',
        color: active ? activeColor : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400, cursor: clickable ? 'pointer' : 'default',
      }}>
      {active ? (activeIcon ?? icon) : icon}{active ? activeLabel : idleLabel}
    </button>
  )
}

// A compact stacked bar of a model's memory footprint: weights (accent) + context/KV-cache
// (amber), against the machine's RAM — or VRAM when the model is loaded on the GPU. While
// loaded it shows the REAL resident size + context from /api/ps; otherwise an estimate
// ("est.") at a default context. Turns red if it would exceed that memory pool.
function RamBar({ sizeBytes, paramSize, ramTotal, vramTotal, run }: {
  sizeBytes?: number; paramSize?: string; ramTotal: number; vramTotal: number; run?: RunningModel
}) {
  const fp = ramFootprint({
    diskBytes: sizeBytes, paramSize, ramTotal, vramTotal,
    actualSize: run?.size, actualVram: run?.sizeVram, contextTokens: run?.contextLength,
  })
  let wPct = fp.fracWeights * 100
  let cPct = fp.fracContext * 100
  if (wPct + cPct > 100) { const s = 100 / (wPct + cPct); wPct *= s; cPct *= s }  // clamp to the track
  const pct = Math.round(fp.fracTotal * 100)
  const ctx = fp.contextTokens ? `${fmtContext(fp.contextTokens)} ctx` : ''
  const wBg = fp.overCapacity ? 'var(--danger)' : 'var(--accent)'
  const cBg = fp.overCapacity ? 'color-mix(in srgb, var(--danger) 55%, transparent)' : 'var(--warning)'
  return (
    <div className="px-3 pb-2.5 pt-0.5">
      <div className="flex items-center justify-between mb-1" style={{ fontSize: 10 }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmtBytes(fp.weights)}</span>
          {fp.context > 0 && <> + <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{fp.actual ? '' : '~'}{fmtBytes(fp.context)} ctx</span></>}
        </span>
        <span style={{ color: fp.overCapacity ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: fp.overCapacity ? 600 : 400 }}>
          {fp.overCapacity ? `exceeds ${fp.capacityLabel} · ` : ''}{pct}% of {fmtBytes(fp.capacity)} {fp.capacityLabel}
          {ctx ? ` · ${ctx}` : ''}{fp.actual ? '' : ' · est.'}
        </span>
      </div>
      <div className="flex overflow-hidden" style={{ height: 6, borderRadius: 3, background: 'var(--bg-elevated)' }}
        title={`${fp.actual ? 'Loaded' : 'Estimated'}: weights ${fmtBytes(fp.weights)} + ${fp.actual ? '' : '~'}${fmtBytes(fp.context)} context ≈ ${fmtBytes(fp.total)} of ${fmtBytes(fp.capacity)} ${fp.capacityLabel}${ctx ? ` at ${ctx}` : ''}`}>
        <div style={{ width: `${wPct}%`, background: wBg, transition: 'width 0.3s' }} />
        <div style={{ width: `${cPct}%`, background: cBg, opacity: 0.9, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function Detail({ k, v }: { k: string; v?: string }) {
  if (!v || v === '—') return null
  return <><span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{k}</span><span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{v}</span></>
}

const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '1px 4px', borderRadius: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)' }

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center p-8"><div className="flex items-start gap-2 max-w-lg text-sm text-center" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{children}</div></div>
}
function Notice({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 rounded text-xs flex items-center gap-1.5" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid var(--danger)' }}><AlertCircle size={12} /> {children}</div>
}
