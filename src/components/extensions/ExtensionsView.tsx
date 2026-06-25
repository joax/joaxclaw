import { useEffect, useState } from 'react'
import { Puzzle, RefreshCw, Plus, Trash2, Check, Loader2, LayoutGrid, List, FileText, X, ChevronRight, SlidersHorizontal, CheckCircle2, KeyRound } from 'lucide-react'
import { useExtensionsStore } from '../../store/extensions'
import type { Plugin, Skill } from '../../store/extensions'
import type { PluginKeyStatus } from '../../lib/pluginConfig'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { PluginConfigModal } from './PluginConfigModal'

type Tab = 'skills' | 'plugins'
type Layout = 'card' | 'list'
type Filter = 'all' | 'enabled' | 'disabled'

export function ExtensionsView() {
  const {
    plugins, skills, loading, error, dirty, saving,
    load, setPluginEnabled, setSkillEnabled,
    removePlugin, removeSkill, addPlugin, addSkill, save,
  } = useExtensionsStore()

  const [tab, setTab] = useState<Tab>('skills')
  const [layout, setLayout] = useState<Layout>('card')
  const [filter, setFilter] = useState<Filter>('all')
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

  const visibleSkills = filter === 'all' ? skills : skills.filter(s => filter === 'enabled' ? s.enabled : !s.enabled)
  const visiblePlugins = filter === 'all' ? plugins : plugins.filter(p => filter === 'enabled' ? p.enabled : !p.enabled)
  const totalCount = plugins.length + skills.length

  return (
    <div className="flex flex-1 flex-col min-h-0 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Extensions</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {loading ? 'Loading…' : `${totalCount} extension${totalCount !== 1 ? 's' : ''} · ${skills.length} skill${skills.length !== 1 ? 's' : ''}, ${plugins.length} plugin${plugins.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Btn
              variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={saving}
              icon={saved ? <Check size={13} /> : saving ? <Loader2 size={13} className="animate-spin" /> : undefined}
            >
              {saved ? 'Saved' : 'Save Changes'}
            </Btn>
          )}
          <Btn variant="outline" size="sm" icon={<RefreshCw size={13} />} onClick={load} loading={loading}>
            Refresh
          </Btn>
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

      {/* Tab bar + layout toggle */}
      <div className="flex items-center shrink-0 mb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex flex-1">
          {(['skills', 'plugins'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setConfirmDelete(null) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px 12px', fontSize: 13, fontWeight: 500,
                color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1, textTransform: 'capitalize'
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs" style={{
                fontSize: 10,
                background: tab === t ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg-elevated)',
                color: tab === t ? 'var(--accent)' : 'var(--text-secondary)'
              }}>
                {t === 'skills'
                  ? (filter === 'all' ? skills.length : `${visibleSkills.length}/${skills.length}`)
                  : (filter === 'all' ? plugins.length : `${visiblePlugins.length}/${plugins.length}`)
                }
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 pb-1">
          {(['all', 'enabled', 'disabled'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'none',
                border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 999, cursor: 'pointer',
                padding: '2px 8px', fontSize: 11, fontWeight: 500,
                color: filter === f ? 'var(--accent)' : 'var(--text-secondary)',
                textTransform: 'capitalize'
              }}
            >
              {f}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-2" style={{ borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
            {([['card', LayoutGrid], ['list', List]] as [Layout, React.ElementType][]).map(([mode, Icon]) => (
              <button
                key={mode}
                onClick={() => setLayout(mode)}
                title={mode.charAt(0).toUpperCase() + mode.slice(1) + ' view'}
                style={{
                  background: layout === mode ? 'var(--bg-elevated)' : 'none',
                  border: `1px solid ${layout === mode ? 'var(--border)' : 'transparent'}`,
                  borderRadius: 'var(--radius)', cursor: 'pointer',
                  padding: '3px 6px', color: layout === mode ? 'var(--accent)' : 'var(--text-secondary)'
                }}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Skills tab */}
      {tab === 'skills' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          {!loading && visibleSkills.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3" style={{ color: 'var(--text-secondary)' }}>
              <Puzzle size={40} style={{ opacity: 0.3 }} />
              <p className="text-sm">{filter === 'all' ? 'No skills configured' : `No ${filter} skills`}</p>
            </div>
          )}

          {layout === 'card' ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {visibleSkills.map(skill => (
                <SkillCard
                  key={skill.id} skill={skill}
                  onToggle={enabled => setSkillEnabled(skill.id, enabled)}
                  onRemove={() => setConfirmDelete(skill.id)}
                  confirmingDelete={confirmDelete === skill.id}
                  onConfirmDelete={() => { removeSkill(skill.id); setConfirmDelete(null) }}
                  onCancelDelete={() => setConfirmDelete(null)}
                  onViewFile={skill.filePath ? () => setMdModal({ skill }) : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {visibleSkills.map(skill => (
                <SkillRow
                  key={skill.id} skill={skill}
                  onToggle={enabled => setSkillEnabled(skill.id, enabled)}
                  onRemove={() => setConfirmDelete(skill.id)}
                  confirmingDelete={confirmDelete === skill.id}
                  onConfirmDelete={() => { removeSkill(skill.id); setConfirmDelete(null) }}
                  onCancelDelete={() => setConfirmDelete(null)}
                  onViewFile={skill.filePath ? () => setMdModal({ skill }) : undefined}
                />
              ))}
            </div>
          )}

          <div className="mt-4">
            {showAddSkill ? (
              <AddSkillForm onAdd={skill => { addSkill(skill); setShowAddSkill(false) }} onCancel={() => setShowAddSkill(false)} />
            ) : (
              <Btn variant="outline" size="sm" icon={<Plus size={13} />} onClick={() => setShowAddSkill(true)}>
                Add Skill
              </Btn>
            )}
          </div>
        </div>
      )}

      {/* Plugins tab */}
      {tab === 'plugins' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          {!loading && visiblePlugins.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3" style={{ color: 'var(--text-secondary)' }}>
              <Puzzle size={40} style={{ opacity: 0.3 }} />
              <p className="text-sm">{filter === 'all' ? 'No plugins configured' : `No ${filter} plugins`}</p>
            </div>
          )}

          {layout === 'card' ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {visiblePlugins.map(plugin => (
                <PluginCard
                  key={plugin.id} plugin={plugin}
                  onToggle={enabled => setPluginEnabled(plugin.id, enabled)}
                  onConfigure={() => setConfigPlugin(plugin)}
                  onRemove={() => setConfirmDelete(plugin.id)}
                  confirmingDelete={confirmDelete === plugin.id}
                  onConfirmDelete={() => { removePlugin(plugin.id); setConfirmDelete(null) }}
                  onCancelDelete={() => setConfirmDelete(null)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {visiblePlugins.map(plugin => (
                <PluginRow
                  key={plugin.id} plugin={plugin}
                  onToggle={enabled => setPluginEnabled(plugin.id, enabled)}
                  onConfigure={() => setConfigPlugin(plugin)}
                  onRemove={() => setConfirmDelete(plugin.id)}
                  confirmingDelete={confirmDelete === plugin.id}
                  onConfirmDelete={() => { removePlugin(plugin.id); setConfirmDelete(null) }}
                  onCancelDelete={() => setConfirmDelete(null)}
                />
              ))}
            </div>
          )}

          <div className="mt-4">
            {showAddPlugin ? (
              <AddPluginForm onAdd={plugin => { addPlugin(plugin); setShowAddPlugin(false) }} onCancel={() => setShowAddPlugin(false)} />
            ) : (
              <Btn variant="outline" size="sm" icon={<Plus size={13} />} onClick={() => setShowAddPlugin(true)}>
                Add Plugin
              </Btn>
            )}
          </div>
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

// ── Skill card ────────────────────────────────────────────────────────────────

interface SkillCardProps {
  skill: Skill
  onToggle: (enabled: boolean) => void
  onRemove: () => void
  onViewFile?: () => void
  confirmingDelete: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

function SkillCard({ skill, onToggle, onRemove, onViewFile, confirmingDelete, onConfirmDelete, onCancelDelete }: SkillCardProps) {
  const [hovered, setHovered] = useState(false)
  const icon = skill.emoji ?? null

  return (
    <div
      className="flex flex-col p-4"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)', transition: 'border-color 0.15s',
        opacity: skill.enabled ? 1 : 0.6,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="flex items-center justify-center shrink-0" style={{
          width: 40, height: 40, borderRadius: 'var(--radius)',
          background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))',
          fontSize: 20,
        }}>
          {icon ? icon : <Puzzle size={18} style={{ color: 'var(--accent)' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
            {skill.name ?? skill.id}
          </p>
          {skill.name && skill.name !== skill.id && (
            <p className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{skill.id}</p>
          )}
          {skill.trigger && (
            <p className="font-mono text-xs mt-0.5 font-semibold" style={{ color: 'var(--accent)' }}>{skill.trigger}</p>
          )}
        </div>
        <ToggleSwitch enabled={skill.enabled} onChange={onToggle} />
      </div>

      {skill.description && (
        <p className="text-xs mb-3 line-clamp-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {skill.description}
        </p>
      )}

      {skill.source && (
        <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
          {skill.bundled ? 'Built-in' : skill.source}
        </p>
      )}

      {confirmingDelete ? (
        <div className="flex gap-2 mt-auto">
          <Btn size="sm" variant="danger" onClick={onConfirmDelete} style={{ flex: 1 }}>Delete</Btn>
          <Btn size="sm" variant="outline" onClick={onCancelDelete} style={{ flex: 1 }}>Cancel</Btn>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1 mt-auto">
          {onViewFile && (
            <Btn size="sm" variant="ghost" icon={<FileText size={12} />} onClick={onViewFile} title="View skill file" />
          )}
          <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={onRemove} style={{ color: 'var(--danger)' }} />
        </div>
      )}
    </div>
  )
}

// ── Skill list row ────────────────────────────────────────────────────────────

function SkillRow({ skill, onToggle, onRemove, onViewFile, confirmingDelete, onConfirmDelete, onCancelDelete }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false)
  const icon = skill.emoji ?? null

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', opacity: skill.enabled ? 1 : 0.6,
    }}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <span style={{ fontSize: 16, lineHeight: 1, width: 20, textAlign: 'center', flexShrink: 0 }}>
          {icon ?? <Puzzle size={14} style={{ color: 'var(--accent)' }} />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
              {skill.name ?? skill.id}
            </p>
            {skill.trigger && (
              <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                color: 'var(--accent)', fontSize: 10
              }}>
                {skill.trigger}
              </span>
            )}
            {skill.source && (
              <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
                {skill.bundled ? 'built-in' : skill.source}
              </span>
            )}
          </div>
          {skill.description && (
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
              {skill.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ChevronRight
            size={13}
            style={{
              color: 'var(--text-secondary)', transition: 'transform 0.15s',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'
            }}
          />
          <ToggleSwitch enabled={skill.enabled} onChange={onToggle} />
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
          {skill.description && (
            <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {skill.description}
            </p>
          )}
          {skill.filePath && (
            <p className="text-xs font-mono truncate mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.6 }} title={skill.filePath}>
              {skill.filePath}
            </p>
          )}
          {confirmingDelete ? (
            <div className="flex gap-2">
              <Btn size="sm" variant="danger" onClick={onConfirmDelete} style={{ flex: 1 }}>Delete</Btn>
              <Btn size="sm" variant="outline" onClick={onCancelDelete} style={{ flex: 1 }}>Cancel</Btn>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {onViewFile && (
                <Btn size="sm" variant="outline" icon={<FileText size={12} />} onClick={onViewFile}>View file</Btn>
              )}
              <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={onRemove} style={{ color: 'var(--danger)' }} />
            </div>
          )}
        </div>
      )}
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

// ── Plugin card ───────────────────────────────────────────────────────────────

interface PluginCardProps {
  plugin: Plugin
  onToggle: (enabled: boolean) => void
  onConfigure: () => void
  onRemove: () => void
  confirmingDelete: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

function PluginCard({ plugin, onToggle, onConfigure, onRemove, confirmingDelete, onConfirmDelete, onCancelDelete }: PluginCardProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="flex flex-col p-4"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)', transition: 'border-color 0.15s',
        opacity: plugin.enabled ? 1 : 0.6,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="flex items-center justify-center shrink-0" style={{
          width: 40, height: 40, borderRadius: 'var(--radius)',
          background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))',
        }}>
          <Puzzle size={18} style={{ color: 'var(--accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {plugin.name ?? plugin.id}
            </p>
            <KeyStatusBadge status={plugin.keyStatus} />
          </div>
          {plugin.name && plugin.name !== plugin.id && (
            <p className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{plugin.id}</p>
          )}
          {plugin.path && (
            <p className="text-xs font-mono truncate mt-0.5" title={plugin.path} style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
              {plugin.path}
            </p>
          )}
        </div>
        <ToggleSwitch enabled={plugin.enabled} onChange={onToggle} />
      </div>

      {plugin.description && (
        <p className="text-xs mb-3 line-clamp-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {plugin.description}
        </p>
      )}

      {(plugin.origin || plugin.version) && (
        <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
          {[plugin.origin, plugin.version].filter(Boolean).join(' · ')}
        </p>
      )}

      {confirmingDelete ? (
        <div className="flex gap-2 mt-auto">
          <Btn size="sm" variant="danger" onClick={onConfirmDelete} style={{ flex: 1 }}>Delete</Btn>
          <Btn size="sm" variant="outline" onClick={onCancelDelete} style={{ flex: 1 }}>Cancel</Btn>
        </div>
      ) : (
        <div className="flex justify-end items-center gap-1 mt-auto">
          <Btn size="sm" variant="ghost" icon={<SlidersHorizontal size={12} />} onClick={onConfigure}>Configure</Btn>
          {!plugin.discovered && (
            <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={onRemove} style={{ color: 'var(--danger)' }} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Plugin list row ───────────────────────────────────────────────────────────

function PluginRow({ plugin, onToggle, onConfigure, onRemove, confirmingDelete, onConfirmDelete, onCancelDelete }: PluginCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', opacity: plugin.enabled ? 1 : 0.6,
    }}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center justify-center shrink-0" style={{
          width: 24, height: 24, borderRadius: 'var(--radius)',
          background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))',
        }}>
          <Puzzle size={13} style={{ color: 'var(--accent)' }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
              {plugin.name ?? plugin.id}
            </p>
            <KeyStatusBadge status={plugin.keyStatus} />
            {plugin.origin && (
              <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
                {plugin.origin}{plugin.version ? ` · ${plugin.version}` : ''}
              </span>
            )}
          </div>
          {plugin.description && (
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
              {plugin.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ChevronRight
            size={13}
            style={{
              color: 'var(--text-secondary)', transition: 'transform 0.15s',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'
            }}
          />
          <ToggleSwitch enabled={plugin.enabled} onChange={onToggle} />
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
          {plugin.description && (
            <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {plugin.description}
            </p>
          )}
          {plugin.path && (
            <p className="text-xs font-mono truncate mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.6 }} title={plugin.path}>
              {plugin.path}
            </p>
          )}
          {confirmingDelete ? (
            <div className="flex gap-2">
              <Btn size="sm" variant="danger" onClick={onConfirmDelete} style={{ flex: 1 }}>Delete</Btn>
              <Btn size="sm" variant="outline" onClick={onCancelDelete} style={{ flex: 1 }}>Cancel</Btn>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Btn size="sm" variant="ghost" icon={<SlidersHorizontal size={12} />} onClick={onConfigure}>Configure</Btn>
              {!plugin.discovered && (
                <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={onRemove} style={{ color: 'var(--danger)' }} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
