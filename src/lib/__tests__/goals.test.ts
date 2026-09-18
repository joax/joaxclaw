import { describe, it, expect } from 'vitest'
import {
  parseGoal, goalView, formatElapsed, availableActions, buildStartParams, buildUpdateParams,
  buildClearParams, classifyGoalError, validateObjective, eligibleSessionKey, shouldApplyGoal,
  resumeActionFor, isOpenGoal, goalErrorPolicy, goalErrorCopy, goalErrorMessage, noteIsOurs, goalRefreshNeeded, type SessionGoal,
} from '../goals'
import {
  goalErrors, asAppGatewayError, APP_NETWORK_ERROR_MESSAGES, NOW, SESSION_KEY, OP_START, OP_PAUSE, OP_RESUME, OP_EDIT, OP_CLEAR,
  goalActive, goalMinimal, goalPaused, goalBlocked, goalBudgetLimited, goalUsageLimited, goalComplete, looseGoalInputs,
  startParams, pauseParams, continueParams, editParams, clearParams, continueAck, pauseResultReplayed,
  OBJECTIVE_NFD, OBJECTIVE_NFC, OBJECTIVE_WITH_CONTROL_CHAR, OBJECTIVE_16000, OBJECTIVE_16001,
  rowSubagentWithGoal, rowCronKey, rowHeartbeatKey, rowWithGoal,
  sessionsChangedRunEndBlocked, sessionsChangedGoalCleared, sessionsChangedGlobalNoGoal, sessionsChangedCoalesced,
} from './fixtures/sprint/chatGoals'

// A chat's goal lives on the gateway session row; lib/goals reads it loosely and builds
// the exact request shapes the gateway validates (OpenClaw 2026.9.4, closed schemas).

const goal = (over: Partial<SessionGoal> = {}): SessionGoal => ({
  id: 'g1', objective: 'Ship v2', status: 'active', createdAt: 1_000, updatedAt: 1_000, tokensUsed: 0, ...over,
})

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

describe('classifyGoalError (2026.9.4 error frames)', () => {
  const cls = (e: Parameters<typeof asAppGatewayError>[0]) => classifyGoalError(asAppGatewayError(e))

  it('busy, ineligible and admitting', () => {
    expect(cls(goalErrors.busy)).toBe('busy')
    expect(cls(goalErrors.ineligible)).toBe('ineligible')
    expect(cls(goalErrors.admitting)).toBe('admitting')
  })

  it('every form of "the goal or session changed" is a rebound', () => {
    for (const e of [
      goalErrors.goalRebound,              // sessions.goal.*: details.code + bare reason
      goalErrors.sessionRebound,
      goalErrors.chatPathSessionRebound,   // chat.send path: "goal-" prefix, no details.code
      goalErrors.sessionRemoved,           // message only
      goalErrors.sessionChangedBeforeUpdate,
      goalErrors.resumeGoalReboundViaTurn, // UNAVAILABLE "SessionGoalOperationError: …"
      goalErrors.startGoalAlreadyExists,
      goalErrors.invalidTransition,        // "goal is already complete"
    ]) expect(cls(e)).toBe('rebound')
  })

  it('an operation id reused for another request is a conflict, on both paths', () => {
    expect(cls(goalErrors.operationConflict)).toBe('conflict')
    expect(cls(goalErrors.chatPathOperationConflict)).toBe('conflict')
  })

  it('expired, clock skew, capacity and missing scope each have their own class', () => {
    expect(cls(goalErrors.expired)).toBe('expired')
    expect(cls(goalErrors.invalidTime)).toBe('clock')
    expect(cls(goalErrors.capacity)).toBe('capacity')
    expect(cls(goalErrors.missingWriteScope)).toBe('scope')
  })

  it('anything else is generic, and never throws', () => {
    for (const e of [goalErrors.unexpected, goalErrors.startOverride, goalErrors.startInvalid, goalErrors.invalidParamsNoteTooLong, goalErrors.unknownMethod_2026_6_5, goalErrors.intentUnsupported_2026_6_5]) {
      expect(cls(e)).toBe('generic')
    }
    expect(classifyGoalError('boom')).toBe('generic')
    expect(classifyGoalError(undefined)).toBe('generic')
  })

  it('reads a plain error-frame object as well as the app Error', () => {
    expect(classifyGoalError({ gatewayError: goalErrors.goalRebound })).toBe('rebound')
    expect(classifyGoalError(goalErrors.busy)).toBe('busy')
  })

  it('treats a request that never got an answer as a network error', () => {
    for (const m of APP_NETWORK_ERROR_MESSAGES) expect(classifyGoalError(new Error(m))).toBe('network')
  })

  it('reports the message without the JSON wrapping or the error-class prefix', () => {
    expect(goalErrorMessage(asAppGatewayError(goalErrors.unexpected))).toBe('Unable to update the Goal; retry the request.')
    expect(goalErrorMessage(asAppGatewayError(goalErrors.resumeGoalReboundViaTurn))).toBe('Goal changed or was cleared; refresh before trying again.')
  })
})

