import { describe, it, expect } from 'vitest'
import { isSessionRunning, sessionChangePatch } from '../sessionRunning'
import type { Session } from '../types'

const session = (p: Partial<Session>): Session => ({ key: 'agent:main:main', ...p })

describe('isSessionRunning', () => {
  it('is false without a session', () => {
    expect(isSessionRunning(undefined)).toBe(false)
    expect(isSessionRunning(null)).toBe(false)
  })

  it('follows hasActiveRun when there is no status', () => {
    expect(isSessionRunning(session({ hasActiveRun: true }))).toBe(true)
    expect(isSessionRunning(session({ hasActiveRun: false }))).toBe(false)
    expect(isSessionRunning(session({}))).toBe(false)
  })

  it('treats an explicit hasActiveRun:false as authoritative over a stale running status', () => {
    expect(isSessionRunning(session({ status: 'running', hasActiveRun: false }))).toBe(false)
  })

  it('is running on status alone when hasActiveRun is absent', () => {
    expect(isSessionRunning(session({ status: 'running' }))).toBe(true)
  })

  it('is false for terminal statuses even with a stale hasActiveRun', () => {
    for (const status of ['idle', 'done', 'failed', 'killed', 'timeout']) {
      expect(isSessionRunning(session({ status, hasActiveRun: true }))).toBe(false)
    }
  })

  it('keeps a yielded controller live while its sub-agent runs', () => {
    // The controller reports itself finished; the worker is what is still running.
    expect(isSessionRunning(session({ status: 'done', hasActiveRun: false, hasActiveSubagentRun: true }))).toBe(true)
  })
})

// The sessions.changed rows a normal turn produces on a 2026.9.4 gateway, in order, as
// captured live (QA harness, mock model): the terminal row, sent with the chat `final`,
// still says running; the settled row follows ~100 ms later.
const RUN_START = { sessionKey: 'agent:main:main', phase: 'start', runId: 'r1', status: 'running', hasActiveRun: true, activeRunIds: null }
const RUN_END = { sessionKey: 'agent:main:main', phase: 'end', runId: 'r1', status: 'running', hasActiveRun: true, activeRunIds: null, endedAt: 1789824846238 }
const RUN_SETTLED = { sessionKey: 'agent:main:main', reason: 'chat.run.settled', status: 'done', hasActiveRun: false, activeRunIds: [] }

describe('sessionChangePatch', () => {
  it("keeps a finished run's session idle through its terminal row (empty bubble after a send)", () => {
    // The chat `final` has just set hasActiveRun:false on a row that said running.
    const afterFinal = session({ status: 'running', hasActiveRun: false })
    const row = { ...afterFinal, ...sessionChangePatch(RUN_END) } as Session
    expect(isSessionRunning(row)).toBe(false)
    expect(row).toMatchObject({ endedAt: 1789824846238 })
    // Before the fix the terminal row made it running again.
    expect(isSessionRunning({ ...afterFinal, ...RUN_END } as Session)).toBe(true)
  })

  it('passes other rows through unchanged', () => {
    expect(sessionChangePatch(RUN_START)).toBe(RUN_START)
    expect(sessionChangePatch(RUN_SETTLED)).toBe(RUN_SETTLED)
  })

  it("keeps a terminal row's idle or failed status", () => {
    expect(sessionChangePatch({ phase: 'error', status: 'failed', hasActiveRun: false })).toEqual({ phase: 'error', status: 'failed', hasActiveRun: false })
  })

  it('keeps a sub-agent that is still working', () => {
    const row = { ...session({ status: 'running', hasActiveRun: false }), ...sessionChangePatch({ ...RUN_END, hasActiveSubagentRun: true }) } as Session
    expect(isSessionRunning(row)).toBe(true)
  })
})
