import { describe, it, expect } from 'vitest'
import { isReminderJob, sessionKeyOfJob, reminderForSession, reminderBySession, fmtCountdown, REMINDER_NAME } from '../reminders'
import type { CronJob } from '../types'

const base = (over: Partial<CronJob>): CronJob => ({
  id: 'j1', name: REMINDER_NAME, enabled: true, deleteAfterRun: true,
  schedule: { kind: 'at', at: '2026-07-01T12:00:00.000Z' },
  sessionTarget: 'session:agent:abc', sessionKey: 'agent:abc',
  payload: { kind: 'agentTurn', message: 'check the build' },
  state: { nextRunAtMs: 1_800_000_000_000 },
  ...over,
} as CronJob)

describe('isReminderJob', () => {
  it('accepts a one-shot deleteAfterRun agentTurn named Reminder', () => {
    expect(isReminderJob(base({}))).toBe(true)
  })
  it('rejects non-reminders', () => {
    expect(isReminderJob(base({ name: 'Nightly digest' }))).toBe(false)
    expect(isReminderJob(base({ deleteAfterRun: false }))).toBe(false)
    expect(isReminderJob(base({ schedule: { kind: 'every', everyMs: 1000 } }))).toBe(false)
    expect(isReminderJob(base({ enabled: false }))).toBe(false)
    expect(isReminderJob(base({ payload: { kind: 'systemEvent' } as CronJob['payload'] }))).toBe(false)
  })
})

describe('sessionKeyOfJob', () => {
  it('prefers explicit sessionKey, else parses session: target', () => {
    expect(sessionKeyOfJob(base({}))).toBe('agent:abc')
    expect(sessionKeyOfJob(base({ sessionKey: undefined, sessionTarget: 'session:agent:xyz' }))).toBe('agent:xyz')
    expect(sessionKeyOfJob(base({ sessionKey: undefined, sessionTarget: 'main' }))).toBeUndefined()
  })
})

describe('reminderForSession / reminderBySession', () => {
  it('finds the reminder targeting a session and its fire time + prompt', () => {
    const jobs = [base({ id: 'r1', sessionKey: 'agent:abc' }), base({ id: 'other', name: 'Nightly' })]
    const r = reminderForSession(jobs, 'agent:abc')
    expect(r?.jobId).toBe('r1')
    expect(r?.fireAtMs).toBe(1_800_000_000_000)
    expect(r?.prompt).toBe('check the build')
    expect(reminderForSession(jobs, 'agent:none')).toBeUndefined()
  })
  it('keeps one reminder per session', () => {
    const map = reminderBySession([base({ id: 'r1' }), base({ id: 'r2' })])
    expect(map.size).toBe(1)
    expect(map.get('agent:abc')?.jobId).toBe('r2')
  })
})

describe('fmtCountdown', () => {
  const now = 1_000_000_000_000
  it('formats relative time', () => {
    expect(fmtCountdown(now + 34_000, now)).toBe('34s')
    expect(fmtCountdown(now + 5 * 60_000, now)).toBe('5m')
    expect(fmtCountdown(now + (2 * 3600 + 10 * 60) * 1000, now)).toBe('2h 10m')
    expect(fmtCountdown(now + 3 * 86400_000, now)).toBe('3d')
    expect(fmtCountdown(now - 5000, now)).toBe('now')
    expect(fmtCountdown(undefined, now)).toBe('')
  })
})
