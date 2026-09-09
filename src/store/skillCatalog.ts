import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import {
  needsForce, skillInstallParams, skillUpdateParams, updateOutcomes,
  type SkillSearchResult,
} from '../lib/skillCatalog'

// Browsing ClawHub for skills, and refreshing the ones already installed.
//
// Kept apart from the extensions store for the same reason as the plugin catalogue: that
// one is a local edit buffer over `config.patch` with a Save button, and installing runs
// on the gateway rather than being a config edit to batch.

interface SkillCatalogState {
  query: string
  results: SkillSearchResult[]
  searching: boolean
  searched: boolean
  /** installRef currently installing, or 'update:all' / 'update:<slug>'. */
  busy: string | null
  error: string | null
  installed: string[]           // installRefs installed this session
  /** Slugs an update refused because their files were edited locally. */
  blocked: string[]
  lastUpdateSummary: string | null

  search: (query: string) => Promise<void>
  install: (result: SkillSearchResult) => Promise<void>
  updateAll: (opts?: { force?: boolean }) => Promise<void>
  clearBlocked: () => void
  clearError: () => void
  reset: () => void
}

const errText = (e: unknown): string => {
  const s = e instanceof Error ? e.message : String(e)
  try { const p = JSON.parse(s) as { message?: string }; if (p?.message) return p.message } catch { /* not JSON */ }
  return s
}
const structured = (e: unknown): unknown => (e as { gatewayError?: unknown })?.gatewayError ?? e

export const useSkillCatalogStore = create<SkillCatalogState>((set) => ({
  query: '',
  results: [],
  searching: false,
  searched: false,
  busy: null,
  error: null,
  installed: [],
  blocked: [],
  lastUpdateSummary: null,

  async search(query) {
    const q = query.trim()
    if (!q) { set({ results: [], searched: false, query: '' }); return }
    set({ searching: true, error: null, query: q })
    try {
      const res = await gatewayClient.request<{ results?: SkillSearchResult[] }>('skills.search', { query: q, limit: 25 })
      set({ results: res.results ?? [], searching: false, searched: true })
    } catch (e) {
      set({ searching: false, searched: true, results: [], error: errText(e) })
    }
  },

  async install(result) {
    set({ busy: result.installRef, error: null })
    try {
      await gatewayClient.request('skills.install', skillInstallParams(result) as unknown as Record<string, unknown>)
      set(s => ({ busy: null, installed: [...s.installed, result.installRef] }))
    } catch (e) {
      set({ busy: null, error: errText(e) })
    }
  },

  // Refresh every ClawHub-tracked skill. A skill whose files were edited locally comes
  // back as `force_required` rather than failing the batch — surfaced for the user to
  // decide, because forcing overwrites those edits.
  async updateAll(opts) {
    set({ busy: 'update:all', error: null, blocked: [], lastUpdateSummary: null })
    try {
      const res = await gatewayClient.request<unknown>(
        'skills.update', skillUpdateParams({ all: true }, { force: opts?.force }),
      )
      const outcomes = updateOutcomes(res)
      const blocked = opts?.force ? [] : needsForce(outcomes)
      const ok = outcomes.filter(o => o.ok).length
      set({
        busy: null,
        blocked,
        lastUpdateSummary: outcomes.length === 0
          ? 'Nothing tracked from ClawHub to update.'
          : `${ok} of ${outcomes.length} skill${outcomes.length === 1 ? '' : 's'} up to date.`,
      })
    } catch (e) {
      // A wholesale refusal can still carry the per-skill reasons.
      const blocked = opts?.force ? [] : needsForce(updateOutcomes(structured(e)))
      set({ busy: null, blocked, ...(blocked.length ? {} : { error: errText(e) }) })
    }
  },

  clearBlocked() { set({ blocked: [] }) },
  clearError() { set({ error: null }) },
  reset() { set({ query: '', results: [], searched: false, error: null, busy: null, blocked: [], lastUpdateSummary: null }) },
}))