describe('goalErrorPolicy', () => {
  const fresh = { admitting: false, conflict: false }
  const app = asAppGatewayError

  it('resends a request the gateway is still admitting, once', () => {
    expect(goalErrorPolicy(app(goalErrors.admitting), fresh).next).toBe('resend')
    expect(goalErrorPolicy(app(goalErrors.admitting), { ...fresh, admitting: true })).toMatchObject({ next: 'stop', retryable: true })
  })

  it('gives a conflicting operation a new id, once', () => {
    expect(goalErrorPolicy(app(goalErrors.operationConflict), fresh).next).toBe('reissue')
    expect(goalErrorPolicy(app(goalErrors.chatPathOperationConflict), { ...fresh, conflict: true })).toMatchObject({ next: 'stop', retryable: false })
  })

  it('keeps an unanswered or retry-me request for an unchanged Retry', () => {
    expect(goalErrorPolicy(new Error('Disconnected'), fresh)).toMatchObject({ next: 'stop', retryable: true, cls: 'network' })
    expect(goalErrorPolicy(app(goalErrors.unexpected), fresh).retryable).toBe(true)
  })

  it('drops a definite refusal, and re-reads the row when the goal changed elsewhere', () => {
    expect(goalErrorPolicy(app(goalErrors.busy), fresh)).toMatchObject({ next: 'stop', refresh: false, retryable: false })
    expect(goalErrorPolicy(app(goalErrors.ineligible), fresh).retryable).toBe(false)
    expect(goalErrorPolicy(app(goalErrors.expired), fresh).retryable).toBe(false)
    expect(goalErrorPolicy(app(goalErrors.capacity), fresh).retryable).toBe(false)
    expect(goalErrorPolicy(app(goalErrors.startInvalid), fresh).retryable).toBe(false)
    expect(goalErrorPolicy(app(goalErrors.sessionRemoved), fresh)).toMatchObject({ refresh: true, retryable: false })
  })
})

describe('goalErrorCopy', () => {
  it('has plain copy for every class', () => {
    const copy = (cls: Parameters<typeof goalErrorCopy>[0]['cls']) => goalErrorCopy({ cls, message: 'x' })
    expect(copy('busy')).toBe('The chat is still working. Try again when the reply finishes.')
    expect(copy('ineligible')).toBe('Goals need an idle chat whose history the gateway can recover. Start a new chat to set a goal.')
    expect(copy('rebound')).toBe("The goal changed somewhere else. Here's the latest.")
    expect(copy('generic')).toBe("Couldn't update the goal: x")
    for (const c of ['network', 'expired', 'clock', 'capacity', 'scope'] as const) {
      expect(copy(c)).not.toContain('x')
      expect(copy(c).length).toBeGreaterThan(10)
    }
  })
})

describe('noteIsOurs', () => {
  it("tells the operator's own Continue note from the agent's", () => {
    const g = parseGoal(continueAck.goal)!
    expect(noteIsOurs(g, ['The key is in the vault now.'])).toBe(true)
    expect(noteIsOurs(parseGoal(goalBlocked)!, ['The key is in the vault now.'])).toBe(false)
    expect(noteIsOurs(parseGoal(goalBlocked)!, undefined)).toBe(false)
  })
})

