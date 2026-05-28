import { useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useSettingsStore } from '../../store/settings'
import type { ThemeSettings, IconFamily } from '../../lib/types'
import { DEFAULT_THEME } from '../../lib/types'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { nanoid } from '../../lib/nanoid'

const ICON_FAMILIES: { id: IconFamily; label: string; desc: string }[] = [
  { id: 'lucide', label: 'Lucide', desc: 'Clean & consistent' },
  { id: 'heroicons', label: 'Heroicons', desc: 'Polished, by Tailwind' },
  { id: 'phosphor', label: 'Phosphor', desc: 'Fun, multiple weights' },
  { id: 'tabler', label: 'Tabler', desc: 'Detailed, tech feel' },
  { id: 'feather', label: 'Feather', desc: 'Minimal, elegant' }
]

export function SettingsView() {
  const { themes, activeThemeId, setActiveTheme, saveTheme, deleteTheme, showGpu, showRam, showHeartbeat, showModelName } = useSettingsStore()
  const activeTheme = themes.find(t => t.id === activeThemeId) ?? DEFAULT_THEME

  const [editing, setEditing] = useState<ThemeSettings>(activeTheme)
  const [newThemeName, setNewThemeName] = useState('')
  const [showNewName, setShowNewName] = useState(false)

  const handleColorChange = (key: keyof ThemeSettings['colors'], value: string) => {
    setEditing(e => ({ ...e, colors: { ...e.colors, [key]: value } }))
  }

  const handleApplyLive = (patch: Partial<ThemeSettings>) => {
    const updated = { ...editing, ...patch }
    setEditing(updated)
    saveTheme(updated)
  }

  const handleSaveNew = () => {
    if (!newThemeName.trim()) return
    const newTheme: ThemeSettings = { ...editing, id: nanoid(), name: newThemeName.trim() }
    saveTheme(newTheme)
    setShowNewName(false)
    setNewThemeName('')
  }

  return (
    <div className="flex flex-1 min-h-0 p-6 gap-5 overflow-y-auto">
      {/* Left column */}
      <div className="flex flex-col gap-4 flex-1 min-w-0">
        {/* Saved themes */}
        <Section title="Themes">
          <div className="space-y-1.5">
            {themes.map(theme => (
              <div
                key={theme.id}
                className="flex items-center gap-3 px-3 py-2 rounded"
                style={{
                  background: theme.id === activeThemeId ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'var(--bg-elevated)',
                  borderRadius: 'var(--radius)'
                }}
              >
                <div className="flex gap-1">
                  {['bgPrimary', 'bgSurface', 'accent'].map(k => (
                    <div key={k} style={{ width: 12, height: 12, borderRadius: 3, background: theme.colors[k as keyof typeof theme.colors] }} />
                  ))}
                </div>
                <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>{theme.name}</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{theme.base}</span>
                {theme.id === activeThemeId ? (
                  <Check size={13} style={{ color: 'var(--accent)' }} />
                ) : (
                  <div className="flex items-center gap-1">
                    <Btn size="sm" variant="outline" onClick={() => { setActiveTheme(theme.id); setEditing(theme) }}>Apply</Btn>
                    {!['default-dark', 'ocean-dark', 'rose-light', 'forest-dark'].includes(theme.id) && (
                      <Btn size="sm" variant="ghost" icon={<Trash2 size={11} />} onClick={() => deleteTheme(theme.id)} style={{ color: 'var(--danger)' }} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2">
            {showNewName ? (
              <div className="flex items-center gap-2">
                <Input value={newThemeName} onChange={setNewThemeName} placeholder="Theme name…" style={{ fontSize: 12 }} autoFocus />
                <Btn size="sm" onClick={handleSaveNew}>Save</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setShowNewName(false)}>Cancel</Btn>
              </div>
            ) : (
              <Btn size="sm" variant="outline" icon={<Plus size={12} />} onClick={() => setShowNewName(true)}>
                Save current as new theme
              </Btn>
            )}
          </div>
        </Section>

        {/* Color editor */}
        <Section title={`Customize: ${editing.name}`}>
          <div className="mb-3">
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Base mode</label>
            <div className="flex gap-2">
              {(['dark', 'light', 'system'] as const).map(b => (
                <button
                  key={b}
                  onClick={() => handleApplyLive({ base: b })}
                  style={{
                    padding: '4px 12px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${editing.base === b ? 'var(--accent)' : 'var(--border)'}`,
                    background: editing.base === b ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                    color: editing.base === b ? 'var(--accent)' : 'var(--text-secondary)'
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(Object.entries(editing.colors) as [keyof ThemeSettings['colors'], string][]).map(([key, value]) => (
              <ColorField
                key={key}
                label={camelToLabel(key)}
                value={value}
                onChange={v => handleColorChange(key, v)}
                onBlur={() => handleApplyLive({ colors: editing.colors })}
              />
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <SliderField
              label="Border radius"
              value={editing.borderRadius}
              min={0} max={20} unit="px"
              onChange={v => handleApplyLive({ borderRadius: v })}
            />
            <SliderField
              label="Font size"
              value={editing.fontSize}
              min={11} max={18} unit="px"
              onChange={v => handleApplyLive({ fontSize: v })}
            />
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Font family</label>
              <select
                value={editing.fontFamily}
                onChange={e => handleApplyLive({ fontFamily: e.target.value })}
                style={{
                  width: '100%', padding: '6px 10px', fontSize: 12,
                  borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none'
                }}
              >
                {[
                  'Inter, system-ui, sans-serif',
                  'system-ui, sans-serif',
                  'Georgia, serif',
                  "'JetBrains Mono', monospace",
                  "'Fira Code', monospace"
                ].map(f => <option key={f} value={f}>{f.split(',')[0].replace(/'/g, '')}</option>)}
              </select>
            </div>
          </div>
        </Section>
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-4" style={{ width: 280, flexShrink: 0 }}>
        {/* Icon family */}
        <Section title="Icon Family">
          <div className="space-y-1.5">
            {ICON_FAMILIES.map(fam => (
              <button
                key={fam.id}
                onClick={() => handleApplyLive({ iconFamily: fam.id })}
                className="w-full flex items-center gap-3 px-3 py-2 text-left rounded"
                style={{
                  background: editing.iconFamily === fam.id ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'var(--bg-elevated)',
                  border: `1px solid ${editing.iconFamily === fam.id ? 'var(--accent)' : 'transparent'}`,
                  borderRadius: 'var(--radius)', cursor: 'pointer'
                }}
              >
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{fam.label}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{fam.desc}</p>
                </div>
                {editing.iconFamily === fam.id && <Check size={14} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
          </div>
        </Section>

        {/* Status bar options */}
        <Section title="Status Bar">
          <div className="space-y-2">
            {[
              { label: 'Show GPU meter', key: 'showGpu', value: showGpu },
              { label: 'Show RAM meter', key: 'showRam', value: showRam },
              { label: 'Show heartbeat', key: 'showHeartbeat', value: showHeartbeat },
              { label: 'Show model name', key: 'showModelName', value: showModelName }
            ].map(({ label, key, value }) => (
              <Toggle
                key={key}
                label={label}
                value={value}
                onChange={v => useSettingsStore.setState({ [key]: v } as Partial<typeof useSettingsStore>)}
              />
            ))}
          </div>
        </Section>

        {/* Mini preview */}
        <Section title="Preview">
          <div
            style={{
              background: editing.colors.bgPrimary,
              borderRadius: editing.borderRadius,
              padding: 12,
              fontSize: editing.fontSize - 2
            }}
          >
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ width: 24, background: editing.colors.bgSurface, borderRadius: 4, padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                {[editing.colors.accent, editing.colors.textSecondary, editing.colors.textSecondary].map((c, i) => (
                  <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: c, opacity: i === 0 ? 1 : 0.5 }} />
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ background: editing.colors.bgSurface, borderRadius: editing.borderRadius / 2, padding: 8, marginBottom: 6 }}>
                  <div style={{ width: '60%', height: 6, borderRadius: 3, background: editing.colors.accent, marginBottom: 4 }} />
                  <div style={{ width: '100%', height: 4, borderRadius: 2, background: editing.colors.textSecondary, opacity: 0.3, marginBottom: 2 }} />
                  <div style={{ width: '80%', height: 4, borderRadius: 2, background: editing.colors.textSecondary, opacity: 0.3 }} />
                </div>
                <div style={{ background: editing.colors.accent, borderRadius: editing.borderRadius / 2, padding: '4px 8px', width: 'fit-content' }}>
                  <div style={{ width: 30, height: 4, borderRadius: 2, background: editing.colors.accentFg, opacity: 0.8 }} />
                </div>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div className="px-4 py-2.5 text-xs font-semibold" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function ColorField({ label, value, onChange, onBlur }: { label: string; value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div>
      <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', padding: 2 }}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          style={{
            flex: 1, padding: '4px 8px', fontSize: 12,
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace'
          }}
        />
      </div>
    </div>
  )
}

function SliderField({ label, value, min, max, unit, onChange }: {
  label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
        <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 36, height: 20, borderRadius: 10, cursor: 'pointer', border: 'none', position: 'relative',
          background: value ? 'var(--accent)' : 'var(--border)', transition: 'background 0.2s'
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3, left: value ? 19 : 3, transition: 'left 0.2s'
        }} />
      </button>
    </div>
  )
}

function camelToLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}
