import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { readLocalStore, patchLocalStore } from '../lib/localStore'
import type { GwModelProvider, GwModelDef } from '../lib/types'

// Collect every array path inside a config-patch payload, in the gateway's dotted
// notation with `[]` for arrays nested inside array elements (e.g.
// `models.providers.google.models[].input`). A config.patch is an RFC-7396 merge and
// the gateway refuses to SHRINK any array unless its exact path is named in
// `replacePaths` — and naming a parent array is NOT enough: each nested array (an
// `input`/`output` modality list on a model, etc.) must be listed independently.
// Model objects round-trip through the app, so a save replaces these arrays wholesale;
// listing them all marks every replacement as intentional. Paths are de-duplicated by
// the caller (many array elements yield the same `...models[].input` path).
export function collectArrayPaths(obj: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(obj)) {
    out.push(prefix)
    for (const item of obj) collectArrayPaths(item, `${prefix}[]`, out)
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      collectArrayPaths(v, prefix ? `${prefix}.${k}` : k, out)
    }
  }
}

interface ModelsState {
  providers: Record<string, GwModelProvider>
  // provider IDs that came from plugin discovery (not originally in config.models.providers)
  pluginProviderIds: Set<string>
  // provider IDs present in the user's raw JSON5 config (not just plugin-injected runtime defaults)
  _parsedProviderIds: Set<string>
  // provider IDs the user explicitly added this session (not yet in the persisted config)
  _userAddedProviderIds: Set<string>
  // "pid/mid" keys for models added as stubs from plugin discovery (no user config yet)
  _stubModelKeys: Set<string>
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
  pluginProviderIds: new Set(),
  _parsedProviderIds: new Set(),
  _userAddedProviderIds: new Set(),
  _stubModelKeys: new Set(),
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
      const snapshot = await gatewayClient.request<{ config?: Record<string, unknown>; parsed?: Record<string, unknown>; hash?: string }>('config.get', {})
      const config = snapshot.config ?? {}

      // Providers in the user's raw JSON5 config (excludes plugin-injected runtime defaults)
      const parsedRaw = (snapshot.parsed ?? snapshot.config ?? {}) as Record<string, unknown>
      const parsedModels = (parsedRaw['models'] ?? {}) as Record<string, unknown>
      const parsedProviders = (parsedModels['providers'] ?? {}) as Record<string, unknown>
      const _parsedProviderIds = new Set(Object.keys(parsedProviders))

      const modelsSection = (config.models ?? {}) as Record<string, unknown>
      const configProvidersRaw = (modelsSection.providers ?? {}) as Record<string, GwModelProvider>
      const configProviderIds = new Set(Object.keys(configProvidersRaw))

      // Deep-copy so we can safely append stub models
      const providers: Record<string, GwModelProvider> = {}
      for (const [pid, p] of Object.entries(configProvidersRaw)) {
        providers[pid] = { ...p, models: [...(p.models ?? [])] }
      }

      const agentsSection = (config.agents ?? {}) as Record<string, unknown>
      const agentDefaults = (agentsSection.defaults ?? {}) as Record<string, unknown>
      const agentDefaultModelIds = Object.keys((agentDefaults.models ?? {}) as Record<string, unknown>)

      const pluginsSection = (config.plugins ?? {}) as Record<string, unknown>
      const pluginEntries = (pluginsSection.entries ?? {}) as Record<string, { enabled?: boolean }>
      const pluginEnabled: Record<string, boolean> = {}
      for (const [id, val] of Object.entries(pluginEntries)) {
        pluginEnabled[id] = val.enabled !== false
      }

      // Merge plugin-provided model IDs into providers as stub entries
      const pluginProviderIds = new Set<string>()
      const _stubModelKeys = new Set<string>()

      for (const fullId of agentDefaultModelIds) {
        const slash = fullId.indexOf('/')
        const pid = slash >= 0 ? fullId.slice(0, slash) : 'other'
        const mid = slash >= 0 ? fullId.slice(slash + 1) : fullId

        if (!configProviderIds.has(pid)) {
          pluginProviderIds.add(pid)
        }

        if (!providers[pid]) {
          providers[pid] = { models: [] }
        }

        if (!providers[pid].models.find(m => m.id === mid)) {
          providers[pid] = { ...providers[pid], models: [...providers[pid].models, { id: mid, name: mid }] }
          _stubModelKeys.add(`${pid}/${mid}`)
        }
      }

      // Overlay locally-persisted model pricing for plugin-managed providers
      const localStore = await readLocalStore()
      const localPricing = localStore.modelPricing ?? {}
      for (const [pid, modelOverrides] of Object.entries(localPricing)) {
        if (!providers[pid]) continue
        providers[pid] = {
          ...providers[pid],
          models: providers[pid].models.map(m => {
            const override = modelOverrides[m.id]
            return override ? { ...m, cost: override } : m
          }),
        }
      }

