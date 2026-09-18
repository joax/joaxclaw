import { useEffect, useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import { TaskRow } from '../tasks/TaskRow'
import { SectionHead, MobileCard, SeeAll } from './DashboardView'
import { dashboardItems, fromScriptJob } from '../../lib/tasks'
import { useTasksStore } from '../../store/tasks'
import { useScriptJobsStore } from '../../store/scriptJobs'

// The Dashboard's Background section: every agent's background work that's worth a look —
// what's running (gateway tasks and scripts), what needs you, and what failed in the last
// day — five rows at most, then "See all →" into the task drawer's list. It replaced the
// Scripts section in the same two slots. Like the Dashboard's other sections it renders
// nothing when it has nothing to show, and nothing until the first list is in.

const MAX_ROWS = 5

export function BackgroundSection({ narrow }: { narrow?: boolean }) {
  const byId = useTasksStore(s => s.byId)
  const loaded = useTasksStore(s => s.loaded)
  const { openDrawer, openJob, openList } = useTasksStore.getState()
  const jobs = useScriptJobsStore(s => s.jobs)
  const expired = useScriptJobsStore(s => s.expired)
  const jobsLoaded = useScriptJobsStore(s => s.loaded)

  useEffect(() => {
    const unwatch = useTasksStore.getState().watch()
    const release = useScriptJobsStore.getState().acquire()
    return () => { unwatch(); release() }
  }, [])

  const [now, setNow] = useState(() => Date.now())
  const items = useMemo(() => dashboardItems({
    tasks: Object.values(byId),
    jobs: Object.values(jobs).map(j => fromScriptJob(j, { expired: j.id in expired, expiredAt: expired[j.id] })),
    now,
  }), [byId, jobs, expired, now])
  const anyActive = items.some(i => i.active)
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyActive])

  if ((!loaded && !jobsLoaded) || items.length === 0) return null

  const content = (
    <>
      <SectionHead
        Icon={Layers}
        label="Background"
        narrow={narrow}
        iconColor="var(--accent)"
        action={<SeeAll onClick={openList} narrow={narrow} />}
      />
      <div>
        {items.slice(0, MAX_ROWS).map(item => (
          <TaskRow
            key={item.key}
            item={item}
            now={now}
            onOpen={item.source === 'task' ? () => openDrawer(item.id) : () => openJob(item.id)}
          />
        ))}
      </div>
    </>
  )

  return narrow ? <MobileCard>{content}</MobileCard> : <div style={{ marginBottom: 16 }}>{content}</div>
}
