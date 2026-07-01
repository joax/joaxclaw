import { useState } from 'react'
import { Check, Plus, Trash2, Upload, Download, Copy, Image as ImageIcon, X, Loader2 } from 'lucide-react'
import { useSettingsStore } from '../../store/settings'
import type { ThemeSettings, IconFamily, ThemeBgSlot, ThemeBackground, ThemeBgFit } from '../../lib/types'
import { THEME_BG_SLOTS } from '../../lib/themeFormat'
import { PRESET_THEMES } from '../../lib/presetThemes'
import { Btn } from '../ui/Btn'
import { nanoid } from '../../lib/nanoid'
import { useThemeImage, primeThemeImage } from './useThemeImage'

// The built-in base themes (loaded from the repo /themes files) are protected: not
// deletable, and tagged "base theme" in the editor.
const PRESET_IDS = new Set(PRESET_THEMES.map(t => t.id))
const isPreset = (id: string) => PRESET_IDS.has(id)

const ICON_FAMILIES: { id: IconFamily; label: string }[] = [
  { id: 'lucide', label: 'Lucide' }, { id: 'heroicons', label: 'Heroicons' },
  { id: 'phosphor', label: 'Phosphor' }, { id: 'tabler', label: 'Tabler' }, { id: 'feather', label: 'Feather' },
]
const FONTS = [
  'Inter, system-ui, sans-serif', 'system-ui, sans-serif', 'Georgia, serif',
  "'JetBrains Mono', monospace", "'Fira Code', monospace",
]
const BG_LABELS: Record<ThemeBgSlot, string> = { app: 'App background', chat: 'Chat background' }

interface ThemeApi {
  pickImage?: (themeId: string, slot: string) => Promise<{ ok: boolean; canceled?: boolean; file?: string; dataUrl?: string; error?: string }>
}
const pickImage = (themeId: string, slot: string) =>
  (window as unknown as { api?: { theme?: ThemeApi } }).api?.theme?.pickImage?.(themeId, slot)

