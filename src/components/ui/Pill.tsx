import type { ReactNode } from 'react'
import { toneColor, toneTint, type StateTone } from '../../lib/stateTone'

// A state pill: the shape of the app's existing badges (radius 999, 10px, a 13% tint),
// coloured by lib/stateTone so a state looks the same everywhere.
export function Pill({ tone, icon, title, children }: {
  tone: StateTone | 'neutral'
  icon?: ReactNode
  title?: string
  children: ReactNode
}) {
  const color = tone === 'neutral' ? 'var(--text-secondary)' : toneColor(tone)
  const background = tone === 'neutral' ? 'var(--bg-elevated)' : toneTint(tone)
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 shrink-0"
      style={{ fontSize: 10, fontWeight: 600, color, background, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' }}
    >
      {icon}
      {children}
    </span>
  )
}
