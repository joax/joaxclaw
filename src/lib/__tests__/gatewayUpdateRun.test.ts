import { describe, it, expect } from 'vitest'
import {
  parseRun, parseRunChanged, mergeRunChanged, phaseProgress, runTone, runTarget, outcomeFromRun, formatDowntime,
  outcomeText, rememberSeen, bannerState, bannerTone, type UpdateRun,
} from '../gatewayUpdate'

// Following an update run (PRD 02-b). The record's shape is OpenClaw 2026.9.4's
// UpdateRunRecordSchema; the ledger records each phase as a step named after it, and a
// finished run always has phase "finished" (finishUpdateRunRecord).

const RUN_ID = '11111111-2222-4333-8444-555555555555'

const wire = (over: Record<string, unknown> = {}) => ({
  runId: RUN_ID,
  createdAtMs: 1000,
  updatedAtMs: 2000,
  trigger: 'api',
  phase: 'validating',
  status: 'running',
  reason: null,
  origin: { doctorHint: 'openclaw doctor' },
  target: { channel: 'stable', kind: 'package', version: '2026.9.5' },
  before: { version: '2026.9.4' },
  after: {},
  steps: [
    { step: 'requested', status: 'completed' },
    { step: 'staging', status: 'completed' },
    { step: 'validating', status: 'in_progress', startedAtMs: 1500 },
  ],
  verification: { serviceRunning: true, runningVersion: '2026.9.4', pid: 42 },
  repair: [],
  confirmedAtMs: null,
  finishedAtMs: null,
  downtimeMs: null,
  ...over,
})

const run = (over: Record<string, unknown> = {}) => parseRun(wire(over)) as UpdateRun

describe('parseRun', () => {
  it('reads a record', () => {
    const r = run()
    expect(r.runId).toBe(RUN_ID)
    expect(r.phase).toBe('validating')
    expect(r.target).toEqual({ channel: 'stable', kind: 'package', version: '2026.9.5' })
    expect(r.before).toEqual({ version: '2026.9.4' })
    expect(r.steps).toHaveLength(3)
    expect(r.verification).toEqual({ serviceRunning: true, runningVersion: '2026.9.4' })
  })

  it('reads a minimal record', () => {
    const r = parseRun({ runId: 'x', phase: 'requested', status: 'running' })
    expect(r).toMatchObject({ runId: 'x', trigger: 'api', steps: [], repair: [], before: {}, after: {}, downtimeMs: null })
  })

  it('keeps unknown phases and statuses as strings', () => {
    const r = parseRun({ runId: 'x', phase: 'teleporting', status: 'paused' })
    expect(r?.phase).toBe('teleporting')
    expect(phaseProgress(r).currentLabel).toBe('Teleporting')
    expect(runTone('paused')).toBe('idle')
  })

  it('caps steps and drops malformed ones', () => {
    const steps = Array.from({ length: 200 }, (_, i) => ({ step: `s${i}`, status: 'completed' }))
    expect(parseRun(wire({ steps: [...steps, { status: 'x' }, 7] }))?.steps).toHaveLength(128)
  })

  it('is null without a runId, phase or status', () => {
    expect(parseRun(null)).toBeNull()
    expect(parseRun({ phase: 'x', status: 'running' })).toBeNull()
    expect(parseRun({ runId: 'x', status: 'running' })).toBeNull()
  })

  it('keeps the next action and the repair attempts', () => {
    const r = run({ origin: { nextAction: 'Run openclaw doctor' }, repair: [{ attempt: 1, status: 'failed', startedAtMs: 1, summary: 'no luck' }] })
    expect(r.nextAction).toBe('Run openclaw doctor')
    expect(r.repair).toEqual([{ attempt: 1, status: 'failed', summary: 'no luck' }])
  })
})

describe('run.changed events', () => {
  it('parses the event', () => {
    expect(parseRunChanged({ runId: RUN_ID, phase: 'activating', status: 'running', updatedAtMs: 5 })).toEqual({ runId: RUN_ID, phase: 'activating', status: 'running', updatedAtMs: 5 })
    expect(parseRunChanged({ runId: RUN_ID })).toBeNull()
  })

  it('folds into the record, never backwards', () => {
    const r = run()
    expect(mergeRunChanged(r, { runId: RUN_ID, phase: 'activating', status: 'running', updatedAtMs: 3000 })).toMatchObject({ phase: 'activating', steps: r.steps })
    expect(mergeRunChanged(r, { runId: RUN_ID, phase: 'staging', status: 'running', updatedAtMs: 1500 })).toBe(r)
  })

  it('starts a stub for a run first seen through an event', () => {
    const stub = mergeRunChanged(null, { runId: 'other', phase: 'staging', status: 'running', updatedAtMs: 9 })
    expect(stub).toMatchObject({ runId: 'other', phase: 'staging', steps: [], target: {} })
  })
})

