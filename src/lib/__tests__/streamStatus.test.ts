import { describe, it, expect } from 'vitest'
import { computeStreamStatus, activityKey, hasProduced, HEARTBEAT_STALE_MS, type StreamStatusInput } from '../streamStatus'
import type { ChatMessage } from '../types'

const T = 60_000 // inter-token stall budget (default 60s)
const NOW = 1_000_000

function input(over: Partial<StreamStatusInput> = {}): StreamStatusInput {
  return {
    isStreaming: true,
    connected: true,
    lastHeartbeat: NOW - 5_000, // fresh tick
    now: NOW,
    turnStart: NOW,
    lastActivity: NOW,
    sawActivity: false,
    stallMs: T,
    ...over,
  }
}

describe('computeStreamStatus', () => {
  it('is idle when not streaming', () => {
    expect(computeStreamStatus(input({ isStreaming: false })).status).toBe('idle')
  })

  // ── Time-to-first-token phase (no output yet) ──
  it('warms (not stalled) while waiting for the first token within 2× budget', () => {
    const r = computeStreamStatus(input({ sawActivity: false, turnStart: NOW - (T + 5_000) })) // 65s, < 120s
    expect(r.status).toBe('warming')
    expect(r.elapsedSeconds).toBe(65)
  })

  it('stalls once the first-token budget (2× stall) is exceeded', () => {
    const r = computeStreamStatus(input({ sawActivity: false, turnStart: NOW - (2 * T + 1_000) })) // 121s
    expect(r.status).toBe('stalled')
  })

  // ── Streaming phase (output has started) ──
  it('is streaming when the inter-activity gap is under budget', () => {
    const r = computeStreamStatus(input({ sawActivity: true, lastActivity: NOW - 10_000 }))
    expect(r.status).toBe('streaming')
  })

  it('stalls when the inter-activity gap exceeds budget', () => {
    const r = computeStreamStatus(input({ sawActivity: true, lastActivity: NOW - (T + 1_000) }))
    expect(r.status).toBe('stalled')
  })

  it('does NOT apply the generous first-token budget once output has started', () => {
    // 90s gap mid-stream is a stall even though it is < the 120s first-token budget.
    const r = computeStreamStatus(input({ sawActivity: true, lastActivity: NOW - 90_000 }))
    expect(r.status).toBe('stalled')
  })

  // ── Connection liveness beats model-stall ──
  it('reports disconnected (not stalled) when the connection is down', () => {
    const r = computeStreamStatus(input({ connected: false, sawActivity: true, lastActivity: NOW - (T + 30_000) }))
    expect(r.status).toBe('disconnected')
  })

  it('reports disconnected when the gateway heartbeat is stale even if status says connected', () => {
    const r = computeStreamStatus(input({ connected: true, lastHeartbeat: NOW - (HEARTBEAT_STALE_MS + 5_000) }))
    expect(r.status).toBe('disconnected')
  })

  it('does not flag disconnected when no heartbeat has arrived yet (null)', () => {
    const r = computeStreamStatus(input({ connected: true, lastHeartbeat: null, sawActivity: true, lastActivity: NOW - 10_000 }))
    expect(r.status).toBe('streaming')
  })
})

// ── activity fingerprint ──
function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', sessionId: '', role: 'assistant', content: '', createdAt: '', ...over } as ChatMessage
}

describe('activityKey / hasProduced', () => {
  it('changes when any progress signal changes', () => {
    const a = activityKey(msg({ content: 'hi' }))
    const b = activityKey(msg({ content: 'hi there' }))
    expect(a).not.toBe(b)
  })

  it('treats reasoning-only output as produced (covers the thinking phase)', () => {
    expect(hasProduced(msg({ content: '', reasoning: 'thinking…' }))).toBe(true)
  })

  it('treats delegation to a sub-agent as produced', () => {
    expect(hasProduced(msg({ waitingForSession: 'agent:x:subagent:y' }))).toBe(true)
  })

  it('is not produced for an empty placeholder', () => {
    expect(hasProduced(msg())).toBe(false)
  })
})
