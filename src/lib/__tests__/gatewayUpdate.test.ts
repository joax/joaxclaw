import { describe, it, expect } from 'vitest'
import {
  buildGatewayUpdatePrompt, parseUpdateAvailable, parseSchedule, parseRunResponse, rpcErrorRefusal, refusalCopy,
  inferOutcome, bannerState, bannerTone, showChannel, runningChatsLine, isClientTimeout, runStartedSince, parseRun, outcomeText, type BannerInputs,
} from '../gatewayUpdate'
import {
  REFUSAL_REASONS, runResponse2026_6_5, errRestartDraining, errRateLimitedRun, NOW_MS, RUN_IDS, runValidating, runSucceeded, runRolledBack, runAbandoned,
} from './fixtures/sprint/gatewayUpdates'

describe('buildGatewayUpdatePrompt', () => {
  it('emits the hardened update script', async () => {
    const { ok, prompt } = await buildGatewayUpdatePrompt()
    expect(ok).toBe(true)
    const p = prompt ?? ''
    // Real, hardened commands.
    expect(p).toContain('set -e')
    expect(p).toContain('openclaw update --yes --no-restart')
    expect(p).toContain('openclaw gateway restart')
  })

  it('defers the restart so the agent turn finishes before the gateway drops', async () => {
    const { prompt } = await buildGatewayUpdatePrompt()
    const p = prompt ?? ''
    // Update must skip its own restart, and the restart we trigger is detached + delayed.
    expect(p).toContain('--no-restart')
    expect(p).toMatch(/nohup sh -c 'sleep \d+; openclaw gateway restart'/)
  })
})

// ── Updating the gateway directly (PRD 02) ──────────────────────────────────────────
// Shapes follow the OpenClaw 2026.9.4 protocol schemas: UpdateAvailableSchema,
// UpdateScheduleStateSchema and UpdateRunResultSchema.

describe('parseUpdateAvailable', () => {
  it('reads the full shape a read-capable client gets', () => {
    const wire = { currentVersion: '2026.9.4', latestVersion: '2026.9.5', channel: 'dev', currentSha: 'abc', commitsBehind: 3, commits: [{ sha: 'a1b2c3d4', subject: 'fix' }] }
    expect(parseUpdateAvailable(wire)).toEqual({ currentVersion: '2026.9.4', latestVersion: '2026.9.5', channel: 'dev', commitsBehind: 3, commits: [{ sha: 'a1b2c3d4', subject: 'fix' }] })
  })

  it('reads the reduced shape a client without operator.read gets', () => {
    expect(parseUpdateAvailable({ currentVersion: '1', latestVersion: '2', channel: 'stable' })).toEqual({ currentVersion: '1', latestVersion: '2', channel: 'stable' })
  })

  it('is null for null or garbage', () => {
    expect(parseUpdateAvailable(null)).toBeNull()
    expect(parseUpdateAvailable(undefined)).toBeNull()
    expect(parseUpdateAvailable('x')).toBeNull()
    expect(parseUpdateAvailable({ currentVersion: '1' })).toBeNull()
    expect(parseUpdateAvailable({ currentVersion: '', latestVersion: '2' })).toBeNull()
  })
})

describe('parseSchedule', () => {
  it('reads a schedule with no campaign', () => {
    expect(parseSchedule({ channel: 'stable', autoEnabled: false })).toEqual({ channel: 'stable', autoEnabled: false })
  })

  it('reads each campaign state', () => {
    for (const state of ['waiting-for-idle', 'countdown', 'applying'] as const) {
      const s = parseSchedule({ channel: 'beta', autoEnabled: true, target: { kind: 'package', version: '2026.9.5' }, campaign: { id: 'c1', state, announcedAtMs: 1, forceAtMs: 900, applyAtMs: 60, updatedAtMs: 1 } })
      expect(s?.campaign?.state).toBe(state)
      expect(s?.targetVersion).toBe('2026.9.5')
    }
  })

  it('keeps a hold', () => {
    const s = parseSchedule({ channel: 'beta', autoEnabled: true, campaign: { id: 'c1', state: 'waiting-for-idle', announcedAtMs: 1, holdUntilMs: 5000, forceAtMs: 9000, updatedAtMs: 1 } })
    expect(s?.campaign).toEqual({ id: 'c1', state: 'waiting-for-idle', holdUntilMs: 5000, forceAtMs: 9000 })
  })

  it('drops an unreadable campaign but keeps the schedule', () => {
    expect(parseSchedule({ autoEnabled: true, campaign: { id: 'c', state: 'weird', forceAtMs: 1 } })).toEqual({ autoEnabled: true })
    expect(parseSchedule(null)).toBeNull()
  })
})

