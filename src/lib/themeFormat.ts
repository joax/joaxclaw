import type { ThemeSettings, ThemeColors, ThemeBackground, ThemeBgSlot, BaseTheme, IconFamily } from './types'

// The `.joaxtheme` package format (a zip): `theme.json` (this manifest) + an optional
// `backgrounds/` folder of images. `format` is bumped on incompatible changes; the
// parser fills sensible defaults so older/hand-written files still load.
export const THEME_FORMAT = 1
export const THEME_BG_SLOTS: ThemeBgSlot[] = ['app', 'chat']

const COLOR_KEYS: (keyof ThemeColors)[] = [
  'bgPrimary', 'bgSurface', 'bgElevated', 'textPrimary', 'textSecondary',
  'accent', 'accentFg', 'border', 'danger', 'success', 'warning',
]
const BASES: BaseTheme[] = ['dark', 'light', 'system']
const ICONS: IconFamily[] = ['lucide', 'heroicons', 'phosphor', 'tabler', 'feather']

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const isHex = (v: unknown): v is string =>
  typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)

export function isThemeColors(v: unknown): v is ThemeColors {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return COLOR_KEYS.every(k => isHex(o[k]))
}

function numOr(v: unknown, d: number, min: number, max: number): number {
  return clamp(typeof v === 'number' && isFinite(v) ? v : d, min, max)
}

function parseBackground(v: unknown): ThemeBackground | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.file !== 'string' || !o.file) return null
  const fit: ThemeBackground['fit'] = o.fit === 'contain' || o.fit === 'tile' ? o.fit : 'cover'
  return {
    file: o.file,
    opacity: numOr(o.opacity, 0.12, 0, 1),
    blur: numOr(o.blur, 0, 0, 40),
    fit,
    position: typeof o.position === 'string' ? o.position : 'center',
  }
}

// Validate + coerce a parsed theme.json (or a bundled preset JSON) into a runtime
// ThemeSettings. Returns null only when required fields (colors, id) are missing/invalid.
export function parseThemeManifest(input: unknown, opts?: { id?: string }): ThemeSettings | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  if (!isThemeColors(o.colors)) return null
  const id = opts?.id ?? (typeof o.id === 'string' && o.id ? o.id : null)
  if (!id) return null

  const backgrounds: Partial<Record<ThemeBgSlot, ThemeBackground>> = {}
  if (o.backgrounds && typeof o.backgrounds === 'object') {
    for (const slot of THEME_BG_SLOTS) {
      const bg = parseBackground((o.backgrounds as Record<string, unknown>)[slot])
      if (bg) backgrounds[slot] = bg
    }
  }

  return {
    id,
    name: typeof o.name === 'string' && o.name ? o.name : id,
    base: BASES.includes(o.base as BaseTheme) ? (o.base as BaseTheme) : 'dark',
    colors: o.colors as ThemeColors,
    borderRadius: numOr(o.borderRadius, 8, 0, 40),
    fontSize: numOr(o.fontSize, 14, 10, 24),
    fontFamily: typeof o.fontFamily === 'string' && o.fontFamily ? o.fontFamily : 'Inter, system-ui, sans-serif',
    iconFamily: ICONS.includes(o.iconFamily as IconFamily) ? (o.iconFamily as IconFamily) : 'lucide',
    ...(typeof o.author === 'string' ? { author: o.author } : {}),
    ...(Object.keys(backgrounds).length ? { backgrounds } : {}),
  }
}

export function extOf(path: string): string {
  const m = /\.[a-z0-9]+$/i.exec(path)
  return m ? m[0].toLowerCase() : '.png'
}

// Produce the theme.json manifest for export. Background `file` paths are rewritten to
// the zip-relative form (`backgrounds/<slot>.<ext>`); the exporter copies the bytes there.
export function serializeTheme(theme: ThemeSettings): Record<string, unknown> {
  const backgrounds: Record<string, unknown> = {}
  for (const slot of THEME_BG_SLOTS) {
    const bg = theme.backgrounds?.[slot]
    if (bg?.file) {
      backgrounds[slot] = {
        file: `backgrounds/${slot}${extOf(bg.file)}`,
        opacity: bg.opacity, blur: bg.blur, fit: bg.fit,
        ...(bg.position ? { position: bg.position } : {}),
      }
    }
  }
  return {
    format: THEME_FORMAT,
    id: theme.id,
    name: theme.name,
    ...(theme.author ? { author: theme.author } : {}),
    base: theme.base,
    colors: theme.colors,
    borderRadius: theme.borderRadius,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    iconFamily: theme.iconFamily,
    ...(Object.keys(backgrounds).length ? { backgrounds } : {}),
  }
}
