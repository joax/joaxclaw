// The agent workspace files a client is allowed to touch.
//
// `agents.files.*` is NOT a folder API, which is easy to miss because it reads like
// one. The gateway resolves every call through `ALLOWED_FILE_NAMES` (its
// `WORKSPACE_BOOTSTRAP_FILENAMES`) and rejects anything else outright with
// `unsupported file "<name>"` — so a free-text "new file" box can only ever produce
// an error. There are exactly six names, and there is no `agents.files.delete` at
// all: `list`, `get` and `set` are the whole surface, and `set` only writes.
// Verified against OpenClaw 2026.9.3 (`dist/agents-*.mjs`).

export const AGENT_CORE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
] as const

export type AgentCoreFile = (typeof AGENT_CORE_FILES)[number]

// The subset the gateway expects to be missing sometimes, and tells clients to offer:
// "Bootstrap files whose absence is a normal workspace state rather than a fault: the
// optional profile files, plus MEMORY.md which only appears once memory is written.
// Editors should offer these for creation instead of flagging them."
//
// The other two are deliberately absent from this list. AGENTS.md is the agent's
// instruction file and always exists; BOOTSTRAP.md is onboarding state the gateway
// writes itself and then hides from `agents.files.list` once setup completes, so
// re-creating it from here would fight the gateway for ownership of it.
export const CREATABLE_AGENT_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
] as const

export function isAgentCoreFile(name: string): name is AgentCoreFile {
  return (AGENT_CORE_FILES as readonly string[]).includes(name)
}

/**
 * Which core files this agent doesn't have yet — the ones worth offering to create.
 * Comparison is case-sensitive because the gateway's allowlist is a plain `Set` of
 * these exact strings; "soul.md" is not the same file to it.
 */
export function creatableAgentFiles(existing: Iterable<string>): AgentCoreFile[] {
  const have = new Set(existing)
  return CREATABLE_AGENT_FILES.filter(name => !have.has(name))
}
