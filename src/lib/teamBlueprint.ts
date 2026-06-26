// TeamBlueprint — the canonical, durable source of truth for a team definition.
//
// A compiled ProcessDef (.md) is an execution artifact derived from a blueprint.
// The blueprint is the only thing a user should edit, export, and import.
//
// File layout per team:
//   ~/.openclaw/teams/<id>.team.json   ← TeamBlueprint   (source of truth)
//   ~/.openclaw/teams/<id>.md          ← compiled ProcessDef (execution artifact)
//
// Architecture notes (source-of-truth boundary, branching, skip routing, invariants):
//   src/lib/TEAMS.md

export const TEAM_SCHEMA_VERSION = 1 as const

/** Sentinel nextMemberId value meaning "route to the end node (finish)". */
export const BRANCH_END = '__end__'

// A single member in the team workflow
export interface TeamMemberDef {
  agentId: string
  role: string
  task: string
  soul?: string
  reviewBefore?: boolean   // insert human review gate before this member (not valid for index 0)
}

/**
 * A single conditional branch within a route decision.
 * Branches are evaluated in order; the first matching condition wins.
 * Set condition to '' to make a branch the catch-all default (put it last).
 */
export interface TeamBranch {
  condition: string       // natural-language condition for the controller to evaluate
  nextMemberId: string    // agentId of the member to invoke, or BRANCH_END to finish
  brief?: string          // optional context/task override passed to the next member
}

/**
 * A conditional routing decision placed after a specific member completes.
 * When present, it replaces the default "proceed to next sequential member" behaviour.
 */
export interface TeamRoute {
  afterMemberId: string   // agentId whose completion triggers this decision
  branches: TeamBranch[]  // ordered list of conditional branches
}

// The canonical team model — stored as .team.json
export interface TeamBlueprint {
  schemaVersion: typeof TEAM_SCHEMA_VERSION
  id: string
  name: string
  description?: string
  controllerAgentId: string
  members: TeamMemberDef[]
  routes?: TeamRoute[]     // optional conditional routing; absent/empty = linear flow
  outputContract?: string
  tags?: string[]
  createdAt: number    // Unix ms
  updatedAt: number    // Unix ms
  version: number      // Increments on every save — user-visible revision counter
  graphCustomized?: boolean  // true if the compiled graph has been manually edited
}

// What gets exported and imported — the blueprint plus optional snapshot of compiled text
export interface TeamExportBundle {
  schemaVersion: typeof TEAM_SCHEMA_VERSION
  blueprint: TeamBlueprint
  compiledProcessMd?: string   // snapshot of the .md at export time (for portability)
  exportedAt: number
}

// ── Run requests ────────────────────────────────────────────────────────────────
//
// A team is a reusable design; the *task* for a given run is supplied separately. An
// agent (or the app) can drop a run request next to the team — <id>.runrequest.json —
// asking the app to run this team with a concrete task. The app surfaces it in the Team
// tab (pre-filling the task box, optionally auto-launching) and clears it once handled.
// `nonce` makes each request fire exactly once even if the file is polled repeatedly.
export interface TeamRunRequest {
  task: string
  autorun?: boolean    // launch immediately vs. just pre-fill the task and wait for the user
  nonce: string
  requestedAt: number  // Unix ms
}

export function runRequestPath(id: string, dir: string): string {
  return `${dir}/${id}.runrequest.json`
}

export function serializeRunRequest(req: TeamRunRequest): string {
  return JSON.stringify(req, null, 2)
}

// Returns null for absent/blank/malformed requests or ones missing a task or nonce.
export function parseRunRequest(text: string | null | undefined): TeamRunRequest | null {
  if (!text || !text.trim()) return null
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    const task = typeof d.task === 'string' ? d.task.trim() : ''
    const nonce = typeof d.nonce === 'string' ? d.nonce : ''
    if (!task || !nonce) return null
    return {
      task,
      autorun: d.autorun === true,
      nonce,
      requestedAt: typeof d.requestedAt === 'number' ? d.requestedAt : 0,
    }
  } catch {
    return null
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function blueprintFilename(id: string): string {
  return `${id}.team.json`
}

export function blueprintPath(id: string, dir: string): string {
  return `${dir}/${id}.team.json`
}

export function compiledMdPath(id: string, dir: string): string {
  return `${dir}/${id}.md`
}

// ── Serialization ─────────────────────────────────────────────────────────────

export function serializeBlueprint(bp: TeamBlueprint): string {
  return JSON.stringify(bp, null, 2)
}

export function parseBlueprint(text: string): TeamBlueprint | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    if (typeof data.id !== 'string' || !data.id) return null
    if (typeof data.name !== 'string' || !data.name) return null
    // Ensure required fields have defaults for forward-compat
    if (!data.schemaVersion) data.schemaVersion = TEAM_SCHEMA_VERSION
    if (!data.members) data.members = []
    if (!data.createdAt) data.createdAt = Date.now()
    if (!data.updatedAt) data.updatedAt = Date.now()
    if (!data.version) data.version = 1
    if (!data.controllerAgentId) data.controllerAgentId = ''
    return data as unknown as TeamBlueprint
  } catch {
    return null
  }
}

