import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, KeyRound, Puzzle } from 'lucide-react'
import { Btn } from '../ui/Btn'
import { Input, Textarea } from '../ui/Input'
import { isSecretRef } from '../../lib/channels'
import {
  pluginConfigSpec, apiKeyPath, readPath, nestedPatch, mergeDeep,
} from '../../lib/pluginConfig'
import { usePluginConfigStore } from '../../store/pluginConfig'
import type { Plugin } from '../../store/extensions'

type Tab = 'form' | 'advanced'

// Configure one plugin: its API key (routed to the right config path for model
// providers / TTS / web-search) and, via Advanced, its raw plugins.entries.<id>
// config. All writes go through config.patch (works on local and remote gateways).
export function PluginConfigModal({ plugin, onClose, onSaved }: { plugin: Plugin; onClose: () => void; onSaved?: () => void }) {
  const { config, loading, saving, error, load, patch } = usePluginConfigStore()
  const spec = pluginConfigSpec(plugin.id)
  const keyPath = spec?.apiKey ? apiKeyPath(plugin.id, spec.apiKey) : null
  const baseUrlPath = spec?.providerBaseUrl ? `models.providers.${plugin.id}.baseUrl` : null

  const [tab, setTab] = useState<Tab>(spec ? 'form' : 'advanced')
  const [keyDraft, setKeyDraft] = useState('')
  const [reveal, setReveal] = useState(false)
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [rawText, setRawText] = useState('')
  const [localErr, setLocalErr] = useState('')

  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Seed drafts once the config is loaded.
  const keyValue = keyPath ? readPath(config ?? undefined, keyPath) : undefined
  const keyIsRef = isSecretRef(keyValue)

  const entryJson = useMemo(() => {
    const e = (readPath(config ?? undefined, `plugins.entries.${plugin.id}`) ?? {}) as Record<string, unknown>
    return JSON.stringify(e, null, 2)
  }, [config, plugin.id])
  useEffect(() => {
    if (!config) return
    setKeyDraft(typeof keyValue === 'string' ? keyValue : '')
    setBaseUrlDraft(baseUrlPath ? String(readPath(config, baseUrlPath) ?? '') : '')
    setRawText(entryJson === '{}' ? '{\n  \n}' : entryJson)
  }, [config])  // eslint-disable-line react-hooks/exhaustive-deps

  const saveForm = async () => {
    setLocalErr('')
    const p: Record<string, unknown> = {}
    if (keyPath) {
      const v = keyDraft.trim()
      // Preserve an untouched SecretRef; write a literal; clear with null.
      if (!(keyIsRef && v === '')) {
        mergeDeep(p, nestedPatch(keyPath, v === '' ? null : v))
        if (spec?.apiKey === 'webSearch' && v !== '') mergeDeep(p, nestedPatch('tools.web.search.provider', plugin.id))
      }
    }
    if (baseUrlPath) {
      const v = baseUrlDraft.trim()
      // Base URL is an OPTIONAL endpoint override. Only write it when the user typed a
      // value. An empty field must NEVER touch the stored endpoint: deleting it (or
      // sending "") leaves the provider with the plugin's default "", which the gateway
      // rejects ("Too small: expected string to have >=1 characters") — so just setting
      // the API key would fail. To remove an override, use the Advanced (raw) tab.
      if (v) mergeDeep(p, nestedPatch(baseUrlPath, v))
    }
    if (Object.keys(p).length === 0) { onClose(); return }
    if (await patch(p)) { onSaved?.(); onClose() }
  }

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
            spec ? (
              <>
                {keyPath && (
                  <div>
                    <label className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                      <KeyRound size={12} /> API key
                    </label>
                    {keyIsRef ? (
                      <div className="text-xs px-2.5 py-2 rounded font-mono" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                        secret ref → {(keyValue as { id?: string }).id} (edit in Advanced to change)
                      </div>
                    ) : (
                      <div className="relative">
                        <Input value={keyDraft} onChange={setKeyDraft} type={reveal ? 'text' : 'password'} placeholder="paste a key, or an env var name" style={{ fontSize: 12, fontFamily: 'monospace', paddingRight: 44 }} />
                        <button onClick={() => setReveal(r => !r)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11 }}>{reveal ? 'hide' : 'show'}</button>
                      </div>
                    )}
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                      Stored at <code style={mono}>{keyPath}</code>. Leave blank to clear.
                    </p>
                  </div>
                )}
                {baseUrlPath && (
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Base URL <span style={{ opacity: 0.6 }}>(optional)</span></label>
                    <Input value={baseUrlDraft} onChange={setBaseUrlDraft} placeholder="https://api.example.com/v1" style={{ fontSize: 12, fontFamily: 'monospace' }} />
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>Override the provider endpoint (OpenAI-compatible hosts).</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                No curated settings for this plugin. Use <b style={{ color: 'var(--text-primary)' }}>Advanced</b> to edit its raw config.
              </p>
            )
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
          <Btn size="sm" loading={saving} onClick={tab === 'form' ? saveForm : saveAdvanced} disabled={loading}>Save</Btn>
        </div>
      </div>
    </div>
  )
}

const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 10, padding: '0 3px', borderRadius: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)' }
