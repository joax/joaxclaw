import { useEffect, useMemo, useState } from 'react'
import { Strip, useCloseStrips } from '../ui/Strip'
import { TaskRow } from '../tasks/TaskRow'
import { toneColor } from '../../lib/stateTone'
import { collectJobRefs, jobsForSession } from '../../lib/scriptJobs'
import {
  stripItems, summaryLine, worstTone, countItems, chipLabel, fromScriptJob, taskMatchesSession,
  type BackgroundItem, type TaskSummary,
} from '../../lib/tasks'
import { useIsNarrow } from '../../lib/useIsNarrow'
import type { ChatMessage } from '../../lib/types'
import { useTasksStore } from '../../store/tasks'
import { useScriptJobsStore } from '../../store/scriptJobs'
import { useConnectionStore } from '../../store/connection'

// Everything this chat has running in the background, in one strip under the header:
// the gateway's tasks for this session (subagents, background commands, automation runs,
// media jobs) and the script jobs it started through joaxclaw-fs. It replaced the Scripts
// dock, so a gateway without tasks still gets exactly the script rows it had.
//
// Collapsed it's one line — "2 running · 1 needs you · 3 done" — coloured by the worst
// state. Open, it lists a row per item; a row opens the task drawer. It hides when there's
// nothing to list, and it only appears once the first list is in, so it never flashes empty.

const NOW_TICK_MS = 1000
const IDLE_TICK_MS = 30_000

export function BackgroundStrip({ sessionKey, messages }: { sessionKey?: string; messages: ChatMessage[] }) {
  const narrow = useIsNarrow()
  // The StripBar is keyed by conversation, so this is when the chat was opened.
  const [openedAtMs] = useState(() => Date.now())
  const connectionSeq = useConnectionStore(s => s.connectionSeq)
  const byId = useTasksStore(s => s.byId)
  const indexIds = useTasksStore(s => (sessionKey ? s.sessionIndex[sessionKey] : undefined))
  const hiddenList = useTasksStore(s => (sessionKey ? s.hidden[sessionKey] : undefined))
  const openDrawer = useTasksStore(s => s.openDrawer)
  const openJob = useTasksStore(s => s.openJob)
  const closeStrips = useCloseStrips()
  // On a phone the drawer opens full screen, so the sheet it was opened from closes rather
  // than lingering underneath with its own Escape and focus trap.
  const open = (item: BackgroundItem) => {
    if (narrow) closeStrips()
    if (item.source === 'task') openDrawer(item.id)
    else openJob(item.id)
  }
  const jobs = useScriptJobsStore(s => s.jobs)
  const expired = useScriptJobsStore(s => s.expired)

  // This chat's task list, again on every new connection (the gateway sends no catch-up).
  useEffect(() => {
    if (!sessionKey) return
    const store = useTasksStore.getState()
    void store.loadSession(sessionKey)
    return store.watch(sessionKey)
  }, [sessionKey, connectionSeq])

  useEffect(() => useScriptJobsStore.getState().acquire(), [])

  // Transcript script_start calls name their job, which covers jobs from a plugin too old
  // to record the launching session. `messages` changes on every streamed token, so this
  // is keyed by the id list rather than the refs.
  const refIds = collectJobRefs(messages).map(r => r.jobId).join(',')

  const tasks = useMemo<TaskSummary[]>(() => {
    if (!sessionKey) return []
    const listed = new Set(indexIds ?? [])
    return Object.values(byId).filter(t => listed.has(t.id) || taskMatchesSession(t, sessionKey))
  }, [byId, indexIds, sessionKey])

  const scriptItems = useMemo<BackgroundItem[]>(() => {
    const refs = new Set(refIds ? refIds.split(',') : [])
    return jobsForSession(Object.values(jobs), sessionKey, refs)
      .map(j => fromScriptJob(j, { expired: j.id in expired, expiredAt: expired[j.id] }))
  }, [jobs, expired, refIds, sessionKey])

  // Elapsed times tick every second while something runs. Otherwise a slow tick is enough
  // to age finished rows out of the strip on time.
  const [now, setNow] = useState(() => Date.now())
  const anyActive = tasks.some(t => t.status === 'queued' || t.status === 'running') || scriptItems.some(i => i.active)
  const anyItems = tasks.length > 0 || scriptItems.length > 0
  useEffect(() => {
    if (!anyItems) return
    const t = setInterval(() => setNow(Date.now()), anyActive ? NOW_TICK_MS : IDLE_TICK_MS)
    return () => clearInterval(t)
  }, [anyActive, anyItems])

  const items = useMemo(
    () => stripItems({ tasks, jobs: scriptItems, now, openedAtMs, hidden: new Set(hiddenList ?? []) }),
    [tasks, scriptItems, now, openedAtMs, hiddenList],
  )

  const counts = countItems(items)
  const tone = worstTone(items)
  const lone = items.length === 1 ? items[0] : undefined
  const track = lone?.source === 'script' && lone.percent != null ? { pct: lone.percent } : undefined

  return (
    <Strip
      id="background"
      visible={!!sessionKey && items.length > 0}
      label="Background"
      headline={summaryLine(items)}
      tone={tone}
      track={track}
      // The phone chip carries its own counts ("Background 2 · 1 ⚠"); the desktop count is
      // the number running, in mono beside the pips.
      count={!narrow && counts.running ? String(counts.running) : undefined}
      chipLabel={chipLabel(items)}
      trailing={<StatePips items={items} />}
      body={
        <div>
          {items.map(item => (
            <TaskRow
              key={item.key}
              item={item}
              now={now}
              sessionKey={sessionKey}
              onOpen={() => open(item)}
            />
          ))}
        </div>
      }
    />
  )
}

// One dot per item (up to six), in its state's colour. Decorative: the headline says the
// same in words.
function StatePips({ items }: { items: BackgroundItem[] }) {
  const shown = items.slice(0, 6)
  return (
    <span aria-hidden className="flex items-center gap-1 shrink-0">
      {shown.map(i => (
        <span
          key={i.key}
          className={i.active ? 'animate-pulse-dot' : undefined}
          style={{ width: 6, height: 6, borderRadius: 999, background: toneColor(i.state.tone) }}
        />
      ))}
    </span>
  )
}
