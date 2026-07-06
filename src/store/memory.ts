import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MemoryConnection, MemoryAccess, MemoryGraph, MemoryItem, MemoryConnInfo } from '../lib/memory/types'
import { memoryProvider, MEMORY_PROVIDERS } from '../lib/memory/providers'
import { isRemoteGatewayState } from './connection'
import { gatewayClient } from '../lib/gateway'

// Provider-neutral memory connections: Obsidian, Markdown folder, … Each connection
// exposes a store to gateway agents via a generated SKILL.md. The skill is written where
// the agents run: for a LOCAL gateway, the Electron bridge writes ~/.openclaw/skills;
// for a REMOTE gateway, the joaxclaw-fs plugin's memory.skill.* RPC writes it on the host.

type MemApi = {
  writeSkill: (slug: string, markdown: string) => Promise<{ ok: boolean; error?: string }>
  removeSkill: (slug: string) => Promise<{ ok: boolean; error?: string }>
}
const memApi = (): MemApi | undefined => (window as unknown as { api?: { memory?: MemApi } }).api?.memory

// True once the connected remote gateway's joaxclaw-fs plugin is confirmed to expose
// memory.* (via memory.status). Local gateways don't use it. Set by probePlugin().
let remotePluginReady = false

async function pushSkill(slug: string, markdown: string) {
  if (isRemoteGatewayState()) await gatewayClient.request('memory.skill.set', { slug, markdown })
  else await memApi()?.writeSkill(slug, markdown)
}
async function dropSkill(slug: string) {
  if (isRemoteGatewayState()) await gatewayClient.request('memory.skill.remove', { slug })
  else await memApi()?.removeSkill(slug)
}

// Rebuild every provider's agent skill from the current connections. A provider with no
// enabled, non-off connection has its skill removed. Access is conservative: read-write
// only when EVERY included connection is read-write (never advertise write we don't mean).
function syncSkills(connections: MemoryConnection[]) {
  // Local needs the Electron bridge; remote needs the joaxclaw-fs memory plugin. If
  // neither is available, do nothing (the UI shows the appropriate notice).
  if (isRemoteGatewayState() ? !remotePluginReady : !memApi()) return
  for (const def of MEMORY_PROVIDERS) {
    const active = connections.filter(c => c.providerId === def.id && c.enabled && c.access !== 'off')
    if (active.length === 0) {
      void dropSkill(def.skillSlug).catch(() => { /* best-effort */ })
      continue
    }
    const access: Exclude<MemoryAccess, 'off'> = active.every(c => c.access === 'read-write') ? 'read-write' : 'read-only'
    const spec = def.buildSkill(active.map(c => ({ name: c.name, config: c.config })), access)
    void pushSkill(spec.slug, spec.markdown).catch(() => { /* best-effort */ })
  }
}

// Gateway errors arrive as an Error whose message is a JSON string
// ({"code":…,"message":…}); surface just the human message.
function cleanErr(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  try {
    const p = JSON.parse(s) as { message?: string }
    if (p?.message) return p.message
  } catch { /* not JSON */ }
  return s
}

let _idCounter = 0
function newId(): string {
  // No Math.random / Date.now in this codebase's guarded paths — a monotonic counter
  // plus the providerId is unique enough for local connection keys.
  return `mc_${++_idCounter}_${MEMORY_PROVIDERS.length}`
}

interface MemoryState {
  connections: MemoryConnection[]
  selectedId: string | null

  // browse state for the selected connection
  loading: boolean
  progress: number
  graph: MemoryGraph | null
  items: MemoryItem[] | null
  info: MemoryConnInfo | null
  error: string | null
  preview: { id: string; title: string; content: string } | null
  previewLoading: boolean

  // Remote plugin readiness: null when the gateway is local (n/a), true/false when the
  // gateway is remote (whether joaxclaw-fs exposes memory.*). Drives the Memory tab's
  // "install the plugin" notice vs. the full management UI.
  remoteReady: boolean | null

