import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeSettings, ThemeBgSlot, ThemeBackground, UserProfile } from '../lib/types'
import { DEFAULT_THEME, PRESET_THEMES } from '../lib/presetThemes'
import { parseThemeManifest, serializeTheme, THEME_BG_SLOTS } from '../lib/themeFormat'
import { applyTheme } from '../lib/theme'

interface ThemeApi {
  import?: () => Promise<{ ok: boolean; canceled?: boolean; error?: string; theme?: unknown }>
  export?: (manifest: unknown, bgFiles: Record<string, string>) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>
  deleteAssets?: (themeId: string) => Promise<unknown>
}
const themeApi = (): ThemeApi | undefined =>
  (window as unknown as { api?: { theme?: ThemeApi } }).api?.theme

const PRESET_IDS = new Set(PRESET_THEMES.map(t => t.id))

// Fetch a bundled-asset / http / data URL and return it as a data URL, so the main
// process can pack it into an exported theme zip (it can't read renderer asset URLs).
async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob()
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

// UI zoom bounds (Electron webFrame zoom levels). ±0.5 per keypress ≈ ±10%.
export const ZOOM_MIN = -3
export const ZOOM_MAX = 4
export const ZOOM_STEP = 0.5

function applyZoom(level: number): void {
  const api = (window as unknown as { api?: { zoom?: { set: (n: number) => void } } }).api
  api?.zoom?.set(level)
}

interface SettingsState {
  activeThemeId: string
  themes: ThemeSettings[]
  monitorVisible: boolean
  showGpu: boolean
  showRam: boolean
  showHeartbeat: boolean
  showModelName: boolean

  // App preferences (local, not sent to gateway)
  streamStallTimeout: number  // seconds before "model stopped responding" banner
  // Chat presentation: 'advanced' = full tool calls + reasoning; 'basic' = friendly
  // plain-language activity trail for run-of-the-mill users.
  chatMode: 'basic' | 'advanced'
  // Whole-app zoom level (Electron webFrame zoom). 0 = 100%; each ±0.5 step ≈ ±10%.
  uiZoom: number

  // Auto-updater: check GitHub Releases on launch + periodically when enabled.
  autoUpdateCheck: boolean
  // A version the user chose to "Skip" — suppresses the banner until a newer one.
  skippedUpdateVersion: string

  // ── User profile ("About You") ──────────────────────────────────────────────
  userProfile: UserProfile
  // Auto-include the profile as context on the first turn of a new chat.
  shareProfile: boolean
  // Use the profile name as the chat identity the model sees (vs. "JoaxClaw").
  useNameAsIdentity: boolean
  // First-run welcome shown-and-dismissed flag.
  welcomeSeen: boolean

  setUserProfile: (patch: Partial<UserProfile>) => void
  setShareProfile: (on: boolean) => void
  setUseNameAsIdentity: (on: boolean) => void
  dismissWelcome: () => void

  setAutoUpdateCheck: (on: boolean) => void
  setSkippedUpdateVersion: (version: string) => void
  setChatMode: (mode: 'basic' | 'advanced') => void
  setUiZoom: (level: number) => void
  setActiveTheme: (id: string) => void
  saveTheme: (theme: ThemeSettings) => void
  deleteTheme: (id: string) => void
  updateActiveColors: (partial: Partial<ThemeSettings>) => void
  updateActiveBackground: (slot: ThemeBgSlot, bg: ThemeBackground | null) => void
  importTheme: () => Promise<{ ok: boolean; error?: string }>
  exportTheme: (id: string) => Promise<{ ok: boolean; error?: string }>
  toggleMonitor: () => void
  setAppPref: <K extends keyof AppPrefs>(key: K, value: AppPrefs[K]) => void
}

export interface AppPrefs {
  streamStallTimeout: number
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      activeThemeId: DEFAULT_THEME.id,
      themes: PRESET_THEMES,
      monitorVisible: false,
      showGpu: true,
      showRam: true,
      showHeartbeat: true,
      showModelName: true,
      streamStallTimeout: 60,
      chatMode: 'advanced',
      uiZoom: 0,
      autoUpdateCheck: true,
      skippedUpdateVersion: '',

      userProfile: { name: '', about: '' },
      shareProfile: true,
      useNameAsIdentity: true,
      welcomeSeen: false,

      setUserProfile(patch) { set(s => ({ userProfile: { ...s.userProfile, ...patch } })) },
      setShareProfile(on) { set({ shareProfile: on }) },
      setUseNameAsIdentity(on) { set({ useNameAsIdentity: on }) },
      dismissWelcome() { set({ welcomeSeen: true }) },

