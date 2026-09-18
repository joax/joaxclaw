import { describe, it, expect } from 'vitest'
import {
  campaignCountdown, formatClock, formatHm, formatWhen, triggerLabel, resultLabel, versionLine, verificationChecks, failureMarkdown,
  parseReportPreview, parseReportResult, parseRun, parseSchedule, bannerState, bannerTone, type BannerInputs,
} from '../gatewayUpdate'
import {
  NOW_MS, RUN_IDS, UPDATE_RUN_TRIGGERS, scheduleCountdown, scheduleWaiting, scheduleHeld, scheduleCountdownAfterHold, scheduleApplying,
  scheduleNoCampaign, scheduleDevGitCountdown, availableFull, runFailedAtVerifying, runSucceeded, runRolledBack, runMinimal,
  reportPreviewReady, reportSubmitCreated, reportSubmitFallback, reportSubmitPending, reportSubmitDuplicate, reportSubmitDuplicateNoLink,
} from './fixtures/sprint/gatewayUpdates'

// Automatic-update campaigns and the update history (PRD 02-c), against the QA fixtures
// (OpenClaw 2026.9.4 shapes). A campaign has no "held" state: a hold is waiting-for-idle
// with holdUntilMs in the future, and holdUntilMs stays set after it passes.

const sched = (s: unknown) => parseSchedule(s)

describe('campaignCountdown', () => {
  it('counts down to applyAtMs', () => {
    const c = campaignCountdown(sched(scheduleCountdown), NOW_MS)
    expect(c).toEqual({ kind: 'countdown', ms: 48_000 })
    expect(formatClock((c as { ms: number }).ms)).toBe('0:48')
    expect(formatClock((campaignCountdown(sched(scheduleCountdown), NOW_MS + 1000) as { ms: number }).ms)).toBe('0:47')
  })

  it('waits for the forced deadline', () => {
    const c = campaignCountdown(sched(scheduleWaiting), NOW_MS)
    expect(c?.kind).toBe('waiting')
    expect(formatClock((c as { ms: number }).ms)).toBe('13:00')
  })

  it('a hold in the future wins over waiting-for-idle', () => {
    expect(campaignCountdown(sched(scheduleHeld), NOW_MS)).toEqual({ kind: 'held', untilMs: scheduleHeld.campaign!.holdUntilMs })
  })

  it('an expired hold is just a countdown again', () => {
    expect(campaignCountdown(sched(scheduleCountdownAfterHold), NOW_MS + 3_600_001)?.kind).toBe('countdown')
  })

  it('clamps past times to 0:00, and shows nothing while applying or with no campaign', () => {
    expect(formatClock((campaignCountdown(sched(scheduleCountdown), NOW_MS + 60_000) as { ms: number }).ms)).toBe('0:00')
    expect(formatClock(-5)).toBe('0:00')
    expect(formatClock(75 * 60_000)).toBe('75:00')
    expect(campaignCountdown(sched(scheduleApplying), NOW_MS)).toBeNull()
    expect(campaignCountdown(sched(scheduleNoCampaign), NOW_MS)).toBeNull()
  })

  it('formats local times', () => {
    expect(formatHm(new Date(2026, 8, 18, 9, 5).getTime())).toBe('09:05')
    const now = new Date(2026, 8, 18, 12, 0).getTime()
    expect(formatWhen(new Date(2026, 8, 18, 9, 12).getTime(), now)).toBe('Today 09:12')
    expect(formatWhen(new Date(2026, 8, 11, 2, 0).getTime(), now)).toBe('Sep 11 02:00')
  })
})

describe('bannerState with a campaign', () => {
  const base: BannerInputs = { available: availableFull, running: null, refusal: null, outcome: null, skipped: null, dismissedKey: null, now: NOW_MS }

  it('campaign beats available, and result beats campaign', () => {
    expect(bannerState({ ...base, schedule: sched(scheduleCountdown) })).toMatchObject({ kind: 'campaign', target: '2026.9.5', countdown: { kind: 'countdown' } })
    expect(bannerState({ ...base, schedule: sched(scheduleCountdown), outcome: { kind: 'ok', version: '2026.9.5' } }).kind).toBe('result')
    expect(bannerState({ ...base, schedule: sched(scheduleCountdown), refusal: { reason: 'x' } }).kind).toBe('refused')
  })

  it('held shows as held, and Hold stays used after it expires', () => {
    expect(bannerState({ ...base, schedule: sched(scheduleHeld) })).toMatchObject({ kind: 'campaign', countdown: { kind: 'held' }, holdUsed: true })
    expect(bannerState({ ...base, schedule: sched(scheduleCountdownAfterHold), now: NOW_MS + 3_600_001 })).toMatchObject({ countdown: { kind: 'countdown' }, holdUsed: true })
    expect(bannerState({ ...base, schedule: sched(scheduleWaiting) })).toMatchObject({ holdUsed: false })
  })

  it('applying is running for every connection, as an update started elsewhere', () => {
    expect(bannerState({ ...base, schedule: sched(scheduleApplying) })).toMatchObject({ kind: 'running', own: false, target: '2026.9.5' })
    // Dismissed or skipped: still running.
    expect(bannerState({ ...base, schedule: sched(scheduleApplying), dismissedKey: 'running', skipped: '2026.9.5' }).kind).toBe('running')
  })

  it('a failed apply clears the campaign, and the banner leaves running', () => {
    expect(bannerState({ ...base, schedule: sched(scheduleNoCampaign) }).kind).toBe('available')
  })

  it('Dismiss holds for the whole campaign', () => {
    const key = (bannerState({ ...base, schedule: sched(scheduleCountdown) }) as { key: string }).key
    expect(bannerState({ ...base, schedule: sched(scheduleHeld), dismissedKey: key }).kind).toBe('hidden')
  })

  it('a git target has no version: it falls back to the notice', () => {
    expect(bannerState({ ...base, available: null, schedule: sched(scheduleDevGitCountdown) })).toMatchObject({ kind: 'campaign' })
    expect((bannerState({ ...base, available: null, schedule: sched(scheduleDevGitCountdown) }) as { target?: string }).target).toBeUndefined()
  })

  it('countdown needs you; held is idle', () => {
    expect(bannerTone(bannerState({ ...base, schedule: sched(scheduleCountdown) }))).toBe('needsYou')
    expect(bannerTone(bannerState({ ...base, schedule: sched(scheduleWaiting) }))).toBe('needsYou')
    expect(bannerTone(bannerState({ ...base, schedule: sched(scheduleHeld) }))).toBe('idle')
  })
})

