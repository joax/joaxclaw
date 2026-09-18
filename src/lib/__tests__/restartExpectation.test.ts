import { describe, it, expect } from 'vitest'
import {
  activeExpectation, makeRestartExpectation, shouldKeepReconnecting,
  DEFAULT_RESTART_UNTIL_MS, DEFAULT_RESTART_WINDOW_MS,
} from '../restartExpectation'

// A flow about to restart the gateway (update, plugin install) arms an expectation so the
// reconnect loop keeps trying for minutes instead of giving up after 12 attempts (~52 s).

const T0 = 1_000_000

describe('makeRestartExpectation', () => {
  it('accepts a bare reason and fills in the defaults', () => {
    expect(makeRestartExpectation('Installing a plugin', T0)).toEqual({
      reason: 'Installing a plugin', detail: undefined,
      untilMs: T0 + DEFAULT_RESTART_UNTIL_MS, setAtMs: T0, windowMs: DEFAULT_RESTART_WINDOW_MS,
    })
  })
  it('keeps the caller’s detail, deadline and window', () => {
    const e = makeRestartExpectation({ reason: 'Gateway is updating', detail: 'x', untilMs: T0 + 10, windowMs: 5 }, T0)
    expect(e).toMatchObject({ reason: 'Gateway is updating', detail: 'x', untilMs: T0 + 10, windowMs: 5 })
  })
})

describe('activeExpectation', () => {
  const e = makeRestartExpectation('r', T0)
  it('covers a drop inside the window', () => {
    expect(activeExpectation(e, T0 + DEFAULT_RESTART_WINDOW_MS)).toBe(e)
  })
  it('has lapsed for a drop after the window', () => {
    expect(activeExpectation(e, T0 + DEFAULT_RESTART_WINDOW_MS + 1)).toBeNull()
  })
  it('is null without an expectation', () => {
    expect(activeExpectation(null, T0)).toBeNull()
  })
})

describe('shouldKeepReconnecting', () => {
  const base = { max: 12, droppedAtMs: T0 + 1000, now: T0 + 60_000 }
  it('stops after max attempts with no expectation', () => {
    expect(shouldKeepReconnecting({ ...base, attempt: 11, expectation: null })).toBe(true)
    expect(shouldKeepReconnecting({ ...base, attempt: 12, expectation: null })).toBe(false)
  })
  it('keeps going past max until untilMs with an expectation', () => {
    const e = makeRestartExpectation('r', T0)
    expect(shouldKeepReconnecting({ ...base, attempt: 40, expectation: e })).toBe(true)
    expect(shouldKeepReconnecting({ ...base, attempt: 40, expectation: e, now: e.untilMs })).toBe(false)
  })
  it('ignores an expectation that lapsed before the drop', () => {
    const e = makeRestartExpectation('r', T0)
    const late = T0 + DEFAULT_RESTART_WINDOW_MS + 1
    expect(shouldKeepReconnecting({ ...base, attempt: 12, expectation: e, droppedAtMs: late, now: late + 1 })).toBe(false)
  })
  it('a re-armed expectation replaces the old one', () => {
    const later = makeRestartExpectation({ reason: 'activating', untilMs: T0 + 20 * 60_000 }, T0 + 30_000)
    expect(shouldKeepReconnecting({ ...base, attempt: 99, expectation: later, now: T0 + 10 * 60_000 })).toBe(true)
  })
})
