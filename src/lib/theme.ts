import type { ThemeSettings } from './types'

export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement
  const c = theme.colors

  root.style.setProperty('--bg-primary', c.bgPrimary)
  root.style.setProperty('--bg-surface', c.bgSurface)
  root.style.setProperty('--bg-elevated', c.bgElevated)
  root.style.setProperty('--text-primary', c.textPrimary)
  root.style.setProperty('--text-secondary', c.textSecondary)
  root.style.setProperty('--accent', c.accent)
  root.style.setProperty('--accent-fg', c.accentFg)
  root.style.setProperty('--border', c.border)
  root.style.setProperty('--danger', c.danger)
  root.style.setProperty('--success', c.success)
  root.style.setProperty('--warning', c.warning)
  root.style.setProperty('--radius', `${theme.borderRadius}px`)
  root.style.setProperty('--font-size', `${theme.fontSize}px`)
  root.style.setProperty('--font-family', theme.fontFamily)

  // Dark/light class for Tailwind
  if (theme.base === 'dark') {
    root.classList.add('dark')
  } else if (theme.base === 'light') {
    root.classList.remove('dark')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

export function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return hex
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`
}
