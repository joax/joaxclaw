import { parseThemeManifest } from './themeFormat'
import type { ThemeSettings } from './types'

// The built-in themes are the readable JSON files under /themes/<id>/theme.json — the
// exact same format users import/export. Vite inlines them at build time via glob, so
// there's a single source of truth for the base themes (no hardcoded duplicate).
const modules = import.meta.glob<Record<string, unknown>>('/themes/*/theme.json', { eager: true, import: 'default' })

// Midnight first (it's the default), then the rest in a stable order.
const PRESET_ORDER = ['default-dark', 'ocean-dark', 'rose-light', 'forest-dark']
const rank = (id: string) => { const i = PRESET_ORDER.indexOf(id); return i < 0 ? 99 : i }

export const PRESET_THEMES: ThemeSettings[] = Object.values(modules)
  .map(m => parseThemeManifest(m))
  .filter((t): t is ThemeSettings => t !== null)
  .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))

export const DEFAULT_THEME: ThemeSettings =
  PRESET_THEMES.find(t => t.id === 'default-dark') ?? PRESET_THEMES[0]