  probePlugin: () => Promise<void>
  addConnection: (providerId: string, name: string, config: Record<string, string>, access: MemoryAccess) => void
  updateConnection: (id: string, patch: Partial<Pick<MemoryConnection, 'name' | 'config'>>) => void
  removeConnection: (id: string) => void
  setEnabled: (id: string, enabled: boolean) => void
  setAccess: (id: string, access: MemoryAccess) => void
  select: (id: string) => Promise<void>
  refresh: () => Promise<void>
  openItem: (itemId: string) => Promise<void>
  test: (providerId: string, config: Record<string, string>) => Promise<{ ok: boolean; info?: MemoryConnInfo; error?: string }>
}

// Load content (graph or item list) for the selected connection based on its provider.
async function loadContent(get: () => MemoryState, set: (p: Partial<MemoryState>) => void, id: string) {
  const conn = get().connections.find(c => c.id === id)
  if (!conn) return
  set({ loading: true, error: null, graph: null, items: null, info: null, preview: null, progress: 0 })
  // On a remote gateway the store lives on the host — browse it through the plugin:
  // memory.graph for graph providers (Obsidian), memory.list for the rest.
  if (isRemoteGatewayState()) {
    const rdef = memoryProvider(conn.providerId)
    try {
      if (rdef?.viewer === 'graph') {
        const res = await gatewayClient.request<{ graph?: MemoryGraph }>('memory.graph', { providerId: conn.providerId, config: conn.config })
        if (get().selectedId !== id) return
        const graph = res?.graph ?? { nodes: [], edges: [] }
        set({ graph, info: { totalItems: graph.nodes.length, note: `${graph.edges.length} links` }, loading: false, progress: 1 })
      } else {
        const res = await gatewayClient.request<{ items?: MemoryItem[] }>('memory.list', { providerId: conn.providerId, config: conn.config })
        if (get().selectedId !== id) return
        const items = res?.items ?? []
        set({ items, info: { totalItems: items.length }, loading: false })
      }
    } catch (e) {
      if (get().selectedId === id) set({ error: cleanErr(e), loading: false })
    }
    return
  }
  const def = memoryProvider(conn.providerId)
  if (!def?.adapter) { set({ error: 'This provider has no browser yet.', loading: false }); return }
  try {
    if (def.viewer === 'graph' && def.adapter.graph) {
      const graph = await def.adapter.graph(conn.config, p => {
        if (get().selectedId === id) set({ progress: p })
      })
      if (get().selectedId !== id) return   // user switched away mid-load
      set({ graph, info: { totalItems: graph.nodes.length, note: `${graph.edges.length} links` }, loading: false, progress: 1 })
    } else {
      const items = await def.adapter.list(conn.config)
      if (get().selectedId !== id) return
      set({ items, info: { totalItems: items.length }, loading: false })
    }
  } catch (e) {
    if (get().selectedId === id) set({ error: String(e), loading: false })
  }
}

