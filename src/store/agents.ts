import { create } from 'zustand'
import type { Agent, AgentFile } from '../lib/types'
import { gatewayClient } from '../lib/gateway'

// ── config.get / config.patch helpers ────────────────────────────────────────

type SubagentEntry = { allowAgents?: string[]; instructions?: Record<string, string>; [k: string]: unknown }
type ConfigEntry   = { subagents?: SubagentEntry; [k: string]: unknown }
// OpenClaw 2026.8 renamed `agents.list` (an array of entries, each carrying its own
// `id`) to `agents.entries` (a map keyed by agent id). Sending the old shape is now a
// hard INVALID_REQUEST — "Unrecognized key: list" — which is what broke saving
// subagents. `list` is read as a fallback so an un-migrated gateway still loads.
type AgentsSection = { entries?: Record<string, ConfigEntry>; list?: (ConfigEntry & { id?: string })[]; [k: string]: unknown }
type ConfigShape   = { agents?: AgentsSection; [k: string]: unknown }
// config.get returns "config" (materialized runtime) AND "parsed" (raw JSON5).
// The raw entries with subagents fields live in "parsed", not "config".
interface ConfigSnapshot { hash?: string; config?: ConfigShape; parsed?: ConfigShape }

async function getConfig(): Promise<ConfigSnapshot> {
  return gatewayClient.request<ConfigSnapshot>('config.get')
}

// Agent config entries keyed by id, from either config shape.
export function agentEntries(snapshot: ConfigSnapshot): Map<string, ConfigEntry> {
  const agents = (snapshot.parsed ?? snapshot.config)?.agents
  const out = new Map<string, ConfigEntry>()
  if (agents?.entries && typeof agents.entries === 'object') {
    for (const [id, entry] of Object.entries(agents.entries)) {
      if (entry && typeof entry === 'object') out.set(id, entry)
    }
    return out
  }
  for (const entry of agents?.list ?? []) {
    if (entry?.id) out.set(entry.id, entry)
  }
  return out
}

// Mirrors the gateway's normalizeAgentId — the agent id is derived from the name.
export function normalizeAgentId(name: string): string {
  return (name ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '') || 'main'
}

// The configured root under which non-default agent workspaces are created
// (gateway resolves a new agent's workspace to `<root>/<agentId>`).
function defaultWorkspaceRoot(snapshot: ConfigSnapshot): string | null {
  const agents = (snapshot.parsed ?? snapshot.config)?.agents as { defaults?: { workspace?: unknown } } | undefined
  const root = agents?.defaults?.workspace
  return typeof root === 'string' && root.trim() ? root.trim() : null
}

// Send a minimal patch touching only one agent entry and one field.
// Using the full raw list as a patch is broken because the runtime config has
// a different shape (e.g. model as object) than the raw JSON5 (model as string),
// causing validation failures or noop diffs when the full list is diffed against
// the runtime config.
async function patchAgentField(
  agentId: string,
  subagentsPatch: Record<string, unknown>,
  baseHash?: string
): Promise<void> {
  // A map keyed by id merges cleanly under RFC 7396 — only this agent's entry is
  // touched. `allowAgents` is an array, and the gateway refuses to SHRINK an array in a
  // merge patch unless its exact path is named in replacePaths, so removing a permitted
  // sub-agent silently kept the old, longer list without this.
  const replacePaths = Array.isArray(subagentsPatch.allowAgents)
    ? [`agents.entries.${agentId}.subagents.allowAgents`]
    : []
  await gatewayClient.request('config.patch', {
    raw: JSON.stringify({ agents: { entries: { [agentId]: { subagents: subagentsPatch } } } }),
    ...(replacePaths.length ? { replacePaths } : {}),
    ...(baseHash ? { baseHash } : {}),
  })
}

// ── store ─────────────────────────────────────────────────────────────────────

interface AgentsListResult {
  defaultId: string
  mainKey: string
  scope: 'per-sender' | 'global'
  agents: Agent[]
}

interface AgentUpdatePayload {
  model?: { primary: string; fallbacks?: string[] }
  modelFallbacks?: string[]
  allowedSubAgents?: string[]
}

// The gateway derives the agent id from `name`. Workspace may be left empty —
// the store fills in the gateway's default (`<defaults.workspace>/<agentId>`).
interface AgentCreatePayload {
  name: string
  workspace?: string
  model?: string
  emoji?: string
  avatar?: string
}

interface AgentsCreateResult {
  ok: true
  agentId: string
  name: string
  workspace: string
  model?: string
}

interface AgentsState {
  agents: Agent[]
  defaultId: string | null
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
  create: (payload: AgentCreatePayload) => Promise<string>
  defaultWorkspaceRoot: () => Promise<string | null>
  update: (id: string, changes: AgentUpdatePayload) => Promise<void>
  remove: (id: string) => Promise<void>
  listFiles: (agentId: string) => Promise<AgentFile[]>
  readFile: (agentId: string, filename: string) => Promise<string>
  writeFile: (agentId: string, filename: string, content: string) => Promise<void>
  deleteFile: (agentId: string, filename: string) => Promise<void>
  readRelationship: (fromId: string, toId: string) => Promise<string>
  writeRelationship: (fromId: string, toId: string, instructions: string) => Promise<void>
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  defaultId: null,
  loading: false,
  error: null,

