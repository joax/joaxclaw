// An expected gateway restart. A flow that is about to restart the gateway (an update,
// a plugin install) says so first, so that the reconnect overlay can explain the drop in
// the flow's own words and keep retrying for as long as the restart can take, instead of
// giving up after about 52 s (12 attempts).

export interface RestartExpectation {
  reason: string
  detail?: string
  /** Keep reconnecting until this time. */
  untilMs: number
  /** When the expectation was set. */
  setAtMs: number
  /** A drop later than setAtMs + windowMs isn't the expected restart. */
  windowMs: number
}

export type RestartExpectationInput = string | { reason: string; detail?: string; untilMs?: number; windowMs?: number }

export const DEFAULT_RESTART_UNTIL_MS = 5 * 60_000
export const DEFAULT_RESTART_WINDOW_MS = 2 * 60_000

/** Normalise the caller's input: a bare string means `{ reason }` with the defaults. */
export function makeRestartExpectation(input: RestartExpectationInput, now: number): RestartExpectation {
  const o = typeof input === 'string' ? { reason: input } : input
  return {
    reason: o.reason,
    detail: o.detail,
    untilMs: o.untilMs ?? now + DEFAULT_RESTART_UNTIL_MS,
    setAtMs: now,
    windowMs: o.windowMs ?? DEFAULT_RESTART_WINDOW_MS,
  }
}

/**
 * The expectation that applies to a drop at `droppedAtMs`, or null when there is none or
 * it had lapsed by then (no drop within its window).
 */
export function activeExpectation(e: RestartExpectation | null, droppedAtMs: number): RestartExpectation | null {
  if (!e) return null
  return droppedAtMs <= e.setAtMs + e.windowMs ? e : null
}

/**
 * Whether the reconnect loop should try again. Without an expectation it stops after
 * `max` attempts. With one that covers the drop, it keeps going until `untilMs`.
 */
export function shouldKeepReconnecting(args: {
  attempt: number
  max: number
  expectation: RestartExpectation | null
  droppedAtMs: number
  now: number
}): boolean {
  const e = activeExpectation(args.expectation, args.droppedAtMs)
  if (e) return args.now < e.untilMs
  return args.attempt < args.max
}
