import { create } from 'zustand'
import type { Agent, AgentFile } from '../lib/types'
import { gatewayClient } from '../lib/gateway'

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
    // Gateway expects agentId (not id), and model as a plain string (primary only)
    const payload: Record<string, unknown> = { agentId: id }
    if (changes.model !== undefined) payload.model = changes.model.primary
    if (changes.modelFallbacks !== undefined) payload.modelFallbacks = changes.modelFallbacks
    if (changes.allowedSubAgents !== undefined) payload.allowedSubAgents = changes.allowedSubAgents
    await gatewayClient.request('agents.update', payload)
    set(s => ({
      agents: s.agents.map(a => a.id !== id ? a : {
        ...a,
        ...(changes.model !== undefined ? { model: changes.model } : {}),
        ...(changes.allowedSubAgents !== undefined ? { allowedSubAgents: changes.allowedSubAgents } : {})
      })
    }))
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
  }
}))