      const selectedId = get().selectedId ?? Object.keys(providers)[0] ?? null

      set({ providers, pluginProviderIds, _parsedProviderIds, _userAddedProviderIds: new Set(), _stubModelKeys, pluginEnabled, selectedId, loading: false, dirty: false, error: null, _baseHash: snapshot.hash ?? null })
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
      _userAddedProviderIds: new Set([...s._userAddedProviderIds, id]),
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
      const pluginProviderIds = new Set(s.pluginProviderIds)
      pluginProviderIds.delete(id)
      const selectedId = s.selectedId === id ? (Object.keys(providers)[0] ?? null) : s.selectedId
      return { providers, pluginEnabled, pluginProviderIds, selectedId, dirty: true }
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
      // Promote stub to configured model
      const _stubModelKeys = new Set(s._stubModelKeys)
      _stubModelKeys.delete(`${providerId}/${model.id}`)
      return { providers: { ...s.providers, [providerId]: { ...provider, models } }, dirty: true, _stubModelKeys }
    })
  },

  deleteModel(providerId, modelId) {
    set(s => {
      const provider = s.providers[providerId]
      if (!provider) return s
      const _stubModelKeys = new Set(s._stubModelKeys)
      _stubModelKeys.delete(`${providerId}/${modelId}`)
      return {
        providers: { ...s.providers, [providerId]: { ...provider, models: provider.models.filter(m => m.id !== modelId) } },
        dirty: true,
        _stubModelKeys,
      }
    })
  },

  async save() {
    const { providers, pluginProviderIds, _parsedProviderIds, _userAddedProviderIds, pluginEnabled, _baseHash, _stubModelKeys } = get()
    set({ saving: true })
    try {
      const pluginEntries: Record<string, unknown> = {}
      for (const [id, enabled] of Object.entries(pluginEnabled)) {
        pluginEntries[id] = { enabled }
      }

      // Build providers payload:
      // - Only save providers that are in the user's JSON5 config OR explicitly added this session.
      //   Plugin-managed providers (in runtime config but not in the user's parsed JSON5) are skipped
      //   because the gateway deep-merges patches with plugin defaults — those defaults may include
      //   invalid values (e.g. baseUrl: "") that fail schema validation and cannot be overridden via patch.
      // - Strip empty-string fields: gateway rejects e.g. baseUrl: "" (must be >=1 chars or absent)
      const providersToSave: Record<string, GwModelProvider> = {}
      for (const [pid, p] of Object.entries(providers)) {
        const isPluginOnly = pluginProviderIds.has(pid)
        const isPluginManaged = !_parsedProviderIds.has(pid) && !_userAddedProviderIds.has(pid)
        if (isPluginManaged) continue  // skip — gateway plugin owns this provider's config

        const models = p.models.filter(m => !_stubModelKeys.has(`${pid}/${m.id}`))
        const cleaned: GwModelProvider = {
          ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
          ...(p.api     ? { api: p.api }         : {}),
          ...(p.apiKey  ? { apiKey: p.apiKey }   : {}),
          models,
        }
        if (!isPluginOnly) {
          providersToSave[pid] = cleaned
        } else if (models.length > 0 || cleaned.baseUrl || cleaned.api || cleaned.apiKey) {
          providersToSave[pid] = cleaned
        }
      }

      // Persist model pricing for plugin-managed providers to local store
      const localPricing: Record<string, Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>> = {}
      for (const [pid, p] of Object.entries(providers)) {
        const isPluginManaged = !_parsedProviderIds.has(pid) && !_userAddedProviderIds.has(pid)
        if (!isPluginManaged) continue
        const modelPricing: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {}
        for (const m of p.models) {
          if (m.cost) modelPricing[m.id] = m.cost
        }
        if (Object.keys(modelPricing).length > 0) localPricing[pid] = modelPricing
      }
      await patchLocalStore({ modelPricing: localPricing })

      const patch = {
        models: { providers: providersToSave },
        plugins: { entries: pluginEntries },
      }
      // The gateway refuses to SHRINK any array in a merge patch unless its exact path
      // is named in replacePaths — including arrays NESTED in model elements (e.g.
      // `models.providers.google.models[].input`), which round-tripping replaces
      // wholesale. Collect every array path in the payload so each is treated as an
      // intentional replacement, not an accidental removal.
      const arrayPaths: string[] = []
      collectArrayPaths(patch, '', arrayPaths)
      const replacePaths = [...new Set(arrayPaths)]
      const params: Record<string, unknown> = { raw: JSON.stringify(patch) }
      if (_baseHash) params.baseHash = _baseHash
      if (replacePaths.length) params.replacePaths = replacePaths

      await gatewayClient.request('config.patch', params)
      await get().load()
      set({ saving: false })
    } catch (e) {
      set({ saving: false, error: String(e) })
      throw e
    }
  },
}))
