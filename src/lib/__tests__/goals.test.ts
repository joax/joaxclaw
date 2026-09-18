import { describe, it, expect } from 'vitest'
import {
  parseGoal, goalView, formatElapsed, availableActions, buildStartParams, buildUpdateParams,
  buildClearParams, classifyGoalError, validateObjective, eligibleSessionKey, shouldApplyGoal,
  resumeActionFor, isOpenGoal, type SessionGoal,
} from '../goals'

// A chat's goal lives on the gateway session row; lib/goals reads it loosely and builds
// the exact request shapes the gateway validates (OpenClaw 2026.9.4, closed schemas).

const goal = (over: Partial<SessionGoal> = {}): SessionGoal => ({
  id: 'g1', objective: 'Ship v2', status: 'active', createdAt: 1_000, updatedAt: 1_000, tokensUsed: 0, ...over,
})

// A gateway rejection as gatewayClient.request throws it.
const rejection = (message: string, details?: Record<string, unknown>, code = 'INVALID_REQUEST') =>
  Object.assign(new Error(JSON.stringify({ code, message, details })), { gatewayError: { code, message, ...(details ? { details } : {}) } })

describe('parseGoal', () => {
  it('reads a full record', () => {
    const g = parseGoal({
      schemaVersion: 1, id: 'g1', objective: 'Ship v2', status: 'blocked', createdAt: 10, updatedAt: 20,
      tokenStart: 0, tokensUsed: 41200, tokenBudget: 50000, continuationTurns: 0, lastStatusNote: 'No key', blockedAt: 20,
    })
    expect(g).toEqual({
      id: 'g1', objective: 'Ship v2', status: 'blocked', createdAt: 10, updatedAt: 20,
      tokensUsed: 41200, tokenBudget: 50000, lastStatusNote: 'No key', blockedAt: 20,
    })
  })

  it('tolerates missing optional fields', () => {
    expect(parseGoal({ id: 'g1', objective: 'x', status: 'active', createdAt: 5 })).toEqual({
      id: 'g1', objective: 'x', status: 'active', createdAt: 5, updatedAt: 5, tokensUsed: 0,
    })
  })

  it('keeps an unknown status, which then reads as idle', () => {
    const g = parseGoal({ id: 'g1', objective: 'x', status: 'dreaming', createdAt: 1 })
    expect(g?.status).toBe('dreaming')
    expect(goalView(g, 1).tone).toBe('idle')
    expect(goalView(g, 1).label).toBe('Goal')
  })

  it('returns null for non-objects, null and incomplete records', () => {
    expect(parseGoal(null)).toBeNull()
    expect(parseGoal(undefined)).toBeNull()
    expect(parseGoal('goal')).toBeNull()
    expect(parseGoal([])).toBeNull()
    expect(parseGoal({ objective: 'x', status: 'active' })).toBeNull()
  })

  it('accepts a numeric-string timestamp', () => {
    expect(parseGoal({ id: 'g1', objective: 'x', status: 'active', createdAt: '1700000000000' })?.createdAt).toBe(1_700_000_000_000)
  })
})

describe('goalView', () => {
  it('maps every status to a label, tone and icon', () => {
    expect(goalView(null, 0)).toEqual({ label: 'Set goal', statusLabel: 'Set goal', tone: 'idle', icon: 'target' })
    expect(goalView(goal({ status: 'active' }), 1_000)).toMatchObject({ label: 'Pursuing · 0m', tone: 'working', icon: 'target' })
    expect(goalView(goal({ status: 'paused' }), 0)).toMatchObject({ label: 'Goal paused', tone: 'idle', icon: 'pause' })
    expect(goalView(goal({ status: 'blocked' }), 0)).toMatchObject({ label: 'Goal blocked', tone: 'needsYou', icon: 'alert' })
    expect(goalView(goal({ status: 'budget_limited' }), 0)).toMatchObject({ label: 'Budget reached', tone: 'needsYou', icon: 'gauge' })
    expect(goalView(goal({ status: 'usage_limited' }), 0)).toMatchObject({ label: 'Usage limit reached', tone: 'needsYou', icon: 'gauge' })
    expect(goalView(goal({ status: 'complete' }), 0)).toMatchObject({ label: 'Goal done', tone: 'done', icon: 'check' })
  })

  it('counts elapsed time from createdAt', () => {
    expect(goalView(goal({ createdAt: 0 }), 24 * 60_000).label).toBe('Pursuing · 24m')
    expect(goalView(goal({ createdAt: 0 }), 24 * 60_000).statusLabel).toBe('Pursuing')
  })
})

describe('formatElapsed', () => {
  it('formats minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0m')
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59m')
    expect(formatElapsed(60 * 60_000)).toBe('1h 0m')
    expect(formatElapsed((26 * 60 + 3) * 60_000)).toBe('26h 3m')
  })

  it('never goes negative (clock skew)', () => {
    expect(formatElapsed(-5_000)).toBe('0m')
  })
})

