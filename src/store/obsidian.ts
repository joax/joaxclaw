import { create } from 'zustand'

const VAULTS_KEY  = 'joaxclaw-obsidian-vaults'
const ACTIVE_KEY  = 'joaxclaw-obsidian-active'
const ACCESS_KEY  = 'joaxclaw-obsidian-agent-access'
const LEGACY_KEY  = 'joaxclaw-obsidian'

// How much of the vault the gateway's AGENTS may reach (via the obsidian-memory skill
// the app writes to ~/.openclaw/skills). Distinct from the app's own access, which is
// always full. 'off' removes the skill entirely so agents can't see the vault.
export type AgentAccess = 'off' | 'read-only' | 'read-write'

export interface ObsidianConfig {
  name: string      // display label, e.g. "Personal", "Work"
  mode: 'local' | 'remote'
  url: string       // e.g. "http://localhost:27123"
  apiKey: string
}

export interface VaultInfo {
  totalFiles: number
  mdFiles: number
}

export interface GraphNode {
  id: string        // file path (unique key)
  title: string     // filename without .md
  folder: string    // top-level folder, '' for vault root
  linkCount: number
}

export interface GraphEdge {
  source: string   // node id
  target: string   // node id
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

interface ObsidianState {
  vaults: ObsidianConfig[]
  activeVaultUrl: string | null
  config: ObsidianConfig | null   // = active vault
  agentAccess: AgentAccess         // what gateway agents may do with the vault
  vaultInfo: VaultInfo | null
  graph: GraphData | null
  loadingGraph: boolean
  graphProgress: number            // 0–1
  error: string | null

  loadConfig: () => void
  addVault: (config: ObsidianConfig) => void
  removeVault: (url: string) => void
  setActiveVault: (url: string) => void
  setAgentAccess: (access: AgentAccess) => void
  saveConfig: (config: ObsidianConfig) => void  // alias for addVault
  clearConfig: () => void                        // removes active vault
  writeSkillFile: () => Promise<void>
  testConnection: (config: ObsidianConfig) => Promise<{ ok: boolean; vaultInfo?: VaultInfo; error?: string }>
  loadGraph: () => Promise<void>
}

function readVaults(): { vaults: ObsidianConfig[]; activeUrl: string | null } {
  try {
    const arr = JSON.parse(localStorage.getItem(VAULTS_KEY) ?? 'null')
    if (Array.isArray(arr) && arr.length > 0) {
      const active = localStorage.getItem(ACTIVE_KEY) ?? arr[0].url
      return { vaults: arr, activeUrl: active }
    }
  } catch { /* fall through */ }

  // Migrate from old single-vault format
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null')
    if (old?.url) {
      const migrated: ObsidianConfig = { name: 'Primary', mode: old.mode ?? 'local', url: old.url, apiKey: old.apiKey ?? '' }
      return { vaults: [migrated], activeUrl: old.url }
    }
  } catch { /* fall through */ }

  return { vaults: [], activeUrl: null }
}

// Default 'read-write' preserves the prior behavior, where configuring a vault always
// gave agents full read+write access via the skill file.
function readAgentAccess(): AgentAccess {
  const v = localStorage.getItem(ACCESS_KEY)
  return v === 'off' || v === 'read-only' || v === 'read-write' ? v : 'read-write'
}

function persist(vaults: ObsidianConfig[], activeUrl: string | null) {
  localStorage.setItem(VAULTS_KEY, JSON.stringify(vaults))
  if (activeUrl) localStorage.setItem(ACTIVE_KEY, activeUrl)
  else localStorage.removeItem(ACTIVE_KEY)
}

function deriveConfig(vaults: ObsidianConfig[], activeUrl: string | null): ObsidianConfig | null {
  return vaults.find(v => v.url === activeUrl) ?? vaults[0] ?? null
}

function normalizeApiKey(key: string): string {
  return key.trim().replace(/^Bearer\s+/i, '')
}

async function apiFetch(config: ObsidianConfig, path: string, extra: Record<string, string> = {}): Promise<Response> {
  const base = config.url.replace(/\/$/, '')
  const key = normalizeApiKey(config.apiKey)
  const headers: Record<string, string> = { ...extra }
  if (key) headers['Authorization'] = `Bearer ${key}`
  return fetch(base + path, { headers })
}

