import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { pluginKeyStatus, type PluginKeyStatus } from '../lib/pluginConfig'
import { isRemoteGatewayState } from './connection'

export interface Plugin {
  id: string
  enabled: boolean
  name?: string
  description?: string
  path?: string
  source?: string
  version?: string
  origin?: string
  // API-key completeness: 'set' (configured), 'missing' (needs a key), 'n/a' (no key needed).
  keyStatus?: PluginKeyStatus
  // True for plugins surfaced from the gateway registry that have no config entry yet
  // (so we don't persist all of them on save — only ones the user actually touches).
  discovered?: boolean
  [key: string]: unknown
}

export interface Skill {
  id: string
  enabled: boolean
  name?: string
  description?: string
  trigger?: string
  agentId?: string
  filePath?: string
  emoji?: string
  source?: string
  bundled?: boolean
  [key: string]: unknown
}

export interface SkillStatusEntry {
  name: string
  skillKey: string
  description?: string
  filePath?: string
  baseDir?: string
  emoji?: string
  source?: string
  bundled?: boolean
  disabled?: boolean
  eligible?: boolean
}

export interface PluginMetaEntry {
  id: string
  name?: string
  description?: string
  version?: string
  source?: string
  origin?: string
  status?: string
  enabled?: boolean
  toolNames?: string[]
}

// ── Normalizers ───────────────────────────────────────────────────────────────

type EntriesMap = Record<string, unknown>

function normalizePlugins(entries: EntriesMap): Plugin[] {
  return Object.entries(entries).map(([key, value]) => {
    const r = (value ?? {}) as Record<string, unknown>
    return {
      ...r,
      id: String(r.id ?? key),
      enabled: Boolean(r.enabled ?? true),
      name: r.name !== undefined ? String(r.name) : key,
      description: r.description !== undefined ? String(r.description) : undefined,
      path: r.path !== undefined ? String(r.path) : undefined,
      source: r.source !== undefined ? String(r.source) : undefined,
    } as Plugin
  })
}

