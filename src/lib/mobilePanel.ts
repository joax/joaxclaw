import type { CSSProperties } from 'react'

// Right-side editor drawers (cron/agent/process editors, side panels) are a fixed panel
// docked below the 36px title bar on desktop. On mobile that leaves a dead gap at the
// top and doesn't cover the screen, so they become a full-screen sheet instead.
// Pair with `useIsNarrow()`.
export function editorDrawerStyle(narrow: boolean, width: number): CSSProperties {
  return {
    background: 'var(--bg-surface)',
    ...(narrow
      ? { top: 0, left: 0, right: 0, bottom: 0, width: '100%', borderLeft: 'none', zIndex: 50 }
      : { top: 36, width, borderLeft: '1px solid var(--border)' }),
  }
}
