import { useEffect, useState } from 'react'
import { Puzzle, RefreshCw, Plus, Trash2, Check, Loader2, Search, FileText, X, ChevronRight, SlidersHorizontal, CheckCircle2, XCircle, HelpCircle, KeyRound } from 'lucide-react'
import { useExtensionsStore } from '../../store/extensions'
import type { Plugin, Skill } from '../../store/extensions'
import type { PluginKeyStatus } from '../../lib/pluginConfig'
import { useConnectionStore } from '../../store/connection'
import { useSkillsStore } from '../../store/skills'
import { useHelpStore } from '../../store/help'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { PluginConfigModal } from './PluginConfigModal'
import { usePluginUpdateStore } from '../../store/pluginUpdate'
import { PLUGIN_ID, isUpdateAvailable, startPluginUpdate } from '../../lib/pluginUpdate'

type Tab = 'skills' | 'plugins'

export function ExtensionsView({ onOpenChat }: { onOpenChat?: () => void }) {
  const {
    plugins, skills, loading, error, dirty, saving,
    load, setPluginEnabled, setSkillEnabled,
    removePlugin, removeSkill, addPlugin, addSkill, save,
  } = useExtensionsStore()
  const { latest: latestPluginVersion, check: checkPluginUpdate } = usePluginUpdateStore()
  const { status, connection } = useConnectionStore()
  const [updating, setUpdating] = useState(false)
  useEffect(() => { checkPluginUpdate() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // The joaxclaw-fs plugin can be upgraded in-app (force-reinstall via an agent). For
  // that plugin, tell the row whether a newer npm version exists + how to trigger it.
  const updateInfoFor = (plugin: Plugin) =>
    plugin.id === PLUGIN_ID && isUpdateAvailable(plugin.version, latestPluginVersion ?? undefined)
      ? { latest: latestPluginVersion!, updating }
      : undefined
  const onUpdatePlugin = async () => { setUpdating(true); await startPluginUpdate(onOpenChat); setUpdating(false) }

  const [tab, setTab] = useState<Tab>('skills')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showAddSkill, setShowAddSkill] = useState(false)
  const [showAddPlugin, setShowAddPlugin] = useState(false)
  const [mdModal, setMdModal] = useState<{ skill: Skill } | null>(null)
  const [configPlugin, setConfigPlugin] = useState<Plugin | null>(null)

  useEffect(() => { load() }, [])

  async function handleSave() {
    try {
      await save()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* error stored in store */ }
  }

  const q = search.trim().toLowerCase()
  const matches = (i: { id: string; name?: string; description?: string }) =>
    !q || i.id.toLowerCase().includes(q) || (i.name ?? '').toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)

  // Group by attention: needs-setup (enabled but missing an API key) → active → off.
  const sActive = skills.filter(s => s.enabled && matches(s))
  const sOff = skills.filter(s => !s.enabled && matches(s))
  const pNeedsSetup = plugins.filter(p => p.enabled && p.keyStatus === 'missing' && matches(p))
  const pActive = plugins.filter(p => p.enabled && p.keyStatus !== 'missing' && matches(p))
  const pOff = plugins.filter(p => !p.enabled && matches(p))
  const shownCount = tab === 'skills' ? sActive.length + sOff.length : pNeedsSetup.length + pActive.length + pOff.length

  // A destructive Remove that flips to inline confirm; shared by skill + plugin rows.
  const removeInline = (id: string, onRemove: () => void) =>
    confirmDelete === id ? (
      <div className="flex gap-2">
        <Btn size="sm" variant="danger" onClick={() => { onRemove(); setConfirmDelete(null) }}>Delete</Btn>
        <Btn size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
      </div>
    ) : (
      <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(id)}>Remove</Btn>
    )

  const renderSkillRow = (skill: Skill) => (
    <ExtRow
      key={skill.id}
      icon={skill.emoji ?? null}
      name={skill.name ?? skill.id}
      subtitle={skill.description}
      enabled={skill.enabled}
      onToggle={v => setSkillEnabled(skill.id, v)}
      expanded={expanded.has(skill.id)}
      onToggleExpand={() => toggleExpanded(skill.id)}
      nameChips={skill.trigger ? <TriggerChip>{skill.trigger}</TriggerChip> : null}
    >
      <ExtMeta items={[
        skill.name && skill.name !== skill.id ? { k: 'id', v: skill.id } : null,
        skill.source ? { k: 'source', v: skill.bundled ? 'Built-in' : skill.source } : null,
        skill.filePath ? { k: 'file', v: skill.filePath } : null,
      ]} />
      <div className="flex items-center gap-1 mt-2">
        {skill.filePath && <Btn size="sm" variant="outline" icon={<FileText size={12} />} onClick={() => setMdModal({ skill })}>View file</Btn>}
        {removeInline(skill.id, () => removeSkill(skill.id))}
      </div>
    </ExtRow>
  )

  const renderPluginRow = (plugin: Plugin) => {
    const upd = updateInfoFor(plugin)
    return (
      <ExtRow
        key={plugin.id}
        icon={null}
        name={plugin.name ?? plugin.id}
        subtitle={plugin.description}
        enabled={plugin.enabled}
        onToggle={v => setPluginEnabled(plugin.id, v)}
        expanded={expanded.has(plugin.id)}
        onToggleExpand={() => toggleExpanded(plugin.id)}
        nameChips={<KeyStatusBadge status={plugin.keyStatus} />}
        rowActions={
          <>
            {upd && <UpdateButton updateInfo={upd} onUpdate={onUpdatePlugin} />}
            <Btn size="sm" variant="ghost" icon={<SlidersHorizontal size={12} />} onClick={() => setConfigPlugin(plugin)}>Configure</Btn>
          </>
        }
      >
        <ExtMeta items={[
          plugin.name && plugin.name !== plugin.id ? { k: 'id', v: plugin.id } : null,
          plugin.origin ? { k: 'source', v: [plugin.origin, plugin.version].filter(Boolean).join(' · ') } : (plugin.version ? { k: 'version', v: plugin.version } : null),
          plugin.path ? { k: 'path', v: plugin.path } : null,
        ]} />
        {!plugin.discovered && <div className="mt-2">{removeInline(plugin.id, () => removePlugin(plugin.id))}</div>}
      </ExtRow>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Extensions</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            <b style={{ color: 'var(--text-primary)' }}>Skills</b> teach agents how to do things · <b style={{ color: 'var(--text-primary)' }}>Plugins</b> add tools &amp; integrations.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && (
            <Btn
              variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={saving}
              icon={saved ? <Check size={13} /> : saving ? <Loader2 size={13} className="animate-spin" /> : undefined}
            >
              {saved ? 'Saved' : 'Save changes'}
            </Btn>
          )}
          <Btn variant="outline" size="sm" icon={<RefreshCw size={13} />} onClick={load} loading={loading} title="Refresh from gateway" />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{
          background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
          border: '1px solid var(--danger)', color: 'var(--danger)'
        }}>
          {error}
        </div>
      )}

      {/* Segmented Skills/Plugins · search · add */}
      <div className="flex items-center justify-between gap-3 mb-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-1 p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          {(['skills', 'plugins'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setConfirmDelete(null); setShowAddSkill(false); setShowAddPlugin(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
                padding: '4px 14px', fontSize: 13, fontWeight: 500, borderRadius: 'calc(var(--radius) - 2px)',
                background: tab === t ? 'var(--bg-surface)' : 'transparent',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: tab === t ? '0 1px 2px rgba(0,0,0,0.15)' : 'none',
              }}
            >
              {t === 'skills' ? 'Skills' : 'Plugins'}
              <span style={{ fontSize: 11, opacity: 0.7 }}>{t === 'skills' ? skills.length : plugins.length}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ padding: '5px 10px 5px 28px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none', width: 180 }}
            />
          </div>
          <Btn variant="outline" size="sm" icon={<Plus size={13} />} onClick={() => tab === 'skills' ? setShowAddSkill(v => !v) : setShowAddPlugin(v => !v)}>
            Add {tab === 'skills' ? 'skill' : 'plugin'}
          </Btn>
        </div>
      </div>

      {/* Skills */}
      {tab === 'skills' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-4">
          <AppSkillsCard gatewayUrl={connection?.url} connected={status === 'connected'} />
          {showAddSkill && (
            <AddSkillForm onAdd={skill => { addSkill(skill); setShowAddSkill(false) }} onCancel={() => setShowAddSkill(false)} />
          )}
          <Group label="Active" count={sActive.length}>{sActive.map(renderSkillRow)}</Group>
          <Group label="Off" count={sOff.length}>{sOff.map(renderSkillRow)}</Group>
          {!loading && shownCount === 0 && !error && (
            <EmptyState label={search ? 'No skills match your search' : 'No skills configured'} />
          )}
        </div>
      )}

      {/* Plugins */}
      {tab === 'plugins' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-4">
          {showAddPlugin && (
            <AddPluginForm onAdd={plugin => { addPlugin(plugin); setShowAddPlugin(false) }} onCancel={() => setShowAddPlugin(false)} />
          )}
          <Group label="Needs setup" count={pNeedsSetup.length} tone="warning">{pNeedsSetup.map(renderPluginRow)}</Group>
          <Group label="Active" count={pActive.length}>{pActive.map(renderPluginRow)}</Group>
          <Group label="Off" count={pOff.length}>{pOff.map(renderPluginRow)}</Group>
          {!loading && shownCount === 0 && !error && (
            <EmptyState label={search ? 'No plugins match your search' : 'No plugins configured'} />
          )}
        </div>
      )}

      {/* Skill MD modal */}
      {mdModal && (
        <SkillMdModal skill={mdModal.skill} onClose={() => setMdModal(null)} />
      )}

      {/* Plugin configure modal */}
      {configPlugin && (
        <PluginConfigModal plugin={configPlugin} onClose={() => setConfigPlugin(null)} onSaved={load} />
      )}
    </div>
  )
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(!enabled) }}
      title={enabled ? 'Disable' : 'Enable'}
      style={{
        display: 'inline-flex', alignItems: 'center',
        width: 36, height: 20, borderRadius: 999,
        border: `1px solid ${enabled ? 'var(--accent)' : 'var(--border)'}`,
        background: enabled ? 'var(--accent)' : 'transparent',
        padding: '2px 3px', cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s', flexShrink: 0,
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: '50%',
        background: enabled ? 'white' : 'var(--text-secondary)',
        transition: 'transform 0.15s',
        transform: enabled ? 'translateX(16px)' : 'translateX(0)',
        display: 'block', flexShrink: 0,
      }} />
    </button>
  )
}

