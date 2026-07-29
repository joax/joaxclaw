import { useEffect, useRef } from 'react'
import { useProcessesStore } from '../store/processes'
import { useTeamsStore } from '../store/teams'
import { useCronsStore } from '../store/crons'
import { reminderBySession, isReminderJob } from './reminders'
import { notify, notifyPreview, notificationsSupported } from './notifications'

// Watches the stores for transitions worth a local notification (runs finishing,
// reminders firing). Agent replies are handled at their completion site in the chat
// store; this covers the events that don't surface as a streamed reply here. Diffs
// against the previous snapshot and seeds on first pass so nothing already-finished
// notifies on mount. No-ops entirely when notifications aren't supported (Electron).
export function useNotificationsWatcher() {
  const runs        = useProcessesStore(s => s.runs)
  const processes   = useProcessesStore(s => s.processes)
  const blueprints  = useTeamsStore(s => s.blueprints)
  const cronJobs    = useCronsStore(s => s.jobs)

  const seeded         = useRef(false)
  const prevRunStatus  = useRef<Record<string, string>>({})
  const prevReminder   = useRef<Record<string, number>>({})

  // ── Runs: running → done/error ──────────────────────────────────────────────
  useEffect(() => {
    if (!notificationsSupported()) return
    const teamIds = new Set(blueprints.map(b => b.id))
    const prev = prevRunStatus.current
    const next: Record<string, string> = {}

    for (const [id, run] of Object.entries(runs)) {
      next[id] = run.status
      if (!seeded.current) continue
      const was = prev[id]
      const isTerminal = run.status === 'done' || run.status === 'error'
      if (was === 'running' && isTerminal) {
        const isTeam = teamIds.has(run.processId)
        const name = (isTeam ? blueprints.find(b => b.id === run.processId)?.name : processes.find(p => p.id === run.processId)?.name) || run.processId
        void notify({
          title: run.status === 'error' ? `${isTeam ? 'Team' : 'Process'} failed` : `${isTeam ? 'Team' : 'Process'} finished`,
          body: name,
          tag: `run:${run.processId}`,
          navigate: { section: isTeam ? 'teams' : 'processes' },
        })
      }
    }
    prevRunStatus.current = next
  }, [runs, processes, blueprints])

  // ── Reminders: a one-shot self-ping fired (its lastRunAtMs advanced) ─────────
  useEffect(() => {
    if (!notificationsSupported()) return
    const reminders = reminderBySession(cronJobs)
    const prev = prevReminder.current
    const next: Record<string, number> = {}

    for (const job of cronJobs) {
      const last = job.state?.lastRunAtMs
      if (last == null) continue
      next[job.id] = last
      if (!seeded.current || !isReminderJob(job)) continue
      if (prev[job.id] != null && last > prev[job.id]) {
        const rem = [...reminders.values()].find(r => r.jobId === job.id)
        void notify({
          title: 'Reminder',
          body: rem?.prompt ? notifyPreview(rem.prompt) : 'A reminder fired',
          tag: `reminder:${job.id}`,
          navigate: { section: 'chat' },
        })
      }
    }
    prevReminder.current = next
  }, [cronJobs])

  // Flip the seed flag after the first snapshot of both is recorded.
  useEffect(() => { seeded.current = true }, [])
}
