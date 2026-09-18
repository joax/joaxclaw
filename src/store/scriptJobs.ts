import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import type { ScriptJob } from '../lib/scriptJobs'
import { useConnectionStore } from './connection'

// Script jobs from the joaxclaw-fs plugin (`script_start`), for the Background strip, the
// Dashboard and the tray. Before this each chat's dock and the Dashboard ran their own
// 3 s `jobs.list` poll; now there is one, and it runs only while something is looking.
// A view calls `acquire()` on mount and the release it returns on unmount.
//
// `jobs.list` has no output (only `jobs.get` does), which is fine: the list is for rows.
// The inline card and the drawer follow one job's output through lib/scriptJobs'
// `subscribeJob`, as before.
//
// The host forgets a finished job 10 min after it ends, and forgets everything when it
// restarts. A job this store saw and that then disappears is kept as last seen and marked
// expired, so a row doesn't vanish mid-read; the strip's own time rules age it out.

const POLL_MS = 3000
/** Last-seen jobs kept after they've gone from the host. */
const KEEP_EXPIRED = 50

interface ScriptJobsState {
  jobs: Record<string, ScriptJob>
  /** jobId → when this store noticed the host no longer had it. */
  expired: Record<string, number>
  /** A jobs.list has come back on this connection. */
  loaded: boolean
  acquire: () => () => void
  refresh: () => Promise<void>
}

let viewers = 0
let timer: ReturnType<typeof setTimeout> | undefined
let url: string | undefined
let seq = 0

export const useScriptJobsStore = create<ScriptJobsState>((set, get) => {
  const tick = async () => {
    timer = undefined
    if (viewers === 0) return
    await get().refresh()
    if (viewers > 0 && !timer) timer = setTimeout(tick, POLL_MS)
  }

  return {
    jobs: {},
    expired: {},
    loaded: false,

    acquire() {
      viewers++
      if (viewers === 1 && !timer) void tick()
      return () => {
        viewers = Math.max(0, viewers - 1)
        if (viewers === 0 && timer) { clearTimeout(timer); timer = undefined }
      }
    },

    async refresh() {
      // A different gateway has different jobs; nothing from the last one should linger.
      const current = useConnectionStore.getState().connection?.url
      if (current !== url) {
        url = current
        set({ jobs: {}, expired: {}, loaded: false })
      }
      // A plugin method, and plugins' methods are in hello-ok, so an absent entry means the
      // plugin isn't installed: script jobs are simply left out, with no notice.
      if (!gatewayClient.connected || !gatewayClient.hasMethod('jobs.list')) return
      const id = ++seq
      // Not lib/scriptJobs' listJobs(): that turns a failure into an empty list, which here
      // would mark every job expired on one dropped request.
      let list: ScriptJob[]
      try {
        list = (await gatewayClient.request<{ jobs?: ScriptJob[] }>('jobs.list')).jobs ?? []
      } catch { return }
      if (id !== seq || current !== url) return
      const now = Date.now()
      const { jobs, expired } = get()
      const nextJobs: Record<string, ScriptJob> = {}
      const nextExpired: Record<string, number> = {}
      for (const j of list) if (j?.id) nextJobs[j.id] = j
      // Jobs we'd seen that the host has since dropped, newest first, capped.
      const gone = Object.values(jobs)
        .filter(j => !nextJobs[j.id])
        .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))
        .slice(0, KEEP_EXPIRED)
      for (const j of gone) {
        nextJobs[j.id] = j
        nextExpired[j.id] = expired[j.id] ?? now
      }
      set({ jobs: nextJobs, expired: nextExpired, loaded: true })
    },
  }
})