// ── Extension row (unified skill / plugin) ──────────────────────────────────────

interface ExtRowProps {
  icon?: string | null
  name: string
  subtitle?: string
  enabled: boolean
  onToggle: (v: boolean) => void
  expanded: boolean
  onToggleExpand: () => void
  nameChips?: React.ReactNode   // inline badges next to the name (trigger, key status)
  rowActions?: React.ReactNode  // primary actions in the collapsed row (Update, Configure)
  children?: React.ReactNode    // expanded body (technical details + Remove)
}

function ExtRow({ icon, name, subtitle, enabled, onToggle, expanded, onToggleExpand, nameChips, rowActions, children }: ExtRowProps) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', opacity: enabled ? 1 : 0.72 }}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={onToggleExpand}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <div className="flex items-center justify-center shrink-0" style={{
            width: 30, height: 30, borderRadius: 'var(--radius)',
            background: 'color-mix(in srgb, var(--accent) 13%, var(--bg-elevated))', fontSize: 16,
          }}>
            {icon ? icon : <Puzzle size={15} style={{ color: 'var(--accent)' }} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{name}</span>
              {nameChips}
            </div>
            {subtitle && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
          </div>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {rowActions}
          <ToggleSwitch enabled={enabled} onChange={onToggle} />
          <button
            onClick={onToggleExpand}
            title={expanded ? 'Collapse' : 'Details'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 2 }}
          >
            <ChevronRight size={14} style={{ transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// A titled group of rows; hides itself when empty. `tone="warning"` for "Needs setup".
function Group({ label, count, tone, children }: { label: string; count: number; tone?: 'warning'; children: React.ReactNode }) {
  if (!count) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-1" style={{ color: tone === 'warning' ? 'var(--warning)' : 'var(--text-secondary)' }}>
        <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.06em' }}>{label}</span>
        <span className="text-xs" style={{ opacity: 0.6 }}>{count}</span>
      </div>
      {children}
    </div>
  )
}

function TriggerChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono shrink-0" style={{ fontSize: 10, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 999 }}>
      {children}
    </span>
  )
}

