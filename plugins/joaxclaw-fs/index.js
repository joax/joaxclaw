// openclaw-joaxclaw-fs — exposes JoaxClaw's host-side state files over the WS.
//
// JoaxClaw stores teams and processes as files in the gateway's state dir:
//   <stateDir>/teams/<id>.team.json       ← TeamBlueprint (source of truth)
//   <stateDir>/teams/<id>.md              ← compiled ProcessDef
//   <stateDir>/teams/<id>.revisions.json  ← revision snapshots
//   <stateDir>/processes/<id>.md          ← ProcessDef (process definition)
//   <stateDir>/processes/.runs/<id>.json  ← persisted run state
//
// The desktop app normally reads/writes these via local Electron file IPC, which
// only reaches the gateway host when it's the same machine. This plugin registers
// teams.* and processes.* gateway RPC methods so the app can manage both over the
// WebSocket — including on a remote gateway, and including teams/processes authored
// by agents on the host.
//
// File contents are passed through verbatim as strings; the app keeps ownership of
// (de)serialization and validation. This plugin is a thin, state-dir-scoped proxy.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { resolveStateDir } from 'openclaw/plugin-sdk/state-paths'
import { errorShape, ErrorCodes } from 'openclaw/plugin-sdk/gateway-runtime'

const READ_SCOPE = 'operator.read'
const WRITE_SCOPE = 'operator.write'

// The three artifacts that make up a team, keyed by the field name we expose.
const SUFFIX = {
  blueprint: '.team.json',
  md: '.md',
  revisions: '.revisions.json',
}

// Ids are kebab-case slugs / filename stems. Reject anything that could escape the
// directory or isn't a plain id.
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
function isValidId(id) {
  return typeof id === 'string' && id.length <= 200 && ID_RE.test(id) && !id.includes('..')
}

function teamsDir() { return path.join(resolveStateDir(), 'teams') }
function processesDir() { return path.join(resolveStateDir(), 'processes') }
function runsDir() { return path.join(processesDir(), '.runs') }

async function readTextOrNull(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}
async function readdirOrEmpty(dir) {
  try {
    return await fs.readdir(dir)
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }
}

// ── teams ──────────────────────────────────────────────────────────────────────

async function readTeam(dir, id) {
  const [blueprint, md, revisions] = await Promise.all([
    readTextOrNull(path.join(dir, id + SUFFIX.blueprint)),
    readTextOrNull(path.join(dir, id + SUFFIX.md)),
    readTextOrNull(path.join(dir, id + SUFFIX.revisions)),
  ])
  return { id, blueprint, md, revisions }
}

function badId(respond, kind, id) {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `invalid ${kind} id ${JSON.stringify(id)}`))
}
function failed(respond, err) {
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `joaxclaw-fs: ${err?.message ?? String(err)}`))
}

export default definePluginEntry({
  id: 'joaxclaw-fs',
  name: 'JoaxClaw FS',
  description: 'teams.* and processes.* gateway methods backed by <stateDir>/teams and <stateDir>/processes.',
  register(api) {
    // ── teams.* ────────────────────────────────────────────────────────────────
    api.registerGatewayMethod('teams.list', async ({ respond }) => {
      try {
        const dir = teamsDir()
        const ids = new Set()
        for (const file of await readdirOrEmpty(dir)) {
          for (const suffix of Object.values(SUFFIX)) {
            if (file.endsWith(suffix)) ids.add(file.slice(0, -suffix.length))
          }
        }
        const teams = await Promise.all([...ids].filter(isValidId).map(id => readTeam(dir, id)))
        respond(true, { teams })
      } catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    api.registerGatewayMethod('teams.get', async ({ params, respond }) => {
      const id = params?.id
      if (!isValidId(id)) return badId(respond, 'team', id)
      try { respond(true, await readTeam(teamsDir(), id)) } catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    api.registerGatewayMethod('teams.set', async ({ params, respond }) => {
      const id = params?.id
      if (!isValidId(id)) return badId(respond, 'team', id)
      try {
        const dir = teamsDir()
        const writes = []
        for (const [field, suffix] of Object.entries(SUFFIX)) {
          const value = params?.[field]
          if (typeof value === 'string') writes.push([path.join(dir, id + suffix), value])
        }
        if (writes.length === 0) {
          return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'teams.set requires at least one of: blueprint, md, revisions'))
        }
        await fs.mkdir(dir, { recursive: true })
        await Promise.all(writes.map(([p, v]) => fs.writeFile(p, v, 'utf8')))
        respond(true, { ok: true, id })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })

    api.registerGatewayMethod('teams.delete', async ({ params, respond }) => {
      const id = params?.id
      if (!isValidId(id)) return badId(respond, 'team', id)
      try {
        const dir = teamsDir()
        await Promise.all(Object.values(SUFFIX).map(suffix => fs.rm(path.join(dir, id + suffix), { force: true })))
        respond(true, { ok: true, id })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })

    // ── processes.* ──────────────────────────────────────────────────────────────
    // Definitions are <stateDir>/processes/<id>.md; run state is .runs/<id>.json.
    api.registerGatewayMethod('processes.list', async ({ respond }) => {
      try {
        const dir = processesDir()
        const defIds = (await readdirOrEmpty(dir)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
        const defs = await Promise.all(
          defIds.filter(isValidId).map(async id => ({ id, md: await readTextOrNull(path.join(dir, id + '.md')) })),
        )
        const runIds = (await readdirOrEmpty(runsDir())).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
        const runs = await Promise.all(
          runIds.filter(isValidId).map(async id => ({ id, run: await readTextOrNull(path.join(runsDir(), id + '.json')) })),
        )
        respond(true, { defs, runs })
      } catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    api.registerGatewayMethod('processes.get', async ({ params, respond }) => {
      const id = params?.id
      if (!isValidId(id)) return badId(respond, 'process', id)
      try { respond(true, { id, md: await readTextOrNull(path.join(processesDir(), id + '.md')) }) }
      catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    api.registerGatewayMethod('processes.set', async ({ params, respond }) => {
      const id = params?.id
      if (!isValidId(id)) return badId(respond, 'process', id)
      if (typeof params?.md !== 'string') {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'processes.set requires md (string)'))
      }
      try {
        const dir = processesDir()
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, id + '.md'), params.md, 'utf8')
        respond(true, { ok: true, id })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })

    api.registerGatewayMethod('processes.delete', async ({ params, respond }) => {
      const id = params?.id
      if (!isValidId(id)) return badId(respond, 'process', id)
      try {
        await Promise.all([
          fs.rm(path.join(processesDir(), id + '.md'), { force: true }),
          fs.rm(path.join(runsDir(), id + '.json'), { force: true }),
        ])
        respond(true, { ok: true, id })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })

    // Persist one process run's state (JSON text). Written frequently during a run.
    api.registerGatewayMethod('processes.runs.set', async ({ params, respond }) => {
      const id = params?.id
      if (!isValidId(id)) return badId(respond, 'process', id)
      if (typeof params?.run !== 'string') {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'processes.runs.set requires run (string)'))
      }
      try {
        await fs.mkdir(runsDir(), { recursive: true })
        await fs.writeFile(path.join(runsDir(), id + '.json'), params.run, 'utf8')
        respond(true, { ok: true, id })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })
  },
})
