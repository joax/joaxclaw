import type { ReactNode } from 'react'
import { useIsNarrow } from '../../lib/useIsNarrow'

// The right-hand panel beside the chat, with the Files drawer's sizing: 380px next to the
// chat, flexing into the leftover width when expanded, and full-screen on a phone.
export const SIDE_PANEL_WIDTH = 380

export function SidePanel({ open = true, expanded = false, label, children }: {
  open?: boolean
  expanded?: boolean
  /** Accessible name for the panel. */
  label: string
  children: ReactNode
}) {
  const narrow = useIsNarrow()
  if (!open) return null

  // Three sizings, and the difference matters: the panel is a flex sibling of the nav
  // rail, so an EXPANDED panel must *flex* into the space left over. Asking for
  // `width: 100%` with `flexShrink: 0` made it demand the whole row next to a ~60px
  // rail, pushing its right edge off the window.
  //
  // <main>'s inner wrapper carries z-[1], so a static sibling paints under it — anything
  // overflowing the chat column would bleed over this panel. Hence the stacking context.
  const sizing: React.CSSProperties = narrow
    ? { position: 'fixed', inset: 0, width: '100%', zIndex: 40 }
    : expanded
      ? { flex: 1, minWidth: 0, position: 'relative', zIndex: 2 }
      : { width: SIDE_PANEL_WIDTH, flexShrink: 0, position: 'relative', zIndex: 2 }

  return (
    <aside
      aria-label={label}
      className="flex flex-col min-h-0"
      style={{
        borderLeft: narrow || expanded ? 'none' : '1px solid var(--border)',
        background: 'var(--bg-primary)',
        // Lift the panel off the chat column, on the left edge only. The negative spread
        // keeps it there: it shrinks the shadow shape by 12px on every side, and the 24px
        // blur reaches about 12px back out, so the top and bottom cancel to zero while
        // the -20px offset still leaves about 20px of shadow to the left. Pointless as a
        // full-screen overlay, where there's nothing beside it to separate from.
        ...(narrow ? {} : { boxShadow: '-20px 0 24px -12px rgba(0,0,0,0.45)' }),
        ...sizing,
      }}
    >
      {children}
    </aside>
  )
}