describe('history labels', () => {
  it('names every trigger, and our own runs whatever the trigger says', () => {
    const labels = UPDATE_RUN_TRIGGERS.map(t => triggerLabel(t, 'x', []))
    expect(labels).toEqual(['From a chat', 'Control UI', 'Command line', 'Automatic', 'Mac app', 'App or API'])
    expect(triggerLabel('api', RUN_IDS.ours, [RUN_IDS.ours])).toBe('JoaxClaw')
    // update.run adopting a campaign records the run as "campaign".
    expect(triggerLabel('campaign', RUN_IDS.ours, [RUN_IDS.ours])).toBe('JoaxClaw')
    expect(triggerLabel('webhook', 'x', [])).toBe('webhook')
  })

  it('labels results', () => {
    expect(['running', 'succeeded', 'failed', 'rolled-back', 'skipped'].map(resultLabel)).toEqual(['Running', 'Succeeded', 'Failed', 'Rolled back', 'Skipped'])
  })

  it('writes the version line', () => {
    expect(versionLine(parseRun(runSucceeded)!)).toBe('2026.9.4 → 2026.9.5')
    // Rolled back: `after` is back where it started, so the line names the version it aimed at.
    expect(versionLine(parseRun(runRolledBack)!)).toBe('2026.9.2 → 2026.9.3')
    expect(versionLine(parseRun(runMinimal)!)).toBe('—')
  })
})

describe('verificationChecks', () => {
  it('maps the checks, with plugin errors counted', () => {
    expect(verificationChecks(parseRun(runFailedAtVerifying)!.verification)).toEqual([
      { label: 'Service', value: 'Passed' },
      { label: 'Version', value: 'Passed' },
      { label: 'Plugins', value: 'Failed', note: '1 error' },
      { label: 'Channels', value: 'Passed' },
      { label: 'Ready', value: 'Failed' },
    ])
    expect(verificationChecks(parseRun(runSucceeded)!.verification).every(c => c.value === 'Passed')).toBe(true)
    expect(verificationChecks({}).every(c => c.value === 'Not checked')).toBe(true)
  })
})

describe('failureMarkdown', () => {
  const md = failureMarkdown(parseRun(runFailedAtVerifying)!, 'JoaxClaw')

  it('has the versions, who started it, the reason and the run', () => {
    expect(md).toContain('2026.9.4 → 2026.9.5')
    expect(md).toContain('**Started by:** JoaxClaw')
    expect(md).toContain('`post-update-verification-failed`')
    expect(md).toContain(RUN_IDS.failed)
  })

  it('lists the failed steps with their detail, escaping backticks', () => {
    expect(md).toContain('- `verifying`')
    expect(md).toContain('- `plugin load`: Exit code: 1; Error: Cannot find module "./dist/index.js" \\`joaxclaw-fs\\`')
  })

  it('lists the checks, the plugin errors and the repair attempts', () => {
    expect(md).toContain('- Plugins: Failed (1 error)')
    expect(md).toContain('joaxclaw-fs: failed to load')
    expect(md).toContain('- #1 failed: Reinstall plugin joaxclaw-fs (npm ERR! 404)')
  })
})

describe('update.report', () => {
  it('reads a ready preview, and nothing else as one', () => {
    const ready = reportPreviewReady as { title: string; body: string; previewDigest: string }
    expect(parseReportPreview(reportPreviewReady)).toEqual({ attemptId: RUN_IDS.failed, title: ready.title, body: ready.body, previewDigest: ready.previewDigest })
    expect(parseReportPreview(reportSubmitCreated)).toBeNull()
    expect(parseReportPreview(null)).toBeNull()
  })

  it('reads every submit result, keeping only http(s) links', () => {
    expect(parseReportResult(reportSubmitCreated)).toEqual({ status: 'created', url: 'https://github.com/openclaw/openclaw/issues/48213' })
    expect(parseReportResult(reportSubmitFallback)).toMatchObject({ status: 'fallback', fallbackUrl: expect.stringMatching(/^https:/) })
    expect(parseReportResult(reportSubmitPending)).toMatchObject({ status: 'pending', message: expect.any(String) })
    expect(parseReportResult(reportSubmitDuplicate)).toMatchObject({ status: 'duplicate', url: expect.any(String) })
    expect(parseReportResult(reportSubmitDuplicateNoLink)).toEqual({ status: 'duplicate', message: 'This failure was already reported.' })
    expect(parseReportResult({ status: 'created', url: 'javascript:alert(1)' })).toEqual({ status: 'created' })
  })
})
