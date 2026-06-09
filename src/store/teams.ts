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
  TEAM_SCHEMA_VERSION,
  blueprintPath,
  compiledMdPath,
  revisionsPath,
  serializeBlueprint,
  serializeBundle,
  serializeRevisions,
  parseBlueprint,
  parseBundle,
  parseRevisions,
  appendRevision,
} from '../lib/teamBlueprint'
import { buildTeamProcessDef, extractMembersFromDef } from '../lib/teamCompiler'

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

interface TeamsState {
  blueprints: TeamBlueprint[]
  compiledDefs: Record<string, ProcessDef>   // id → compiled ProcessDef
  revisions: Record<string, TeamRevision[]>  // id → revision log (newest last, max 20)
  loading: boolean
  error: string | null

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
}

export const useTeamsStore = create<TeamsState>((set, get) => ({
  blueprints: [],
  compiledDefs: {},
  revisions: {},
  loading: false,
  error: null,

  // ── Load ──────────────────────────────────────────────────────────────────────

  async load() {
    set({ loading: true, error: null })
    const api = fileApi()
    if (!api) { set({ loading: false, error: 'File API not available' }); return }

    try {
      const dir = teamsDir()
      // Get all files in the teams directory (no extension filter)
      const { ok, files, error } = await api.listdir(dir)
      if (!ok) { set({ loading: false, error: error ?? 'Failed to list teams directory' }); return }

      const jsonFiles = files.filter(f => f.name.endsWith('.team.json'))
      const mdFiles   = files.filter(f => f.name.endsWith('.md'))

      const blueprints: TeamBlueprint[] = []
      const compiledDefs: Record<string, ProcessDef> = {}
      const knownIds = new Set<string>()

      // ── 1. Load from .team.json (primary) ────────────────────────────────────

      for (const f of jsonFiles) {
        const res = await api.read(f.path)
        if (!res.ok || !res.text) continue
        const bp = parseBlueprint(res.text)
        if (!bp) continue

        blueprints.push(bp)
        knownIds.add(bp.id)

        // Load or recompile the .md
        const mdPath = compiledMdPath(bp.id, dir)
        const mdRes = await api.read(mdPath)
        if (mdRes.ok && mdRes.text) {
          const def = parseProcessFile(mdPath, mdRes.text)
          if (def) { compiledDefs[bp.id] = def; continue }
        }
        // .md missing or corrupt — recompile
        const def = buildTeamProcessDef(bp, mdPath)
        await api.write(mdPath, serializeProcess(def))
        compiledDefs[bp.id] = def
      }

      // ── 2. Migrate legacy .md-only teams (no .team.json) ─────────────────────

      for (const f of mdFiles) {
        const res = await api.read(f.path)
        if (!res.ok || !res.text) continue
        const def = parseProcessFile(f.path, res.text)
        if (!def || knownIds.has(def.id)) continue

        // Reconstruct a blueprint from the compiled .md
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
          tags: def.tags,
          createdAt: now,
          updatedAt: now,
          version: 1,
          graphCustomized: false,
        }
        await api.write(blueprintPath(bp.id, dir), serializeBlueprint(bp))
        blueprints.push(bp)
        compiledDefs[bp.id] = def
        knownIds.add(bp.id)
      }

      set({ blueprints, compiledDefs, loading: false })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  // ── saveBlueprint ─────────────────────────────────────────────────────────────

  async saveBlueprint(bp) {
    const api = fileApi()
    if (!api) { set({ error: 'File API not available' }); return false }

    const dir = teamsDir()
    const jsonPath = blueprintPath(bp.id, dir)
    const mdPath   = compiledMdPath(bp.id, dir)
    const revPath  = revisionsPath(bp.id, dir)

    // Recompile .md from blueprint (graph customization is reset)
    const bpToSave: TeamBlueprint = { ...bp, graphCustomized: false }
    const def = buildTeamProcessDef(bpToSave, mdPath)
    const mdText = serializeProcess(def)

    // Build updated revision log (load from file on first access for this session)
    let prevRevs: TeamRevision[] = get().revisions[bpToSave.id] ?? []
    if (prevRevs.length === 0) {
      const loaded = await api.read(revPath)
      if (loaded.ok && loaded.text) prevRevs = parseRevisions(loaded.text)
    }
    const newRevisions = appendRevision(prevRevs, bpToSave)

    const [jsonRes, mdRes, revRes] = await Promise.all([
      api.write(jsonPath, serializeBlueprint(bpToSave)),
      api.write(mdPath, mdText),
      api.write(revPath, serializeRevisions(newRevisions)),
    ])

    if (!jsonRes.ok) { set({ error: jsonRes.error ?? 'Failed to save blueprint' }); return false }
    if (!mdRes.ok)   { set({ error: mdRes.error  ?? 'Failed to write compiled process' }); return false }
    if (!revRes.ok) console.warn('Revision history write failed:', revRes.error)

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
    const api = fileApi()
    if (!api) { set({ error: 'File API not available' }); return false }

    const mdText = serializeProcess(def)
    const mdRes = await api.write(def.path, mdText)
    if (!mdRes.ok) { set({ error: mdRes.error ?? 'Failed to save graph' }); return false }

    const dir = teamsDir()
    const jsonPath = blueprintPath(def.id, dir)
    const revPath  = revisionsPath(def.id, dir)

    const bp = get().blueprints.find(b => b.id === def.id)
    if (!bp) {
      // Blueprint not in memory — just update the compiled def
      set(s => ({ compiledDefs: { ...s.compiledDefs, [def.id]: def }, error: null }))
      return true
    }

    const bpUpdated: TeamBlueprint = { ...bp, graphCustomized: true, updatedAt: Date.now() }

    // Load revision history if not yet cached for this session
    let prevRevs: TeamRevision[] = get().revisions[def.id] ?? []
    if (prevRevs.length === 0) {
      const loaded = await api.read(revPath)
      if (loaded.ok && loaded.text) prevRevs = parseRevisions(loaded.text)
    }
    const newRevisions = appendRevision(prevRevs, bpUpdated)

    const [jsonRes, revRes] = await Promise.all([
      api.write(jsonPath, serializeBlueprint(bpUpdated)),
      api.write(revPath, serializeRevisions(newRevisions)),
    ])

    if (!jsonRes.ok) { set({ error: jsonRes.error ?? 'Failed to persist blueprint after graph save' }); return false }
    if (!revRes.ok) console.warn('Revision history write failed (graph save):', revRes.error)

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
    const api = fileApi()
    if (!api) { set({ error: 'File API not available' }); return false }
    const dir = teamsDir()
    await Promise.all([
      api.delete(blueprintPath(id, dir)).catch(() => {}),
      api.delete(compiledMdPath(id, dir)).catch(() => {}),
      api.delete(revisionsPath(id, dir)).catch(() => {}),
    ])
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
    const api = fileApi()
    if (!api) { set({ error: 'File API not available' }); return null }

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

      const [jsonRes, mdRes] = await Promise.all([
        api.write(blueprintPath(bp.id, dir), serializeBlueprint(bp)),
        api.write(mdPath, mdText),
      ])
      if (!jsonRes.ok || !mdRes.ok) {
        set({ error: 'Failed to write imported team files' })
        return null
      }
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
      tags: def.tags,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }

    await Promise.all([
      api.write(blueprintPath(bp.id, dir), serializeBlueprint(bp)),
      api.write(def.path, text),
    ])

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
    const api = fileApi()
    if (!api) return
    const path = revisionsPath(id, teamsDir())
    const res = await api.read(path)
    if (!res.ok || !res.text) return
    const revs = parseRevisions(res.text)
    set(s => ({ revisions: { ...s.revisions, [id]: revs } }))
  },
}))