// Read Obsidian's excluded file patterns from .obsidian/app.json (best-effort).
// Obsidian stores these under Settings → Files & Links → Excluded files.
async function fetchVaultExcludePatterns(config: ObsidianConfig): Promise<string[]> {
  try {
    const res = await apiFetch(config, '/vault/.obsidian/app.json')
    if (!res.ok) return []
    const json = await res.json() as Record<string, unknown>
    const raw = json['userIgnoreFilters']
    if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string' && s.length > 0)
  } catch { /* best-effort */ }
  return []
}

// Returns true if the vault-relative path matches any of Obsidian's exclusion patterns.
// Obsidian matches with simple path.includes(filter), case-insensitive.
function isVaultExcluded(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  const lower = path.toLowerCase()
  return patterns.some(p => lower.includes(p.toLowerCase()))
}

// Recursively list all markdown files in the vault.
// GET /vault/{dir}/ returns immediate children: plain names for files, names ending
// with "/" for subdirectories. We recurse into every subdirectory.
async function listAllFiles(
  config: ObsidianConfig,
  dirPath = '',
  depth = 0
): Promise<string[]> {
  if (depth > 15) return []
  try {
    const encodedDir = dirPath
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/') + (dirPath ? '/' : '')
    const res = await apiFetch(config, '/vault/' + encodedDir)
    if (!res.ok) return []
    const data = await res.json() as { files?: string[] }
    const entries = data.files ?? []

    const files: string[] = []
    const subdirFetches: Promise<string[]>[] = []

    for (const entry of entries) {
      if (entry.startsWith('.')) continue  // skip hidden dirs (.trash, .obsidian, etc.)
      if (entry.endsWith('/')) {
        subdirFetches.push(listAllFiles(config, dirPath + entry, depth + 1))
      } else {
        files.push(dirPath + entry)
      }
    }

    const subResults = await Promise.all(subdirFetches)
    for (const sub of subResults) files.push(...sub)
    return files
  } catch {
    return []
  }
}

// Sync the gateway-agent skill file to the current vaults + access level. 'off' (or no
// vaults) removes the skill so agents can't reach the vault; otherwise the skill is
// (re)written in read-only or read-write form. Best-effort — failures are non-fatal.
function syncAgentSkill(vaults: ObsidianConfig[], access: AgentAccess) {
  const api = (window as unknown as {
    api?: {
      obsidian?: {
        writeSkill?: (v: Array<{ name: string; url: string; apiKey: string }>, mode: 'read-only' | 'read-write') => Promise<unknown>
        removeSkill?: () => Promise<unknown>
      }
    }
  }).api
  if (access === 'off' || vaults.length === 0) {
    api?.obsidian?.removeSkill?.()?.catch(() => { /* best-effort */ })
    return
  }
  api?.obsidian?.writeSkill?.(vaults.map(v => ({ name: v.name, url: v.url, apiKey: v.apiKey })), access)
    ?.catch(() => { /* best-effort */ })
}

