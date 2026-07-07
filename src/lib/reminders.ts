import type { CronJob } from './types'

// A "reminder" is a one-shot session turn the model scheduled for itself via the
// joaxclaw-fs `reminder_set` tool. It surfaces to the app as a cron job (the session
// turn scheduler is cron-backed), tagged with this name + one-shot + deleteAfterRun,
// so we can show a "waiting for a reminder" alarm and let the user cancel it too.
// Keep this marker in sync with REMINDER_NAME in plugins/joaxclaw-fs/index.js.
export const REMINDER_NAME = 'Reminder'

export interface PendingReminder {
  jobId: string
  sessionKey?: string
  fireAtMs?: number
  prompt?: string
}

// The session a cron job targets: explicit sessionKey, or a "session:<key>" target.
export function sessionKeyOfJob(job: CronJob): string | undefined {
  if (job.sessionKey) return job.sessionKey
  if (typeof job.sessionTarget === 'string' && job.sessionTarget.startsWith('session:')) {
    return job.sessionTarget.slice('session:'.length)
  }
  return undefined
}

export function isReminderJob(job: CronJob): boolean {
  return job.enabled !== false
    && job.name === REMINDER_NAME
    && job.schedule?.kind === 'at'
    && job.deleteAfterRun === true
    && job.payload?.kind === 'agentTurn'
}

function fireAtOf(job: CronJob): number | undefined {
  if (job.state?.nextRunAtMs) return job.state.nextRunAtMs
  if (job.schedule?.kind === 'at' && job.schedule.at) {
    const t = Date.parse(job.schedule.at)
    return Number.isNaN(t) ? undefined : t
  }
  return undefined
}

// All pending reminders, keyed by target session (last one wins — one per session).
export function reminderBySession(jobs: CronJob[]): Map<string, PendingReminder> {
  const out = new Map<string, PendingReminder>()
  for (const j of jobs) {
    if (!isReminderJob(j)) continue
    const sessionKey = sessionKeyOfJob(j)
    if (!sessionKey) continue
    out.set(sessionKey, {
      jobId: j.id, sessionKey, fireAtMs: fireAtOf(j),
      prompt: j.payload?.kind === 'agentTurn' ? j.payload.message : undefined,
    })
  }
  return out
}

export function reminderForSession(jobs: CronJob[], sessionKey: string): PendingReminder | undefined {
  return reminderBySession(jobs).get(sessionKey)
}

// The cron job a session belongs to — from live run events (cronSessions) or a job that
// explicitly targets the session. Reminder jobs are excluded: their target is a normal
// chat being pinged, not a cron-run session, so it should stay labelled as that chat.
export function cronJobForSession(
  jobs: CronJob[],
  cronSessions: Record<string, string>,
  sessionKey: string,
): CronJob | undefined {
  const jobId = cronSessions[sessionKey]
  if (jobId) {
    const j = jobs.find(x => x.id === jobId)
    if (j && !isReminderJob(j)) return j
  }
  return jobs.find(j => !isReminderJob(j) && sessionKeyOfJob(j) === sessionKey)
}

// Compact countdown to a fire time: "34s", "5m", "2h 10m", "3d", or "now".
export function fmtCountdown(fireAtMs?: number, nowMs = Date.now()): string {
  if (!fireAtMs) return ''
  const s = Math.round((fireAtMs - nowMs) / 1000)
  if (s <= 0) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h` }
  return `${Math.round(s / 86400)}d`
}