describe('phaseProgress', () => {
  it('is indeterminate before anything is known', () => {
    const p = phaseProgress(null)
    expect(p.pct).toBeNull()
    expect(p.currentLabel).toBe('Requested')
    expect(`${p.completed}/${p.total}`).toBe('0/5')
  })

  it('requested is 0/5', () => {
    const p = phaseProgress({ phase: 'requested', status: 'running' })
    expect(`${p.completed}/${p.total}`).toBe('0/5')
    expect(p.pct).toBe(0)
    expect(p.phases.every(x => x.mark === 'pending')).toBe(true)
  })

  it('validating is 1/5 with Validating current', () => {
    const p = phaseProgress({ phase: 'validating', status: 'running' })
    expect(`${p.completed}/${p.total}`).toBe('1/5')
    expect(p.phases.find(x => x.mark === 'current')?.label).toBe('Validating')
    expect(p.currentLabel).toBe('Validating')
  })

  it('reads the phase steps when there are some', () => {
    const p = phaseProgress(run())
    expect(p.phases.map(x => x.mark)).toEqual(['done', 'current', 'pending', 'pending', 'pending'])
  })

  it('repairing inserts a sixth phase', () => {
    const p = phaseProgress({ phase: 'repairing', status: 'running' })
    expect(p.total).toBe(6)
    expect(p.phases.map(x => x.id)).toEqual(['staging', 'validating', 'repairing', 'activating', 'restarting', 'verifying'])
    expect(p.phases.find(x => x.mark === 'current')?.id).toBe('repairing')
  })

  it('a repair after verification goes after Verifying', () => {
    const steps = ['staging', 'validating', 'activating', 'restarting', 'verifying'].map(step => ({ step, status: 'completed' }))
    const p = phaseProgress({ phase: 'repairing', status: 'running', steps: [...steps, { step: 'repairing', status: 'in_progress' }] })
    expect(p.phases.map(x => x.id).slice(-2)).toEqual(['verifying', 'repairing'])
  })

  it('finished and succeeded is 5/5', () => {
    const p = phaseProgress({ phase: 'finished', status: 'succeeded' })
    expect(`${p.completed}/${p.total}`).toBe('5/5')
    expect(p.pct).toBe(100)
  })

  it('failed at verifying marks Verifying failed', () => {
    expect(phaseProgress({ phase: 'verifying', status: 'failed' }).phases.find(x => x.id === 'verifying')?.mark).toBe('failed')
    // The ledger's own shape: phase "finished", the phase's step marked failed.
    const steps = [
      ...['staging', 'validating', 'activating', 'restarting'].map(step => ({ step, status: 'completed' })),
      { step: 'verifying', status: 'failed' },
    ]
    const p = phaseProgress({ phase: 'finished', status: 'rolled-back', steps })
    expect(p.phases.map(x => x.mark)).toEqual(['done', 'done', 'done', 'done', 'failed'])
    expect(`${p.completed}/${p.total}`).toBe('4/5')
  })
})

describe('run outcomes', () => {
  it('maps statuses to tones', () => {
    expect(runTone('running')).toBe('working')
    expect(runTone('succeeded')).toBe('done')
    expect(runTone('failed')).toBe('failed')
    expect(runTone('rolled-back')).toBe('failed')
    expect(runTone('skipped')).toBe('idle')
  })

  it('names the target', () => {
    expect(runTarget(run())).toBe('2026.9.5')
    expect(runTarget({ target: { sha: 'abcdef1234567' }, after: {} })).toBe('abcdef1')
    expect(runTarget({ target: {}, after: {} })).toBeUndefined()
  })

  it('reports success with the version and downtime', () => {
    const o = outcomeFromRun(run({ phase: 'finished', status: 'succeeded', after: { version: '2026.9.5' }, downtimeMs: 38_000 }))
    expect(o).toEqual({ kind: 'ok', version: '2026.9.5', downtimeMs: 38_000, runId: RUN_ID })
    expect(outcomeText(o!)).toBe('Gateway updated to 2026.9.5 · down for 38s.')
  })

  it('reports a failure and a rollback with the version it stayed on', () => {
    const failed = outcomeFromRun(run({ phase: 'finished', status: 'failed' }))
    expect(failed).toEqual({ kind: 'failed', target: '2026.9.5', before: '2026.9.4', runId: RUN_ID })
    expect(outcomeText(failed!)).toBe('The update to 2026.9.5 failed. The gateway is still on 2026.9.4.')
    const back = outcomeFromRun(run({ phase: 'finished', status: 'rolled-back' }))
    expect(outcomeText(back!)).toBe("The update to 2026.9.5 didn't pass its checks and was rolled back to 2026.9.4.")
    expect(bannerTone(bannerState({ available: null, running: null, refusal: null, outcome: back, skipped: null, dismissedKey: null }))).toBe('failed')
  })

  it('treats no-op skips as nothing to report, and other skips as failures', () => {
    expect(outcomeFromRun(run({ status: 'skipped', reason: 'already-current' }))).toMatchObject({ kind: 'already-current', version: '2026.9.4' })
    expect(outcomeFromRun(run({ status: 'skipped', reason: 'cancelled' }))).toBeNull()
    expect(outcomeFromRun(run({ status: 'skipped', reason: 'restart-disabled' }))).toMatchObject({ kind: 'failed' })
    expect(outcomeFromRun(run())).toBeNull()
  })

  it('falls back to what we knew when the record is a bare stub', () => {
    const stub = mergeRunChanged(null, { runId: 'x', phase: 'finished', status: 'failed', updatedAtMs: 1 })
    expect(outcomeFromRun(stub, { target: '2026.9.5' })).toEqual({ kind: 'failed', target: '2026.9.5', runId: 'x' })
  })
})

describe('formatDowntime', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDowntime(38_000)).toBe('38s')
    expect(formatDowntime(64_000)).toBe('1m 04s')
    expect(formatDowntime(3_720_000)).toBe('1h 02m')
    expect(formatDowntime(null)).toBe('')
    expect(formatDowntime(undefined)).toBe('')
  })
})

describe('rememberSeen', () => {
  it('keeps the newest, capped, without duplicates', () => {
    expect(rememberSeen(['a', 'b'], 'a')).toEqual(['b', 'a'])
    expect(rememberSeen(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd'])
  })
})
