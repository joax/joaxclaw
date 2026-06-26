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
import { randomUUID } from 'node:crypto'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { resolveStateDir } from 'openclaw/plugin-sdk/state-paths'
import { errorShape, ErrorCodes } from 'openclaw/plugin-sdk/gateway-runtime'

const READ_SCOPE = 'operator.read'
const WRITE_SCOPE = 'operator.write'

// The artifacts that make up a team, keyed by the field name we expose. `runRequest`
// is an agent/app-authored "run this team with this task" request the desktop app
// picks up; it rides the generic get/list/set/delete paths like the other artifacts.
const SUFFIX = {
  blueprint: '.team.json',
  md: '.md',
  revisions: '.revisions.json',
  runRequest: '.runrequest.json',
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

// ── engines.* host classification + guarded fetch ───────────────────────────────
// engines.* lets the app probe local LLM engines that live on the GATEWAY host's
// loopback/LAN — unreachable from a remote client, but reachable from here. To keep
// this from being a general-purpose request proxy (SSRF), we only ever fetch hosts
// that classify as a local engine host: loopback, *.local, or a private IPv4 range.
function isLocalEngineHost(host) {
  if (!host) return false
  let h = String(host).toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
      h === '::1' || h === '::ffff:7f00:1' || h === '::ffff:127.0.0.1') return true
  if (h.endsWith('.local')) return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h)
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10)
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return false
}

