// Mapping a run onto the steps of the team it is running.
//
// The old Monitor tab showed a run as a log, separate from the team you had just been
// reading. Showing progress against the SAME numbered sequence means there is one mental
// model instead of two — but it needs the run's flat counters turned into a state per
// step, which is what this does.

export type StepState = 'idle' | 'done' | 'active' | 'waiting' | 'failed'

export interface StepStatus {
  state: StepState
  timing?: string
  note?: string
}

export interface RunLike {
  /** Loose on purpose: the store's RunStatus is 'idle' | 'running' | 'done' | 'error',
   *  but a run read back from disk was written by an older build and may carry
   *  something else. Unknown values fall through to the idle branch. */
  status: string
  stepsDone: number
  currentAgent?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

/** "4m 12s", or "38s" under a minute. Empty for a missing or negative span. */
export function fmtElapsed(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * Per-step state for a run, keyed by step index.
 *
 * A team loops (a branch can send the flow back to an earlier step), so `stepsDone` can
 * exceed the number of members. It is taken modulo the step count rather than clamped, so
 * a second pass lights up the steps again instead of leaving every one stuck on "done".
 */
export function stepStatuses(
  run: RunLike | undefined,
  stepCount: number,
  now = Date.now(),
): Record<number, StepStatus> {
  if (!run || stepCount <= 0) return {}

  const running = run.status === 'running'
  const failed = run.status === 'error' || run.status === 'failed'
  const done = Math.max(0, Math.floor(run.stepsDone) || 0)

  // Where the flow currently sits. Past the end of a looping team this wraps.
  const cursor = done % stepCount
  // A finished run has every step behind it; a run still on its first pass has `done`.
  const completedThisPass = running || failed ? cursor : stepCount

  const out: Record<number, StepStatus> = {}
  for (let i = 0; i < stepCount; i++) {
    if (i < completedThisPass) {
      out[i] = { state: 'done' }
    } else if (i === cursor && running) {
      out[i] = {
        state: 'active',
        ...(run.startedAt ? { timing: fmtElapsed(now - run.startedAt) } : {}),
      }
    } else if (i === cursor && failed) {
      out[i] = { state: 'failed', ...(run.error ? { note: run.error } : {}) }
    } else {
      out[i] = { state: running || failed ? 'waiting' : 'idle' }
    }
  }
  return out
}

/** One line for the run banner: what is happening, in the team's own vocabulary. */
export function describeRun(
  run: RunLike | undefined,
  steps: { role?: string; agentId: string }[],
): string | null {
  if (!run) return null
  const count = steps.length
  if (run.status === 'running') {
    if (count === 0) return 'Running'
    const cursor = (Math.max(0, run.stepsDone) % count)
    const step = steps[cursor]
    const who = step?.role || step?.agentId
    return `Running — step ${cursor + 1} of ${count}${who ? `, ${who}` : ''}`
  }
  if (run.status === 'error' || run.status === 'failed') return run.error ? `Failed — ${run.error}` : 'Failed'
  if (run.status === 'done') return 'Finished'
  return null
}
