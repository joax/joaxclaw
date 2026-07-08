import logoDark from '../assets/logo-dark.png'   // pale artwork — reads on dark backgrounds
import logoLight from '../assets/logo.png'        // dark navy artwork — reads on light backgrounds
import type { BaseTheme } from './types'
import { useSettingsStore } from '../store/settings'

// Whether the active theme renders on a light background (so the dark-artwork logo is
// the legible one). `system` follows the OS colour scheme, matching applyTheme().
function isLightBase(base: BaseTheme): boolean {
  if (base === 'light') return true
  if (base === 'dark') return false
  return !window.matchMedia('(prefers-color-scheme: dark)').matches
}

// The app logo matched to the active theme: the dark logo on light themes (e.g. Sky
// Light), the pale logo on dark themes. Reactive — swaps when the theme changes.
export function useLogoUrl(): string {
  return useSettingsStore(s => {
    const theme = s.themes.find(t => t.id === s.activeThemeId)
    return theme && isLightBase(theme.base) ? logoLight : logoDark
  })
}
