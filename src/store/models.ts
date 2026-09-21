import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { readLocalStore, patchLocalStore } from '../lib/localStore'
import type { GwModelProvider, GwModelDef } from '../lib/types'
import { collectArrayPaths, patchChangedNothing, type ConfigPatchResult } from '../lib/configPatch'

export { collectArrayPaths }

interface ModelsState {
  providers: Record<string, GwModelProvider>
  // provider IDs that came from plugin discovery (not originally in config.models.providers)
  pluginProviderIds: Set<string>
  // provider IDs present in the user's raw JSON5 config (not just plugin-injected runtime defaults)
  _parsedProviderIds: Set<string>
  // provider IDs the user explicitly added this session (not yet in the persisted config)
  _userAddedProviderIds: Set<string>
  // provider IDs the user DELETED this session. A merge patch keeps what it doesn't
  // mention, so a deletion only happens if the id is sent as null.
  _deletedProviderIds: Set<string>
  // plugin ids whose enabled state the user changed this session. Only these travel:
  // writing every resolved plugin back used to bloat the config file with entries the
  // user never set.
  _toggledPluginIds: Set<string>
  // provider IDs the user EDITED this session. A plugin-managed provider is left out of
  // the payload by default (see save()), but once it's edited it has to travel, or the
  // patch carries no change at all and the gateway answers "noop" — which looked like a
  // successful save that reverted on reload.
  _editedProviderIds: Set<string>
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
  _editedProviderIds: new Set(),
  _deletedProviderIds: new Set(),
  _toggledPluginIds: new Set(),
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

      set({ providers, pluginProviderIds, _parsedProviderIds, _userAddedProviderIds: new Set(), _editedProviderIds: new Set(), _deletedProviderIds: new Set(), _toggledPluginIds: new Set(), _stubModelKeys, pluginEnabled, selectedId, loading: false, dirty: false, error: null, _baseHash: snapshot.hash ?? null })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  selectProvider(id) {
    set({ selectedId: id })
  },

  setProviderEnabled(id, enabled) {
    set(s => ({ pluginEnabled: { ...s.pluginEnabled, [id]: enabled }, _toggledPluginIds: new Set([...s._toggledPluginIds, id]), dirty: true }))
  },

  updateProviderConfig(id, patch) {
    set(s => ({
      providers: { ...s.providers, [id]: { ...s.providers[id], ...patch } },
      _editedProviderIds: new Set([...s._editedProviderIds, id]),
      dirty: true,
    }))
  },

  addProvider(id, provider) {
    set(s => ({
      providers: { ...s.providers, [id]: provider },
      pluginEnabled: { ...s.pluginEnabled, [id]: true },
      _userAddedProviderIds: new Set([...s._userAddedProviderIds, id]),
      _toggledPluginIds: new Set([...s._toggledPluginIds, id]),
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
      return {
        providers, pluginEnabled, pluginProviderIds, selectedId, dirty: true,
        _deletedProviderIds: new Set([...s._deletedProviderIds, id]),
      }
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
      return { providers: { ...s.providers, [providerId]: { ...provider, models } }, dirty: true, _stubModelKeys, _editedProviderIds: new Set([...s._editedProviderIds, providerId]) }
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
        _editedProviderIds: new Set([...s._editedProviderIds, providerId]),
      }
    })
  },

  async save() {
    const { providers, pluginProviderIds, _parsedProviderIds, _userAddedProviderIds, _editedProviderIds, _deletedProviderIds, _toggledPluginIds, pluginEnabled, _baseHash, _stubModelKeys } = get()
    set({ saving: true })
    try {
      // Only the plugins the user actually toggled. A merge patch leaves the rest alone,
      // and sending every resolved plugin wrote dozens of entries the user never set.
      const pluginEntries: Record<string, unknown> = {}
      for (const id of _toggledPluginIds) {
        if (id in pluginEnabled) pluginEntries[id] = { enabled: pluginEnabled[id] }
      }

      // Build providers payload:
      // - Only save providers that are in the user's JSON5 config OR explicitly added this session.
      //   Plugin-managed providers (in runtime config but not in the user's parsed JSON5) are skipped
      //   because the gateway deep-merges patches with plugin defaults — those defaults may include
      //   invalid values (e.g. baseUrl: "") that fail schema validation and cannot be overridden via patch.
      // - Strip empty-string fields: gateway rejects e.g. baseUrl: "" (must be >=1 chars or absent)
      const providersToSave: Record<string, GwModelProvider | null> = {}
      // Deleted providers travel as null, which is how a merge patch removes a key.
      for (const pid of _deletedProviderIds) providersToSave[pid] = null
      for (const [pid, p] of Object.entries(providers)) {
        const isPluginOnly = pluginProviderIds.has(pid)
        // A plugin-managed provider is normally left to its plugin. Once the user edits
        // one it must be sent, or the patch contains nothing the gateway can apply.
        const isPluginManaged = !_parsedProviderIds.has(pid) && !_userAddedProviderIds.has(pid)
        if (isPluginManaged && !_editedProviderIds.has(pid)) continue

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
        const isPluginManaged = !_parsedProviderIds.has(pid) && !_userAddedProviderIds.has(pid) && !_editedProviderIds.has(pid)
        if (!isPluginManaged) continue
        const modelPricing: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {}
        for (const m of p.models) {
          if (m.cost) modelPricing[m.id] = m.cost
        }
        if (Object.keys(modelPricing).length > 0) localPricing[pid] = modelPricing
      }
      await patchLocalStore({ modelPricing: localPricing })

      const patch: Record<string, unknown> = {
        models: { providers: providersToSave },
        ...(Object.keys(pluginEntries).length ? { plugins: { entries: pluginEntries } } : {}),
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

      // The gateway can accept a patch and change nothing (`{ok:true, noop:true}`) —
      // for instance when the payload carries no edit. Reporting that as saved is how a
      // change could silently disappear on the next reload, so it's an error here.
      const res = await gatewayClient.request<ConfigPatchResult>('config.patch', params)
      if (patchChangedNothing(res)) {
        set({ saving: false, error: 'The gateway accepted the save but reported no change — nothing was written. Check the connection log for the config.patch reply.' })
        return
      }
      await get().load()
      set({ saving: false })
    } catch (e) {
      set({ saving: false, error: String(e) })
      throw e
    }
  },
}))
