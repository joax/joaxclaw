import { create } from 'zustand'
import type { Agent, AgentFile } from '../lib/types'
import { gatewayClient } from '../lib/gateway'

// ── config.get / config.patch helpers ────────────────────────────────────────

type SubagentEntry = { allowAgents?: string[]; instructions?: Record<string, string>; [k: string]: unknown }
type ConfigEntry   = { id: string; subagents?: SubagentEntry; [k: string]: unknown }
type ConfigShape   = { agents?: { list?: ConfigEntry[]; [k: string]: unknown }; [k: string]: unknown }
// config.get returns "config" (materialized runtime) AND "parsed" (raw JSON5).
// The raw agents.list with subagents fields lives in "parsed", not "config".
interface ConfigSnapshot { hash?: string; config?: ConfigShape; parsed?: ConfigShape }

async function getConfig(): Promise<ConfigSnapshot> {
  return gatewayClient.request<ConfigSnapshot>('config.get')
}

function rawList(snapshot: ConfigSnapshot): ConfigEntry[] | null {
  const list = (snapshot.parsed ?? snapshot.config)?.agents?.list
  return Array.isArray(list) ? list : null
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
  await gatewayClient.request('config.patch', {
    raw: JSON.stringify({ agents: { list: [{ id: agentId, subagents: subagentsPatch }] } }),
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

interface AgentsState {
  agents: Agent[]
  defaultId: string | null
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
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

      const configById = new Map<string, ConfigEntry>()
      for (const entry of rawList(snapshot) ?? []) {
        if (entry.id) configById.set(entry.id, entry)
      }

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
      const entry = rawList(snapshot)?.find(a => a.id === fromId)
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
