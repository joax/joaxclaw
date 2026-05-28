import { create } from 'zustand'
import JSON5 from 'json5'
import type { Agent, AgentFile } from '../lib/types'
import { gatewayClient } from '../lib/gateway'

// ── openclaw.json config patcher ─────────────────────────────────────────────

type ConfigEntry = { id: string; subagents?: { allowAgents?: string[]; [k: string]: unknown }; [k: string]: unknown }
type OpenclawConfig = { agents?: { list?: ConfigEntry[]; [k: string]: unknown }; [k: string]: unknown }
type ConfigApi = { read: () => Promise<{ ok: boolean; text?: string }>; write: (t: string) => Promise<{ ok: boolean }> }

function configApi(): ConfigApi | null {
  try { return (window as unknown as { api: { config: ConfigApi } }).api.config }
  catch { return null }
}

async function persistSubAgentsToConfig(agentId: string, allowedSubAgents: string[]): Promise<void> {
  const api = configApi()
  if (!api) return
  const res = await api.read()
  if (!res.ok || !res.text) return
  const config = JSON5.parse(res.text) as OpenclawConfig
  const list = config.agents?.list
  if (!Array.isArray(list)) return
  const entry = list.find(a => a.id === agentId)
  if (!entry) return
  if (allowedSubAgents.length > 0) {
    entry.subagents = { ...(entry.subagents ?? {}), allowAgents: allowedSubAgents }
  } else {
    if (entry.subagents) {
      delete entry.subagents.allowAgents
      if (Object.keys(entry.subagents).length === 0) delete entry.subagents
    }
  }
  await api.write(JSON.stringify(config, null, 2))
}

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
      const res = await gatewayClient.request<AgentsListResult>('agents.list')
      set({ agents: res.agents ?? [], defaultId: res.defaultId ?? null, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  async update(id, changes) {
    // Apply immediately so UI is responsive, then confirm with the gateway
    set(s => ({
      agents: s.agents.map(a => a.id !== id ? a : {
        ...a,
        ...(changes.model !== undefined ? { model: changes.model } : {}),
        ...(changes.allowedSubAgents !== undefined ? { allowedSubAgents: changes.allowedSubAgents } : {})
      })
    }))
    const payload: Record<string, unknown> = { agentId: id }
    if (changes.model !== undefined) payload.model = changes.model.primary
    if (changes.modelFallbacks !== undefined) payload.modelFallbacks = changes.modelFallbacks
    if (changes.allowedSubAgents !== undefined) payload.allowedSubAgents = changes.allowedSubAgents
    await gatewayClient.request('agents.update', payload)
    if (changes.allowedSubAgents !== undefined) {
      await persistSubAgentsToConfig(id, changes.allowedSubAgents).catch(() => {})
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
    if (content === undefined) {
      throw new Error(`Unexpected response shape: ${JSON.stringify(res)}`)
    }
    return String(content)
  },

  async writeFile(agentId, filename, content) {
    await gatewayClient.request('agents.files.set', { agentId, name: filename, content })
  },

  async deleteFile(agentId, filename) {
    await gatewayClient.request('agents.files.delete', { agentId, name: filename })
  },

  async readRelationship(fromId, toId) {
    const api = configApi()
    if (!api) return ''
    const res = await api.read()
    if (!res.ok || !res.text) return ''
    const config = JSON5.parse(res.text) as OpenclawConfig
    const entry = config.agents?.list?.find(a => a.id === fromId)
    return (entry?.subagents as { allowAgents?: string[]; instructions?: Record<string, string> } | undefined)?.instructions?.[toId] ?? ''
  },

  async writeRelationship(fromId, toId, instructions) {
    const api = configApi()
    if (!api) throw new Error('Config API not available')
    const res = await api.read()
    if (!res.ok || !res.text) throw new Error('Could not read openclaw.json')
    const config = JSON5.parse(res.text) as OpenclawConfig
    const list = config.agents?.list
    if (!Array.isArray(list)) throw new Error('No agents list in config')
    const entry = list.find(a => a.id === fromId)
    if (!entry) throw new Error(`Agent ${fromId} not found in config`)
    const sub = (entry.subagents ?? {}) as { allowAgents?: string[]; instructions?: Record<string, string>; [k: string]: unknown }
    if (instructions.trim()) {
      sub.instructions = { ...(sub.instructions ?? {}), [toId]: instructions }
    } else {
      if (sub.instructions) {
        delete sub.instructions[toId]
        if (Object.keys(sub.instructions).length === 0) delete sub.instructions
      }
    }
    entry.subagents = sub
    const writeRes = await api.write(JSON.stringify(config, null, 2))
    if (!writeRes.ok) throw new Error('Failed to write openclaw.json')
  },
}))