// The technical details, tucked into the expanded row: id / source / file / path.
function ExtMeta({ items }: { items: ({ k: string; v: string } | null)[] }) {
  const rows = items.filter(Boolean) as { k: string; v: string }[]
  if (!rows.length) return null
  return (
    <div className="flex flex-col gap-1">
      {rows.map(r => (
        <div key={r.k} className="flex gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span style={{ width: 52, flexShrink: 0, opacity: 0.55 }}>{r.k}</span>
          <span className="font-mono truncate" title={r.v}>{r.v}</span>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 py-10" style={{ color: 'var(--text-secondary)' }}>
      <Puzzle size={36} style={{ opacity: 0.3 }} />
      <p className="text-sm">{label}</p>
    </div>
  )
}

// ── Skill MD modal ────────────────────────────────────────────────────────────

function SkillMdModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!skill.filePath) return
    const api = (window as unknown as { api?: { file?: { read: (p: string) => Promise<{ ok: boolean; text?: string; error?: string }> } } }).api
    if (!api?.file?.read) { setErr('File read not available'); return }
    api.file.read(skill.filePath).then(r => {
      if (r.ok && r.text) setContent(r.text)
      else setErr(r.error ?? 'Failed to read file')
    })
  }, [skill.filePath])

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center"
      style={{ top: 36, background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col"
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', width: 680, maxHeight: '80vh',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <FileText size={14} style={{ color: 'var(--accent)' }} />
          <span className="font-medium text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
            {skill.name ?? skill.id}
          </span>
          {skill.filePath && (
            <span className="text-xs font-mono truncate max-w-xs" style={{ color: 'var(--text-secondary)' }} title={skill.filePath}>
              {skill.filePath.split('/').slice(-2).join('/')}
            </span>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}>
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {err && <p className="text-sm" style={{ color: 'var(--danger)' }}>{err}</p>}
          {content && (
            <pre className="text-xs font-mono whitespace-pre-wrap" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {content}
            </pre>
          )}
          {!content && !err && (
            <div className="flex items-center justify-center h-20">
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Plugin API-key status badge ───────────────────────────────────────────────

function KeyStatusBadge({ status }: { status?: PluginKeyStatus }) {
  if (status === 'set') {
    return (
      <span title="API key configured" className="flex items-center gap-1 shrink-0" style={{ fontSize: 10, fontWeight: 600, color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 13%, transparent)', padding: '1px 6px', borderRadius: 999 }}>
        <CheckCircle2 size={11} /> Configured
      </span>
    )
  }
  if (status === 'missing') {
    return (
      <span title="This plugin needs an API key" className="flex items-center gap-1 shrink-0" style={{ fontSize: 10, fontWeight: 600, color: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 13%, transparent)', padding: '1px 6px', borderRadius: 999 }}>
        <KeyRound size={10} /> Needs key
      </span>
    )
  }
  return null
}

// A small "→ vX.Y.Z" update pill + button, shown when a newer version is available.
function UpdateButton({ updateInfo, onUpdate }: { updateInfo?: { latest: string; updating: boolean }; onUpdate?: () => void }) {
  if (!updateInfo || !onUpdate) return null
  return (
    <Btn size="sm" loading={updateInfo.updating}
      icon={updateInfo.updating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      onClick={onUpdate} title={`Update to v${updateInfo.latest} (force-reinstall via an agent, then restart the gateway)`}>
      Update → v{updateInfo.latest}
    </Btn>
  )
}


// ── Add Skill form ────────────────────────────────────────────────────────────

function AddSkillForm({ onAdd, onCancel }: { onAdd: (s: Skill) => void; onCancel: () => void }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [trigger, setTrigger] = useState('')

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center"
      style={{ top: 36, background: 'rgba(0,0,0,0.5)' }} onClick={onCancel}>
      <div className="flex flex-col p-5 gap-4" style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', width: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
      }} onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Add Skill</h3>
        <FormField label="ID *"><Input value={id} onChange={setId} placeholder="e.g. my-skill" autoFocus /></FormField>
        <FormField label="Name"><Input value={name} onChange={setName} placeholder="Display name" /></FormField>
        <FormField label="Trigger"><Input value={trigger} onChange={setTrigger} placeholder="e.g. /whisper" /></FormField>
        <FormField label="Description"><Input value={description} onChange={setDescription} placeholder="Short description" /></FormField>
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" size="sm" onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" size="sm"
            onClick={() => { const t = id.trim(); if (!t) return; onAdd({ id: t, enabled: true, name: name.trim() || undefined, description: description.trim() || undefined, trigger: trigger.trim() || undefined }) }}
            disabled={!id.trim()}>Add</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Add Plugin form ───────────────────────────────────────────────────────────

function AddPluginForm({ onAdd, onCancel }: { onAdd: (p: Plugin) => void; onCancel: () => void }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [description, setDescription] = useState('')

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center"
      style={{ top: 36, background: 'rgba(0,0,0,0.5)' }} onClick={onCancel}>
      <div className="flex flex-col p-5 gap-4" style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', width: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
      }} onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Add Plugin</h3>
        <FormField label="ID *"><Input value={id} onChange={setId} placeholder="e.g. my-plugin" autoFocus /></FormField>
        <FormField label="Name"><Input value={name} onChange={setName} placeholder="Display name" /></FormField>
        <FormField label="Path"><Input value={path} onChange={setPath} placeholder="/path/to/plugin" /></FormField>
        <FormField label="Description"><Input value={description} onChange={setDescription} placeholder="Short description" /></FormField>
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" size="sm" onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" size="sm"
            onClick={() => { const t = id.trim(); if (!t) return; onAdd({ id: t, enabled: true, name: name.trim() || undefined, path: path.trim() || undefined, description: description.trim() || undefined }) }}
            disabled={!id.trim()}>Add</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label.toUpperCase()}
      </label>
      {children}
    </div>
  )
}

// Status + reinstall for the app-native agent skills (process-builder, teams-blueprint).
// These are installed automatically on connect; this surfaces their status and a manual
// reinstall. Lives at the top of the Skills tab.
function AppSkillsCard({ gatewayUrl, connected }: { gatewayUrl?: string; connected: boolean }) {
  const { results, running, run } = useSkillsStore()
  const openHelp = useHelpStore(s => s.openHelp)

  // Remote skill uploads are gated by skills.install.allowUploadedArchives.
  const uploadBlocked = results.some(r =>
    r.status === 'error' && /allowUploadedArchives|uploaded skill archive/i.test(r.error ?? '')
  )

  return (
    <SkillsCardShell title="App Skills">
      <div className="space-y-2.5">
        <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Agent skills that teach models to build JoaxClaw teams &amp; processes. Installed automatically on connect.
        </p>

        <div className="space-y-1.5">
          {results.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
              {connected ? 'Not installed yet.' : 'Connect to install.'}
            </p>
          )}
          {results.map(r => (
            <div key={r.slug} className="flex items-start gap-2 text-xs">
              {r.status === 'error'
                ? <XCircle size={12} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                : <CheckCircle2 size={12} style={{ color: r.status === 'installed' ? 'var(--success)' : 'var(--text-secondary)', flexShrink: 0, marginTop: 1 }} />}
              <div className="min-w-0">
                <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{r.slug}</span>
                <span style={{ color: 'var(--text-secondary)' }}> — {r.status}</span>
                {r.error && (
                  <p style={{ color: 'var(--warning)', opacity: 0.9, marginTop: 1, wordBreak: 'break-word' }}>{r.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {uploadBlocked && (
          <button
            onClick={() => openHelp('gateways')}
            className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-left"
            style={{
              background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-elevated))',
              border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
              cursor: 'pointer',
            }}
          >
            <HelpCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>
              Remote upload disabled — enable <code style={{ fontFamily: 'monospace' }}>skills.install.allowUploadedArchives</code>
            </span>
            <span className="text-xs" style={{ color: 'var(--accent)' }}>Help</span>
          </button>
        )}

        <Btn
          variant="outline"
          size="sm"
          className="w-full"
          icon={<RefreshCw size={12} />}
          loading={running}
          disabled={!connected}
          onClick={() => run(gatewayUrl, true)}
        >
          Reinstall
        </Btn>
      </div>
    </SkillsCardShell>
  )
}

function SkillsCardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div className="px-3 py-2.5 text-xs font-semibold" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}