  async fetch() {
    set({ loading: true, error: null })
    try {
      // agents.list does not return allowedSubAgents — read it from config in parallel
      const [res, snapshot] = await Promise.all([
        gatewayClient.request<AgentsListResult>('agents.list'),
        getConfig().catch(() => ({} as ConfigSnapshot)),
      ])

      const configById = agentEntries(snapshot)

      const agents = (res.agents ?? []).map(a => {
        const cfgEntry = configById.get(a.id)
        const allowedSubAgents = cfgEntry?.subagents?.allowAgents
        return allowedSubAgents?.length ? { ...a, allowedSubAgents } : a
      })

      set({ agents, defaultId: res.defaultId ?? null, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  async create(payload) {
    let workspace = payload.workspace?.trim() ?? ''
    // Empty workspace → fall back to the gateway default: <defaults.workspace>/<agentId>
    if (!workspace) {
      const root = await useAgentsStore.getState().defaultWorkspaceRoot()
      if (root) workspace = `${root.replace(/\/+$/, '')}/${normalizeAgentId(payload.name)}`
    }
    if (!workspace) {
      throw new Error('Workspace is required — no default (agents.defaults.workspace) is configured on the gateway.')
    }

    const params: Record<string, unknown> = { name: payload.name.trim(), workspace }
    const model = payload.model?.trim()
    if (model) params.model = model
    if (payload.emoji?.trim()) params.emoji = payload.emoji.trim()
    if (payload.avatar?.trim()) params.avatar = payload.avatar.trim()

    const res = await gatewayClient.request<AgentsCreateResult>('agents.create', params)
    // Re-fetch so the new agent (with config-derived fields) appears in the list
    await useAgentsStore.getState().fetch()
    return res.agentId
  },

  async defaultWorkspaceRoot() {
    try {
      return defaultWorkspaceRoot(await getConfig())
    } catch {
      return null
    }
  },

  async update(id, changes) {
    // Optimistic UI update
    set(s => ({
      agents: s.agents.map(a => a.id !== id ? a : {
        ...a,
        ...(changes.model !== undefined ? { model: changes.model } : {}),
        ...(changes.allowedSubAgents !== undefined ? { allowedSubAgents: changes.allowedSubAgents } : {})
      })
    }))

    // Model/name changes go through agents.update (allowedSubAgents is NOT accepted there)
    const payload: Record<string, unknown> = { agentId: id }
    if (changes.model !== undefined) payload.model = changes.model.primary
    if (changes.modelFallbacks !== undefined) payload.modelFallbacks = changes.modelFallbacks
    if (Object.keys(payload).length > 1) {
      await gatewayClient.request('agents.update', payload)
    }

    // Subagent changes go through config.patch (writes + hot-reloads gateway)
    if (changes.allowedSubAgents !== undefined) {
      const snapshot = await getConfig()
      const allowAgentsPatch = changes.allowedSubAgents.length > 0
        ? changes.allowedSubAgents
        : null  // null removes the key (RFC 7396)
      await patchAgentField(id, { allowAgents: allowAgentsPatch }, snapshot.hash)
    }
  },

  async remove(id) {
    set(s => ({ agents: s.agents.filter(a => a.id !== id) }))
    await gatewayClient.request('agents.delete', { id }).catch(() => {})
  },

  async listFiles(agentId) {
    const res = await gatewayClient.request<{ files: Record<string, unknown>[] }>('agents.files.list', { agentId })
    return (res.files ?? []).map(f => ({
      filename: (f.name ?? f.filename ?? '') as string,
      size: f.size as number | undefined,
      updatedAt: (f.updatedAtMs ?? f.updatedAt) as number | undefined
    }))
  },

  async readFile(agentId, filename) {
    const res = await gatewayClient.request<Record<string, unknown>>('agents.files.get', { agentId, name: filename })
    const file = res.file as Record<string, unknown> | undefined
    const content = file?.content ?? res.content ?? res.text
    if (content === undefined) throw new Error(`Unexpected response shape: ${JSON.stringify(res)}`)
    return String(content)
  },

  async writeFile(agentId, filename, content) {
    await gatewayClient.request('agents.files.set', { agentId, name: filename, content })
  },

  async deleteFile(agentId, filename) {
    await gatewayClient.request('agents.files.delete', { agentId, name: filename })
  },

  async readRelationship(fromId, toId) {
    try {
      const snapshot = await getConfig()
      const entry = agentEntries(snapshot).get(fromId)
      return entry?.subagents?.instructions?.[toId] ?? ''
    } catch {
      return ''
    }
  },

  async writeRelationship(fromId, toId, instructions) {
    const snapshot = await getConfig()
    const instructionValue = instructions.trim() || null  // null removes the key (RFC 7396)
    await patchAgentField(fromId, { instructions: { [toId]: instructionValue } }, snapshot.hash)
  },
}))
