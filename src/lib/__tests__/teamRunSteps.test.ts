import { describe, it, expect } from 'vitest'
import { describeRun, fmtElapsed, stepStatuses, type RunLike } from '../teamRunSteps'

const NOW = 1_700_000_000_000
const run = (over: Partial<RunLike> = {}): RunLike => ({
  status: 'running', stepsDone: 0, startedAt: NOW - 90_000, ...over,
})
const steps = [
  { role: 'Scout', agentId: 'research-worker' },
  { role: 'Analyst', agentId: 'research-worker' },
  { role: 'Recorder', agentId: 'power-assistant' },
]

describe('stepStatuses', () => {
  it('marks what is done, what is running, and what is waiting', () => {
    const s = stepStatuses(run({ stepsDone: 1 }), 3, NOW)
    expect(s[0].state).toBe('done')
    expect(s[1].state).toBe('active')
    expect(s[2].state).toBe('waiting')
  })

  it('lights the first step at the very start of a run', () => {
    expect(stepStatuses(run({ stepsDone: 0 }), 3, NOW)[0].state).toBe('active')
  })

  it('marks every step done when the run finished', () => {
    const s = stepStatuses(run({ status: 'done', stepsDone: 3 }), 3, NOW)
    expect([s[0].state, s[1].state, s[2].state]).toEqual(['done', 'done', 'done'])
  })

  it('puts the failure on the step that was running, and carries its reason', () => {
    const s = stepStatuses(run({ status: 'error', stepsDone: 1, error: 'rate limited' }), 3, NOW)
    expect(s[0].state).toBe('done')
    expect(s[1]).toEqual({ state: 'failed', note: 'rate limited' })
    expect(s[2].state).toBe('waiting')
  })

  it('wraps a looping team instead of leaving every step done', () => {
    // A branch can send the flow back to an earlier step, so stepsDone exceeds the step
    // count on the second pass. Clamping would freeze the sequence on "all done" while
    // the team was visibly still working.
    const s = stepStatuses(run({ stepsDone: 4 }), 3, NOW)
    expect(s[0].state).toBe('done')
    expect(s[1].state).toBe('active')
    expect(s[2].state).toBe('waiting')
  })

  it('times the active step from the run start', () => {
    expect(stepStatuses(run({ stepsDone: 0 }), 3, NOW)[0].timing).toBe('1m 30s')
  })

  it('shows nothing for a launch that has not started yet', () => {
    // teams.launchPrompt records an ATTEMPT with status 'idle' when an agent asks for a
    // team's prompt. Until it spawns the team lead no step has run, and marking them all
    // done would claim work that never happened.
    expect(stepStatuses(run({ status: 'idle', stepsDone: 0 }), 3, NOW)).toEqual({})
  })

  it('is empty without a run, or for a team with no steps', () => {
    expect(stepStatuses(undefined, 3, NOW)).toEqual({})
    expect(stepStatuses(run(), 0, NOW)).toEqual({})
  })
})

describe('describeRun', () => {
  it('names the step in the team’s own words', () => {
    expect(describeRun(run({ stepsDone: 1 }), steps)).toBe('Running — step 2 of 3, Analyst')
  })

  it('wraps with the sequence on a later pass', () => {
    expect(describeRun(run({ stepsDone: 3 }), steps)).toBe('Running — step 1 of 3, Scout')
  })

  it('falls back to the agent id when a step has no role', () => {
    expect(describeRun(run({ stepsDone: 0 }), [{ agentId: 'main' }])).toBe('Running — step 1 of 1, main')
  })

  it('reports a failure with its reason', () => {
    expect(describeRun(run({ status: 'error', error: 'rate limited' }), steps)).toBe('Failed — rate limited')
  })

  it('is null when there is nothing to say', () => {
    expect(describeRun(undefined, steps)).toBeNull()
    expect(describeRun(run({ status: 'idle' }), steps)).toBeNull()
  })
})

describe('fmtElapsed', () => {
  it('reads as a duration', () => {
    expect(fmtElapsed(38_000)).toBe('38s')
    expect(fmtElapsed(252_000)).toBe('4m 12s')
    expect(fmtElapsed(60_000)).toBe('1m 00s')
  })

  it('is empty for nothing sensible to show', () => {
    expect(fmtElapsed(undefined)).toBe('')
    expect(fmtElapsed(-1)).toBe('')
    expect(fmtElapsed(NaN)).toBe('')
  })
})
