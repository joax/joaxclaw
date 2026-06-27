// Teams store.
//
// Primary type: TeamBlueprint (stored as <id>.team.json)
// Execution artifact: ProcessDef (compiled to <id>.md, always re-derivable from blueprint)
//
// File layout per team:
//   ~/.openclaw/teams/<id>.team.json  ← TeamBlueprint  (source of truth)
//   ~/.openclaw/teams/<id>.md         ← compiled ProcessDef

import { create } from 'zustand'
import type { ProcessDef } from '../lib/processParser'
import { parseProcessFile, serializeProcess } from '../lib/processParser'
import {
  type TeamBlueprint,
  type TeamExportBundle,
  type TeamRevision,
  type TeamRunRequest,
  TEAM_SCHEMA_VERSION,
  blueprintPath,
  compiledMdPath,
  revisionsPath,
  runRequestPath,
  serializeBlueprint,
  serializeBundle,
  serializeRevisions,
  parseBlueprint,
  parseBundle,
  parseRevisions,
  parseRunRequest,
  appendRevision,
} from '../lib/teamBlueprint'
import { buildTeamProcessDef, extractMembersFromDef } from '../lib/teamCompiler'
import { gatewayClient } from '../lib/gateway'
import { isRemoteGatewayState } from './connection'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fileApi = () => (window as any)?.api?.file as {
  read:    (path: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  write:   (path: string, text: string) => Promise<{ ok: boolean; error?: string }>
  delete:  (path: string) => Promise<{ ok: boolean; error?: string }>
  listdir: (dir: string, ext?: string) => Promise<{ ok: boolean; files: { name: string; path: string }[]; error?: string }>
} | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const homedir = (): string => (window as any)?.api?.system?.homedir ?? '~'

export function teamsDir(): string {
  return `${homedir()}/.openclaw/teams`
}

// ── Storage backends ───────────────────────────────────────────────────────────
//
// Teams live as files in the gateway host's ~/.openclaw/teams. We reach them two
// ways: the `joaxclaw-fs` gateway plugin (teams.* RPC over the WS — works local AND
// remote, and sees agent-authored teams), or, when that plugin isn't installed on
// a LOCAL gateway, direct Electron file I/O. On a REMOTE gateway with no plugin
// there's no path to the host's files, so the view shows install instructions.
//
// A backend deals only in raw artifact text; all blueprint/process (de)serialization
// stays in the store so both backends share identical logic.

interface RawTeam { id: string; blueprint: string | null; md: string | null; revisions: string | null; runRequest?: string | null }
interface TeamParts { blueprint?: string; md?: string; revisions?: string; runRequest?: string }

interface TeamsBackend {
  kind: 'rpc' | 'file'
  list: () => Promise<RawTeam[]>
  read: (id: string) => Promise<RawTeam>
  write: (id: string, parts: TeamParts) => Promise<void>
  remove: (id: string) => Promise<void>
}

function isUnknownMethod(e: unknown): boolean {
  return /unknown method/i.test(e instanceof Error ? e.message : String(e))
}

// Plugin backend — rides the existing gateway WebSocket.
const rpcBackend: TeamsBackend = {
  kind: 'rpc',
  async list() {
    const r = await gatewayClient.request<{ teams: RawTeam[] }>('teams.list')
    return r.teams ?? []
  },
  async read(id) {
    const r = await gatewayClient.request<Partial<RawTeam>>('teams.get', { id })
    return { id, blueprint: r.blueprint ?? null, md: r.md ?? null, revisions: r.revisions ?? null, runRequest: r.runRequest ?? null }
  },
  async write(id, parts) { await gatewayClient.request('teams.set', { id, ...parts }) },
  async remove(id) { await gatewayClient.request('teams.delete', { id }) },
}

// Local-file backend — only valid when the gateway is on this machine.
async function readFileText(path: string): Promise<string | null> {
  const api = fileApi(); if (!api) return null
  const r = await api.read(path)
  return r.ok && r.text != null ? r.text : null
}
const fileBackend: TeamsBackend = {
  kind: 'file',
  async list() {
    const api = fileApi(); if (!api) throw new Error('File API not available')
    const dir = teamsDir()
    const { ok, files, error } = await api.listdir(dir)
    if (!ok) throw new Error(error ?? 'Failed to list teams directory')
    const ids = new Set<string>()
    for (const f of files) {
      for (const suf of ['.team.json', '.md', '.revisions.json']) {
        if (f.name.endsWith(suf)) ids.add(f.name.slice(0, -suf.length))
      }
    }
    return Promise.all([...ids].map(id => fileBackend.read(id)))
  },
  async read(id) {
    const dir = teamsDir()
    const [blueprint, md, revisions, runRequest] = await Promise.all([
      readFileText(blueprintPath(id, dir)),
      readFileText(compiledMdPath(id, dir)),
      readFileText(revisionsPath(id, dir)),
      readFileText(runRequestPath(id, dir)),
    ])
    return { id, blueprint, md, revisions, runRequest }
  },
  async write(id, parts) {
    const api = fileApi(); if (!api) throw new Error('File API not available')
    const dir = teamsDir()
    const writes: Promise<{ ok: boolean; error?: string }>[] = []
    if (parts.blueprint !== undefined) writes.push(api.write(blueprintPath(id, dir), parts.blueprint))
    if (parts.md !== undefined) writes.push(api.write(compiledMdPath(id, dir), parts.md))
    if (parts.revisions !== undefined) writes.push(api.write(revisionsPath(id, dir), parts.revisions))
    if (parts.runRequest !== undefined) writes.push(api.write(runRequestPath(id, dir), parts.runRequest))
    const results = await Promise.all(writes)
    const failed = results.find(r => !r.ok)
    if (failed) throw new Error(failed.error ?? 'Failed to write team files')
  },
  async remove(id) {
    const api = fileApi(); if (!api) return
    const dir = teamsDir()
    await Promise.all([
      api.delete(blueprintPath(id, dir)).catch(() => {}),
      api.delete(compiledMdPath(id, dir)).catch(() => {}),
      api.delete(revisionsPath(id, dir)).catch(() => {}),
      api.delete(runRequestPath(id, dir)).catch(() => {}),
    ])
  },
}

// Pick the backend: prefer the plugin (probe teams.list). If it's missing, fall
// back to local files on a local gateway, or signal `needsPlugin` on a remote one.
async function resolveBackend(): Promise<{ backend: TeamsBackend | null; needsPlugin: boolean }> {
  try {
    await rpcBackend.list()
    return { backend: rpcBackend, needsPlugin: false }
  } catch (e) {
    if (!isUnknownMethod(e)) throw e
    return isRemoteGatewayState()
      ? { backend: null, needsPlugin: true }
      : { backend: fileBackend, needsPlugin: false }
  }
}

interface TeamsState {
  blueprints: TeamBlueprint[]
  compiledDefs: Record<string, ProcessDef>   // id → compiled ProcessDef
  revisions: Record<string, TeamRevision[]>  // id → revision log (newest last, max 20)
  // id → pending agent/app run request (a task to run this team with), or null/absent.
  runRequests: Record<string, TeamRunRequest | null>
  loading: boolean
  error: string | null
  // True on a remote gateway when the joaxclaw-fs plugin isn't installed → the view
  // shows install instructions instead of the (unreachable) team list.
  needsPlugin: boolean
  backend: TeamsBackend | null

  load: () => Promise<void>

  // Save a blueprint (creates/updates .team.json, recompiles .md, appends revision)
  saveBlueprint: (bp: TeamBlueprint) => Promise<boolean>

  // Save only the compiled ProcessDef (.md) without touching the blueprint.
  // Sets graphCustomized=true on the blueprint so the UI can warn the user.
  saveCompiledDef: (def: ProcessDef) => Promise<boolean>

  deleteTeam: (id: string) => Promise<boolean>

  // Export: triggers a browser download of the .team.json bundle
  exportBundle: (id: string) => void

  // Import: parses a .team.json bundle (or bare blueprint JSON, or legacy .md).
  // Saves both files to teamsDir. Returns the blueprint on success.
  importBundle: (text: string, filename: string) => Promise<TeamBlueprint | null>

  // Load revision history for a specific team (lazy — only when the History tab opens)
  loadRevisions: (id: string) => Promise<void>

  // Re-read one team's run request (cheap; polled while a team detail is open so an
  // agent's teams.run call surfaces live). Updates runRequests[id].
  refreshRunRequest: (id: string) => Promise<void>

  // Clear a team's run request once it's been handled (run or dismissed), so it
  // doesn't fire again. Best-effort persist + local clear.
  consumeRunRequest: (id: string) => Promise<void>
}

export const useTeamsStore = create<TeamsState>((set, get) => ({
  blueprints: [],
  compiledDefs: {},
  revisions: {},
  runRequests: {},
  loading: false,
  error: null,
  needsPlugin: false,
  backend: null,

  // ── Load ──────────────────────────────────────────────────────────────────────

  async load() {
    set({ loading: true, error: null, needsPlugin: false })
    try {
      const { backend, needsPlugin } = await resolveBackend()
      if (!backend) {
        set({ loading: false, needsPlugin, backend: null, blueprints: [], compiledDefs: {} })
        return
      }

      const raw = await backend.list()
      const blueprints: TeamBlueprint[] = []
      const compiledDefs: Record<string, ProcessDef> = {}
      const runRequests: Record<string, TeamRunRequest | null> = {}

      for (const t of raw) {
        runRequests[t.id] = parseRunRequest(t.runRequest)

        // mdPath is a nominal label for the ProcessDef; actual I/O goes through the backend by id.
        const mdPath = compiledMdPath(t.id, teamsDir())

        if (t.blueprint) {
          const bp = parseBlueprint(t.blueprint)
          if (!bp) continue
          blueprints.push(bp)

          let def = t.md ? parseProcessFile(mdPath, t.md) : null
          if (!def) {
            // .md missing or corrupt — recompile and persist
            def = buildTeamProcessDef(bp, mdPath)
            await backend.write(bp.id, { md: serializeProcess(def) })
          }
          compiledDefs[bp.id] = def
        } else if (t.md) {
          // Legacy team with only a compiled .md — reconstruct + persist a blueprint.
          const def = parseProcessFile(mdPath, t.md)
          if (!def) continue
          const members = extractMembersFromDef(def)
          const now = Date.now()
          const bp: TeamBlueprint = {
            schemaVersion: TEAM_SCHEMA_VERSION,
            id: def.id,
            name: def.name,
            description: def.description,
            controllerAgentId: def.controllerAgentId ?? '',
            members,
            outputContract: def.outputContract,
            workspace: def.workspace,
            tags: def.tags,
            createdAt: now,
            updatedAt: now,
            version: 1,
            graphCustomized: false,
          }
          await backend.write(bp.id, { blueprint: serializeBlueprint(bp) })
          blueprints.push(bp)
          compiledDefs[bp.id] = def
        }
      }

      set({ backend, blueprints, compiledDefs, runRequests, loading: false, needsPlugin: false })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  // ── Run requests ───────────────────────────────────────────────────────────────

  async refreshRunRequest(id) {
    const backend = get().backend
    if (!backend) return
    const raw = await backend.read(id).catch(() => null)
    if (!raw) return
    const req = parseRunRequest(raw.runRequest)
    // Avoid a re-render when nothing changed (this runs on a poll).
    if ((get().runRequests[id]?.nonce ?? null) === (req?.nonce ?? null)) return
    set(s => ({ runRequests: { ...s.runRequests, [id]: req } }))
  },

  async consumeRunRequest(id) {
    set(s => ({ runRequests: { ...s.runRequests, [id]: null } }))
    const backend = get().backend
    if (!backend) return
    // Persist the clear so the request doesn't resurface on the next read/poll.
    await backend.write(id, { runRequest: '' }).catch(() => { /* best-effort */ })
  },

  // ── saveBlueprint ─────────────────────────────────────────────────────────────

  async saveBlueprint(bp) {
    let backend = get().backend
    if (!backend) { const r = await resolveBackend().catch(() => null); backend = r?.backend ?? null }
    if (!backend) { set({ error: 'Teams storage is unavailable on this gateway' }); return false }

    const mdPath = compiledMdPath(bp.id, teamsDir())

    // Recompile .md from blueprint (graph customization is reset)
    const bpToSave: TeamBlueprint = { ...bp, graphCustomized: false }
    const def = buildTeamProcessDef(bpToSave, mdPath)
    const mdText = serializeProcess(def)

    // Build updated revision log (load on first access for this session)
    let prevRevs: TeamRevision[] = get().revisions[bpToSave.id] ?? []
    if (prevRevs.length === 0) {
      const loaded = await backend.read(bpToSave.id).catch(() => null)
      if (loaded?.revisions) prevRevs = parseRevisions(loaded.revisions)
    }
    const newRevisions = appendRevision(prevRevs, bpToSave)

    try {
      await backend.write(bpToSave.id, {
        blueprint: serializeBlueprint(bpToSave),
        md: mdText,
        revisions: serializeRevisions(newRevisions),
      })
    } catch (e) { set({ error: String(e) }); return false }

    set(s => ({
      error: null,
      blueprints: s.blueprints.some(b => b.id === bp.id)
        ? s.blueprints.map(b => b.id === bp.id ? bpToSave : b)
        : [bpToSave, ...s.blueprints],
      compiledDefs: { ...s.compiledDefs, [bp.id]: def },
      revisions: { ...s.revisions, [bpToSave.id]: newRevisions },
    }))
    return true
  },

  // ── saveCompiledDef ───────────────────────────────────────────────────────────

  async saveCompiledDef(def) {
    const backend = get().backend
    if (!backend) { set({ error: 'Teams storage is unavailable on this gateway' }); return false }

    const mdText = serializeProcess(def)
    const bp = get().blueprints.find(b => b.id === def.id)

    if (!bp) {
      // Blueprint not in memory — just persist the compiled def
      try { await backend.write(def.id, { md: mdText }) }
      catch (e) { set({ error: String(e) }); return false }
      set(s => ({ compiledDefs: { ...s.compiledDefs, [def.id]: def }, error: null }))
      return true
    }

    const bpUpdated: TeamBlueprint = { ...bp, graphCustomized: true, updatedAt: Date.now() }

    let prevRevs: TeamRevision[] = get().revisions[def.id] ?? []
    if (prevRevs.length === 0) {
      const loaded = await backend.read(def.id).catch(() => null)
      if (loaded?.revisions) prevRevs = parseRevisions(loaded.revisions)
    }
    const newRevisions = appendRevision(prevRevs, bpUpdated)

    try {
      await backend.write(def.id, {
        md: mdText,
        blueprint: serializeBlueprint(bpUpdated),
        revisions: serializeRevisions(newRevisions),
      })
    } catch (e) { set({ error: String(e) }); return false }

    set(s => ({
      compiledDefs: { ...s.compiledDefs, [def.id]: def },
      blueprints: s.blueprints.map(b => b.id === def.id ? bpUpdated : b),
      revisions:  { ...s.revisions, [def.id]: newRevisions },
      error: null,
    }))
    return true
  },

  // ── deleteTeam ────────────────────────────────────────────────────────────────

  async deleteTeam(id) {
    const backend = get().backend
    if (!backend) { set({ error: 'Teams storage is unavailable on this gateway' }); return false }
    try { await backend.remove(id) }
    catch (e) { set({ error: String(e) }); return false }
    set(s => ({
      blueprints: s.blueprints.filter(b => b.id !== id),
      compiledDefs: Object.fromEntries(Object.entries(s.compiledDefs).filter(([k]) => k !== id)),
      revisions:    Object.fromEntries(Object.entries(s.revisions).filter(([k]) => k !== id)),
      error: null,
    }))
    return true
  },

  // ── exportBundle ──────────────────────────────────────────────────────────────

  exportBundle(id) {
    const s = get()
    const bp = s.blueprints.find(b => b.id === id)
    if (!bp) return
    const def = s.compiledDefs[id]
    const bundle: TeamExportBundle = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: bp,
      compiledProcessMd: def ? serializeProcess(def) : undefined,
      exportedAt: Date.now(),
    }
    const text = serializeBundle(bundle)
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${id}.team.json`
    a.click()
    URL.revokeObjectURL(url)
  },

  // ── importBundle ──────────────────────────────────────────────────────────────

  async importBundle(text, filename) {
    let backend = get().backend
    if (!backend) { const r = await resolveBackend().catch(() => null); backend = r?.backend ?? null }
    if (!backend) { set({ error: 'Teams storage is unavailable on this gateway' }); return null }

    const dir = teamsDir()

    // Try to parse as a bundle or bare blueprint first
    const bundle = parseBundle(text)
    if (bundle) {
      const { blueprint: bp } = bundle
      const mdPath = compiledMdPath(bp.id, dir)

      // Use the bundled compiled snapshot when present and parseable; otherwise recompile.
      const bundledDef = bundle.compiledProcessMd
        ? parseProcessFile(mdPath, bundle.compiledProcessMd)
        : null
      const def = bundledDef ?? buildTeamProcessDef(bp, mdPath)
      const mdText = bundledDef ? bundle.compiledProcessMd! : serializeProcess(def)

      try { await backend.write(bp.id, { blueprint: serializeBlueprint(bp), md: mdText }) }
      catch { set({ error: 'Failed to write imported team' }); return null }

      set(s => ({
        error: null,
        blueprints: s.blueprints.some(b => b.id === bp.id)
          ? s.blueprints.map(b => b.id === bp.id ? bp : b)
          : [bp, ...s.blueprints],
        compiledDefs: { ...s.compiledDefs, [bp.id]: def },
      }))
      return bp
    }

    // Fallback: try to parse as a legacy .md process file
    const stem = filename.replace(/\.md$/, '')
    const mdPath = `${dir}/${filename.endsWith('.md') ? filename : stem + '.md'}`
    const def = parseProcessFile(mdPath, text)
    if (!def) {
      set({ error: 'Could not parse imported file as a team or process' })
      return null
    }

    const members = extractMembersFromDef(def)
    const now = Date.now()
    const bp: TeamBlueprint = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      id: def.id,
      name: def.name,
      description: def.description,
      controllerAgentId: def.controllerAgentId ?? '',
      members,
      outputContract: def.outputContract,
      workspace: def.workspace,
      tags: def.tags,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }

    try { await backend.write(bp.id, { blueprint: serializeBlueprint(bp), md: text }) }
    catch { set({ error: 'Failed to write imported team' }); return null }

    set(s => ({
      error: null,
      blueprints: s.blueprints.some(b => b.id === bp.id)
        ? s.blueprints.map(b => b.id === bp.id ? bp : b)
        : [bp, ...s.blueprints],
      compiledDefs: { ...s.compiledDefs, [bp.id]: def },
    }))
    return bp
  },

  // ── loadRevisions ─────────────────────────────────────────────────────────────

  async loadRevisions(id) {
    const backend = get().backend
    if (!backend) return
    const raw = await backend.read(id).catch(() => null)
    if (!raw?.revisions) return
    const revs = parseRevisions(raw.revisions)
    set(s => ({ revisions: { ...s.revisions, [id]: revs } }))
  },
}))
