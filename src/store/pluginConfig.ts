import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'

// Reads the full gateway config and patches it — used by the plugin Configure modal,
// which edits values across several config sections (plugins.entries.<id>,
// models.providers.<id>, tools.web, messages.tts) in one place. Reads the *parsed*
// view so SecretRefs round-trip, mirroring the channels/models stores.

interface ConfigSnapshot {
  hash?: string
  config?: Record<string, unknown>
  parsed?: Record<string, unknown>
}

interface PluginConfigState {
  loading: boolean
  saving: boolean
  error: string | null
  config: Record<string, unknown> | null
  hash: string | null

  load: () => Promise<void>
  patch: (patch: Record<string, unknown>, replacePaths?: string[]) => Promise<boolean>
}

export const usePluginConfigStore = create<PluginConfigState>((set, get) => ({
  loading: false,
  saving: false,
  error: null,
  config: null,
  hash: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const snap = await gatewayClient.request<ConfigSnapshot>('config.get', {})
      set({ config: (snap.parsed ?? snap.config ?? {}) as Record<string, unknown>, hash: snap.hash ?? null, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  async patch(patch, replacePaths) {
    set({ saving: true, error: null })
    try {
      // Re-read for a fresh hash right before writing (avoids stale-hash conflicts).
      const snap = await gatewayClient.request<ConfigSnapshot>('config.get', {})
      await gatewayClient.request('config.patch', {
        raw: JSON.stringify(patch),
        ...(snap.hash ? { baseHash: snap.hash } : {}),
        ...(replacePaths?.length ? { replacePaths } : {}),
      })
      await get().load()
      set({ saving: false })
      return true
    } catch (e) {
      set({ saving: false, error: String(e) })
      return false
    }
  },
}))