describe('availableActions', () => {
  const on = { idle: true, canWrite: true, online: true }
  const busy = { ...on, idle: false }

  it('active: the same set whether or not a reply is running (none of them runs a turn)', () => {
    expect(availableActions(goal({ status: 'active' }), on)).toEqual(['pause', 'edit', 'complete', 'clear'])
    expect(availableActions(goal({ status: 'active' }), busy)).toEqual(['pause', 'edit', 'complete', 'clear'])
  })

  it('paused: Resume only while idle', () => {
    expect(availableActions(goal({ status: 'paused' }), on)).toEqual(['resume', 'edit', 'complete', 'clear'])
    expect(availableActions(goal({ status: 'paused' }), busy)).toEqual(['edit', 'complete', 'clear'])
  })

  it('blocked: Continue leads, and goes while a reply runs', () => {
    expect(availableActions(goal({ status: 'blocked' }), on)[0]).toBe('continue')
    expect(availableActions(goal({ status: 'blocked' }), busy)).not.toContain('continue')
  })

  it('budget reached: Keep going', () => {
    expect(availableActions(goal({ status: 'budget_limited' }), on)[0]).toBe('keepGoing')
    expect(availableActions(goal({ status: 'usage_limited' }), on)[0]).toBe('keepGoing')
  })

  it('done is final: Start a new goal and Clear only', () => {
    expect(availableActions(goal({ status: 'complete' }), on)).toEqual(['startNew', 'clear'])
  })

  it('offers nothing offline, without write access, or with no goal', () => {
    expect(availableActions(goal(), { ...on, online: false })).toEqual([])
    expect(availableActions(goal(), { ...on, canWrite: false })).toEqual([])
    expect(availableActions(null, on)).toEqual([])
  })

  it('an unknown status can still be cleared', () => {
    expect(availableActions(goal({ status: 'dreaming' }), on)).toEqual(['clear'])
  })

  it('names the resume action per state', () => {
    expect(resumeActionFor(goal({ status: 'active' }))).toBeNull()
    expect(resumeActionFor(goal({ status: 'paused' }))).toBe('resume')
    expect(resumeActionFor(goal({ status: 'blocked' }))).toBe('continue')
    expect(resumeActionFor(goal({ status: 'budget_limited' }))).toBe('keepGoing')
  })
})

describe('buildStartParams', () => {
  it('builds a goal-start chat.send with no thinking', () => {
    const p = buildStartParams('agent:main:dashboard:1', 'Ship v2', 'op-1', 1234)
    expect(p).toEqual({
      sessionKey: 'agent:main:dashboard:1',
      message: 'Ship v2',
      idempotencyKey: 'op-1',
      intent: { kind: 'session-goal-start', version: 1, issuedAtMs: 1234 },
    })
    expect(p).not.toHaveProperty('thinking')
    expect(p).not.toHaveProperty('attachments')
  })

  it('rejects an empty or over-long objective', () => {
    expect(() => buildStartParams('k', '   ', 'op', 1)).toThrow()
    expect(() => buildStartParams('k', 'x'.repeat(16_001), 'op', 1)).toThrow(/16,000/)
    expect(() => buildStartParams('k', 'x'.repeat(16_000), 'op', 1)).not.toThrow()
  })

  it('normalises to NFC, so a decomposed é is sent composed', () => {
    const decomposed = 'Caf' + 'e' + String.fromCharCode(0x301)
    const p = buildStartParams('k', decomposed, 'op', 1)
    expect(p.message).toBe('Caf' + String.fromCharCode(0xe9))
  })
})

describe('validateObjective', () => {
  it('strips the control characters the gateway strips, keeping newlines and tabs', () => {
    const text = 'a' + String.fromCharCode(0) + 'b' + String.fromCharCode(0x1b) + '\n\tc' + String.fromCharCode(0x7f)
    expect(validateObjective(text)).toEqual({ ok: true, value: 'ab\n\tc' })
  })

  it('reports empty and too long', () => {
    expect(validateObjective('')).toEqual({ ok: false, error: 'empty' })
    expect(validateObjective('y'.repeat(16_001))).toEqual({ ok: false, error: 'tooLong' })
  })
})

describe('buildUpdateParams', () => {
  it('edit requires an objective', () => {
    expect(() => buildUpdateParams(goal(), 'k', 'edit', {}, 'op', 1)).toThrow()
    expect(buildUpdateParams(goal(), 'k', 'edit', { objective: ' New aim ' }, 'op', 1)).toEqual({
      sessionKey: 'k', goalId: 'g1', operationId: 'op', issuedAtMs: 1, action: 'edit', objective: 'New aim',
    })
  })

  it('omits an empty note, trims a note, and caps it at 2000', () => {
    expect(buildUpdateParams(goal(), 'k', 'pause', { note: '  ' }, 'op', 1)).toEqual({
      sessionKey: 'k', goalId: 'g1', operationId: 'op', issuedAtMs: 1, action: 'pause',
    })
    expect(buildUpdateParams(goal(), 'k', 'complete', { note: ' done ' }, 'op', 1).note).toBe('done')
    expect((buildUpdateParams(goal(), 'k', 'resume', { note: 'n'.repeat(2500) }, 'op', 1).note as string).length).toBe(2000)
  })

  it('Continue and Keep going are a resume on the wire', () => {
    expect(buildUpdateParams(goal(), 'k', 'continue', { note: 'key is in the vault' }, 'op', 1)).toMatchObject({ action: 'resume', note: 'key is in the vault' })
    expect(buildUpdateParams(goal(), 'k', 'keepGoing', {}, 'op', 1).action).toBe('resume')
  })

  it('clear carries identity only', () => {
    expect(buildClearParams(goal(), 'k', 'op', 1)).toEqual({ sessionKey: 'k', goalId: 'g1', operationId: 'op', issuedAtMs: 1 })
  })
})

