import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import type { GwModelProvider, GwModelDef } from '../lib/types'

interface ModelsState {
  // config.models.providers  — keyed by provider id
  providers: Record<string, GwModelProvider>
  // config.plugins.entries   — only the enabled flag per provider id
  pluginEnabled: Record<string, boolean>

  selectedId: string | null
  loading: boolean
  error: string | null
  dirty: boolean
  saving: boolean
  _baseHash: string | null

  load: () => Promise<void>
  selectProvider: (id: string) => void

  setProviderEnabled: (id: string, enabled: boolean) => void
  updateProviderConfig: (id: string, patch: Partial<Omit<GwModelProvider, 'models'>>) => void
  addProvider: (id: string, provider: GwModelProvider) => void
  deleteProvider: (id: string) => void

  setModel: (providerId: string, model: GwModelDef) => void
  deleteModel: (providerId: string, modelId: string) => void

  save: () => Promise<void>
}

export const useModelsStore = create<ModelsState>((set, get) => ({
  providers: {},
  pluginEnabled: {},
  selectedId: null,
  loading: false,
  error: null,
  dirty: false,
  saving: false,
  _baseHash: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const snapshot = await gatewayClient.request<{ config?: Record<string, unknown>; hash?: string }>('config.get', {})
      const config = snapshot.config ?? {}

      const modelsSection = (config.models ?? {}) as Record<string, unknown>
      const providers = (modelsSection.providers ?? {}) as Record<string, GwModelProvider>

      const pluginsSection = (config.plugins ?? {}) as Record<string, unknown>
      const pluginEntries = (pluginsSection.entries ?? {}) as Record<string, { enabled?: boolean }>
      const pluginEnabled: Record<string, boolean> = {}
      for (const [id, val] of Object.entries(pluginEntries)) {
        pluginEnabled[id] = val.enabled !== false
      }

      const selectedId = get().selectedId ?? Object.keys(providers)[0] ?? null

      set({ providers, pluginEnabled, selectedId, loading: false, dirty: false, error: null, _baseHash: snapshot.hash ?? null })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  selectProvider(id) {
    set({ selectedId: id })
  },

  setProviderEnabled(id, enabled) {
    set(s => ({ pluginEnabled: { ...s.pluginEnabled, [id]: enabled }, dirty: true }))
  },

  updateProviderConfig(id, patch) {
    set(s => ({
      providers: { ...s.providers, [id]: { ...s.providers[id], ...patch } },
      dirty: true,
    }))
  },

  addProvider(id, provider) {
    set(s => ({
      providers: { ...s.providers, [id]: provider },
      pluginEnabled: { ...s.pluginEnabled, [id]: true },
      selectedId: id,
      dirty: true,
    }))
  },

  deleteProvider(id) {
    set(s => {
      const providers = { ...s.providers }
      delete providers[id]
      const pluginEnabled = { ...s.pluginEnabled }
      delete pluginEnabled[id]
      const selectedId = s.selectedId === id ? (Object.keys(providers)[0] ?? null) : s.selectedId
      return { providers, pluginEnabled, selectedId, dirty: true }
    })
  },

  setModel(providerId, model) {
    set(s => {
      const provider = s.providers[providerId]
      if (!provider) return s
      const existing = provider.models.findIndex(m => m.id === model.id)
      const models = existing >= 0
        ? provider.models.map((m, i) => i === existing ? model : m)
        : [...provider.models, model]
      return { providers: { ...s.providers, [providerId]: { ...provider, models } }, dirty: true }
    })
  },

  deleteModel(providerId, modelId) {
    set(s => {
      const provider = s.providers[providerId]
      if (!provider) return s
      return {
        providers: { ...s.providers, [providerId]: { ...provider, models: provider.models.filter(m => m.id !== modelId) } },
        dirty: true,
      }
    })
  },

  async save() {
    const { providers, pluginEnabled, _baseHash } = get()
    set({ saving: true })
    try {
      // Build minimal plugin entries patch — only touch the enabled field per provider
      const pluginEntries: Record<string, unknown> = {}
      for (const [id, enabled] of Object.entries(pluginEnabled)) {
        pluginEntries[id] = { enabled }
      }

      const patch = {
        models: { providers },
        plugins: { entries: pluginEntries },
      }
      const params: Record<string, unknown> = { raw: JSON.stringify(patch) }
      if (_baseHash) params.baseHash = _baseHash

      await gatewayClient.request('config.patch', params)
      await get().load()
      set({ saving: false })
    } catch (e) {
      set({ saving: false, error: String(e) })
      throw e
    }
  },
}))