function normalizeSkills(entries: EntriesMap): Skill[] {
  return Object.entries(entries).map(([key, value]) => {
    const r = (value ?? {}) as Record<string, unknown>
    return {
      ...r,
      id: String(r.id ?? key),
      enabled: Boolean(r.enabled ?? true),
      name: r.name !== undefined ? String(r.name) : key,
      description: r.description !== undefined ? String(r.description) : undefined,
      trigger: r.trigger !== undefined ? String(r.trigger) : undefined,
      agentId: r.agentId !== undefined ? String(r.agentId) : undefined,
    } as Skill
  })
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface ExtensionsState {
  plugins: Plugin[]
  skills: Skill[]
  toolNameMap: Map<string, string>  // toolName → pluginId
  loading: boolean
  error: string | null
  dirty: boolean
  saving: boolean

  _baseHash: string | null

  load: () => Promise<void>
  setPluginEnabled: (id: string, enabled: boolean) => void
  setSkillEnabled: (id: string, enabled: boolean) => void
  removePlugin: (id: string) => void
  removeSkill: (id: string) => void
  addPlugin: (plugin: Plugin) => void
  addSkill: (skill: Skill) => void
  save: () => Promise<void>
}

export const useExtensionsStore = create<ExtensionsState>((set, get) => ({
  plugins: [],
  skills: [],
  toolNameMap: new Map(),
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
      // Parsed (raw) view keeps SecretRefs intact, so a key set as an env ref still
      // counts as configured when we compute per-plugin completeness below.
      const fullCfg = (snapshot.parsed ?? snapshot.config ?? {}) as Record<string, unknown>
      const pluginsSection = config.plugins as Record<string, unknown> | undefined
      const skillsSection = config.skills as Record<string, unknown> | undefined
      const pluginEntries = (pluginsSection?.entries ?? {}) as EntriesMap
      const skillEntries = (skillsSection?.entries ?? {}) as EntriesMap

      // Enrich skills with metadata from skills.status (description, filePath, etc.)
      // Also surface non-bundled discovered skills that aren't yet in config entries.
      let skillStatusMap: Record<string, SkillStatusEntry> = {}
      let skillStatusList: SkillStatusEntry[] = []
      try {
        const statusRes = await gatewayClient.request<{ skills?: SkillStatusEntry[] }>('skills.status', {})
        skillStatusList = statusRes?.skills ?? []
        for (const s of skillStatusList) {
          if (s.skillKey) skillStatusMap[s.skillKey] = s
          if (s.name) skillStatusMap[s.name] = s
        }
      } catch { /* non-critical */ }

      const configSkills = normalizeSkills(skillEntries).map(sk => {
        const status = skillStatusMap[sk.id] ?? skillStatusMap[sk.name ?? '']
        if (!status) return sk
        return {
          ...sk,
          description: sk.description ?? status.description,
          filePath: status.filePath,
          emoji: status.emoji,
          source: status.source,
          bundled: status.bundled,
        }
      })

      // Include user-installed (non-bundled) skills discovered by the gateway
      // that aren't already represented in the config entries.
      const configIds = new Set(configSkills.map(s => s.id))
      const discoveredSkills: Skill[] = skillStatusList
        .filter(s => s.skillKey && !s.bundled && !configIds.has(s.skillKey) && !configIds.has(s.name))
        .map(s => ({
          id: s.skillKey,
          enabled: !s.disabled,
          name: s.name,
          description: s.description,
          filePath: s.filePath,
          emoji: s.emoji,
          source: s.source,
          bundled: false,
        }))

      const skills = [...configSkills, ...discoveredSkills]

      // Enrich plugins with metadata from `openclaw plugins list --json`. This is the
      // LOCAL host's CLI, so it's authoritative only when the gateway is local (see the
      // remote-gateway-localhost pitfall); for remote we fall back to the gateway's own
      // plugins.list below.
      let pluginMetaMap: Record<string, PluginMetaEntry> = {}
      let cliPlugins: PluginMetaEntry[] = []
      try {
        const api = (window as unknown as { api?: { plugins?: { list: () => Promise<{ ok: boolean; plugins?: PluginMetaEntry[] }> } } }).api
        const res = await api?.plugins?.list()
        cliPlugins = res?.plugins ?? []
        for (const p of cliPlugins) {
          if (p.id) pluginMetaMap[p.id] = p
        }
      } catch { /* non-critical */ }

      // Build toolName → pluginId map from gateway plugins.list (includes toolNames per
      // plugin) and keep the gateway's registry — it's correct for a remote gateway.
      const toolNameMap = new Map<string, string>()
      let gwPlugins: PluginMetaEntry[] = []
      try {
        type GwPlugin = PluginMetaEntry & { toolNames?: string[] }
        const res = await gatewayClient.request<{ plugins?: GwPlugin[] }>('plugins.list', {})
        gwPlugins = res?.plugins ?? []
        for (const p of gwPlugins) {
          if (!p.id) continue
          for (const tn of p.toolNames ?? []) toolNameMap.set(tn, p.id)
          // Also merge toolNames into the meta map
          if (!pluginMetaMap[p.id]) pluginMetaMap[p.id] = p
          else pluginMetaMap[p.id] = { ...pluginMetaMap[p.id], ...p }
        }
      } catch { /* non-critical */ }

      const configPlugins = normalizePlugins(pluginEntries).map(p => {
        const keyStatus = pluginKeyStatus(fullCfg, p.id)
        const meta = pluginMetaMap[p.id]
        if (!meta) return { ...p, keyStatus }
        return {
          ...p,
          keyStatus,
          description: p.description ?? meta.description,
          name: p.name !== p.id ? p.name : (meta.name ?? p.name),
          version: meta.version,
          origin: meta.origin,
          source: p.source ?? meta.source,
        }
      })

      // Merge in plugins the gateway knows about that have no config entry yet, so the
      // FULL registry is visible (not just configured ones) — mirrors discoveredSkills.
      // Source: the local CLI when the gateway is local (lists every installed plugin,
      // including disabled stock ones); the gateway's own plugins.list when remote.
      const configPluginIds = new Set(configPlugins.map(p => p.id))
      const registry = isRemoteGatewayState() ? gwPlugins : (cliPlugins.length ? cliPlugins : gwPlugins)
      const seen = new Set(configPluginIds)
      const discoveredPlugins: Plugin[] = registry
        .filter(m => m.id && !seen.has(m.id) && (seen.add(m.id), true))
        .map(m => ({
          id: m.id,
          enabled: Boolean(m.enabled ?? m.status === 'enabled'),
          name: m.name ?? m.id,
          description: m.description,
          version: m.version,
          origin: m.origin,
          source: m.source,
          keyStatus: pluginKeyStatus(fullCfg, m.id),
          discovered: true,
        }))

      const plugins = [...configPlugins, ...discoveredPlugins]

      set({
        plugins,
        skills,
        toolNameMap,
        _baseHash: snapshot.hash ?? null,
        loading: false,
        dirty: false,
        error: null,
      })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  setPluginEnabled(id, enabled) {
    set(s => ({
      plugins: s.plugins.map(p => {
        if (p.id !== id) return p
        // Adopting a registry-discovered plugin: reduce it to a minimal entry so save()
        // writes just the enable state (no stale source path / version into config).
        if (p.discovered) return { id: p.id, enabled, name: p.name, description: p.description, keyStatus: p.keyStatus }
        return { ...p, enabled }
      }),
      dirty: true,
    }))
  },

  setSkillEnabled(id, enabled) {
    set(s => ({ skills: s.skills.map(sk => sk.id === id ? { ...sk, enabled } : sk), dirty: true }))
  },

  removePlugin(id) {
    set(s => ({ plugins: s.plugins.filter(p => p.id !== id), dirty: true }))
  },

  removeSkill(id) {
    set(s => ({ skills: s.skills.filter(sk => sk.id !== id), dirty: true }))
  },

  addPlugin(plugin) {
    set(s => ({ plugins: [...s.plugins, plugin], dirty: true }))
  },

  addSkill(skill) {
    set(s => ({ skills: [...s.skills, skill], dirty: true }))
  },

  async save() {
    const { plugins, skills, _baseHash } = get()
    set({ saving: true })
    try {
      const pluginEntries: Record<string, unknown> = {}
      for (const p of plugins) {
        // Untouched registry-discovered plugins have no config intent — don't persist
        // them (otherwise we'd write all ~90 stock plugins into the config).
        if (p.discovered) continue
        // Strip gateway-computed fields so they don't leak into the saved config.
        const { id, discovered: _d, keyStatus: _k, version: _v, origin: _o, ...rest } = p
        void _d; void _k; void _v; void _o
        pluginEntries[id] = rest
      }
      const skillEntries: Record<string, unknown> = {}
      for (const s of skills) {
        // Strip gateway-only fields — only config-relevant fields go into the patch
        const { id, filePath: _fp, emoji: _em, source: _src, bundled: _bu, ...rest } = s
        skillEntries[id] = rest
      }

      const patch = { plugins: { entries: pluginEntries }, skills: { entries: skillEntries } }
      const params: Record<string, unknown> = { raw: JSON.stringify(patch) }
      if (_baseHash) params.baseHash = _baseHash

      await gatewayClient.request('config.patch', params)

      // Reload to get fresh hash after the patch
      await get().load()
      set({ saving: false })
    } catch (e) {
      set({ saving: false, error: String(e) })
      throw e
    }
  },
}))
