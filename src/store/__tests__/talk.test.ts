import { describe, it, expect } from 'vitest'
import { nextPhase } from '../talk'

describe('nextPhase — Talk interaction state machine', () => {
  it('user speech (incl. barge-in) → user_speaking', () => {
    expect(nextPhase('listening', 'speechStart')).toBe('user_speaking')
    expect(nextPhase('speaking', 'speechStart')).toBe('user_speaking')   // barge-in
  })
  it('a finished user turn → thinking; an agent transcript does not', () => {
    expect(nextPhase('user_speaking', 'transcript.done', 'user')).toBe('thinking')
    expect(nextPhase('speaking', 'transcript.done', 'assistant')).toBe('speaking')
  })
  it('agent audio → speaking, audioDone → listening', () => {
    expect(nextPhase('thinking', 'audio')).toBe('speaking')
    expect(nextPhase('speaking', 'audioDone')).toBe('listening')
  })
  it('tool lifecycle: call → tool_running, result → thinking', () => {
    expect(nextPhase('thinking', 'tool.call')).toBe('tool_running')
    expect(nextPhase('tool_running', 'tool.result')).toBe('thinking')
    expect(nextPhase('speaking', 'tool.result')).toBe('speaking')   // only from tool_running
  })
  it('error → error; unknown/plain transcript events leave phase unchanged', () => {
    expect(nextPhase('speaking', 'error')).toBe('error')
    expect(nextPhase('listening', 'transcript.delta')).toBe('listening')
    expect(nextPhase('listening', 'whatever')).toBe('listening')
  })
})