// Compatibility selector for the few views that still consume the old
// "Obsidian vaults" shape (Agent map, Process collaboration vault picker) — now
// derived from the unified memory connections instead of a separate store.
export interface ObsidianVaultRef { name: string; url: string; apiKey: string }
export function useObsidianVaults(): ObsidianVaultRef[] {
  const connections = useMemoryStore(s => s.connections)
  return useMemo(
    () => connections
      .filter(c => c.providerId === 'obsidian' && c.enabled)
      .map(c => ({ name: c.name, url: c.config.url ?? '', apiKey: c.config.apiKey ?? '' })),
    [connections],
  )
}

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set, get) => ({
      connections: [],
      selectedId: null,
      loading: false,
      progress: 0,
      graph: null,
      items: null,
      info: null,
      error: null,
      preview: null,
      previewLoading: false,
      remoteReady: null,

      async probePlugin() {
        if (!isRemoteGatewayState()) { remotePluginReady = false; set({ remoteReady: null }); return }
        try {
          await gatewayClient.request('memory.status', {}, 8000)
          remotePluginReady = true
          set({ remoteReady: true })
        } catch {
          remotePluginReady = false
          set({ remoteReady: false })
        }
      },

      addConnection(providerId, name, config, access) {
        const conn: MemoryConnection = { id: newId(), providerId, name: name.trim() || providerId, enabled: true, access, config }
        const connections = [...get().connections, conn]
        set({ connections, selectedId: conn.id })
        syncSkills(connections)
        void loadContent(get, set, conn.id)
      },

      updateConnection(id, patch) {
        const connections = get().connections.map(c => c.id === id ? { ...c, ...patch } : c)
        set({ connections })
        syncSkills(connections)
        if (get().selectedId === id) void loadContent(get, set, id)
      },

      removeConnection(id) {
        const connections = get().connections.filter(c => c.id !== id)
        const selectedId = get().selectedId === id ? (connections[0]?.id ?? null) : get().selectedId
        set({ connections, selectedId, graph: null, items: null, preview: null })
        syncSkills(connections)
        if (selectedId) void loadContent(get, set, selectedId)
      },

      setEnabled(id, enabled) {
        const connections = get().connections.map(c => c.id === id ? { ...c, enabled } : c)
        set({ connections })
        syncSkills(connections)
      },

      setAccess(id, access) {
        const connections = get().connections.map(c => c.id === id ? { ...c, access } : c)
        set({ connections })
        syncSkills(connections)
      },

      async select(id) {
        set({ selectedId: id })
        await loadContent(get, set, id)
      },

      async refresh() {
        const id = get().selectedId
        if (id) await loadContent(get, set, id)
      },

      async openItem(itemId) {
        const id = get().selectedId
        const conn = get().connections.find(c => c.id === id)
        const def = conn && memoryProvider(conn.providerId)
        if (!conn) return
        const title = get().items?.find(i => i.id === itemId)?.title ?? itemId
        set({ previewLoading: true, preview: { id: itemId, title, content: '' } })
        try {
          const content = isRemoteGatewayState()
            ? (await gatewayClient.request<{ content?: string }>('memory.read', { providerId: conn.providerId, config: conn.config, id: itemId }))?.content ?? ''
            : def?.adapter
              ? await def.adapter.read(conn.config, itemId)
              : ''
          if (get().selectedId === id) set({ preview: { id: itemId, title, content }, previewLoading: false })
        } catch (e) {
          if (get().selectedId === id) set({ preview: { id: itemId, title, content: `Could not read this item.\n\n${cleanErr(e)}` }, previewLoading: false })
        }
      },

      async test(providerId, config) {
        // On a remote gateway the store lives on the host, so test THERE (via the plugin)
        // — not from this client, which can't reach the host's localhost and would
        // resolve env-var credentials from the wrong machine. memory.list doubles as the
        // reachability + auth check.
        if (isRemoteGatewayState()) {
          try {
            const res = await gatewayClient.request<{ items?: MemoryItem[] }>('memory.list', { providerId, config })
            const n = res?.items?.length ?? 0
            return { ok: true, info: { totalItems: n, note: `${n} item${n === 1 ? '' : 's'} on the gateway host` } }
          } catch (e) {
            return { ok: false, error: cleanErr(e) }
          }
        }
        const def = memoryProvider(providerId)
        if (!def?.adapter) return { ok: false, error: 'No adapter for this provider.' }
        return def.adapter.test(config)
      },
    }),
    {
      name: 'joaxclaw-memory',
      partialize: s => ({ connections: s.connections }),
      // One-time migration: fold the old single-provider Obsidian vaults into connections.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state.connections.length > 0) return
        try {
          const rawVaults = localStorage.getItem('joaxclaw-obsidian-vaults')
          if (!rawVaults) return
          const vaults = JSON.parse(rawVaults) as Array<{ name?: string; url?: string; apiKey?: string }>
          const access = (localStorage.getItem('joaxclaw-obsidian-agent-access') as MemoryAccess) || 'read-write'
          const migrated: MemoryConnection[] = vaults
            .filter(v => v?.url)
            .map((v, i) => ({
              id: `mc_obsidian_${i}`,
              providerId: 'obsidian',
              name: v.name || 'Obsidian',
              enabled: true,
              access: access === 'off' ? 'read-only' : access,
              config: { url: v.url ?? '', apiKey: v.apiKey ?? '' },
            }))
          if (migrated.length) {
            state.connections = migrated
            state.selectedId = migrated[0].id
          }
        } catch { /* migration is best-effort */ }
      },
    }
  )
)
