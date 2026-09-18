// QA (sprint 2026.9, final pass): the history mapping after the integration merge moved it to
// lib/chatHistory.ts. Every tool call in the source-shaped 2026.9.4 fixture reloads with the
// outcome PRD 05 FR-2/FR-3/FR-15 expects, nested tool rows included, and a still-running
// turn's unanswered call shows as running.
import { describe, expect, it } from 'vitest'
import { toChatMessages } from '../chatHistory'
import { EXPORT_HISTORY_MESSAGES, EXPECTED_TOOL_OUTCOMES, SESSION_KEY } from './fixtures/sprint/chatExport'

const calls = (active: boolean) =>
  toChatMessages(EXPORT_HISTORY_MESSAGES as unknown[], SESSION_KEY, undefined, active).flatMap(m => m.toolCalls ?? [])

describe('QA final · lib/chatHistory.toChatMessages', () => {
  it('reloads every call in the fixture with its expected outcome while the run is active', () => {
    const byId = new Map(calls(true).map(c => [c.id, c]))
    for (const [id, want] of Object.entries(EXPECTED_TOOL_OUTCOMES)) {
      const c = byId.get(id)
      expect(c, id).toBeDefined()
      expect(c!.name, id).toBe(want.name)
      expect(c!.status, id).toBe(want.status)
      expect(c!.result !== undefined || c!.error !== undefined, id).toBe(want.hasResult)
    }
  })
  it('keeps the nested tool activity row as a call (it was dropped before #79 follow-up)', () => {
    expect(calls(false).some(c => c.id === 'call_nest07')).toBe(true)
  })
  it('nothing is "running" once the run has ended', () => {
    expect(calls(false).some(c => c.status === 'running')).toBe(false)
  })
})
