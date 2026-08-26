import { describe, it, expect } from 'vitest'
import { hasProduced } from '../streamStatus'
import type { ChatMessage } from '../types'

// `watchSession` reuses a trailing assistant turn when it is streaming OR has produced
// nothing. The second half is what stops a blank bubble being appended on every
// reconnect: the sweep clears `streaming` while the session stays hasActiveRun, so the
// pane re-attaches on each blip. This pins the predicate that decision rests on.
const turn = (p: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1', sessionId: 's', role: 'assistant', content: '', createdAt: '', ...p,
})

const reusable = (m: ChatMessage) => m.role === 'assistant' && (!!m.streaming || !hasProduced(m))

describe('empty assistant turn is reusable', () => {
  it('reuses a placeholder that never received a frame', () => {
    expect(reusable(turn({ streaming: false }))).toBe(true)
  })

  it('reuses one the reconnect sweep marked interrupted but left empty', () => {
    expect(reusable(turn({ streaming: false, interrupted: true }))).toBe(true)
  })

  it('still reuses the in-flight turn', () => {
    expect(reusable(turn({ streaming: true }))).toBe(true)
  })

  it('never reuses a turn carrying real output', () => {
    expect(reusable(turn({ content: 'an answer' }))).toBe(false)
    expect(reusable(turn({ reasoning: 'thinking' }))).toBe(false)
    expect(reusable(turn({ toolCalls: [{ id: 't', name: 'exec', status: 'done' }] }))).toBe(false)
    expect(reusable(turn({ waitingForSession: 'agent:main:child' }))).toBe(false)
  })

  it('leaves user turns alone', () => {
    expect(reusable(turn({ role: 'user', content: 'hi' }))).toBe(false)
  })
})
