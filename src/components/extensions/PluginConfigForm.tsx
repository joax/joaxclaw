import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'
import { KeyRound, Check } from 'lucide-react'
import { Input, Textarea } from '../ui/Input'
import { isSecretRef } from '../../lib/channels'
import {
  readPath, nestedPatch, mergeDeep,
  type FieldSpec, type FieldGroup,
} from '../../lib/pluginConfig'

export interface PluginFormHandle { submit: () => Promise<void> }

const GROUP_LABEL: Record<FieldGroup, string> = { key: 'API key', llm: 'LLM', config: 'Settings' }
const GROUP_ORDER: FieldGroup[] = ['key', 'llm', 'config']

// Renders a plugin's config as typed fields (from the gateway schema or the curated
// catalog) grouped into sections, and writes one merged patch through config.patch.
// The modal's footer Save calls submit() via the forwarded ref.
export const PluginConfigForm = forwardRef<PluginFormHandle, {
  fields: FieldSpec[]
  config: Record<string, unknown> | null
  patch: (p: Record<string, unknown>) => Promise<boolean>
  onSaved?: () => void
  onClose: () => void
  onError: (msg: string) => void
}>(function PluginConfigForm({ fields, config, patch, onSaved, onClose, onError }, ref) {
  // Original values + whether each field's stored value is an (untouched) SecretRef.
  const originals = useMemo(() => {
    const m: Record<string, { raw: unknown; ref: boolean }> = {}
    for (const f of fields) {
      const raw = readPath(config ?? undefined, f.path)
      m[f.path] = { raw, ref: isSecretRef(raw) }
    }
    return m
  }, [fields, config])

  // Drafts: booleans stored as boolean, everything else as string.
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>(() => {
    const d: Record<string, string | boolean> = {}
    for (const f of fields) {
      const raw = originals[f.path]?.raw
      d[f.path] = f.kind === 'boolean' ? Boolean(raw) : (typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '')
    }
    return d
  })
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  const set = (path: string, v: string | boolean) => setDrafts(d => ({ ...d, [path]: v }))

  useImperativeHandle(ref, () => ({
    async submit() {
      onError('')
      const p: Record<string, unknown> = {}
      for (const f of fields) {
        const orig = originals[f.path]
        const draft = drafts[f.path]

        if (f.kind === 'boolean') {
          const cur = Boolean(orig?.raw)
          if (Boolean(draft) !== cur) mergeDeep(p, nestedPatch(f.path, Boolean(draft)))
          continue
        }

        const s = String(draft ?? '').trim()

        if (f.kind === 'secret') {
          // Preserve an untouched SecretRef; write a literal; blank clears with null.
          if (orig?.ref && s === '') continue
          if (s === '' && (orig?.raw === undefined || orig?.raw === '')) continue
          mergeDeep(p, nestedPatch(f.path, s === '' ? null : s))
          if (s !== '' && f.writeAlso) mergeDeep(p, nestedPatch(f.writeAlso.path, f.writeAlso.value))
          continue
        }

        if (f.kind === 'url') {
          // Optional endpoint override: only write a real value, never clear via the form
          // (an empty string is rejected by the gateway — remove it in Advanced instead).
          if (s !== '' && s !== String(orig?.raw ?? '')) mergeDeep(p, nestedPatch(f.path, s))
          continue
        }

        if (f.kind === 'number') {
          if (s === '') {
            if (orig?.raw !== undefined) mergeDeep(p, nestedPatch(f.path, null))
            continue
          }
          const n = Number(s)
          if (Number.isNaN(n)) { onError(`${f.label} must be a number`); return }
          if (f.min !== undefined && n < f.min) { onError(`${f.label} must be ≥ ${f.min}`); return }
          if (f.max !== undefined && n > f.max) { onError(`${f.label} must be ≤ ${f.max}`); return }
          if (n !== orig?.raw) mergeDeep(p, nestedPatch(f.path, n))
          continue
        }

        // text | textarea | enum
        if (s !== String(orig?.raw ?? '')) mergeDeep(p, nestedPatch(f.path, s === '' ? null : s))
      }

      if (Object.keys(p).length === 0) { onClose(); return }
      if (await patch(p)) { onSaved?.(); onClose() }
    },
  }), [fields, drafts, originals, patch, onSaved, onClose, onError])

  if (!fields.length) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        No curated settings for this plugin. Use <b style={{ color: 'var(--text-primary)' }}>Advanced</b> to edit its raw config.
      </p>
    )
  }

  const groups = GROUP_ORDER.filter(g => fields.some(f => f.group === g))

  return (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g} className="space-y-3">
          {groups.length > 1 && (
            <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {g === 'key' && <KeyRound size={12} />}{GROUP_LABEL[g]}
            </div>
          )}
          {fields.filter(f => f.group === g).map(f => (
            <FieldRow
              key={f.path} field={f}
              value={drafts[f.path]} isRef={originals[f.path]?.ref ?? false}
              reveal={!!reveal[f.path]} onReveal={() => setReveal(r => ({ ...r, [f.path]: !r[f.path] }))}
              onChange={v => set(f.path, v)}
            />
          ))}
        </div>
      ))}
    </div>
  )
})

function FieldRow({ field, value, isRef, reveal, onReveal, onChange }: {
  field: FieldSpec
  value: string | boolean
  isRef: boolean
  reveal: boolean
  onReveal: () => void
  onChange: (v: string | boolean) => void
}) {
  const label = (
    <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
      {field.label}
      {field.required && <span style={{ color: 'var(--danger)' }}> *</span>}
      {!field.required && (field.kind === 'url') && <span style={{ opacity: 0.6 }}> (optional)</span>}
    </label>
  )
  const help = field.help && (
    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{field.help}</p>
  )

  if (field.kind === 'boolean') {
    const on = Boolean(value)
    return (
      <div>
        <button onClick={() => onChange(!on)} className="flex items-center gap-2 text-xs" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', padding: 0 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--bg-elevated)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {on && <Check size={11} style={{ color: '#fff' }} />}
          </span>
          {field.label}
        </button>
        {help}
      </div>
    )
  }

  if (field.kind === 'secret' && isRef) {
    return (
      <div>
        {label}
        <div className="text-xs px-2.5 py-2 rounded font-mono" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          secret ref (edit in Advanced to change)
        </div>
        {help}
      </div>
    )
  }

  if (field.kind === 'secret') {
    return (
      <div>
        {label}
        <div className="relative">
          <Input value={String(value)} onChange={onChange} type={reveal ? 'text' : 'password'} placeholder={field.placeholder} style={{ fontSize: 12, fontFamily: 'monospace', paddingRight: 44 }} />
          <button onClick={onReveal} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11 }}>{reveal ? 'hide' : 'show'}</button>
        </div>
        {help}
      </div>
    )
  }

  if (field.kind === 'enum') {
    return (
      <div>
        {label}
        <select value={String(value)} onChange={e => onChange(e.target.value)} style={{ display: 'block', width: '100%', padding: '7px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}>
          <option value="">—</option>
          {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {help}
      </div>
    )
  }

  if (field.kind === 'textarea') {
    return (
      <div>
        {label}
        <Textarea value={String(value)} onChange={onChange} rows={4} placeholder={field.placeholder} style={{ fontSize: 12 }} />
        {help}
      </div>
    )
  }

  // text | number | url
  return (
    <div>
      {label}
      <Input value={String(value)} onChange={onChange} type={field.kind === 'number' ? 'number' : 'text'} placeholder={field.placeholder} style={{ fontSize: 12, fontFamily: field.kind === 'url' ? 'monospace' : undefined }} />
      {help}
    </div>
  )
}
