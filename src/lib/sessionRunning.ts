import type { Session } from './types'

// One definition of "this session is working right now", shared by every surface
// that shows a live indicator.
//
// The chat list and the chat pane used to answer this question differently: the list
// asked the gateway (`hasActiveRun`), the pane asked the local stream
// (`message.streaming`). Any run that outlives its stream — the turn finalized but the
// agent kept going, the WebSocket dropped mid-run, the reply arrives on another
// channel — showed a live dot in the sidebar and a finished-looking transcript.

const TERMINAL_STATUSES = new Set(['idle', 'done', 'failed', 'killed', 'timeout'])

export function isSessionRunning(session: Session | undefined | null): boolean {
  if (!session) return false
  // A controller that has yielded to a running sub-agent reports hasActiveRun:false /
  // status:'done' for itself, but its worker is still live.
  if (session.hasActiveSubagentRun) return true
  if (session.status && TERMINAL_STATUSES.has(session.status)) return false
  // An explicit false overrides a stale stored 'running' status.
  if (session.hasActiveRun === false) return false
  if (session.status === 'running') return true
  return session.hasActiveRun ?? false
}

/**
 * A `sessions.changed` payload as a patch for the session's row.
 *
 * When a run ends, the gateway broadcasts the row with `phase: 'end'` (or 'error') from
 * a snapshot taken before that run is settled, so it still says `status: 'running'`,
 * `hasActiveRun: true`; the settled row ('chat.run.settled') follows a moment later.
 * Applied as is, it undid the idle state the chat's `final` had just set, and the open
 * pane, seeing a running session with no stream, attached to the finished run and left
 * an empty "Assistant" bubble under the reply. So a terminal payload's running claims
 * are left out; the rest of it, and every other payload, applies unchanged.
 */
export function sessionChangePatch<T extends object>(payload: T): Partial<T> {
  const p = payload as Record<string, unknown>
  if (p.phase !== 'end' && p.phase !== 'error') return payload
  const { hasActiveRun, status, ...rest } = p
  return {
    ...rest,
    ...(hasActiveRun === false ? { hasActiveRun } : {}),
    ...(status !== undefined && status !== 'running' ? { status } : {}),
  } as Partial<T>
}
