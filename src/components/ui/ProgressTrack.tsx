// The one progress bar in the app. The context-window fill, a session's progress card
// and a <progress> bar a model writes into a reply all draw with this, so they read as
// the same thing.

interface Props {
  /** 0–100, or null for indeterminate (a dimmed, pulsing full-width fill). */
  pct: number | null
  color?: string
  /** Accessible name. Omit when a neighbouring label already says what this measures. */
  label?: string
  height?: number
}

export function ProgressTrack({ pct, color = 'var(--accent)', label, height = 4 }: Props) {
  const indeterminate = pct === null
  const width = indeterminate ? 100 : Math.min(Math.max(pct, 0), 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': Math.round(width) })}
      style={{ flex: 1, minWidth: 0, height, background: 'var(--bg-primary)', borderRadius: height / 2, overflow: 'hidden' }}
    >
      <div
        className={indeterminate ? 'animate-pulse' : undefined}
        style={{
          width: `${width}%`, height: '100%', background: color, borderRadius: height / 2,
          opacity: indeterminate ? 0.35 : 1, transition: 'width 0.4s',
        }}
      />
    </div>
  )
}
