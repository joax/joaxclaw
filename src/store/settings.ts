import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { type ThemeSettings, DEFAULT_THEME, PRESET_THEMES } from '../lib/types'
import { applyTheme } from '../lib/theme'

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

  setChatMode: (mode: 'basic' | 'advanced') => void
  setUiZoom: (level: number) => void
  setActiveTheme: (id: string) => void
  saveTheme: (theme: ThemeSettings) => void
  deleteTheme: (id: string) => void
  updateActiveColors: (partial: Partial<ThemeSettings>) => void
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
          return { themes, activeThemeId }
        })
      },

      updateActiveColors(partial) {
        const theme = get().themes.find(t => t.id === get().activeThemeId)
        if (!theme) return
        const updated = { ...theme, ...partial, colors: { ...theme.colors, ...(partial.colors ?? {}) } }
        get().saveTheme(updated)
      },

      toggleMonitor() { set(s => ({ monitorVisible: !s.monitorVisible })) },

      setAppPref(key, value) { set({ [key]: value } as Pick<SettingsState, typeof key>) },
    }),
    {
      name: 'joaxclaw-settings',
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
