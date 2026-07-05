import { parseThemeManifest, THEME_BG_SLOTS } from './themeFormat'
import type { ThemeSettings } from './types'

// The built-in themes are the readable JSON files under /themes/<id>/theme.json — the
// exact same format users import/export. Vite inlines them at build time, so there's a
// single source of truth for the base themes (no hardcoded duplicate). Any bundled
// background images under /themes/<id>/backgrounds/ are resolved to app asset URLs and
// marked with an `asset:` prefix so the renderer uses them directly (vs reading a
// user-picked image off disk).
const themeModules = import.meta.glob<Record<string, unknown>>('/themes/*/theme.json', { eager: true, import: 'default' })
const bgModules = import.meta.glob<string>('/themes/*/backgrounds/*', { eager: true, import: 'default', query: '?url' })

const PRESET_ORDER = ['default-dark', 'ocean-dark', 'rose-light', 'sky-light', 'forest-dark', 'retro-terminal']
const rank = (id: string) => { const i = PRESET_ORDER.indexOf(id); return i < 0 ? 99 : i }

function buildPreset(themePath: string, raw: Record<string, unknown>): ThemeSettings | null {
  const theme = parseThemeManifest(raw)
  if (!theme?.backgrounds) return theme
  const dir = themePath.replace(/theme\.json$/, '') // e.g. '/themes/forest/'
  for (const slot of THEME_BG_SLOTS) {
    const bg = theme.backgrounds[slot]
    if (!bg?.file) continue
    const url = bgModules[dir + bg.file] // '/themes/forest/backgrounds/app.jpg'
    if (url) bg.file = `asset:${url}`
    else delete theme.backgrounds[slot]
  }
  return theme
}

export const PRESET_THEMES: ThemeSettings[] = Object.entries(themeModules)
  .map(([path, raw]) => buildPreset(path, raw))
  .filter((t): t is ThemeSettings => t !== null)
  .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))

export const DEFAULT_THEME: ThemeSettings =
  PRESET_THEMES.find(t => t.id === 'default-dark') ?? PRESET_THEMES[0]
