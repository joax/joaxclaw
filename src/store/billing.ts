import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { dayLabel, utcOffsetLabel, type SessionsUsage } from '../lib/billing'

// Usage/billing data from the gateway's `sessions.usage` report.
//
// Two things make this more than a plain fetch:
//  1. The gateway builds its per-session cost cache lazily. The first call after a
//     restart answers with zeros and `cacheStatus.status: 'refreshing'`, so we poll
//     until it reports `fresh` rather than showing an empty bill.
//  2. Scanning every transcript is slow on a big history, so a refetch keeps the
//     previous report on screen (`refetching`) instead of blanking the view.

export type BillingRange = 'today' | '7d' | '30d' | '90d' | '1y' | 'all'
export type BillingGroup = 'day' | 'week'

const WARM_POLL_MS = 2_500
const WARM_POLL_MAX = 24          // ~1 min of cache warming before we give up polling
const REQUEST_TIMEOUT_MS = 120_000

interface BillingState {
  data: SessionsUsage | null
  loading: boolean            // no data yet — show a skeleton
  refetching: boolean         // background refresh — hold the previous render
  error: string | null
  fetchedAt: number | null

  range: BillingRange
  agentId: string | null      // null = every agent
  group: BillingGroup

  setRange: (r: BillingRange) => void
  setAgent: (id: string | null) => void
  setGroup: (g: BillingGroup) => void
  fetch: (opts?: { quiet?: boolean }) => Promise<void>
  reset: () => void
}

function usageParams(state: Pick<BillingState, 'range' | 'agentId'>): Record<string, unknown> {
  const params: Record<string, unknown> = {
    limit: 200,
    // Bucket days on the user's midnight, not UTC's, so "today" means today.
    mode: 'specific',
    utcOffset: utcOffsetLabel(),
  }
  if (state.agentId) params.agentId = state.agentId
  else params.agentScope = 'all'

  if (state.range === 'today') {
    const today = dayLabel(new Date())
    params.startDate = today
    params.endDate = today
  } else {
    params.range = state.range
  }
  return params
}

/** True while the gateway is still hydrating its cost cache — numbers are partial. */
export function isWarming(data: SessionsUsage | null): boolean {
  const status = data?.cacheStatus
  if (!status) return false
  return status.status !== 'fresh' && (status.pendingFiles > 0 || status.staleFiles > 0)
}

let warmTimer: ReturnType<typeof setTimeout> | null = null
let warmAttempts = 0
// Guards against an in-flight response from an older filter overwriting a newer one.
let requestSeq = 0

function clearWarmTimer() {
  if (warmTimer) { clearTimeout(warmTimer); warmTimer = null }
}

export const useBillingStore = create<BillingState>((set, get) => ({
  data: null,
  loading: false,
  refetching: false,
  error: null,
  fetchedAt: null,

  range: '7d',
  agentId: null,
  group: 'day',

  setRange(range) {
    if (get().range === range) return
    set({ range })
    void get().fetch()
  },

  setAgent(agentId) {
    if (get().agentId === agentId) return
    set({ agentId })
    void get().fetch()
  },

  setGroup(group) {
    set({ group })   // purely client-side re-bucketing, no refetch
  },

  async fetch(opts) {
    const seq = ++requestSeq
    clearWarmTimer()
    if (!opts?.quiet) warmAttempts = 0

    const state = get()
    set(state.data ? { refetching: true, error: null } : { loading: true, error: null })

    try {
      const data = await gatewayClient.request<SessionsUsage>(
        'sessions.usage',
        usageParams(state),
        REQUEST_TIMEOUT_MS,
      )
      if (seq !== requestSeq) return          // a newer request already won
      set({ data, loading: false, refetching: false, error: null, fetchedAt: Date.now() })

      // Cache still warming → come back for the complete numbers.
      if (isWarming(data) && warmAttempts < WARM_POLL_MAX) {
        warmAttempts++
        warmTimer = setTimeout(() => { void get().fetch({ quiet: true }) }, WARM_POLL_MS)
      } else {
        warmAttempts = 0
      }
    } catch (e) {
      if (seq !== requestSeq) return
      set({ loading: false, refetching: false, error: String(e) })
    }
  },

  reset() {
    clearWarmTimer()
    warmAttempts = 0
    requestSeq++
    set({ data: null, loading: false, refetching: false, error: null, fetchedAt: null })
  },
}))
