// ── Memory provider registry ────────────────────────────────────────────────────
//
// Declarative catalog of memory backends, mirroring the channels catalog. Each entry
// supplies its connect-form fields and a skill builder (the agent-facing SKILL.md);
// content adapters (browse) are attached in the content-browsing increment.
//
// Adding a backend = one MemoryProviderDef here, not a new screen.

import type { MemoryProviderDef, MemorySkillSpec } from './types'
import { obsidianAdapter } from './adapters/obsidian'
import { markdownAdapter } from './adapters/markdown'
import { isEnvRef, envRefName } from './secrets'

// Obsidian — a vault reached over the Local REST API (HTTP + bearer key). Local to the
// gateway host (loopback) or a reachable LAN/cloud URL. Graph-viewable.
const OBSIDIAN: MemoryProviderDef = {
  id: 'obsidian',
  label: 'Obsidian',
  blurb: 'A vault served by the Obsidian Local REST API. Notes + backlink graph.',
  icon: '🟣',
  location: 'server-local',
  viewer: 'graph',
  skillSlug: 'obsidian-memory',
  fields: [
    { key: 'url', label: 'API URL', kind: 'url', placeholder: 'http://localhost:27123', required: true },
    { key: 'apiKey', label: 'API key', kind: 'secret', placeholder: 'Obsidian Local REST API key', required: true },
  ],
  buildSkill(conns, access): MemorySkillSpec {
    const write = access === 'read-write'
    const desc = write
      ? 'Read and write the user\'s Obsidian notes for durable memory. Use it to recall context and to save notes/facts the user should keep across sessions.'
      : 'Read the user\'s Obsidian notes for context. This is READ-ONLY — never create, edit, or delete notes.'
    const vaults = conns.map(c => {
      // An env-ref key stays out of the skill file: reference the env var instead of
      // embedding the secret. A literal is embedded (convenient, but less secure).
      const auth = isEnvRef(c.config.apiKey)
        ? `header \`Authorization: Bearer $${envRefName(c.config.apiKey)}\` — read the token from the \`${envRefName(c.config.apiKey)}\` environment variable (it is not stored here)`
        : `header \`Authorization: Bearer ${c.config.apiKey}\``
      return `- **${c.name}** — base URL \`${c.config.url}\`, ${auth}`
    }).join('\n')
    const rows = [
      '| List folder | GET | `/vault/{path}/` |',
      '| Read note | GET | `/vault/{path}` (`Accept: text/markdown`) |',
      '| Search | POST | `/search/simple?query=…` |',
      ...(write ? [
        '| Create / overwrite | PUT | `/vault/{path}` (body = markdown) |',
        '| Append | POST | `/vault/{path}` |',
      ] : []),
    ].join('\n')
    const md = [
      '---',
      'name: obsidian-memory',
      `description: ${desc}`,
      '---',
      '',
      '# Obsidian memory',
      '',
      `Your ${write ? 'read/write ' : 'read-only '}long-term memory lives in Obsidian vault(s), reachable over the Obsidian Local REST API.`,
      '',
      '## Vaults',
      vaults,
      '',
      '## API',
      '',
      '| Action | Method | Path |',
      '| --- | --- | --- |',
      rows,
      '',
      write
        ? 'Save durable facts/notes the user asks you to remember, or context worth keeping across sessions. Prefer updating an existing relevant note over creating many small ones.'
        : 'Do NOT modify anything. Read notes only to ground your answers.',
    ].join('\n')
    return { slug: 'obsidian-memory', markdown: md }
  },
  adapter: obsidianAdapter,
}

// Plain Markdown folder — a directory of .md files on the gateway host that agents
// read/write with their normal file tools. Zero external dependency; the simplest
// possible memory. Not graph-viewable (flat file list).
const MARKDOWN: MemoryProviderDef = {
  id: 'markdown',
  label: 'Markdown folder',
  blurb: 'A folder of Markdown files on the OpenClaw server the agent reads and writes with its file tools. No external app.',
  icon: '📁',
  location: 'server-local',
  viewer: 'notes',
  skillSlug: 'markdown-memory',
  fields: [
    { key: 'path', label: 'Folder', kind: 'path', placeholder: '~/.openclaw/workspace/memory', required: true, help: 'A directory on the gateway host. Created if missing.' },
  ],
  buildSkill(conns, access): MemorySkillSpec {
    const write = access === 'read-write'
    const desc = write
      ? 'Your durable long-term memory: Markdown files on this machine. Read them for context and write/update them to remember things across sessions.'
      : 'Your durable long-term memory: read-only Markdown files on this machine. Read them for context; never modify them.'
    const folders = conns.map(c => `- **${c.name}** — \`${c.config.path}\``).join('\n')
    const md = [
      '---',
      'name: markdown-memory',
      `description: ${desc}`,
      '---',
      '',
      '# Markdown memory',
      '',
      `Your long-term memory is a folder of Markdown files on this machine. Use your file tools to read${write ? ' and write' : ''} them.`,
      '',
      '## Folders',
      folders,
      '',
      write
        ? 'When you learn a durable fact or preference worth keeping, append it to the most relevant file (create one if needed). Keep entries short and dated. Read existing files before answering so you use what you already know.'
        : 'These files are READ-ONLY. Read them for context; never create, edit, or delete them.',
    ].join('\n')
    return { slug: 'markdown-memory', markdown: md }
  },
  adapter: markdownAdapter,
}

export const MEMORY_PROVIDERS: MemoryProviderDef[] = [OBSIDIAN, MARKDOWN]

const BY_ID = new Map(MEMORY_PROVIDERS.map(p => [p.id, p]))
export function memoryProvider(id: string): MemoryProviderDef | undefined {
  return BY_ID.get(id)
}
