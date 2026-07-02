import { create } from 'zustand'
import { fetchLatestPluginVersion } from '../lib/pluginUpdate'

// Tracks the latest published joaxclaw-fs version (from npm) and the user's skip/dismiss
// choices, so a banner + the plugins list can offer an update. The installed version
// comes from the extensions store; this only owns the "latest available" side.

const SKIP_KEY = 'joaxclaw-plugin-skip'  // persisted: a version the user chose to skip

interface PluginUpdateState {
  latest: string | null
  checking: boolean
  checkedAtMs: number | null
  skipped: string | null
  dismissed: boolean  // session-only
  check: (force?: boolean) => Promise<void>
  skip: () => void
  dismiss: () => void
}

export const usePluginUpdateStore = create<PluginUpdateState>((set, get) => ({
  latest: null,
  checking: false,
  checkedAtMs: null,
  skipped: (() => { try { return localStorage.getItem(SKIP_KEY) } catch { return null } })(),
  dismissed: false,

  async check(force = false) {
    const { checking, checkedAtMs } = get()
    if (checking) return
    // Don't re-hit npm more than every 30 min unless forced.
    if (!force && checkedAtMs && Date.now() - checkedAtMs < 30 * 60_000) return
    set({ checking: true })
    const latest = await fetchLatestPluginVersion()
    set({ checking: false, checkedAtMs: Date.now(), ...(latest ? { latest } : {}) })
  },

  skip() {
    const v = get().latest
    if (!v) return
    try { localStorage.setItem(SKIP_KEY, v) } catch { /* ignore */ }
    set({ skipped: v })
  },

  dismiss() { set({ dismissed: true }) },
}))
