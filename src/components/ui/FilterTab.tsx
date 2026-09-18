// A pill-shaped filter tab with an optional count, from the chat list. It's also the
// shape of the phone strip chips.
export function FilterTab({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="text-xs font-medium"
      style={{
        padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: 'none',
        background: active ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
    >
      {label}{count ? ` · ${count}` : ''}
    </button>
  )
}
