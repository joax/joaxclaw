// QA (sprint 2026.9, PRD 02): sweeps over every gateway-shaped fixture, plus regressions for
// what the manual run against an isolated 2026.9.3/2026.9.4 gateway turned up.
// Checklist: docs/qa/sprint-2026-9/02-gateway-updates.md
import { describe, expect, it } from 'vitest'
import * as fx from './fixtures/sprint/gatewayUpdates'
import {
  bannerState, campaignCountdown, outcomeFromRun, parseRun, parseRunResponse, parseSchedule, parseUpdateAvailable,
  phaseProgress, refusalCopy, refusalFromRun, rpcErrorRefusal, isRunId, type BannerInputs,
} from '../gatewayUpdate'

const base: BannerInputs = { available: null, running: null, refusal: null, outcome: null, skipped: null, dismissedKey: null }
const gwErr = (frame: { error: unknown }) => Object.assign(new Error(JSON.stringify(frame.error)), { gatewayError: frame.error })

describe('QA 02 · every run record fixture parses and reports sensibly', () => {
  const records = [fx.runRequested, fx.runValidating, fx.runRestarting, fx.runRepairing, fx.runSucceeded, fx.runFailedAtVerifying,
    fx.runRolledBack, fx.runRefusedRestartDisabled, fx.runAlreadyCurrent, fx.runAbandoned, fx.runMinimal, fx.runOversize]

  it.each(records.map(r => [r.runId + ':' + r.status, r] as const))('%s', (_, rec) => {
    const run = parseRun(rec)
    expect(run).not.toBeNull()
    const p = phaseProgress(run)
    expect(p.completed).toBeLessThanOrEqual(p.total)
    // A running record never reports an outcome; a terminal one never throws.
    if (run!.status === 'running') expect(outcomeFromRun(run!)).toBeNull()
    else expect(() => outcomeFromRun(run!)).not.toThrow()
  })

  it('02-F3: a failed run names the version it was going to (not "the new version")', () => {
    const o = outcomeFromRun(parseRun(fx.runFailedAtVerifying)!)
    expect(o?.kind).toBe('failed')
    expect(o && 'target' in o ? o.target : undefined).not.toBe('the new version')
  })

  it('02-GC-2: a finished failed run shows the phase that failed from its steps, never "finished"', () => {
    const p = phaseProgress(parseRun(fx.runFailedAtVerifying))
    expect(p.phases.find(x => x.mark === 'failed')?.id).toBe('verifying')
    expect(p.phases.some(x => x.id === 'finished')).toBe(false)
  })

  it('02-GC-2: a rolled-back run marks a phase failed even though its step says completed', () => {
    const p = phaseProgress(parseRun(fx.runRolledBack))
    expect(p.phases.some(x => x.mark === 'failed')).toBe(true)
  })

  it('QA live: a refused (skipped) run shows no failed phase in History details', () => {
    // Recorded on the isolated 2026.9.3 gateway: update.run on a package install whose package
    // manager couldn't be detected. Validating is "skipped"; nothing failed.
    const refused = parseRun({
      runId: '796a6f46-396c-42d4-a6b6-077a41f260e8', createdAtMs: 1789756004785, updatedAtMs: 1789756005226, trigger: 'api',
      phase: 'finished', status: 'skipped', reason: 'not-git-install',
      target: { channel: 'stable', kind: 'package', version: '2026.9.4' }, before: { version: '2026.9.3' }, after: {},
      steps: [
        { step: 'requested', status: 'completed', startedAtMs: 1789756004785, endedAtMs: 1789756005075 },
        { step: 'driver:adopted', status: 'completed', endedAtMs: 1789756005073 },
        { step: 'staging', status: 'completed', startedAtMs: 1789756005075, endedAtMs: 1789756005224 },
        { step: 'validating', status: 'skipped', startedAtMs: 1789756005224, endedAtMs: 1789756005226 },
      ],
      verification: { booted: true, runningVersion: '2026.9.3', serviceRunning: true, versionMatch: false, pluginErrors: [] },
      repair: [], finishedAtMs: 1789756005226, downtimeMs: null,
    })!
    expect(phaseProgress(refused).phases.some(p => p.mark === 'failed')).toBe(false)
    expect(refusalFromRun(refused)).toEqual({ reason: 'not-git-install' })
  })
})

