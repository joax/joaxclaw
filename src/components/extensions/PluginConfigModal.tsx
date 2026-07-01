import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Loader2, Puzzle } from 'lucide-react'
import { Btn } from '../ui/Btn'
import { Textarea } from '../ui/Input'
import { pluginConfigSpec, fieldsFor, readPath, type JsonSchema } from '../../lib/pluginConfig'
import { usePluginConfigStore } from '../../store/pluginConfig'
import { PluginConfigForm, type PluginFormHandle } from './PluginConfigForm'
import type { Plugin } from '../../store/extensions'

type Tab = 'form' | 'advanced'

// Configure one plugin: a typed Settings form (fields from the gateway schema when
// available, else the curated catalog — API key routed to the right config path, an
// optional LLM group, and curated behaviour fields) plus an Advanced raw editor for
// plugins.entries.<id>. All writes go through config.patch (works local and remote).
export function PluginConfigModal({ plugin, onClose, onSaved }: { plugin: Plugin; onClose: () => void; onSaved?: () => void }) {
  const { config, loading, saving, error, load, patch } = usePluginConfigStore()
  const configSchema = plugin.configSchema as unknown as JsonSchema | undefined
  // Whether there's anything to show on the Settings tab (used only to pick the default tab
  // synchronously, before config loads); the real field list is resolved from config below.
  const hasCurated = !!pluginConfigSpec(plugin.id) || !!configSchema

  const [tab, setTab] = useState<Tab>(hasCurated ? 'form' : 'advanced')
  const [rawText, setRawText] = useState('')
  const [localErr, setLocalErr] = useState('')
  const formRef = useRef<PluginFormHandle>(null)

  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const fields = useMemo(
    () => fieldsFor({ id: plugin.id, configSchema }, config ?? undefined),
    [config, plugin.id, configSchema],
  )

  const entryJson = useMemo(() => {
    const e = (readPath(config ?? undefined, `plugins.entries.${plugin.id}`) ?? {}) as Record<string, unknown>
    return JSON.stringify(e, null, 2)
  }, [config, plugin.id])
  useEffect(() => {
    if (!config) return
    setRawText(entryJson === '{}' ? '{\n  \n}' : entryJson)
  }, [config])  // eslint-disable-line react-hooks/exhaustive-deps

  const saveAdvanced = async () => {
    setLocalErr('')
    let parsed: unknown
    try {
      parsed = rawText.trim() ? JSON.parse(rawText) : {}
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Must be a JSON object')
    } catch (e) {
      setLocalErr(`Invalid JSON: ${String(e instanceof Error ? e.message : e)}`)
      return
    }
    if (await patch({ plugins: { entries: { [plugin.id]: parsed } } })) { onSaved?.(); onClose() }
  }

  const onSave = () => (tab === 'form' ? formRef.current?.submit() : saveAdvanced())

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center" style={{ top: 36, background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="flex flex-col" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', width: 540, maxHeight: '82vh', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <Puzzle size={14} style={{ color: 'var(--accent)' }} />
          <span className="font-medium text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>Configure {plugin.name ?? plugin.id}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}><X size={14} /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-2" style={{ borderBottom: '1px solid var(--border)' }}>
          {(['form', 'advanced'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} className="text-xs" style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px 8px',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: tab === t ? 600 : 400,
              borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, marginBottom: -1,
            }}>{t === 'form' ? 'Settings' : 'Advanced (raw)'}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-20"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-secondary)' }} /></div>
          ) : tab === 'form' ? (
            <PluginConfigForm
              ref={formRef} fields={fields} config={config}
              patch={patch} onSaved={onSaved} onClose={onClose} onError={setLocalErr}
            />
          ) : (
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Raw config — written under <code style={mono}>plugins.entries.{plugin.id}</code>
              </label>
              <Textarea value={rawText} onChange={setRawText} rows={12} style={{ fontFamily: 'monospace', fontSize: 12 }} />
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                e.g. <code style={mono}>{'{ "config": { … }, "llm": { "allowModelOverride": true } }'}</code>. Secrets can be <code style={mono}>{'{ source: "env", id: "VAR" }'}</code>.
              </p>
            </div>
          )}

          {(localErr || error) && <p className="text-xs" style={{ color: 'var(--danger)' }}>{localErr || error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <Btn variant="outline" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" loading={saving} onClick={onSave} disabled={loading}>Save</Btn>
        </div>
      </div>
    </div>
  )
}

const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 10, padding: '0 3px', borderRadius: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)' }
