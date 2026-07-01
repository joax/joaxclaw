import type { ChatMessage } from './types'

// Phase-aware liveness for a streaming turn (pure logic; the React hook in
// components/chat/useStreamStatus.ts is thin glue over this).
//
// The old detector fired one flat timeout on any silence — which false-alarms while a
// slow local model loads, while a model reasons before its first token, or when the
// *connection* (not the model) drops. This separates the signals:
//   • connection liveness — the gateway `tick` heartbeat + connection status. No recent
//     tick ⇒ blame the pipe, not the model ("disconnected"), and let the reconnect path
//     handle it.
//   • time-to-first-token vs inter-token — before any output we allow a longer budget
//     (model load + context encoding + initial reasoning); once output is flowing we
//     watch the shorter inter-activity gap.
export type StreamStatus =
  | 'idle'          // not streaming
  | 'warming'       // streaming, no output yet, still within the first-token budget
  | 'streaming'     // output flowing (or recently changed)
  | 'stalled'       // silent past the phase threshold, but the gateway is still alive
  | 'disconnected'  // the gateway went quiet — a connection problem, not a model stall

// The gateway sends `tick` heartbeats ~30s apart; ~75s tolerates a couple of missed
// ticks before we treat the connection itself as the problem.
export const HEARTBEAT_STALE_MS = 75_000
// Before the first token, allow this multiple of the inter-token stall budget — model
// load and long context encoding produce no signal but are legitimate work.
export const TTFT_MULTIPLIER = 2

export interface StreamStatusInput {
  isStreaming: boolean
  connected: boolean            // connection status === 'connected'
  lastHeartbeat: number | null  // ms epoch of the last gateway tick, or null
  now: number
  turnStart: number             // ms epoch the current turn began
  lastActivity: number          // ms epoch of the last activity-fingerprint change
  sawActivity: boolean          // has the turn produced any output/reasoning/tool/delegation yet
  stallMs: number               // inter-token stall budget (user setting)
}

// Pure decision function — unit-tested.
export function computeStreamStatus(i: StreamStatusInput): { status: StreamStatus; elapsedSeconds: number } {
  if (!i.isStreaming) return { status: 'idle', elapsedSeconds: 0 }

  // Connection liveness first: never say "the model stopped" when the pipe is dead.
  const heartbeatStale = i.lastHeartbeat != null && i.now - i.lastHeartbeat > HEARTBEAT_STALE_MS
  if (!i.connected || heartbeatStale) {
    return { status: 'disconnected', elapsedSeconds: Math.max(0, Math.round((i.now - i.lastActivity) / 1000)) }
  }

  if (!i.sawActivity) {
    // Time-to-first-token phase — be patient (slow model load / large context).
    const since = i.now - i.turnStart
    return { status: since > i.stallMs * TTFT_MULTIPLIER ? 'stalled' : 'warming', elapsedSeconds: Math.max(0, Math.round(since / 1000)) }
  }

  // Streaming phase — watch the inter-activity gap.
  const since = i.now - i.lastActivity
  return { status: since > i.stallMs ? 'stalled' : 'streaming', elapsedSeconds: Math.max(0, Math.round(since / 1000)) }
}

// The activity fingerprint: every signal that means "the turn is making progress" —
// answer text, reasoning, tool calls (and running ones), delegation to a sub-agent, and
// any sub-agent thread output. A change in any of these resets the stall clock.
export function activityKey(m: ChatMessage | undefined): string | null {
  if (!m) return null
  const threads = m.threads?.reduce((n, t) => n + t.content.length + (t.reasoning?.length ?? 0) + (t.toolCalls?.length ?? 0), 0) ?? 0
  return `${m.content.length}:${m.reasoning?.length ?? 0}:${m.toolCalls?.length ?? 0}:${m.toolCalls?.filter(t => t.status === 'running').length ?? 0}:${m.waitingForSession ?? ''}:${threads}`
}

// True once the turn has produced anything (past the time-to-first-token phase).
export function hasProduced(m: ChatMessage | undefined): boolean {
  if (!m) return false
  const threads = m.threads?.reduce((n, t) => n + t.content.length + (t.reasoning?.length ?? 0) + (t.toolCalls?.length ?? 0), 0) ?? 0
  return m.content.length > 0 || (m.reasoning?.length ?? 0) > 0 || (m.toolCalls?.length ?? 0) > 0 || threads > 0 || !!m.waitingForSession
}
