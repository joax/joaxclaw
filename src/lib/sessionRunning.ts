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
