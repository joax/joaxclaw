import { describe, it, expect } from 'vitest'
import { isManagedJob } from '../managedJobs'
import type { CronJob } from '../types'

const base = (over: Partial<CronJob>): CronJob => ({
  id: 'x',
  name: 'job',
  enabled: true,
  schedule: { kind: 'cron', expr: '0 3 * * *' },
  sessionTarget: 'isolated',
  wakeMode: 'now',
  state: {},
  ...over,
} as CronJob)

describe('isManagedJob', () => {
  // Keys observed on a live 2026.8 gateway.
  it('flags gateway-declared automations by their declarationKey', () => {
    expect(isManagedJob(base({ declarationKey: 'skill-collection-review:main' }))).toBe(true)
    expect(isManagedJob(base({ declarationKey: 'heartbeat:power-assistant' }))).toBe(true)
    expect(isManagedJob(base({ declarationKey: 'memory-core:memory-dreaming-promotion' }))).toBe(true)
  })

  it('leaves user-created jobs alone', () => {
    expect(isManagedJob(base({ name: 'vault-sync' }))).toBe(false)
    expect(isManagedJob(base({ declarationKey: undefined }))).toBe(false)
  })

  // configRevision is present on EVERY job, managed or not, so it must not be
  // mistaken for the marker.
  it('does not key off configRevision, which every job carries', () => {
    expect(isManagedJob(base({ configRevision: 'sha256:abc' } as Partial<CronJob>))).toBe(false)
  })

  it('treats an empty or blank key as not managed', () => {
    expect(isManagedJob(base({ declarationKey: '' }))).toBe(false)
    expect(isManagedJob(base({ declarationKey: '   ' }))).toBe(false)
  })

  it('splits a real gateway list into 8 user jobs and 13 managed', () => {
    const jobs = [
      ...['vault-sync', 'inbox-processing-and-summary', 'nightly-cleanup-sessions',
          'nightly-prune-recalls', 'nightly-workspace-cleanup', 'calla-ventures-research',
          'investor-associate-analysis', 'QA ModRest Dev'].map(name => base({ name })),
      ...['main', 'coder-worker', 'research-worker', 'personal-assistant', 'power-assistant',
          'ui-ux-designer', 'email-calendar-worker', 'document-review-worker',
          'visual-analyzer', 'golf-web-content-worker', 'golf-instagram-worker']
        .map(a => base({ name: `skill-collection-review-${a}`, declarationKey: `skill-collection-review:${a}` })),
      base({ name: 'heartbeat-power-assistant', declarationKey: 'heartbeat:power-assistant' }),
      base({ name: 'Memory Dreaming Promotion', declarationKey: 'memory-core:memory-dreaming-promotion' }),
    ]
    expect(jobs.filter(isManagedJob)).toHaveLength(13)
    expect(jobs.filter(j => !isManagedJob(j))).toHaveLength(8)
  })
})