describe('fixtures: goal shapes from 2026.9.4', () => {
  it('parses every status and tolerates the loose inputs', () => {
    for (const g of [goalActive, goalMinimal, goalPaused, goalBlocked, goalBudgetLimited, goalUsageLimited, goalComplete]) {
      expect(parseGoal(g)?.id).toBe(g.id)
    }
    expect(parseGoal(looseGoalInputs.nullValue)).toBeNull()
    expect(parseGoal(looseGoalInputs.string)).toBeNull()
    expect(parseGoal(looseGoalInputs.array)).toBeNull()
    expect(parseGoal(looseGoalInputs.missingId)).toBeNull()
    expect(goalView(parseGoal(looseGoalInputs.unknownStatus), NOW).tone).toBe('idle')
    expect(parseGoal(looseGoalInputs.numericStringTimestamps)?.createdAt).toBe(goalActive.createdAt)
    expect(parseGoal(looseGoalInputs.futureSchemaVersion)?.status).toBe('active')
  })

  it('builds the exact params the gateway expects', () => {
    expect(buildStartParams(SESSION_KEY, 'Ship v2', OP_START, NOW)).toEqual(startParams)
    const g = parseGoal(goalActive)!
    expect(buildUpdateParams(g, SESSION_KEY, 'pause', {}, OP_PAUSE, NOW)).toEqual(pauseParams)
    expect(buildUpdateParams(g, SESSION_KEY, 'continue', { note: 'The key is in the vault now.' }, OP_RESUME, NOW)).toEqual(continueParams)
    expect(buildUpdateParams(g, SESSION_KEY, 'edit', { objective: editParams.action === 'edit' ? editParams.objective : '' }, OP_EDIT, NOW)).toEqual(editParams)
    expect(buildClearParams(g, SESSION_KEY, OP_CLEAR, NOW)).toEqual(clearParams)
  })

  it('a retry rebuilds byte-identical start params', () => {
    const a = JSON.stringify(buildStartParams(SESSION_KEY, 'Ship v2', OP_START, NOW))
    const b = JSON.stringify(buildStartParams(SESSION_KEY, 'Ship v2', OP_START, NOW))
    expect(a).toBe(b)
  })

  it('normalises the NFD objective and strips the control character', () => {
    expect(validateObjective(OBJECTIVE_NFD)).toEqual({ ok: true, value: OBJECTIVE_NFC })
    expect(validateObjective(OBJECTIVE_WITH_CONTROL_CHAR)).toEqual({ ok: true, value: 'Ship v2now' })
    expect(validateObjective(OBJECTIVE_16000).ok).toBe(true)
    expect(validateObjective(OBJECTIVE_16001).ok).toBe(false)
  })

  it('refuses the fixture sub-agent, cron and heartbeat keys', () => {
    expect(eligibleSessionKey(rowSubagentWithGoal.key)).toBe(false)
    expect(eligibleSessionKey(rowCronKey.key)).toBe(false)
    expect(eligibleSessionKey(rowHeartbeatKey.key)).toBe(false)
    expect(eligibleSessionKey(rowWithGoal.key)).toBe(true)
  })

  it('a replayed or late result never overwrites a newer row goal', () => {
    const newer = parseGoal({ ...goalActive, status: 'blocked', updatedAt: NOW + 10_000 })
    expect(shouldApplyGoal(newer, parseGoal(pauseResultReplayed.goal)!)).toBe(false)
  })

  it('the Done summary numbers come from the goal', () => {
    const g = parseGoal(goalComplete)!
    expect(formatElapsed((g.completedAt ?? g.updatedAt) - g.createdAt)).toBe('2h 10m')
    expect(g.tokensUsed.toLocaleString('en-US')).toBe('188,400')
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

describe('goalRefreshNeeded', () => {
  it('re-reads once when no run-end snapshot came and the goal has not moved', () => {
    expect(goalRefreshNeeded(goal({ updatedAt: 5 }), goal({ updatedAt: 5 }), false)).toBe(true)
    // The agent may have created a goal on a chat that had none.
    expect(goalRefreshNeeded(null, null, false)).toBe(true)
  })

  it('does nothing once the run-end snapshot or a newer goal arrived', () => {
    expect(goalRefreshNeeded(goal({ updatedAt: 5 }), goal({ updatedAt: 5 }), true)).toBe(false)
    expect(goalRefreshNeeded(goal({ updatedAt: 5 }), goal({ updatedAt: 9, status: 'complete' }), false)).toBe(false)
    expect(goalRefreshNeeded(goal(), null, false)).toBe(false)
    expect(goalRefreshNeeded(null, goal(), false)).toBe(false)
    expect(goalRefreshNeeded(goal(), goal({ id: 'g2' }), false)).toBe(false)
  })

  it('leaves a done goal alone', () => {
    expect(goalRefreshNeeded(goal({ status: 'complete' }), goal({ status: 'complete' }), false)).toBe(false)
  })
})

describe('fixtures: sessions.changed carries the goal', () => {
  // store/sessions merges payloads whole ({...row, ...payload}); these check what that merge sees.
  const merge = (row: Record<string, unknown>, p: Record<string, unknown>) => ({ ...row, ...p })
  const row = { key: SESSION_KEY, goal: goalActive }

  it("the run-end snapshot brings the agent's blocked goal", () => {
    expect(parseGoal(merge(row, sessionsChangedRunEndBlocked as unknown as Record<string, unknown>).goal)?.status).toBe('blocked')
  })

  it('goal:null clears it, and a payload without a goal key leaves it', () => {
    expect(parseGoal(merge(row, sessionsChangedGoalCleared as unknown as Record<string, unknown>).goal)).toBeNull()
    expect(parseGoal(merge(row, sessionsChangedGlobalNoGoal as unknown as Record<string, unknown>).goal)?.id).toBe(goalActive.id)
  })

  it('applies whatever the reason', () => {
    expect(parseGoal(merge({ key: SESSION_KEY }, sessionsChangedCoalesced as unknown as Record<string, unknown>).goal)?.status).toBe('active')
  })
})
