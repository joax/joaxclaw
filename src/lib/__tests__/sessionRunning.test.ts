import { describe, it, expect } from 'vitest'
import { isSessionRunning } from '../sessionRunning'
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