describe('parseRunResponse', () => {
  it('a managed-service handoff is a started run', () => {
    const res = { runId: 'r1', ok: true, result: { status: 'skipped', reason: 'managed-service-handoff-started', steps: [] }, handoff: { status: 'started', command: 'openclaw update --yes --json' } }
    expect(parseRunResponse(res)).toEqual({ kind: 'started', runId: 'r1' })
  })

  it('already-current is a no-op, not a refusal', () => {
    expect(parseRunResponse({ runId: 'r1', ok: false, result: { status: 'skipped', reason: 'already-current' } })).toEqual({ kind: 'already-current', runId: 'r1' })
  })

  it('ok:false with a reason is a refusal, carrying the handoff command', () => {
    const res = { runId: 'r2', ok: false, result: { status: 'skipped', reason: 'managed-service-handoff-unavailable' }, handoff: { status: 'unavailable', command: 'openclaw update --yes', message: 'Run it yourself' } }
    expect(parseRunResponse(res)).toEqual({ kind: 'refused', runId: 'r2', refusal: { reason: 'managed-service-handoff-unavailable', message: 'Run it yourself', command: 'openclaw update --yes' } })
  })

  it('owner_required comes as a code', () => {
    expect(parseRunResponse({ runId: 'r3', ok: false, code: 'owner_required', message: 'Only the owner', result: { status: 'error' } }))
      .toEqual({ kind: 'refused', runId: 'r3', refusal: { reason: 'owner_required', message: 'Only the owner' } })
  })

  it('2026.6.5 starts a handoff without a runId', () => {
    expect(parseRunResponse(runResponse2026_6_5)).toEqual({ kind: 'started' })
  })

  it('an unreadable reply is an unknown refusal', () => {
    expect(parseRunResponse(null)).toEqual({ kind: 'refused', refusal: { reason: 'unknown' } })
  })
})

describe('rpcErrorRefusal', () => {
  it('reads the rate limit', () => {
    const err = Object.assign(new Error('x'), { gatewayError: { code: 'UNAVAILABLE', message: 'rate limit', retryAfterMs: 12_300 } })
    expect(rpcErrorRefusal(err)).toEqual({ reason: 'rate-limited', message: '13' })
    expect(refusalCopy(rpcErrorRefusal(err)).text).toBe('The gateway is busy. Try again in 13s.')
  })

  it("uses the gateway's message, else the error's", () => {
    expect(rpcErrorRefusal(Object.assign(new Error('{}'), { gatewayError: { code: 'INVALID_REQUEST', message: 'bad params' } }))).toEqual({ reason: 'rpc-error', message: 'bad params' })
    expect(rpcErrorRefusal(new Error('Request update.run timed out'))).toEqual({ reason: 'rpc-error', message: 'Request update.run timed out' })
  })

  it("doesn't call the restart drain a rate limit", () => {
    const err = Object.assign(new Error('x'), { gatewayError: errRestartDraining.error })
    expect(rpcErrorRefusal(err)).toEqual({ reason: 'rpc-error', message: 'The gateway is restarting. Try again in a moment.' })
  })
})

// QA A8: our 15 min timer running out is not the gateway's verdict on the run.
describe('isClientTimeout', () => {
  it("is our own timer on update.run, not the gateway's reply", () => {
    expect(isClientTimeout(new Error('Request update.run timed out'))).toBe(true)
    expect(isClientTimeout('Request update.run timed out')).toBe(true)
  })

  it('a gateway error reply, a drop, or another call timing out is not', () => {
    expect(isClientTimeout(Object.assign(new Error('Request update.run timed out'), { gatewayError: errRestartDraining.error }))).toBe(false)
    expect(isClientTimeout(Object.assign(new Error('x'), { gatewayError: errRateLimitedRun.error }))).toBe(false)
    expect(isClientTimeout(new Error('Connection closed'))).toBe(false)
    expect(isClientTimeout(new Error('Request update.status timed out'))).toBe(false)
    expect(isClientTimeout(new Error('Request update.status timed out'), 'update.status')).toBe(true)
    expect(isClientTimeout(null)).toBe(false)
  })
})

