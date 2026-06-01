import { create } from 'zustand'
import type { CronJob, CronRunEntry } from '../lib/types'
import { gatewayClient } from '../lib/gateway'

interface CronsState {
  jobs: CronJob[]
  runs: Record<string, CronRunEntry[]>
  runsHasMore: Record<string, boolean>
  runsNextOffset: Record<string, number>
  loadingJobs: boolean
  loadingRuns: Set<string>
  runningNow: Set<string>
  error: string | null
  _subscribed: boolean
  fetch: () => Promise<void>
  fetchRuns: (jobId: string, reset?: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
  update: (id: string, patch: Record<string, unknown>) => Promise<CronJob>
  remove: (id: string) => Promise<void>
  _startEventTracking: () => void
}

export const useCronsStore = create<CronsState>((set, get) => ({
  jobs: [],
  runs: {},
  runsHasMore: {},
  runsNextOffset: {},
  loadingJobs: false,
  loadingRuns: new Set(),
  runningNow: new Set(),
  error: null,
  _subscribed: false,

  _startEventTracking() {
    if (get()._subscribed) return
    set({ _subscribed: true })

    gatewayClient.on((frame) => {
      if (frame.event !== 'cron') return
      const p = frame.payload as {
        action: string
        jobId: string
        job?: CronJob
        nextRunAtMs?: number
        runAtMs?: number
        status?: string
        error?: string
        errorReason?: string
        summary?: string
        durationMs?: number
        sessionKey?: string
        model?: string
        usage?: CronRunEntry['usage']
      }
      const { action, jobId } = p

      if (action === 'added' && p.job) {
        set(s => ({ jobs: [...s.jobs, p.job!] }))
        return
      }

      if (action === 'updated' && p.job) {
        set(s => ({ jobs: s.jobs.map(j => j.id === jobId ? p.job! : j) }))
        return
      }

      if (action === 'removed') {
        set(s => ({
          jobs: s.jobs.filter(j => j.id !== jobId),
          runs: Object.fromEntries(Object.entries(s.runs).filter(([k]) => k !== jobId))
        }))
        return
      }

      if (action === 'started') {
        set(s => ({
          jobs: s.jobs.map(j => j.id === jobId ? {
            ...j,
            state: { ...j.state, runningAtMs: p.runAtMs ?? Date.now(), nextRunAtMs: p.nextRunAtMs }
          } : j)
        }))
        return
      }

      if (action === 'finished') {
        const newEntry: CronRunEntry = {
          ts: Date.now(),
          jobId,
          action: 'finished',
          status: p.status as CronRunEntry['status'],
          error: p.error,
          errorReason: p.errorReason,
          summary: p.summary,
          durationMs: p.durationMs,
          runAtMs: p.runAtMs,
          nextRunAtMs: p.nextRunAtMs,
          sessionKey: p.sessionKey,
          model: p.model,
          usage: p.usage
        }
        set(s => ({
          jobs: s.jobs.map(j => j.id === jobId ? {
            ...j,
            state: {
              ...j.state,
              runningAtMs: undefined,
              lastRunAtMs: p.runAtMs ?? Date.now(),
              lastRunStatus: p.status as CronJob['state']['lastRunStatus'],
              lastError: p.error,
              lastErrorReason: p.errorReason,
              lastDurationMs: p.durationMs,
              nextRunAtMs: p.nextRunAtMs
            }
          } : j),
          runs: s.runs[jobId]
            ? { ...s.runs, [jobId]: [newEntry, ...s.runs[jobId]] }
            : s.runs
        }))
      }
    })
  },

  async fetch() {
    set({ loadingJobs: true, error: null })
    get()._startEventTracking()
    try {
      const res = await gatewayClient.request<{ jobs: CronJob[] }>('cron.list', {
        includeDisabled: true,
        limit: 200
      })
      set({ jobs: res.jobs ?? [], loadingJobs: false })
    } catch (e) {
      set({ error: String(e), loadingJobs: false })
    }
  },

  async fetchRuns(jobId, reset = false) {
    const s = get()
    const offset = reset ? 0 : (s.runsNextOffset[jobId] ?? 0)
    if (!reset && !s.runsHasMore[jobId] && s.runs[jobId]) return

    set(st => {
      const next = new Set(st.loadingRuns)
      next.add(jobId)
      return { loadingRuns: next }
    })
    try {
      const res = await gatewayClient.request<{
        entries: CronRunEntry[]
        hasMore: boolean
        nextOffset: number | null
      }>('cron.runs', { id: jobId, limit: 30, offset, sortDir: 'desc' })

      const entries = res.entries ?? []
      set(st => {
        const next = new Set(st.loadingRuns)
        next.delete(jobId)
        const existing = reset ? [] : (st.runs[jobId] ?? [])
        return {
          loadingRuns: next,
          runs: { ...st.runs, [jobId]: [...existing, ...entries] },
          runsHasMore: { ...st.runsHasMore, [jobId]: res.hasMore },
          runsNextOffset: { ...st.runsNextOffset, [jobId]: res.nextOffset ?? 0 }
        }
      })
    } catch {
      set(st => {
        const next = new Set(st.loadingRuns)
        next.delete(jobId)
        return { loadingRuns: next }
      })
    }
  },

  async runNow(id) {
    set(s => {
      const next = new Set(s.runningNow)
      next.add(id)
      return { runningNow: next }
    })
    try {
      await gatewayClient.request('cron.run', { id })
    } finally {
      set(s => {
        const next = new Set(s.runningNow)
        next.delete(id)
        return { runningNow: next }
      })
    }
  },

  async toggle(id, enabled) {
    set(s => ({ jobs: s.jobs.map(j => j.id === id ? { ...j, enabled } : j) }))
    try {
      await gatewayClient.request('cron.update', { jobId: id, patch: { enabled } })
    } catch {
      set(s => ({ jobs: s.jobs.map(j => j.id === id ? { ...j, enabled: !enabled } : j) }))
    }
  },

  async update(id, patch) {
    const updated = await gatewayClient.request<CronJob>('cron.update', { jobId: id, patch })
    set(s => ({ jobs: s.jobs.map(j => j.id === id ? updated : j) }))
    return updated
  },

  async remove(id) {
    set(s => ({ jobs: s.jobs.filter(j => j.id !== id) }))
    await gatewayClient.request('cron.remove', { id }).catch(() => {})
  }
}))
