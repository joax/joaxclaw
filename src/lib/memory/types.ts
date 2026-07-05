// ── Memory backends: connection + provider model ────────────────────────────────
//
// The Memory tab manages connections between the gateway's agents and external
// memory/knowledge stores. Agents reach a store via a generated OpenClaw SKILL.md;
// the app browses a store via the provider's content adapter. Providers are declared
// declaratively in ./providers (mirrors the channels catalog in ../channels).

// What gateway agents may do with a store — drives which skill (if any) is generated.
export type MemoryAccess = 'off' | 'read-only' | 'read-write'

// Where the data lives relative to the gateway host.
export type MemoryLocation = 'server-local' | 'cloud'

// How the app renders a store's content in the browse pane.
export type MemoryViewer = 'graph' | 'notes' | 'items'

// A configured backend instance.
export interface MemoryConnection {
  id: string
  providerId: string
  name: string                     // user label, e.g. "Personal", "Work notes"
  enabled: boolean
  access: MemoryAccess
  config: Record<string, string>   // provider-specific: url, apiKey, path, space, …
}

// One field of a provider's connect form.
export interface MemoryFieldDef {
  key: string
  label: string
  kind: 'text' | 'url' | 'path' | 'secret'
  placeholder?: string
  required?: boolean
  help?: string
}

// A single browsable unit of memory content (a note, a file, a memory record).
export interface MemoryItem {
  id: string            // provider-unique (path, key, …)
  title: string
  subtitle?: string     // folder / timestamp / tags
  updatedAt?: number
}

// Graph shape for graph-capable providers (Obsidian, and later Cognee/Graphiti).
export interface MemoryGraphNode { id: string; title: string; folder: string; linkCount: number }
export interface MemoryGraphEdge { source: string; target: string }
export interface MemoryGraph { nodes: MemoryGraphNode[]; edges: MemoryGraphEdge[] }

export interface MemoryConnInfo { totalItems?: number; note?: string }

// The generated agent-facing skill written to the gateway host's skills dir.
export interface MemorySkillSpec { slug: string; markdown: string }

// How the app reads a backend to browse it. Config values are resolved literals.
// (SecretRef/scoped-token hardening is deferred to the P3 gateway plugin.)
export interface MemoryAdapter {
  test(config: Record<string, string>): Promise<{ ok: boolean; info?: MemoryConnInfo; error?: string }>
  list(config: Record<string, string>): Promise<MemoryItem[]>
  read(config: Record<string, string>, id: string): Promise<string>
  graph?(config: Record<string, string>, onProgress?: (p: number) => void): Promise<MemoryGraph>
}

// A declarative backend definition (the registry entry).
export interface MemoryProviderDef {
  id: string
  label: string
  blurb: string
  icon: string                  // emoji
  location: MemoryLocation
  viewer: MemoryViewer
  skillSlug: string             // the SKILL.md dir name this provider writes (stable)
  fields: MemoryFieldDef[]
  // Build the ONE skill exposing all enabled connections of this provider to agents.
  // access is never 'off' here (a provider with no enabled read/write conns emits none).
  buildSkill(conns: { name: string; config: Record<string, string> }[], access: Exclude<MemoryAccess, 'off'>): MemorySkillSpec
  adapter?: MemoryAdapter       // wired in the content-browsing increment
}