      setAutoUpdateCheck(on) { set({ autoUpdateCheck: on }) },
      setSkippedUpdateVersion(version) { set({ skippedUpdateVersion: version }) },

      setChatMode(mode) { set({ chatMode: mode }) },

      setUiZoom(level) {
        const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(level * 2) / 2))
        set({ uiZoom: clamped })
        applyZoom(clamped)
      },

      setActiveTheme(id) {
        const theme = get().themes.find(t => t.id === id)
        if (theme) {
          set({ activeThemeId: id })
          applyTheme(theme)
        }
      },

      saveTheme(theme) {
        set(s => {
          const existing = s.themes.findIndex(t => t.id === theme.id)
          const themes = existing >= 0
            ? s.themes.map((t, i) => i === existing ? theme : t)
            : [...s.themes, theme]
          return { themes, activeThemeId: theme.id }
        })
        applyTheme(theme)
      },

      deleteTheme(id) {
        set(s => {
          const themes = s.themes.filter(t => t.id !== id)
          const activeThemeId = s.activeThemeId === id ? (themes[0]?.id ?? DEFAULT_THEME.id) : s.activeThemeId
          if (s.activeThemeId === id) applyTheme(themes.find(t => t.id === activeThemeId) ?? DEFAULT_THEME)
          return { themes, activeThemeId }
        })
        themeApi()?.deleteAssets?.(id)?.catch(() => { /* best-effort disk cleanup */ })
      },

      updateActiveColors(partial) {
        const theme = get().themes.find(t => t.id === get().activeThemeId)
        if (!theme) return
        const updated = { ...theme, ...partial, colors: { ...theme.colors, ...(partial.colors ?? {}) } }
        get().saveTheme(updated)
      },

      updateActiveBackground(slot, bg) {
        const theme = get().themes.find(t => t.id === get().activeThemeId)
        if (!theme) return
        const backgrounds = { ...(theme.backgrounds ?? {}) }
        if (bg) backgrounds[slot] = bg
        else delete backgrounds[slot]
        get().saveTheme({ ...theme, backgrounds: Object.keys(backgrounds).length ? backgrounds : undefined })
      },

      async importTheme() {
        const api = themeApi()
        if (!api?.import) return { ok: false, error: 'Theme import is unavailable' }
        const res = await api.import()
        if (res?.canceled) return { ok: true }
        if (!res?.ok) return { ok: false, error: res?.error ?? 'Import failed' }
        const theme = parseThemeManifest(res.theme)
        if (!theme) return { ok: false, error: 'The package is not a valid theme' }
        get().saveTheme(theme) // save, activate, and apply
        return { ok: true }
      },

      async exportTheme(id) {
        const theme = get().themes.find(t => t.id === id)
        if (!theme) return { ok: false, error: 'Theme not found' }
        const api = themeApi()
        if (!api?.export) return { ok: false, error: 'Theme export is unavailable' }
        const bgFiles: Record<string, string> = {}
        for (const slot of THEME_BG_SLOTS) {
          const f = theme.backgrounds?.[slot]?.file
          if (!f) continue
          // Disk paths pass through; bundled/remote assets are inlined as data URLs.
          const direct = f.startsWith('asset:') ? f.slice(6) : /^(https?:|blob:|data:)/.test(f) ? f : null
          bgFiles[slot] = direct ? await urlToDataUrl(direct) : f
        }
        const res = await api.export(serializeTheme(theme), bgFiles)
        if (res?.canceled) return { ok: true }
        return { ok: !!res?.ok, error: res?.error }
      },

      toggleMonitor() { set(s => ({ monitorVisible: !s.monitorVisible })) },

      setAppPref(key, value) { set({ [key]: value } as Pick<SettingsState, typeof key>) },
    }),
    {
      name: 'joaxclaw-settings',
      // Base themes always come from the repo files (PRESET_THEMES) — never localStorage —
      // so updated presets and their bundled backgrounds take effect on upgrade and can't
      // go stale. Only user-created themes are persisted.
      partialize: (s) => ({ ...s, themes: s.themes.filter(t => !PRESET_IDS.has(t.id)) }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        const custom = (p.themes ?? []).filter(t => !PRESET_IDS.has(t.id))
        return { ...current, ...p, themes: [...PRESET_THEMES, ...custom] }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          const theme = state.themes.find(t => t.id === state.activeThemeId) ?? DEFAULT_THEME
          applyTheme(theme)
          applyZoom(state.uiZoom ?? 0)
        }
      }
    }
  )
)