export function serializeBundle(bundle: TeamExportBundle): string {
  return JSON.stringify(bundle, null, 2)
}

// Parses a .team.json export bundle.
// Also accepts a bare blueprint JSON (no "bundle" wrapper) for backward compat.
// Returns null for future schema versions that cannot be safely parsed.
export function parseBundle(text: string): TeamExportBundle | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    // Full bundle format
    if (data.blueprint && typeof (data.blueprint as Record<string, unknown>).id === 'string') {
      // Reject future schema versions rather than silently misparse them
      if (typeof data.schemaVersion === 'number' && data.schemaVersion > TEAM_SCHEMA_VERSION) {
        return null
      }
      return data as unknown as TeamExportBundle
    }
    // Bare blueprint
    const bp = parseBlueprint(text)
    if (bp) {
      return {
        schemaVersion: TEAM_SCHEMA_VERSION,
        blueprint: bp,
        exportedAt: Date.now(),
      }
    }
    return null
  } catch {
    return null
  }
}

// ── Revision history ─────────────────────────────────────────────────────────

/** Full blueprint snapshot captured on every save. Stored as <id>.revisions.json */
export interface TeamRevision {
  blueprint: TeamBlueprint
  savedAt: number            // Unix ms — mirrors blueprint.updatedAt
}

export const MAX_REVISIONS = 20

export function revisionsPath(id: string, dir: string): string {
  return `${dir}/${id}.revisions.json`
}

export function parseRevisions(text: string): TeamRevision[] {
  try {
    const data = JSON.parse(text) as unknown
    if (!Array.isArray(data)) return []
    return (data as unknown[]).filter(
      (r): r is TeamRevision =>
        !!r && typeof r === 'object' &&
        typeof (r as Record<string, unknown>).savedAt === 'number' &&
        !!(r as TeamRevision).blueprint?.id
    )
  } catch { return [] }
}

export function serializeRevisions(revisions: TeamRevision[]): string {
  return JSON.stringify(revisions, null, 2)
}

/** Appends a new snapshot and caps the list at MAX_REVISIONS (newest last). */
export function appendRevision(existing: TeamRevision[], bp: TeamBlueprint): TeamRevision[] {
  const entry: TeamRevision = { blueprint: { ...bp }, savedAt: bp.updatedAt }
  return [...existing, entry].slice(-MAX_REVISIONS)
}

// ── Bundle validation ─────────────────────────────────────────────────────────

/**
 * Validate a parsed bundle object before accepting it.
 * Returns an array of human-readable error strings; empty = valid.
 * Rejects bundles whose schemaVersion exceeds the current supported version
 * so future formats fail clearly instead of silently misparsing.
 */
export function validateBundle(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['Bundle must be a JSON object']
  }
  const obj = data as Record<string, unknown>
  const errors: string[] = []

  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > TEAM_SCHEMA_VERSION) {
    errors.push(
      `Bundle uses schema v${obj.schemaVersion} but this app only supports up to v${TEAM_SCHEMA_VERSION} — please upgrade the app.`
    )
  }

  if (!obj.blueprint || typeof obj.blueprint !== 'object' || Array.isArray(obj.blueprint)) {
    errors.push('Bundle is missing a valid blueprint field')
    return errors
  }

  const bp = obj.blueprint as Record<string, unknown>
  if (typeof bp.id !== 'string' || !bp.id) errors.push('Blueprint is missing a valid id')
  if (typeof bp.name !== 'string' || !bp.name) errors.push('Blueprint is missing a valid name')
  if (!Array.isArray(bp.members)) errors.push('Blueprint members must be an array')
  if (typeof bp.version !== 'number') errors.push('Blueprint version must be a number')

  return errors
}

// ── Blueprint lifecycle ────────────────────────────────────────────────────────

export function newBlueprint(id: string, name: string): TeamBlueprint {
  const now = Date.now()
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    id, name,
    controllerAgentId: '',
    members: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
}

// Returns a new blueprint with the provided patch applied, version bumped, updatedAt refreshed.
// id, createdAt, and schemaVersion are immutable.
export function bumpBlueprint(
  bp: TeamBlueprint,
  patch: Partial<Omit<TeamBlueprint, 'id' | 'createdAt' | 'schemaVersion' | 'version' | 'updatedAt'>>
): TeamBlueprint {
  return {
    ...bp,
    ...patch,
    id: bp.id,
    createdAt: bp.createdAt,
    schemaVersion: bp.schemaVersion,
    version: bp.version + 1,
    updatedAt: Date.now(),
  }
}