// Validate + classify a requested engine URL. Responds with INVALID_REQUEST and
// returns null on anything we won't fetch; returns the URL string otherwise.
function guardEngineUrl(url, respond) {
  let u
  try { u = new URL(url) } catch {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `invalid url ${JSON.stringify(url)}`))
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unsupported protocol ${JSON.stringify(u.protocol)}`))
    return null
  }
  if (!isLocalEngineHost(u.hostname)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'engines.* only proxies local-engine hosts (loopback / .local / private IPv4)'))
    return null
  }
  return u.toString()
}

// Cap on the body we return from engines.fetch (model lists are small; this guards
// against an unexpectedly large response). 1 MiB is plenty for /api/tags or /models.
const ENGINE_BODY_CAP = 1 << 20

async function engineFetch(url, timeoutMs) {
  const ctrl = new AbortController()
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 30000) : 4000
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
  } finally {
    clearTimeout(timer)
  }
}

// ── Ollama model-pull tracking ──────────────────────────────────────────────────
// A pull is a long streaming download; engines.pull starts it and returns a pullId,
// the stream is consumed in the background into `pulls`, and the client polls
// engines.pullStatus. Keyed by pullId; finished entries are GC'd after a minute.
const pulls = new Map()

async function runPull(baseUrl, model, pullId) {
  const upd = (patch) => pulls.set(pullId, { ...(pulls.get(pullId) || {}), ...patch })
  // Ollama reports per-layer (digest) bytes; track each so we can report an OVERALL %.
  const layers = new Map()
  const overall = () => {
    let c = 0, t = 0
    for (const l of layers.values()) { c += l.completed; t += l.total }
    return { completed: c, total: t }
  }
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, '') + '/api/pull', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
    })
    if (!res.ok || !res.body) { upd({ done: true, error: `HTTP ${res.status}` }); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line) continue
        let obj; try { obj = JSON.parse(line) } catch { continue }
        if (obj.error) { upd({ done: true, error: String(obj.error) }); return }
        if (obj.digest && typeof obj.total === 'number') {
          layers.set(obj.digest, { completed: typeof obj.completed === 'number' ? obj.completed : 0, total: obj.total })
        }
        const o = overall()
        upd({ status: obj.status ?? pulls.get(pullId)?.status, completed: o.completed, total: o.total })
      }
    }
    upd({ done: true })
  } catch (err) {
    upd({ done: true, error: err?.message ?? String(err) })
  }
}

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
  const [blueprint, md, revisions, runRequest] = await Promise.all([
    readTextOrNull(path.join(dir, id + SUFFIX.blueprint)),
    readTextOrNull(path.join(dir, id + SUFFIX.md)),
    readTextOrNull(path.join(dir, id + SUFFIX.revisions)),
    readTextOrNull(path.join(dir, id + SUFFIX.runRequest)),
  ])
  return { id, blueprint, md, revisions, runRequest }
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
  description: 'teams.* / processes.* (backed by <stateDir>) and engines.* (host-side local-LLM probing) gateway methods.',
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
          return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `teams.set requires at least one of: ${Object.keys(SUFFIX).join(', ')}`))
        }
        await fs.mkdir(dir, { recursive: true })
        await Promise.all(writes.map(([p, v]) => fs.writeFile(p, v, 'utf8')))
        respond(true, { ok: true, id })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })

    // Request a run of a saved team with a concrete task. Thin by design: this only
    // records the request as <id>.runrequest.json; the desktop app owns the actual
    // launch (it holds the prompt-compilation logic and the live run monitor). The app
    // clears the request once handled. `nonce` makes the request fire exactly once.
    api.registerGatewayMethod('teams.run', async ({ params, respond }) => {
      const id = params?.id
      if (!isValidId(id)) return badId(respond, 'team', id)
      const task = typeof params?.task === 'string' ? params.task.trim() : ''
      if (!task) {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'teams.run requires task (non-empty string)'))
      }
      try {
        const dir = teamsDir()
        // Require the team to exist before queueing a run for it.
        const blueprint = await readTextOrNull(path.join(dir, id + SUFFIX.blueprint))
        if (blueprint == null) {
          return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `no such team ${JSON.stringify(id)}`))
        }
        const nonce = randomUUID()
        const request = { task, autorun: params?.autorun === true, nonce, requestedAt: Date.now() }
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, id + SUFFIX.runRequest), JSON.stringify(request, null, 2), 'utf8')
        respond(true, { ok: true, id, nonce })
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

    // ── engines.* ────────────────────────────────────────────────────────────────
    // Probe / read local LLM engines on the gateway host. The desktop app can only
    // reach `localhost` on the CLIENT machine, so loopback engines on a remote
    // gateway host were always "unknown". These methods run the probe HERE (on the
    // host), so a remote app can check liveness and list models of the host's engines.

    // Liveness: GET the given health URL, report whether it responded ok.
    api.registerGatewayMethod('engines.probe', async ({ params, respond }) => {
      const url = guardEngineUrl(params?.url, respond)
      if (url == null) return
      try {
        const res = await engineFetch(url, params?.timeoutMs)
        respond(true, { ok: res.ok, status: res.status })
      } catch {
        // Network error / timeout / connection refused → engine is down, not an error.
        respond(true, { ok: false, status: 0 })
      }
    }, { scope: READ_SCOPE })

    // Read: GET the given URL and return its body (capped). Used for model listing
    // (e.g. Ollama /api/tags, OpenAI-compatible /models). Body is returned verbatim;
    // the app owns parsing, exactly like the local-fetch path.
    api.registerGatewayMethod('engines.fetch', async ({ params, respond }) => {
      const url = guardEngineUrl(params?.url, respond)
      if (url == null) return
      try {
        const res = await engineFetch(url, params?.timeoutMs)
        const raw = await res.text()
        const body = raw.length > ENGINE_BODY_CAP ? raw.slice(0, ENGINE_BODY_CAP) : raw
        respond(true, { ok: res.ok, status: res.status, body })
      } catch (err) {
        respond(true, { ok: false, status: 0, body: '', error: err?.message ?? String(err) })
      }
    }, { scope: READ_SCOPE })

    // Pull an Ollama model on the host (POST <baseUrl>/api/pull, streamed). Returns a
    // pullId immediately; the client polls engines.pullStatus for progress.
    api.registerGatewayMethod('engines.pull', async ({ params, respond }) => {
      const url = guardEngineUrl(params?.baseUrl, respond)
      if (url == null) return
      const model = String(params?.model ?? '').trim()
      if (!model) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'engines.pull requires model'))
      const pullId = randomUUID()
      pulls.set(pullId, { status: 'starting', completed: 0, total: 0, done: false, model })
      void runPull(url, model, pullId)   // background; don't await
      respond(true, { pullId })
    }, { scope: WRITE_SCOPE })

    // Poll a pull's progress: { status, completed, total, done, error?, model }.
    api.registerGatewayMethod('engines.pullStatus', async ({ params, respond }) => {
      const id = String(params?.pullId ?? '')
      const p = pulls.get(id)
      if (!p) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'unknown pullId'))
      respond(true, p)
      if (p.done) setTimeout(() => pulls.delete(id), 60000)   // GC finished pulls
    }, { scope: READ_SCOPE })

    // Delete an Ollama model on the host (DELETE <baseUrl>/api/delete).
    api.registerGatewayMethod('engines.delete', async ({ params, respond }) => {
      const url = guardEngineUrl(params?.baseUrl, respond)
      if (url == null) return
      const model = String(params?.model ?? '').trim()
      if (!model) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'engines.delete requires model'))
      try {
        const res = await fetch(url.replace(/\/+$/, '') + '/api/delete', {
          method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: model }),
        })
        respond(true, { ok: res.ok, status: res.status })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })

    // Model details (POST <baseUrl>/api/show) — license, context length, params, quant.
    api.registerGatewayMethod('engines.show', async ({ params, respond }) => {
      const url = guardEngineUrl(params?.baseUrl, respond)
      if (url == null) return
      const model = String(params?.model ?? '').trim()
      if (!model) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'engines.show requires model'))
      try {
        const res = await fetch(url.replace(/\/+$/, '') + '/api/show', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: model }),
        })
        const raw = await res.text()
        respond(true, { ok: res.ok, status: res.status, body: raw.length > ENGINE_BODY_CAP ? raw.slice(0, ENGINE_BODY_CAP) : raw })
      } catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    // Load / unload a model by setting keep_alive (POST <baseUrl>/api/generate):
    // keepAlive < 0 keeps it resident, 0 unloads it now.
    api.registerGatewayMethod('engines.keepAlive', async ({ params, respond }) => {
      const url = guardEngineUrl(params?.baseUrl, respond)
      if (url == null) return
      const model = String(params?.model ?? '').trim()
      if (!model) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'engines.keepAlive requires model'))
      const keepAlive = typeof params?.keepAlive === 'number' ? params.keepAlive : 0
      try {
        const res = await fetch(url.replace(/\/+$/, '') + '/api/generate', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: keepAlive }),
        })
        await res.text()
        respond(true, { ok: res.ok, status: res.status })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })
  },
})
