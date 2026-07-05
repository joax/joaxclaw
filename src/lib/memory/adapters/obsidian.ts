// Obsidian content adapter — talks directly to the Obsidian Local REST API over HTTP.
// Ported from the original single-vault store into a config-driven MemoryAdapter so
// Obsidian is just one memory provider. config = { url, apiKey }.

import type { MemoryAdapter, MemoryItem, MemoryGraphNode, MemoryGraphEdge } from '../types'

type Cfg = Record<string, string>

function normalizeApiKey(key: string): string {
  return (key ?? '').trim().replace(/^Bearer\s+/i, '')
}

async function apiFetch(config: Cfg, path: string, extra: Record<string, string> = {}): Promise<Response> {
  const base = (config.url ?? '').replace(/\/$/, '')
  const key = normalizeApiKey(config.apiKey ?? '')
  const headers: Record<string, string> = { ...extra }
  if (key) headers['Authorization'] = `Bearer ${key}`
  return fetch(base + path, { headers })
}

// Obsidian's excluded-file patterns (Settings → Files & Links → Excluded files).
async function fetchVaultExcludePatterns(config: Cfg): Promise<string[]> {
  try {
    const res = await apiFetch(config, '/vault/.obsidian/app.json')
    if (!res.ok) return []
    const json = await res.json() as Record<string, unknown>
    const raw = json['userIgnoreFilters']
    if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string' && s.length > 0)
  } catch { /* best-effort */ }
  return []
}

function isVaultExcluded(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  const lower = path.toLowerCase()
  return patterns.some(p => lower.includes(p.toLowerCase()))
}

// Recursively list every markdown file in the vault.
async function listAllFiles(config: Cfg, dirPath = '', depth = 0): Promise<string[]> {
  if (depth > 15) return []
  try {
    const encodedDir = dirPath.split('/').filter(Boolean).map(encodeURIComponent).join('/') + (dirPath ? '/' : '')
    const res = await apiFetch(config, '/vault/' + encodedDir)
    if (!res.ok) return []
    const data = await res.json() as { files?: string[] }
    const entries = data.files ?? []
    const files: string[] = []
    const subdirFetches: Promise<string[]>[] = []
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      if (entry.endsWith('/')) subdirFetches.push(listAllFiles(config, dirPath + entry, depth + 1))
      else files.push(dirPath + entry)
    }
    for (const sub of await Promise.all(subdirFetches)) files.push(...sub)
    return files
  } catch {
    return []
  }
}

export const obsidianAdapter: MemoryAdapter = {
  async test(config) {
    try {
      const res = await apiFetch(config, '/vault/')
      if (res.status === 401) throw new Error('Invalid API key — copy it exactly from Obsidian → Settings → Local REST API → API Key')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { files?: string[] }
      const entries = data.files ?? []
      const rootMd = entries.filter(f => f.endsWith('.md')).length
      const folders = entries.filter(f => f.endsWith('/')).length
      return { ok: true, info: { totalItems: rootMd + (folders > 0 ? -1 : 0), note: `${entries.length} entries in vault root` } }
    } catch (e) {
      const msg = String(e)
      const friendly = msg.includes('Failed to fetch') || msg.includes('fetch')
        ? `Cannot reach ${config.url} — check that Obsidian is open with the Local REST API plugin enabled. If using HTTPS (port 27124), restart the app once to apply the certificate trust update.`
        : msg
      return { ok: false, error: friendly }
    }
  },

  async list(config) {
    const files = await listAllFiles(config)
    return files
      .filter(f => f.endsWith('.md') && !f.endsWith('.excalidraw.md'))
      .map<MemoryItem>(path => {
        const parts = path.split('/')
        return { id: path, title: parts[parts.length - 1].replace(/\.md$/, ''), subtitle: parts.length > 1 ? parts.slice(0, -1).join('/') : undefined }
      })
      .sort((a, b) => a.title.localeCompare(b.title))
  },

  async read(config, id) {
    const encodedPath = id.split('/').map(encodeURIComponent).join('/')
    const res = await apiFetch(config, '/vault/' + encodedPath, { 'Accept': 'text/markdown' })
    if (!res.ok) throw new Error(`Cannot read note: HTTP ${res.status}`)
    return res.text()
  },

  async graph(config, onProgress) {
    const checkRes = await apiFetch(config, '/vault/')
    if (!checkRes.ok) throw new Error(`Cannot list vault: HTTP ${checkRes.status}`)
    onProgress?.(0.02)

    const [allFiles, excludePatterns] = await Promise.all([listAllFiles(config), fetchVaultExcludePatterns(config)])
    onProgress?.(0.15)

    const mdFiles = allFiles.filter(f =>
      f.endsWith('.md') && !f.endsWith('.excalidraw.md') && !isVaultExcluded(f, excludePatterns))

    const titleToId = new Map<string, string>()
    const pathToId = new Map<string, string>()
    const nodes: MemoryGraphNode[] = mdFiles.map(path => {
      const parts = path.split('/')
      const title = parts[parts.length - 1].replace(/\.md$/, '')
      const folder = parts.length > 1 ? parts[0] : ''
      const key = title.toLowerCase()
      if (!titleToId.has(key)) titleToId.set(key, path)
      pathToId.set(path.replace(/\.md$/i, '').toLowerCase(), path)
      return { id: path, title, folder, linkCount: 0 }
    })

    function resolveLink(raw: string): string | undefined {
      let clean = raw.trim()
      try { clean = decodeURIComponent(clean) } catch { /* keep */ }
      clean = clean.replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase()
      return pathToId.get(clean) ?? titleToId.get(clean.split('/').pop() ?? clean)
    }

    const BATCH = 25
    const rawLinksByFile = new Map<string, string[]>()
    const aliasToPath = new Map<string, string>()

    for (let i = 0; i < mdFiles.length; i += BATCH) {
      const batch = mdFiles.slice(i, i + BATCH)
      await Promise.all(batch.map(async path => {
        try {
          const encodedPath = path.split('/').map(encodeURIComponent).join('/')
          const res = await apiFetch(config, '/vault/' + encodedPath, { 'Accept': 'text/markdown' })
          if (!res.ok) return
          const text = await res.text()
          const fmEnd = text.indexOf('\n---', 4)
          if (text.startsWith('---\n') && fmEnd !== -1) {
            const fm = text.slice(4, fmEnd)
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
          const links: string[] = []
          for (const m of text.matchAll(/\[\[([^\]|#\n]+)/g)) links.push(m[1])
          for (const m of text.matchAll(/\[[^\]]*\]\(([^)#\n]+?\.md(?:[^)]*)?)\)/g)) links.push(m[1].split('#')[0].trim())
          if (links.length > 0) rawLinksByFile.set(path, links)
        } catch { /* skip per-file */ }
      }))
      onProgress?.(0.15 + 0.70 * Math.min(1, (i + BATCH) / mdFiles.length))
    }

    for (const [alias, path] of aliasToPath) if (!titleToId.has(alias)) titleToId.set(alias, path)

    const linkMap = new Map<string, Set<string>>()
    for (const [src, links] of rawLinksByFile) {
      const targets = new Set<string>()
      for (const raw of links) { const t = resolveLink(raw); if (t && t !== src) targets.add(t) }
      if (targets.size > 0) linkMap.set(src, targets)
    }

    const edges: MemoryGraphEdge[] = []
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
    onProgress?.(1)
    return { nodes, edges }
  },
}