describe('runStartedSince', () => {
  const runs = [runValidating, runSucceeded, runRolledBack, runAbandoned].map(r => parseRun(r)!)
  const T0 = NOW_MS - 60_000

  it('picks the newest run created since the click (a minute of clock slack)', () => {
    expect(runStartedSince(runs, T0)?.runId).toBe(RUN_IDS.ours)
    expect(runStartedSince(runs, T0 + 45_000)?.runId).toBe(RUN_IDS.ours)
  })

  it('is null when the ledger has nothing that new', () => {
    expect(runStartedSince(runs, T0 + 5 * 60_000)).toBeNull()
    expect(runStartedSince([], T0)).toBeNull()
  })

  it("doesn't depend on the list's order", () => {
    const older = { ...runs[0], runId: RUN_IDS.cli, createdAtMs: T0 - 30_000 }
    expect(runStartedSince([older, runs[0]], T0)?.runId).toBe(RUN_IDS.ours)
    expect(runStartedSince([runs[0], older], T0)?.runId).toBe(RUN_IDS.ours)
  })
})

describe('the unconfirmed outcome', () => {
  it('is neutral, not a failure', () => {
    const s = bannerState({ available: null, running: null, refusal: null, outcome: { kind: 'unconfirmed', target: '2026.9.5' }, skipped: null, dismissedKey: null })
    expect(s).toMatchObject({ kind: 'result', key: 'result:unconfirmed:2026.9.5' })
    expect(bannerTone(s)).toBe('idle')
    expect(outcomeText({ kind: 'unconfirmed' })).toBe('The update may still be running — check the Gateway tab.')
  })
})

describe('refusalCopy', () => {
  it('covers every refusal the gateway sends', () => {
    expect(refusalCopy({ reason: 'external-supervisor-update-required' })).toMatchObject({ action: 'none', text: expect.stringMatching(/outside supervisor/) })
    expect(refusalCopy({ reason: 'restart-disabled' })).toMatchObject({ action: 'none', text: expect.stringMatching(/restarts are turned off/) })
    expect(refusalCopy({ reason: 'restart-unavailable' }).text).toBe(refusalCopy({ reason: 'restart-disabled' }).text)
    expect(refusalCopy({ reason: 'managed-service-handoff-unavailable', command: 'openclaw update --yes' })).toMatchObject({ action: 'command', command: 'openclaw update --yes' })
    expect(refusalCopy({ reason: 'managed-service-handoff-unavailable' }).command).toBe('openclaw update')
    expect(refusalCopy({ reason: 'managed-service-handoff-already-running' }).text).toBe('Another update is already running. Wait for it to finish.')
    expect(refusalCopy({ reason: 'update-campaign-applying' }).text).toBe('An automatic update is already being applied.')
    for (const reason of ['not-openclaw-root', 'unsupported_git_channel', 'update-target-campaign-mismatch', 'unexpected-error']) {
      expect(refusalCopy({ reason })).toEqual({ action: 'viaAgent', text: `The gateway refused the update (${reason}).` })
    }
  })

  it('gives the reasons the PRD missed their own copy', () => {
    expect(refusalCopy({ reason: 'managed-service-handoff-failed' })).toMatchObject({ action: 'command', command: 'openclaw update' })
    expect(refusalCopy({ reason: 'owner_required' })).toEqual({ action: 'none', text: "Only the gateway's owner can start an update." })
    expect(refusalCopy({ reason: 'invalid-update-target' }).action).toBe('command')
    expect(refusalCopy({ reason: 'unsupported-update-target' }).action).toBe('command')
    expect(refusalCopy({ reason: 'update-target-upstream-mismatch' }).text).toMatch(/different branch/)
  })

  it('has words for every reason the 2026.9.4 handler can return', () => {
    for (const reason of REFUSAL_REASONS) {
      const copy = refusalCopy({ reason })
      expect(copy.text.length).toBeGreaterThan(10)
      expect(copy.text).toMatch(/[.:]$/)
    }
  })

  it('falls back to the reason code for anything unknown', () => {
    expect(refusalCopy({ reason: 'brand-new-reason' })).toEqual({ action: 'viaAgent', text: 'The gateway refused the update (brand-new-reason).' })
  })
})

