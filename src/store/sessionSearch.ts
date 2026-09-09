import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { buildSearchParams, type SessionSearchHit } from '../lib/sessionSearch'

// Transcript search over the sessions the client knows about.
//
// Deliberately explicit rather than live-as-you-type: unlike the name filter beside it,
// every run is a gateway round-trip that reads transcripts, so it fires on submit.

interface SessionSearchState {
  query: string            // the query the current results belong to
  hits: SessionSearchHit[]
  loading: boolean
  error: string | null
  /** How many sessions were actually searched, and how many the cap left out. */
  searched: number
  skipped: number
  /** True once a search has run, so "no matches" can be told apart from "not yet run". */
  ran: boolean

  run: (query: string, keys: readonly string[]) => Promise<void>
  clear: () => void
}

export const useSessionSearchStore = create<SessionSearchState>((set) => ({
  query: '',
  hits: [],
  loading: false,
  error: null,
  searched: 0,
  skipped: 0,
  ran: false,

  async run(query, keys) {
    const built = buildSearchParams(query, keys)
    if (!built) { set({ hits: [], ran: false, error: null, query: '' }); return }
    set({ loading: true, error: null, query: built.params.query, searched: built.searched, skipped: built.skipped })
    try {
      const res = await gatewayClient.request<{ results?: SessionSearchHit[]; indexing?: boolean }>(
        // The params interface is exact; the client takes an index signature.
        'sessions.search', { ...built.params },
      )
      set({ hits: res.results ?? [], loading: false, ran: true })
    } catch (e) {
      set({
        loading: false,
        ran: true,
        hits: [],
        error: e instanceof Error ? e.message : String(e),
      })
    }
  },

  clear() { set({ query: '', hits: [], error: null, ran: false, searched: 0, skipped: 0 }) },
}))