export function ThemesView() {
  const {
    themes, activeThemeId, setActiveTheme, saveTheme, deleteTheme,
    updateActiveColors, updateActiveBackground, importTheme, exportTheme,
  } = useSettingsStore()
  const active = themes.find(t => t.id === activeThemeId) ?? themes[0]

  const [busy, setBusy] = useState<'import' | 'export' | null>(null)
  const [err, setErr] = useState('')

  const duplicate = (t: ThemeSettings) => {
    saveTheme({ ...t, id: nanoid(), name: `${t.name} copy`, backgrounds: undefined }) // saves + activates
  }
  const doImport = async () => {
    setBusy('import'); setErr('')
    const res = await importTheme()
    setBusy(null)
    if (!res.ok) setErr(res.error ?? 'Import failed')
  }
  const doExport = async () => {
    setBusy('export'); setErr('')
    const res = await exportTheme(active.id)
    setBusy(null)
    if (!res.ok) setErr(res.error ?? 'Export failed')
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Gallery ── */}
      <div className="flex flex-col shrink-0 border-r overflow-y-auto" style={{ width: 280, borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center justify-between px-4 py-3 shrink-0">
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Themes</h1>
          <div className="flex items-center gap-1">
            <Btn size="sm" variant="outline" icon={busy === 'import' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} loading={busy === 'import'} onClick={doImport}>Import</Btn>
            <Btn size="sm" variant="outline" icon={<Plus size={12} />} onClick={() => duplicate(active)}>New</Btn>
          </div>
        </div>
        {err && <p className="px-4 pb-2 text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
        <div className="px-3 pb-4 grid grid-cols-2 gap-2">
          {themes.map(t => (
            <ThemeCard key={t.id} theme={t} active={t.id === activeThemeId}
              onApply={() => setActiveTheme(t.id)}
              onDelete={isPreset(t.id) ? undefined : () => deleteTheme(t.id)}
              onDuplicate={() => duplicate(t)} />
          ))}
        </div>
      </div>

      {/* ── Editor ── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <input
              value={active.name}
              onChange={e => updateActiveColors({ name: e.target.value })}
              className="text-lg font-semibold bg-transparent outline-none flex-1 min-w-0"
              style={{ color: 'var(--text-primary)', border: 'none' }}
            />
            {isPreset(active.id) && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>base theme</span>}
            <Btn size="sm" variant="outline" icon={busy === 'export' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} loading={busy === 'export'} onClick={doExport}>Export</Btn>
          </div>

          <Section title="Colors">
            <div className="mb-3 flex gap-2">
              {(['dark', 'light', 'system'] as const).map(b => (
                <Pill key={b} active={active.base === b} label={b} onClick={() => updateActiveColors({ base: b })} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(Object.entries(active.colors) as [keyof ThemeSettings['colors'], string][]).map(([key, value]) => (
                <ColorField key={key} label={camelToLabel(key)} value={value}
                  onChange={v => updateActiveColors({ colors: { ...active.colors, [key]: v } })} />
              ))}
            </div>
          </Section>

          <Section title="Typography & shape">
            <div className="space-y-3">
              <SliderField label="Border radius" value={active.borderRadius} min={0} max={20} unit="px" onChange={v => updateActiveColors({ borderRadius: v })} />
              <SliderField label="Font size" value={active.fontSize} min={11} max={18} unit="px" onChange={v => updateActiveColors({ fontSize: v })} />
              <div>
                <FieldLabel>Font family</FieldLabel>
                <Select value={active.fontFamily} onChange={v => updateActiveColors({ fontFamily: v })} options={FONTS.map(f => ({ value: f, label: f.split(',')[0].replace(/'/g, '') }))} />
              </div>
              <div>
                <FieldLabel>Icon family</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {ICON_FAMILIES.map(fam => (
                    <Pill key={fam.id} active={active.iconFamily === fam.id} label={fam.label} onClick={() => updateActiveColors({ iconFamily: fam.id })} />
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Backgrounds">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)', opacity: 0.75 }}>
              Optional images layered behind the app and the chat, packaged with the theme on export.
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
              Recommended: at least <b style={{ color: 'var(--text-secondary)' }}>1920×1080</b> (2560×1440+ for sharp
              HiDPI displays). JPG or WebP; images are scaled to cover.
            </p>
            <div className="space-y-3">
              {THEME_BG_SLOTS.map(slot => (
                <BackgroundEditor key={slot} slot={slot} bg={active.backgrounds?.[slot]} themeId={active.id}
                  onChange={bg => updateActiveBackground(slot, bg)} />
              ))}
            </div>
          </Section>

          <Section title="Preview"><ThemePreview theme={active} /></Section>
        </div>
      </div>
    </div>
  )
}

function ThemeCard({ theme, active, onApply, onDelete, onDuplicate }: {
  theme: ThemeSettings; active: boolean; onApply: () => void; onDelete?: () => void; onDuplicate: () => void
}) {
  return (
    <div
      onClick={onApply}
      className="group relative rounded p-2 cursor-pointer"
      style={{ background: 'var(--bg-elevated)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)' }}
    >
      <div className="flex rounded overflow-hidden mb-1.5" style={{ height: 34 }}>
        <div style={{ flex: 2, background: theme.colors.bgPrimary }} />
        <div style={{ flex: 1, background: theme.colors.bgSurface }} />
        <div style={{ width: 12, background: theme.colors.accent }} />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium truncate flex-1" style={{ color: 'var(--text-primary)' }}>{theme.name}</span>
        {active && <Check size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
      </div>
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconBtn title="Duplicate" onClick={e => { e.stopPropagation(); onDuplicate() }}><Copy size={11} /></IconBtn>
        {onDelete && <IconBtn title="Delete" danger onClick={e => { e.stopPropagation(); onDelete() }}><Trash2 size={11} /></IconBtn>}
      </div>
    </div>
  )
}

function BackgroundEditor({ slot, bg, themeId, onChange }: {
  slot: ThemeBgSlot; bg?: ThemeBackground; themeId: string; onChange: (bg: ThemeBackground | null) => void
}) {
  const [picking, setPicking] = useState(false)
  const url = useThemeImage(bg?.file)

  const choose = async () => {
    setPicking(true)
    const res = await pickImage(themeId, slot)
    setPicking(false)
    if (!res?.ok || !res.file) return
    if (res.dataUrl) primeThemeImage(res.file, res.dataUrl)
    onChange({ file: res.file, opacity: bg?.opacity ?? 0.12, blur: bg?.blur ?? 0, fit: bg?.fit ?? 'cover', position: bg?.position ?? 'center' })
  }
  const patch = (p: Partial<ThemeBackground>) => { if (bg) onChange({ ...bg, ...p }) }

  return (
    <div className="rounded p-3" style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius)' }}>
      <div className="flex items-center gap-3">
        <div className="rounded overflow-hidden shrink-0 flex items-center justify-center" style={{ width: 56, height: 40, background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
          {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={16} style={{ color: 'var(--text-secondary)', opacity: 0.5 }} />}
        </div>
        <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{BG_LABELS[slot]}</span>
        <Btn size="sm" variant="outline" loading={picking} onClick={choose}>{bg ? 'Replace' : 'Choose image'}</Btn>
        {bg && <Btn size="sm" variant="ghost" icon={<X size={12} />} onClick={() => onChange(null)} />}
      </div>
      {bg && (
        <div className="mt-3 space-y-2.5">
          <SliderField label="Opacity" value={Math.round(bg.opacity * 100)} min={0} max={100} unit="%" onChange={v => patch({ opacity: v / 100 })} />
          <SliderField label="Blur" value={bg.blur} min={0} max={20} unit="px" onChange={v => patch({ blur: v })} />
          <div>
            <FieldLabel>Fit</FieldLabel>
            <div className="flex gap-1.5">
              {(['cover', 'contain', 'tile'] as ThemeBgFit[]).map(f => (
                <Pill key={f} active={bg.fit === f} label={f} onClick={() => patch({ fit: f })} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ThemePreview({ theme }: { theme: ThemeSettings }) {
  const c = theme.colors
  return (
    <div style={{ background: c.bgPrimary, borderRadius: theme.borderRadius, padding: 14, fontSize: theme.fontSize - 2, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ width: 40, background: c.bgSurface, borderRadius: theme.borderRadius / 2, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          {[c.accent, c.textSecondary, c.textSecondary].map((col, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: col, opacity: i === 0 ? 1 : 0.5 }} />)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ background: c.bgSurface, borderRadius: theme.borderRadius / 2, padding: 10, marginBottom: 8 }}>
            <div style={{ width: '55%', height: 8, borderRadius: 4, background: c.textPrimary, marginBottom: 6 }} />
            <div style={{ width: '100%', height: 5, borderRadius: 2, background: c.textSecondary, opacity: 0.35, marginBottom: 3 }} />
            <div style={{ width: '85%', height: 5, borderRadius: 2, background: c.textSecondary, opacity: 0.35 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ background: c.accent, color: c.accentFg, borderRadius: theme.borderRadius / 2, padding: '5px 12px', fontSize: theme.fontSize - 4 }}>Primary</div>
            <div style={{ background: 'transparent', color: c.textSecondary, border: `1px solid ${c.border}`, borderRadius: theme.borderRadius / 2, padding: '5px 12px', fontSize: theme.fontSize - 4 }}>Secondary</div>
          </div>
          <div className="flex gap-1.5 mt-2">
            {[c.danger, c.warning, c.success].map((col, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: col }} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── small local UI helpers ──
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div className="px-4 py-2.5 text-xs font-semibold" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
      <div className="p-4">{children}</div>
    </div>
  )
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>{children}</label>
}
function Pill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', fontSize: 12, borderRadius: 999, cursor: 'pointer', textTransform: 'capitalize',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-secondary)',
    }}>{label}</button>
  )
}
function IconBtn({ children, title, danger, onClick }: { children: React.ReactNode; title: string; danger?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button title={title} onClick={onClick} className="flex items-center justify-center rounded" style={{ width: 20, height: 20, background: 'var(--bg-surface)', border: '1px solid var(--border)', cursor: 'pointer', color: danger ? 'var(--danger)' : 'var(--text-secondary)' }}>{children}</button>
  )
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', padding: 2 }} />
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          style={{ flex: 1, padding: '4px 8px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace' }} />
      </div>
    </div>
  )
}
function SliderField({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
        <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
    </div>
  )
}
function camelToLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}
