import type { CronJob } from './types'

// The gateway declares some automations itself, from config rather than from the user:
// one skill-collection review per agent, per-agent heartbeats, memory-core dreaming.
// They arrive through cron.list like any other job, but carry a `declarationKey`
// naming the declaration that produced them:
//
//   skill-collection-review:main   heartbeat:power-assistant   memory-core:memory-dreaming-promotion
//
// Jobs the user created never have one. Since there is a review job per agent, these
// can easily outnumber the user's own automations — 13 of 21 on a live gateway — so
// the list hides them behind a toggle instead of burying the real ones.
export function isManagedJob(job: CronJob): boolean {
  return typeof job.declarationKey === 'string' && job.declarationKey.trim() !== ''
}
