import { useEffect, useMemo, useState } from 'react'
import { HardDriveDownload, Trash2, RefreshCw, AlertCircle, Loader2, Check, Plus, Power, X } from 'lucide-react'
import { useModelsStore } from '../../store/models'
import { useModelManagerStore } from '../../store/modelManager'
import { detectFromConfig } from '../../lib/localEngines'
import { fmtBytes } from '../../lib/modelManager'
import type { GwModelDef } from '../../lib/types'

// Local models manager (Models → Local models). Lists models installed on an Ollama
// engine, pulls new ones with live progress, deletes, and adds a model to the gateway's
// provider config so agents can use it. Routed through the joaxclaw-fs engines.* methods,
// so it works on a local AND a remote gateway. Ollama-only for now.

export function LocalModelsPanel() {
  const providers = useModelsStore(s => s.providers)
  const setModel = useModelsStore(s => s.setModel)
  const save = useModelsStore(s => s.save)
  const { installed, running, loading, error, needsPlugin, downloads, load, pull, remove } = useModelManagerStore()

  // Ollama engines come from the configured providers (they carry the host baseUrl).
  const engines = useMemo(() => detectFromConfig(providers).filter(e => e.api === 'ollama'), [providers])
  const [engineKey, setEngineKey] = useState<string | null>(null)
  const engine = engines.find(e => e.key === engineKey) ?? engines[0]
  const baseUrl = engine?.baseUrl

  const [pullName, setPullName] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  useEffect(() => { if (baseUrl) load(baseUrl) }, [baseUrl])  // eslint-disable-line react-hooks/exhaustive-deps

  const configured = engine ? new Set((providers[engine.key]?.models ?? []).map(m => m.id)) : new Set<string>()
  const addToProvider = async (name: string) => {
    if (!engine) return
    const def: GwModelDef = { id: name, name, input: ['text'] }
    setModel(engine.key, def)
    await save()
  }

  if (engines.length === 0) {
    return <Center>No Ollama engine in your model providers. Add an <b>Ollama</b> provider in the <b>Providers</b> tab first.</Center>
  }

  const activeDownloads = Object.values(downloads)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Engine bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <HardDriveDownload size={14} style={{ color: 'var(--accent)' }} />
        {engines.length > 1 ? (
          <select value={engine?.key} onChange={e => setEngineKey(e.target.value)}
            style={{ fontSize: 12, padding: '3px 7px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}>
            {engines.map(e => <option key={e.key} value={e.key}>{e.label} · {e.baseUrl}</option>)}
          </select>
        ) : (
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{engine?.label} <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{engine?.baseUrl}</span></span>
        )}
        <div className="flex-1" />
        <button onClick={() => baseUrl && load(baseUrl)} title="Reload" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {needsPlugin ? (
        <Center>
          <AlertCircle size={16} style={{ color: 'var(--warning)' }} />
          <span>Model management needs the <b>joaxclaw-fs</b> plugin (≥ 0.3.0) on the gateway host.
          Install it: <code style={mono}>openclaw plugins install --force openclaw-joaxclaw-fs &amp;&amp; openclaw plugins enable joaxclaw-fs</code>, then restart the gateway.</span>
        </Center>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <Notice>{error}</Notice>}

          {/* Pull a model */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Pull a model</label>
            <div className="flex items-center gap-2">
              <input value={pullName} onChange={e => setPullName(e.target.value)} placeholder="model name, e.g. qwen2.5:7b  ·  llama3.2:3b  ·  phi4"
                onKeyDown={e => { if (e.key === 'Enter' && pullName.trim()) { pull(baseUrl!, pullName); setPullName('') } }}
                style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', padding: '7px 11px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }} />
              <button onClick={() => { if (pullName.trim()) { pull(baseUrl!, pullName); setPullName('') } }} disabled={!pullName.trim()}
                className="flex items-center gap-1.5" style={{ fontSize: 13, fontWeight: 500, padding: '7px 14px', borderRadius: 'var(--radius)', border: 'none', cursor: pullName.trim() ? 'pointer' : 'not-allowed', color: 'white', background: 'var(--accent)', opacity: pullName.trim() ? 1 : 0.5 }}>
                <HardDriveDownload size={14} /> Pull
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>Browse names at <span style={{ color: 'var(--accent)' }}>ollama.com/library</span>. Downloads run on the gateway host.</p>
          </div>

          {/* Active downloads */}
          {activeDownloads.length > 0 && (
            <div className="space-y-2">
              {activeDownloads.map(d => (
                <div key={d.model} className="rounded p-2.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    {d.error ? <X size={12} style={{ color: 'var(--danger)' }} /> : d.done ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />}
                    <span className="text-xs font-mono flex-1" style={{ color: 'var(--text-primary)' }}>{d.model}</span>
                    <span className="text-xs" style={{ color: d.error ? 'var(--danger)' : 'var(--text-secondary)' }}>{d.error ? 'failed' : d.status}{d.percent != null && !d.done ? ` · ${d.percent}%` : ''}</span>
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

          {/* Installed */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Installed ({installed.length})</label>
            {installed.length === 0 && !loading && <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>No models installed on this engine.</p>}
            <div className="space-y-1.5">
              {installed.map(m => {
                const isAdded = configured.has(m.name)
                return (
                  <div key={m.name} className="flex items-center gap-2 rounded px-3 py-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                        {running.has(m.name) && <span className="flex items-center gap-1" style={{ fontSize: 9, color: 'var(--success)' }}><Power size={9} /> loaded</span>}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {[fmtBytes(m.sizeBytes), m.paramSize, m.quant].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {isAdded ? (
                      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}><Check size={11} /> in provider</span>
                    ) : (
                      <button onClick={() => addToProvider(m.name)} title="Add to the gateway provider so agents can use it"
                        className="flex items-center gap-1 text-xs" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                        <Plus size={11} /> Add to provider
                      </button>
                    )}
                    {confirmDel === m.name ? (
                      <span className="flex items-center gap-1">
                        <button onClick={async () => { setConfirmDel(null); await remove(baseUrl!, m.name) }} className="text-xs" style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
                        <button onClick={() => setConfirmDel(null)} className="text-xs" style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDel(m.name)} title="Delete from engine" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}><Trash2 size={13} /></button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '1px 4px', borderRadius: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)' }

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center p-8"><div className="flex items-start gap-2 max-w-lg text-sm text-center" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{children}</div></div>
}
function Notice({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 rounded text-xs flex items-center gap-1.5" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid var(--danger)' }}><AlertCircle size={12} /> {children}</div>
}
