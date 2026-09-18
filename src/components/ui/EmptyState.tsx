import type { LucideIcon } from 'lucide-react'

// An empty list: a faded icon and one short line, with an optional hint. `compact` is for
// strips and the drawer, where a full-height empty state would be too much.
export function EmptyState({ icon: Icon, label, hint, compact }: {
  icon: LucideIcon
  label: string
  hint?: string
  compact?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center flex-1 ${compact ? 'gap-2 py-4' : 'gap-3 py-10'}`}
      style={{ color: 'var(--text-secondary)' }}
    >
      <Icon size={compact ? 20 : 36} style={{ opacity: 0.3 }} />
      <p className="text-sm">{label}</p>
      {hint && <p className="text-xs text-center" style={{ opacity: 0.75, maxWidth: 320 }}>{hint}</p>}
    </div>
  )
}
