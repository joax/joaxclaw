import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'

// The gateway's Tool Search setting, read for the "written as text" hint (see
// lib/toolSearch.ts), and switched off from there when the user asks.
//
// It's read lazily, the first time a hint could show, and marked stale on every
// connect, because the setting can change from the CLI or another client meanwhile.

interface ConfigSnapshot { hash?: string; config?: Record<string, unknown>; parsed?: Record<string, unknown> }

interface ToolSearchState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** `tools.toolSearch` as authored. undefined means unset, so the runtime default applies. */
  setting: unknown
  /** `agents.defaults.experimental.localModelLean`: what turns Tool Search on for 2026.8 local models. */
  localModelLean: unknown
  saving: boolean
  /** Switched off from this app, in this run: the hint then says to start a new chat. */
  turnedOff: boolean
  error: string | null
  ensure: () => void
  invalidate: () => void
  turnOff: () => Promise<void>
}

function read(path: string[], obj: unknown): unknown {
  let cur = obj
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

export const useToolSearchStore = create<ToolSearchState>((set, get) => ({
  status: 'idle',
  setting: undefined,
  localModelLean: undefined,
  saving: false,
  turnedOff: false,
  error: null,

  ensure() {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    gatewayClient.request<ConfigSnapshot>('config.get', {})
      .then(snap => {
        // The authored view, so "unset" reads as unset rather than as a filled-in default.
        const view = snap.parsed ?? snap.config ?? {}
        set({
          status: 'ready',
          setting: read(['tools', 'toolSearch'], view),
          localModelLean: read(['agents', 'defaults', 'experimental', 'localModelLean'], view),
        })
      })
      .catch(() => set({ status: 'error' }))
  },

  invalidate() {
    if (get().status !== 'loading') set({ status: 'idle' })
  },

  async turnOff() {
    set({ saving: true, error: null })
    try {
      const snap = await gatewayClient.request<ConfigSnapshot>('config.get', {})
      // Hot-applies (the gateway's reload plan lists `tools` as no-restart), so the next
      // message already gets the full tool set.
      await gatewayClient.request('config.patch', {
        raw: JSON.stringify({ tools: { toolSearch: false } }),
        ...(snap.hash ? { baseHash: snap.hash } : {}),
      })
      set({ saving: false, setting: false, turnedOff: true, status: 'ready' })
    } catch (e) {
      set({ saving: false, error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
