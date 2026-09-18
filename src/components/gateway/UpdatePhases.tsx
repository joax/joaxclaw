import { CheckCircle2, Circle, CircleDot, XCircle } from 'lucide-react'
import { ProgressTrack } from '../ui/ProgressTrack'
import { toneColor } from '../../lib/stateTone'
import type { PhaseMark, PhaseProgress } from '../../lib/gatewayUpdate'

// An update run's phases, drawn with the progress card's step icons (ProgressCardDock):
// a check when done, a pulsing dot for the current one, a dimmed ring for what's left,
// and a cross for the phase that failed.

export function PhaseIcon({ mark, size = 12 }: { mark: PhaseMark; size?: number }) {
  switch (mark) {
    case 'done': return <CheckCircle2 size={size} style={{ color: toneColor('done') }} />
    case 'current': return <CircleDot size={size} className="animate-pulse" style={{ color: toneColor('working') }} />
    case 'failed': return <XCircle size={size} style={{ color: toneColor('failed') }} />
    default: return <Circle size={size} style={{ color: toneColor('idle'), opacity: 0.6 }} />
  }
}

const MARK_LABEL: Record<PhaseMark, string> = { done: 'done', current: 'in progress', pending: 'to do', failed: 'failed' }

/** The row of phases with their marks. */
export function PhaseMarks({ progress }: { progress: PhaseProgress }) {
  return (
    <ol className="flex items-center flex-wrap gap-x-3 gap-y-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {progress.phases.map(p => (
        <li key={p.id} className="inline-flex items-center gap-1 text-xs" style={{ color: p.mark === 'pending' ? 'var(--text-secondary)' : 'var(--text-primary)', fontWeight: p.mark === 'current' ? 600 : 400 }}>
          <span aria-hidden style={{ display: 'flex' }}><PhaseIcon mark={p.mark} /></span>
          {p.label}
          <span className="sr-only"> ({MARK_LABEL[p.mark]})</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The banner's running line, in Strip anatomy: the phases (only the current label on a
 * phone), then the one ProgressTrack, then a mono count. The bar is indeterminate until
 * the first phase is known.
 */
export function PhaseLine({ progress, narrow }: { progress: PhaseProgress; narrow?: boolean }) {
  const color = toneColor('working')
  return (
    <div className="flex items-center gap-3 min-w-0 text-xs">
      {narrow
        ? <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{progress.currentLabel}</span>
        : <div className="min-w-0"><PhaseMarks progress={progress} /></div>}
      <div style={{ flex: '0 1 160px', minWidth: 80, display: 'flex' }}>
        <ProgressTrack
          pct={progress.pct}
          color={color}
          label={`Update progress, ${progress.completed} of ${progress.total} phases`}
        />
      </div>
      <span className="font-mono shrink-0" style={{ color }}>{progress.completed}/{progress.total}</span>
    </div>
  )
}
