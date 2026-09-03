// Settling a turn the gateway has already finished.
//
// The chat store keeps a turn `streaming` past its `final` in one deliberate case: this
// gateway ends a run with an EMPTY `final` at a sessions_yield, auto-resumes the agent,
// and sends the real answer in a later `final`. So an empty final while a sub-agent
// thread is in flight is treated as that yield boundary, not the end of the turn.
//
// When the resumed answer never arrives — the worker died, its completion frame was
// missed, the yield was the actual end — nothing settles the turn. Worse, the thread
// left in 'running' makes isActivelyWorking() true, so the stall detector never fires
// either (it treats a running sub-agent as legitimate work). The composer stays blocked
// and the chat reads "Working…" until the user hits Stop.
//
// The gateway's own view of the session is the authority: if it says the session is not
// running, the turn is over whatever the local frames implied. One observation is not
// enough — a controller reads idle for a moment at a yield boundary, before its worker
// registers as an active sub-agent run — so the idle reading must hold for a grace
// period before we settle.

export const STUCK_STREAM_GRACE_MS = 8_000

export interface StreamingConv {
  id: string
  sessionKey?: string
  streaming: boolean
  // Whether the open turn could be mid-yield: a yield ALWAYS has a spawned sub-agent
  // thread in flight. With none, there is no auto-resume to wait for and an idle session
  // means the turn is simply over — settle on the first reading instead of waiting out
  // the grace period.
  mayBeYielding: boolean
}

export interface ReconcileResult {
  settle: string[]
  idleSince: Map<string, number>
}

/**
 * Decide which conversations have a stream to settle.
 *
 * `isRunning` returns undefined when the session is unknown to the sessions store — a
 * turn sent before its session row exists. Unknown is never treated as idle: we cannot
 * distinguish "finished" from "not yet reported", and settling early would cut off a
 * live turn.
 */
export function reconcileStreams(
  convs: StreamingConv[],
  isRunning: (sessionKey: string) => boolean | undefined,
  idleSince: Map<string, number>,
  now: number,
  graceMs: number = STUCK_STREAM_GRACE_MS,
): ReconcileResult {
  const next = new Map<string, number>()
  const settle: string[] = []

  for (const conv of convs) {
    if (!conv.streaming || !conv.sessionKey) continue
    const running = isRunning(conv.sessionKey)
    if (running !== false) continue          // running, or unknown — leave it alone

    if (!conv.mayBeYielding) { settle.push(conv.id); continue }

    const since = idleSince.get(conv.id) ?? now
    if (now - since >= graceMs) settle.push(conv.id)
    else next.set(conv.id, since)
  }

  return { settle, idleSince: next }
}
