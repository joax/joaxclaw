import { useIsNarrow } from '../../lib/useIsNarrow'

// The labelled on/off switch from Settings, moved here unchanged apart from the knob
// colour (a token instead of #fff) and optional `disabled` / `description`.
export function Toggle({ label, value, onChange, disabled, description }: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  description?: string
}) {
  const narrow = useIsNarrow()
  // A larger pill on mobile for a comfortable tap target. `minHeight` is set explicitly
  // so the global `button { min-height: 40px }` mobile rule doesn't stretch the switch
  // into a square (it only grows buttons that DON'T set their own min-height).
  const W = narrow ? 46 : 36
  const H = narrow ? 26 : 20
  const K = narrow ? 20 : 14   // knob diameter
  const pad = 3
  return (
    <div className="flex items-center justify-between gap-3" style={{ opacity: disabled ? 0.5 : 1 }}>
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
        {label}
        {description && <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>{description}</span>}
      </span>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
        style={{
          width: W, height: H, minHeight: H, flexShrink: 0, borderRadius: H / 2,
          cursor: disabled ? 'default' : 'pointer', border: 'none', position: 'relative',
          background: value ? 'var(--accent)' : 'var(--border)', transition: 'background 0.2s'
        }}
      >
        <div style={{
          width: K, height: K, borderRadius: '50%', background: 'var(--accent-fg)',
          position: 'absolute', top: pad, left: value ? W - K - pad : pad, transition: 'left 0.2s'
        }} />
      </button>
    </div>
  )
}