describe('inferOutcome', () => {
  it('is success when the gateway came back on the target', () => {
    expect(inferOutcome('2026.9.5', '2026.9.5')).toEqual({ kind: 'ok', version: '2026.9.5' })
  })

  it('is only "back on" otherwise', () => {
    expect(inferOutcome('2026.9.4', '2026.9.5')).toEqual({ kind: 'back-on', version: '2026.9.4' })
    expect(inferOutcome('2026.9.4', undefined)).toEqual({ kind: 'back-on', version: '2026.9.4' })
    expect(inferOutcome(undefined, '2026.9.5')).toBeNull()
  })
})

describe('bannerState', () => {
  const available = { currentVersion: '2026.9.4', latestVersion: '2026.9.5' }
  const base: BannerInputs = { available, running: null, refusal: null, outcome: null, skipped: null, dismissedKey: null }

  it('is hidden with nothing to say', () => {
    expect(bannerState({ ...base, available: null }).kind).toBe('hidden')
  })

  it('running beats refused beats result beats available', () => {
    const all: BannerInputs = { ...base, running: { target: '2026.9.5' }, refusal: { reason: 'restart-disabled' }, outcome: { kind: 'ok', version: '2026.9.5' } }
    expect(bannerState(all).kind).toBe('running')
    expect(bannerState({ ...all, running: null }).kind).toBe('refused')
    expect(bannerState({ ...all, running: null, refusal: null }).kind).toBe('result')
    expect(bannerState({ ...all, running: null, refusal: null, outcome: null }).kind).toBe('available')
  })

  it('Skip hides the notice for that version only, never running', () => {
    expect(bannerState({ ...base, skipped: '2026.9.5' }).kind).toBe('hidden')
    expect(bannerState({ ...base, skipped: '2026.9.3' }).kind).toBe('available')
    expect(bannerState({ ...base, skipped: '2026.9.5', running: {} }).kind).toBe('running')
  })

  it('Dismiss hides the state it was pressed on, never running', () => {
    const shown = bannerState(base)
    expect(shown.kind).toBe('available')
    const key = (shown as { key: string }).key
    expect(bannerState({ ...base, dismissedKey: key }).kind).toBe('hidden')
    expect(bannerState({ ...base, dismissedKey: key, running: {} }).kind).toBe('running')
    // A newer version, or a new state such as a result, shows again.
    expect(bannerState({ ...base, dismissedKey: key, available: { ...available, latestVersion: '2026.9.6' } }).kind).toBe('available')
    expect(bannerState({ ...base, dismissedKey: key, outcome: { kind: 'back-on', version: '2026.9.4' } }).kind).toBe('result')
  })

  it('maps states to tones', () => {
    expect(bannerTone(bannerState(base))).toBe('working')
    expect(bannerTone(bannerState({ ...base, refusal: { reason: 'x' } }))).toBe('failed')
    expect(bannerTone(bannerState({ ...base, outcome: { kind: 'ok', version: '1' } }))).toBe('done')
    expect(bannerTone(bannerState({ ...base, outcome: { kind: 'back-on', version: '1' } }))).toBe('idle')
  })
})

describe('copy helpers', () => {
  it('names only the non-default channels', () => {
    expect(showChannel('stable')).toBe(false)
    expect(showChannel(undefined)).toBe(false)
    expect(showChannel('beta')).toBe(true)
  })

  it('counts running chats', () => {
    expect(runningChatsLine(0)).toBeNull()
    expect(runningChatsLine(1)).toBe('1 chat is running now.')
    expect(runningChatsLine(2)).toBe('2 chats are running now.')
  })
})