describe('classifyGoalError', () => {
  it('reads the structured reason first', () => {
    expect(classifyGoalError(rejection('This session still has active or queued work…', { reason: 'goal-session-busy' }, 'UNAVAILABLE'))).toBe('busy')
    // chat.send prefixes the operation code with "goal-"; sessions.goal.* doesn't.
    expect(classifyGoalError(rejection('x', { reason: 'goal-goal-rebound' }))).toBe('rebound')
    expect(classifyGoalError(rejection('x', { code: 'GOAL_OPERATION_REJECTED', reason: 'goal-rebound' }))).toBe('rebound')
    expect(classifyGoalError(rejection('x', { code: 'GOAL_OPERATION_REJECTED', reason: 'session-rebound' }))).toBe('rebound')
    expect(classifyGoalError(rejection('x', { code: 'GOAL_OPERATION_REJECTED', reason: 'operation-conflict' }))).toBe('conflict')
    expect(classifyGoalError(rejection('x', { reason: 'goal-operation-conflict' }))).toBe('conflict')
    expect(classifyGoalError(rejection('Too many recent Goal operations', { reason: 'capacity' }))).toBe('generic')
  })

  it('falls back to the message text', () => {
    expect(classifyGoalError(rejection('Goal start or resume requires an idle local session with recoverable history. Finish current work…'))).toBe('ineligible')
    expect(classifyGoalError(rejection('Session changed or was removed; refresh its Goal.'))).toBe('rebound')
    expect(classifyGoalError(rejection('Session changed before its Goal update; retry.'))).toBe('rebound')
    expect(classifyGoalError(rejection('Goal is being admitted; retry the same request.', undefined, 'UNAVAILABLE'))).toBe('admitting')
    expect(classifyGoalError(rejection('goal already exists'))).toBe('rebound')
  })

  it('treats a request that never got an answer as a network error', () => {
    expect(classifyGoalError(new Error('Request sessions.goal.update timed out'))).toBe('network')
    expect(classifyGoalError(new Error('Disconnected'))).toBe('network')
    expect(classifyGoalError(new Error('Not connected'))).toBe('network')
  })

  it('anything else is generic', () => {
    expect(classifyGoalError(rejection('Goal operation time is invalid; refresh and try again.', { reason: 'invalid' }))).toBe('generic')
    expect(classifyGoalError('boom')).toBe('generic')
    expect(classifyGoalError(undefined)).toBe('generic')
  })
})

describe('eligibleSessionKey', () => {
  it('accepts ordinary chats and a new chat', () => {
    expect(eligibleSessionKey('agent:main:dashboard:0b1c')).toBe(true)
    expect(eligibleSessionKey('agent:main:main')).toBe(true)
    expect(eligibleSessionKey('')).toBe(true)
  })

  it('refuses sub-agent, cron, heartbeat, ACP and global sessions', () => {
    expect(eligibleSessionKey('agent:research:subagent:a6d1')).toBe(false)
    expect(eligibleSessionKey('agent:main:cron:77')).toBe(false)
    expect(eligibleSessionKey('agent:main:heartbeat')).toBe(false)
    expect(eligibleSessionKey('agent:main:acp:9')).toBe(false)
    expect(eligibleSessionKey('global')).toBe(false)
  })
})

describe('shouldApplyGoal', () => {
  it('writes over no goal, or a same-id goal at an older revision', () => {
    expect(shouldApplyGoal(null, goal())).toBe(true)
    expect(shouldApplyGoal(goal({ updatedAt: 5 }), goal({ updatedAt: 9 }))).toBe(true)
  })

  it('never lets a late reply overwrite a newer state or another goal', () => {
    expect(shouldApplyGoal(goal({ updatedAt: 9 }), goal({ updatedAt: 5 }))).toBe(false)
    expect(shouldApplyGoal(goal({ id: 'other' }), goal())).toBe(false)
  })
})

describe('isOpenGoal', () => {
  it('is any goal that is not done', () => {
    expect(isOpenGoal(goal({ status: 'paused' }))).toBe(true)
    expect(isOpenGoal(goal({ status: 'complete' }))).toBe(false)
    expect(isOpenGoal(null)).toBe(false)
  })
})