describe('QA 02 · update.run responses', () => {
  it('02-GC-4: already-current (ok:false) is the no-op, not a refusal', () => {
    expect(parseRunResponse(fx.runResponseAlreadyCurrent).kind).toBe('already-current')
  })
  it('02-GC-4: a started managed handoff (ok:true, result.status skipped) is started', () => {
    expect(parseRunResponse(fx.runResponseHandoffStarted).kind).toBe('started')
  })
  it('02-GC-5: every refusal response keeps its runId', () => {
    for (const r of [fx.runResponseRestartDisabled, fx.runResponseHandoffFailed, fx.runResponseCampaignApplying, fx.runResponseUnexpected]) {
      const p = parseRunResponse(r)
      expect(p.kind).toBe('refused')
      if ('runId' in r && r.runId) expect(p.runId).toBe(r.runId)
    }
  })
  it('02-A2: 2026.6.5 ok:true without a runId is started, with nothing to follow', () => {
    expect(parseRunResponse(fx.runResponse2026_6_5)).toEqual({ kind: 'started' })
  })
  it('QA live: not-git-install gets words and a way round, not the bare reason code', () => {
    const c = refusalCopy({ reason: 'not-git-install' })
    expect(c.text).not.toMatch(/not-git-install/)
    expect(c.action).toBe('command')
  })
  it('02-GC-10/11: rate limit, restart drain and errors map to the right refusal', () => {
    expect(rpcErrorRefusal(gwErr(fx.errRateLimitedRun)).reason).toBe('rate-limited')
    expect(rpcErrorRefusal(gwErr(fx.errRestartDraining)).reason).toBe('rpc-error')
    expect(refusalCopy(rpcErrorRefusal(gwErr(fx.errRestartDraining))).text).not.toMatch(/busy/i)
  })
})

describe('QA 02 · snapshots, schedules and banner precedence', () => {
  it('02-1: the 2026.6.5 snapshot and event reach the banner for any scope', () => {
    const a = parseUpdateAvailable(fx.helloSnapshot2026_6_5.updateAvailable)
    expect(a).not.toBeNull()
    expect(bannerState({ ...base, available: a }).kind).toBe('available')
    expect(parseUpdateAvailable((fx.evAvailable2026_6_5 as { updateAvailable: unknown }).updateAvailable)).not.toBeNull()
  })
  it('02-GC-8: a hold that has expired is not "held"', () => {
    const s = parseSchedule(fx.scheduleHeld)!
    const until = s.campaign!.holdUntilMs!
    expect(campaignCountdown(s, until - 1)?.kind).toBe('held')
    expect(campaignCountdown(s, until + 1)?.kind).not.toBe('held')
  })
  it('02-GC-12: a git campaign has no target version, and applying is running for every connection', () => {
    expect(parseSchedule(fx.scheduleDevGitCountdown)?.targetVersion).toBeUndefined()
    expect(bannerState({ ...base, schedule: parseSchedule(fx.scheduleApplying) }).kind).toBe('running')
  })
  it('02-B1.a: running beats a refusal, a result, a campaign and a notice; none of them can hide it', () => {
    const s = bannerState({
      ...base, available: parseUpdateAvailable(fx.availableFull), running: { own: true }, refusal: { reason: 'restart-disabled' },
      outcome: { kind: 'back-on', version: '2026.9.4' }, schedule: parseSchedule(fx.scheduleCountdown), dismissedKey: 'running',
    })
    expect(s.kind).toBe('running')
  })
  it('02-GC-11: isRunId accepts real ledger ids and rejects junk', () => {
    expect(isRunId(fx.RUN_IDS.failed)).toBe(true)
    expect(isRunId('not-a-uuid')).toBe(false)
  })
})