export const useObsidianStore = create<ObsidianState>((set, get) => ({
  vaults: [],
  activeVaultUrl: null,
  config: null,
  agentAccess: readAgentAccess(),
  vaultInfo: null,
  graph: null,
  loadingGraph: false,
  graphProgress: 0,
  error: null,

  loadConfig() {
    const { vaults, activeUrl } = readVaults()
    set({ vaults, activeVaultUrl: activeUrl, config: deriveConfig(vaults, activeUrl), agentAccess: readAgentAccess() })
  },

  addVault(config) {
    const { vaults, activeVaultUrl } = get()
    const normalized = { ...config, apiKey: normalizeApiKey(config.apiKey) }
    const idx = vaults.findIndex(v => v.url === normalized.url)
    const updated = idx >= 0
      ? vaults.map((v, i) => i === idx ? normalized : v)
      : [...vaults, normalized]
    const newActive = activeVaultUrl ?? config.url
    persist(updated, newActive)
    set({ vaults: updated, activeVaultUrl: newActive, config: deriveConfig(updated, newActive), error: null })
    syncAgentSkill(updated, get().agentAccess)
  },

  removeVault(url) {
    const { vaults, activeVaultUrl } = get()
    const updated = vaults.filter(v => v.url !== url)
    let newActive = activeVaultUrl === url
      ? (updated[0]?.url ?? null)
      : activeVaultUrl
    if (updated.length === 0) newActive = null
    persist(updated, newActive)
    const newConfig = deriveConfig(updated, newActive)
    set({
      vaults: updated, activeVaultUrl: newActive, config: newConfig,
      vaultInfo: newConfig ? null : null,
      graph: newConfig ? get().graph : null,
    })
    syncAgentSkill(updated, get().agentAccess)
  },

  setActiveVault(url) {
    const { vaults } = get()
    const config = vaults.find(v => v.url === url) ?? null
    if (!config) return
    localStorage.setItem(ACTIVE_KEY, url)
    set({ activeVaultUrl: url, config, graph: null, vaultInfo: null, error: null })
  },

  setAgentAccess(access) {
    localStorage.setItem(ACCESS_KEY, access)
    set({ agentAccess: access })
    syncAgentSkill(get().vaults, access)
  },

  saveConfig(config) {
    get().addVault(config)
  },

  clearConfig() {
    const { activeVaultUrl } = get()
    if (activeVaultUrl) get().removeVault(activeVaultUrl)
  },

  async writeSkillFile() {
    syncAgentSkill(get().vaults, get().agentAccess)
  },

  async testConnection(config) {
    try {
      const res = await apiFetch(config, '/vault/')
      if (res.status === 401) throw new Error('Invalid API key — copy it exactly from Obsidian → Settings → Local REST API → API Key')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { files?: string[] }
      const entries = data.files ?? []
      const rootMd = entries.filter(f => f.endsWith('.md')).length
      const folders = entries.filter(f => f.endsWith('/')).length
      return {
        ok: true,
        vaultInfo: { totalFiles: entries.length, mdFiles: rootMd + (folders > 0 ? -1 : 0) }
      }
    } catch (e) {
      const msg = String(e)
      const friendly = msg.includes('Failed to fetch') || msg.includes('fetch')
        ? `Cannot reach ${config.url} — check that Obsidian is open with the Local REST API plugin enabled. If using HTTPS (port 27124), restart the app once to apply the certificate trust update.`
        : msg
      return { ok: false, error: friendly }
    }
  },

  async loadGraph() {
    const config = get().config
    if (!config) return

    set({ loadingGraph: true, error: null, graphProgress: 0, graph: null })

    try {
      // Verify connectivity first
      const checkRes = await apiFetch(config, '/vault/')
      if (!checkRes.ok) throw new Error(`Cannot list vault: HTTP ${checkRes.status}`)

      // Recursively enumerate all files and read Obsidian's excluded-path patterns (progress 0→15%)
      set({ graphProgress: 0.02 })
      const [allFiles, excludePatterns] = await Promise.all([
        listAllFiles(config),
        fetchVaultExcludePatterns(config),
      ])
      set({ graphProgress: 0.15 })

      const mdFiles = allFiles.filter(f => {
        if (!f.endsWith('.md')) return false
        // Skip Excalidraw drawings stored as .excalidraw.md — they are not prose notes
        if (f.endsWith('.excalidraw.md')) return false
        // Apply Obsidian's "Excluded files" patterns (Settings → Files & Links)
        if (isVaultExcluded(f, excludePatterns)) return false
        return true
      })

      set({ vaultInfo: { totalFiles: allFiles.length, mdFiles: mdFiles.length } })

      // Build two lookup maps so both [[Title]] and [[folder/Title]] resolve correctly
      const titleToId = new Map<string, string>()  // lowercase bare title → path
      const pathToId  = new Map<string, string>()  // lowercase path-without-ext → path

      const nodes: GraphNode[] = mdFiles.map(path => {
        const parts = path.split('/')
        const title = parts[parts.length - 1].replace(/\.md$/, '')
        const folder = parts.length > 1 ? parts[0] : ''
        const key = title.toLowerCase()
        // First writer wins — if two notes share a title, prefer the one we see first
        if (!titleToId.has(key)) titleToId.set(key, path)
        pathToId.set(path.replace(/\.md$/i, '').toLowerCase(), path)
        return { id: path, title, folder, linkCount: 0 }
      })

      function resolveLink(raw: string): string | undefined {
        // Strip URL encoding, leading ./, and .md extension then look up
        let clean = raw.trim()
        try { clean = decodeURIComponent(clean) } catch { /* keep as-is */ }
        clean = clean.replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase()
        // Full path match (handles [[folder/note]] and [text](folder/note.md))
        // then bare title as fallback (handles [[note]] when note is in a subfolder)
        return pathToId.get(clean) ?? titleToId.get(clean.split('/').pop() ?? clean)
      }

      const BATCH = 25

      // Pass 1: fetch all files, collect raw link strings and front-matter aliases.
      // We defer resolution until all aliases are known so that a link [[Alias of B]]
      // resolves correctly even when B is fetched in a later batch than the linking note.
      const rawLinksByFile = new Map<string, string[]>()  // path → raw link strings
      const aliasToPath    = new Map<string, string>()    // lowercase alias → canonical path

      for (let i = 0; i < mdFiles.length; i += BATCH) {
        const batch = mdFiles.slice(i, i + BATCH)
        await Promise.all(batch.map(async path => {
          try {
            const encodedPath = path.split('/').map(encodeURIComponent).join('/')
            const res = await apiFetch(config, '/vault/' + encodedPath, { 'Accept': 'text/markdown' })
            if (!res.ok) return
            const text = await res.text()

            // Extract YAML front-matter aliases so [[Alias]] links can be resolved
            const fmEnd = text.indexOf('\n---', 4)
            if (text.startsWith('---\n') && fmEnd !== -1) {
              const fm = text.slice(4, fmEnd)
              // aliases: [A, "B C"]  or  aliases:\n  - A\n  - "B C"
              const inline = fm.match(/^aliases:\s*\[([^\]]*)\]/m)
              if (inline) {
                for (const part of inline[1].split(',')) {
                  const a = part.trim().replace(/^["']|["']$/g, '').trim().toLowerCase()
                  if (a && !titleToId.has(a) && !aliasToPath.has(a)) aliasToPath.set(a, path)
                }
              } else {
                const block = fm.match(/^aliases:\s*\n((?:[ \t]+-[^\n]*(?:\n|$))+)/m)
                if (block) {
                  for (const line of block[1].split('\n')) {
                    const lm = line.match(/^[ \t]+-\s*(.+)/)
                    if (lm) {
                      const a = lm[1].trim().replace(/^["']|["']$/g, '').trim().toLowerCase()
                      if (a && !titleToId.has(a) && !aliasToPath.has(a)) aliasToPath.set(a, path)
                    }
                  }
                }
              }
            }

            // Collect raw link references — [[Wiki links]] and [text](file.md)
            const links: string[] = []
            for (const m of text.matchAll(/\[\[([^\]|#\n]+)/g)) links.push(m[1])
            for (const m of text.matchAll(/\[[^\]]*\]\(([^)#\n]+?\.md(?:[^)]*)?)\)/g)) {
              links.push(m[1].split('#')[0].trim())
            }
            if (links.length > 0) rawLinksByFile.set(path, links)
          } catch { /* skip per-file errors */ }
        }))
        set({ graphProgress: 0.15 + 0.70 * Math.min(1, (i + BATCH) / mdFiles.length) })
      }

      // Merge aliases into the title lookup so resolveLink can find them
      for (const [alias, path] of aliasToPath) {
        if (!titleToId.has(alias)) titleToId.set(alias, path)
      }

      // Pass 2: resolve all collected link references now that the alias map is complete
      const linkMap = new Map<string, Set<string>>()
      for (const [src, links] of rawLinksByFile) {
        const targets = new Set<string>()
        for (const raw of links) {
          const t = resolveLink(raw)
          if (t && t !== src) targets.add(t)
        }
        if (targets.size > 0) linkMap.set(src, targets)
      }

      const edges: GraphEdge[] = []
      const seen = new Set<string>()
      const nodeById = new Map(nodes.map(n => [n.id, n]))

      for (const [src, targets] of linkMap) {
        for (const tgt of targets) {
          const key = src < tgt ? `${src}║${tgt}` : `${tgt}║${src}`
          if (!seen.has(key)) {
            seen.add(key)
            edges.push({ source: src, target: tgt })
            const sn = nodeById.get(src); if (sn) sn.linkCount++
            const tn = nodeById.get(tgt); if (tn) tn.linkCount++
          }
        }
      }

      set({ graph: { nodes, edges }, loadingGraph: false, graphProgress: 1 })
    } catch (e) {
      set({ error: String(e), loadingGraph: false })
    }
  }
}))
