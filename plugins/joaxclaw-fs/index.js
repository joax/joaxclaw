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
import os from 'node:os'
import https from 'node:https'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { resolveStateDir } from 'openclaw/plugin-sdk/state-paths'
import { errorShape, ErrorCodes } from 'openclaw/plugin-sdk/gateway-runtime'

const READ_SCOPE = 'operator.read'
const WRITE_SCOPE = 'operator.write'

// ── reminder tools (agent-facing "ping-me-later") ───────────────────────────────
// reminder_set schedules a one-shot session turn that re-delivers the model's own
// prompt after a delay (so an idle/waiting agent can revive itself); reminder_cancel
// clears it. Both are tagged so the app can surface a "waiting for a reminder" alarm
// and the user can cancel too. One active reminder per session (setting replaces).
const REMINDER_TAG = 'jc-reminder'
const REMINDER_NAME = 'Reminder'
const REMINDER_MIN_S = 30
const REMINDER_MAX_S = 30 * 24 * 3600  // 30 days
const REMINDER_AUTOCANCEL_GRACE_MS = 8000  // don't auto-cancel within the turn that set it
// sessionKey -> ms when a reminder was last set (for the auto-cancel grace window).
const reminderSetAt = new Map()

// AgentToolResult is { content: [{ type, text }], details? } — return plain text.
function toolText(text) { return { content: [{ type: 'text', text }] } }

function fmtDur(secs) {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.round(secs / 60)}m`
  if (secs < 86400) { const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h` }
  return `${Math.round(secs / 86400)}d`
}

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
function skillsDir() { return path.join(resolveStateDir(), 'skills') }

// Memory skills are written to <stateDir>/skills/<slug>/SKILL.md — the same directory
// the gateway loads skills from. Slug is a kebab dir name (matches the app side).
const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

// ── memory content browsing (host-side) ─────────────────────────────────────────
// memory.list / memory.read let the app browse a server-local memory store from a
// REMOTE gateway: the store lives on THIS host, unreachable from the client. Mirrors
// the app's client-side adapters (src/lib/memory/adapters). Returns a flat item list
// (the graph view stays local-gateway-only).
function expandHome(p) { return String(p ?? '').replace(/^~(?=\/|$)/, os.homedir()) }

async function mdList(config) {
  const dir = expandHome(config?.path)
  let entries = []
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => ({ id: path.join(dir, e.name), title: e.name.replace(/\.md$/, '') }))
    .sort((a, b) => a.title.localeCompare(b.title))
}
async function mdRead(id) {
  return fs.readFile(expandHome(id), 'utf8')
}

// A memory credential is a literal or an "env:VAR" reference resolved from the host's
// environment — so the plaintext secret never has to live in the SKILL.md or config.
function resolveSecret(v) {
  if (typeof v !== 'string') return ''
  if (!v.startsWith('env:')) return v
  const name = v.slice(4).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return ''
  return process.env[name] ?? ''
}

function obsHeaders(config) {
  const key = resolveSecret(config?.apiKey).trim().replace(/^Bearer\s+/i, '')
  return key ? { Authorization: `Bearer ${key}` } : {}
}

// The Obsidian Local REST API's HTTPS port (27124) serves a SELF-SIGNED cert, which
// Node's fetch rejects ("fetch failed"). The desktop app trusts it via the OS cert
// store. Here we make the request with node:https and rejectUnauthorized:false — which
// reliably skips verification (unlike a fetch dispatcher) — but ONLY for a LOCAL host
// (loopback/.local/private IPv4) over https, never for a public URL. Returns a minimal
// Response-like object so callers can use res.ok / res.status / res.json() / res.text().
function insecureLocalHttps(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, rejectUnauthorized: false }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => body,
          json: async () => JSON.parse(body),
        })
      })
    })
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('request timed out')))
    req.end()
  })
}

// Single entry point for every Obsidian request, so the self-signed-cert handling and
// auth header live in one place. `suffix` is the path (+ query) after the base URL.
async function obsFetch(config, suffix, extraHeaders = {}) {
  const base = String(config?.url ?? '').replace(/\/$/, '')
  const url = base + suffix
  const headers = { ...obsHeaders(config), ...extraHeaders }
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' && isLocalEngineHost(u.hostname)) {
      return await insecureLocalHttps(url, headers)
    }
  } catch { /* malformed url → fall through to fetch, which will surface it */ }
  return fetch(url, { headers })
}

async function obsListAll(config, dirPath = '', depth = 0) {
  if (depth > 15) return []
  const enc = dirPath.split('/').filter(Boolean).map(encodeURIComponent).join('/') + (dirPath ? '/' : '')
  let res
  try { res = await obsFetch(config, '/vault/' + enc) } catch { return [] }
  if (!res.ok) return []
  const data = await res.json().catch(() => ({}))
  const files = []
  const subs = []
  for (const e of (data.files ?? [])) {
    if (e.startsWith('.')) continue
    if (e.endsWith('/')) subs.push(obsListAll(config, dirPath + e, depth + 1))
    else files.push(dirPath + e)
  }
  for (const s of await Promise.all(subs)) files.push(...s)
  return files
}
async function obsList(config) {
  const files = await obsListAll(config)
  return files
    .filter(f => f.endsWith('.md') && !f.endsWith('.excalidraw.md'))
    .map(p => {
      const parts = p.split('/')
      return { id: p, title: parts[parts.length - 1].replace(/\.md$/, ''), subtitle: parts.length > 1 ? parts.slice(0, -1).join('/') : undefined }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}
async function obsRead(config, id) {
  const enc = String(id).split('/').map(encodeURIComponent).join('/')
  const res = await obsFetch(config, '/vault/' + enc, { Accept: 'text/markdown' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// Obsidian backlink graph (ported from the app's client adapter) so the graph view
// works when the vault is server-local on a remote gateway.
async function obsExcludePatterns(config) {
  try {
    const res = await obsFetch(config, '/vault/.obsidian/app.json')
    if (!res.ok) return []
    const json = await res.json().catch(() => ({}))
    const raw = json.userIgnoreFilters
    if (Array.isArray(raw)) return raw.filter(s => typeof s === 'string' && s.length > 0)
  } catch { /* best-effort */ }
  return []
}
function obsExcluded(p, patterns) {
  if (!patterns.length) return false
  const lower = p.toLowerCase()
  return patterns.some(x => lower.includes(x.toLowerCase()))
}
async function obsGraph(config) {
  const check = await obsFetch(config, '/vault/')
  if (!check.ok) throw new Error(`Cannot list vault: HTTP ${check.status}`)
  const [allFiles, excludePatterns] = await Promise.all([obsListAll(config), obsExcludePatterns(config)])
  const mdFiles = allFiles.filter(f => f.endsWith('.md') && !f.endsWith('.excalidraw.md') && !obsExcluded(f, excludePatterns))

  const titleToId = new Map()
  const pathToId = new Map()
  const nodes = mdFiles.map(p => {
    const parts = p.split('/')
    const title = parts[parts.length - 1].replace(/\.md$/, '')
    const folder = parts.length > 1 ? parts[0] : ''
    const key = title.toLowerCase()
    if (!titleToId.has(key)) titleToId.set(key, p)
    pathToId.set(p.replace(/\.md$/i, '').toLowerCase(), p)
    return { id: p, title, folder, linkCount: 0 }
  })

  const resolveLink = (raw) => {
    let clean = raw.trim()
    try { clean = decodeURIComponent(clean) } catch { /* keep */ }
    clean = clean.replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase()
    return pathToId.get(clean) ?? titleToId.get(clean.split('/').pop() ?? clean)
  }

  const BATCH = 25
  const rawLinksByFile = new Map()
  const aliasToPath = new Map()
  for (let i = 0; i < mdFiles.length; i += BATCH) {
    const batch = mdFiles.slice(i, i + BATCH)
    await Promise.all(batch.map(async p => {
      try {
        const enc = p.split('/').map(encodeURIComponent).join('/')
        const res = await obsFetch(config, '/vault/' + enc, { Accept: 'text/markdown' })
        if (!res.ok) return
        const text = await res.text()
        const fmEnd = text.indexOf('\n---', 4)
        if (text.startsWith('---\n') && fmEnd !== -1) {
          const fm = text.slice(4, fmEnd)
          const inline = fm.match(/^aliases:\s*\[([^\]]*)\]/m)
          if (inline) {
            for (const part of inline[1].split(',')) {
              const a = part.trim().replace(/^["']|["']$/g, '').trim().toLowerCase()
              if (a && !titleToId.has(a) && !aliasToPath.has(a)) aliasToPath.set(a, p)
            }
          } else {
            const block = fm.match(/^aliases:\s*\n((?:[ \t]+-[^\n]*(?:\n|$))+)/m)
            if (block) {
              for (const line of block[1].split('\n')) {
                const lm = line.match(/^[ \t]+-\s*(.+)/)
                if (lm) {
                  const a = lm[1].trim().replace(/^["']|["']$/g, '').trim().toLowerCase()
                  if (a && !titleToId.has(a) && !aliasToPath.has(a)) aliasToPath.set(a, p)
                }
              }
            }
          }
        }
        const links = []
        for (const m of text.matchAll(/\[\[([^\]|#\n]+)/g)) links.push(m[1])
        for (const m of text.matchAll(/\[[^\]]*\]\(([^)#\n]+?\.md(?:[^)]*)?)\)/g)) links.push(m[1].split('#')[0].trim())
        if (links.length) rawLinksByFile.set(p, links)
      } catch { /* skip per-file */ }
    }))
  }
  for (const [alias, p] of aliasToPath) if (!titleToId.has(alias)) titleToId.set(alias, p)

  const linkMap = new Map()
  for (const [src, links] of rawLinksByFile) {
    const targets = new Set()
    for (const raw of links) { const t = resolveLink(raw); if (t && t !== src) targets.add(t) }
    if (targets.size) linkMap.set(src, targets)
  }
  const edges = []
  const seen = new Set()
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
  return { nodes, edges }
}

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
  // Surface the underlying cause: `fetch` TypeErrors read "fetch failed", but the real
  // reason (ECONNREFUSED, self-signed certificate, timeout, …) lives in err.cause.
  const base = err?.message ?? String(err)
  const cause = err?.cause
  const detail = cause?.code || cause?.message
  const msg = detail && detail !== base ? `${base} (${detail})` : base
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `joaxclaw-fs: ${msg}`))
}

// ── host.metrics : the gateway host's CPU / RAM / GPU ────────────────────────────
// The desktop app's local metrics (`window.api.metrics.get`) describe the CLIENT
// machine, so on a REMOTE gateway the dashboard showed the wrong host. This reports
// the actual gateway host's load, shaped exactly like the app's SystemMetrics
// (cpu %, ramUsed/ramTotal in bytes, gpu[] with memory in MB). CPU% and RAM use only
// Node built-ins (no systeminformation dep); GPU is a best-effort nvidia-smi read.
const execFileP = promisify(execFile)

function cpuSnapshot() {
  let idle = 0, total = 0
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t
    idle += c.times.idle
  }
  return { idle, total }
}

// Sample CPU times twice over a short window and derive a busy percentage — os.cpus()
// gives cumulative counters, so a single read can't yield a rate.
async function cpuPercent() {
  const a = cpuSnapshot()
  await new Promise(r => setTimeout(r, 150))
  const b = cpuSnapshot()
  const idleDelta = b.idle - a.idle
  const totalDelta = b.total - a.total
  if (totalDelta <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)))
}

// GPU stats, best-effort across vendors — each probe returns [] when its tool/GPU is
// absent, and we use the first that reports something. Memory is normalized to MB and
// utilization to a 0–100 int, matching the app's SystemMetrics.gpu shape.

// NVIDIA — nvidia-smi (Linux/Windows). One row per GPU.
async function gpuNvidia() {
  try {
    const { stdout } = await execFileP('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 4000 })
    return String(stdout).trim().split('\n').filter(Boolean).map(line => {
      const p = line.split(',').map(s => s.trim())
      return {
        model:          p[0] || 'NVIDIA GPU',
        utilizationGpu: parseInt(p[1], 10) || 0,
        memUsed:        parseInt(p[2], 10) || 0,   // MB
        memTotal:       parseInt(p[3], 10) || 0,   // MB
        temperatureGpu: parseInt(p[4], 10) || 0,
      }
    })
  } catch {
    return []
  }
}

// AMD — rocm-smi --json (Linux). JSON keys vary by ROCm version, so match by
// case-insensitive substring rather than exact keys.
async function gpuAmd() {
  if (os.platform() !== 'linux') return []
  try {
    const { stdout } = await execFileP('rocm-smi',
      ['--showuse', '--showmeminfo', 'vram', '--showtemp', '--showproductname', '--json'],
      { timeout: 4000 })
    const data = JSON.parse(stdout)
    const out = []
    for (const [card, info] of Object.entries(data)) {
      if (!info || typeof info !== 'object' || !/^card\d+/i.test(card)) continue
      const num = (sub) => {
        for (const [k, v] of Object.entries(info)) {
          if (k.toLowerCase().includes(sub)) {
            const n = parseFloat(String(v).replace(/[^\d.-]/g, ''))
            if (Number.isFinite(n)) return n
          }
        }
        return 0
      }
      const str = (sub) => {
        for (const [k, v] of Object.entries(info)) {
          if (k.toLowerCase().includes(sub)) return String(v)
        }
        return ''
      }
      out.push({
        model:          str('card series') || str('card model') || str('product') || 'AMD GPU',
        utilizationGpu: Math.round(num('gpu use')),
        memUsed:        Math.round(num('used memory') / (1024 * 1024)),        // bytes → MB
        memTotal:       Math.round(num('vram total memory') / (1024 * 1024)),  // bytes → MB
        temperatureGpu: Math.round(num('temperature')),
      })
    }
    return out
  } catch {
    return []
  }
}

// Apple Silicon — system_profiler (macOS). Reports the GPU model; per-GPU utilization
// and dedicated VRAM aren't available without elevated powermetrics (Apple uses unified
// memory, already covered by RAM), so those stay 0 and the app shows the model instead
// of a misleading 0% bar.
async function gpuApple() {
  if (os.platform() !== 'darwin') return []
  try {
    const { stdout } = await execFileP('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 5000 })
    const data = JSON.parse(stdout)
    const displays = Array.isArray(data?.SPDisplaysDataType) ? data.SPDisplaysDataType : []
    return displays
      .map(d => ({
        model:          d?.sppci_model || d?._name || 'Apple GPU',
        utilizationGpu: 0,
        memUsed:        0,
        memTotal:       0,
        temperatureGpu: 0,
      }))
      .filter(g => g.model)
  } catch {
    return []
  }
}

async function gpuStats() {
  const nv = await gpuNvidia()
  if (nv.length) return nv
  const amd = await gpuAmd()
  if (amd.length) return amd
  return gpuApple()
}

// ── script jobs : track long-running host scripts the model launches ─────────────
// The gateway's built-in bash tool can't be followed once a command backgrounds, so
// the model launches long scripts via the script_start tool: it spawns the process
// HERE, keeps it alive with stdout/stderr captured into a bounded buffer, and returns
// a jobId. The desktop app polls jobs.get to render a live progress card; the model
// polls script_status or sets a reminder to check back. Jobs live on the host, so
// progress survives an app reconnect/restart.
const jobs = new Map()               // jobId -> job
const JOB_MAX_BYTES = 256 * 1024     // keep only the last 256 KiB of a job's output
const JOB_TAIL_BYTES = 16 * 1024     // most we return to a poller in one go
const JOB_GC_MS = 10 * 60 * 1000     // forget a finished job 10 min after it ends

// Best-effort progress: the last NN% seen in recent output. Scripts that don't print a
// percentage simply have no bar (status + live log still track them).
function parsePercent(text) {
  let pct = null
  for (const m of text.slice(-4000).matchAll(/(\d{1,3})\s?%/g)) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n >= 0 && n <= 100) pct = n
  }
  return pct
}

function startJob(command, cwd, opts = {}) {
  const id = randomUUID()
  const job = {
    id, command, cwd: cwd || undefined, startedAt: Date.now(), finishedAt: null,
    running: true, done: false, exitCode: null, error: null, output: '', percent: null, pid: null,
    sessionKey: opts.sessionKey,   // the session that launched it, for the finish wake-up
  }
  jobs.set(id, job)
  let child
  try {
    // Run via the user's LOGIN shell (`$SHELL -lc`, default bash) instead of the default
    // `sh -c`, so their shell profile is sourced and PATH modifications (nvm/asdf/volta/
    // homebrew node, etc.) apply. Otherwise a systemd-launched gateway's minimal PATH leaks
    // in and tools like `node` resolve to a stale/missing /usr/bin/node. Subprocesses
    // inherit this env. A missing shell surfaces as a normal job error via child 'error'.
    const shell = process.env.SHELL || 'bash'
    child = spawn(shell, ['-lc', command], { cwd: cwd || undefined, env: process.env })
  } catch (err) {
    job.running = false; job.done = true; job.error = String(err?.message ?? err); job.finishedAt = Date.now()
    return job
  }
  job.pid = child.pid ?? null
  const append = (buf) => {
    job.output += buf.toString('utf8')
    if (job.output.length > JOB_MAX_BYTES) job.output = job.output.slice(-JOB_MAX_BYTES)
    const pct = parsePercent(job.output)
    if (pct != null) job.percent = pct
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.on('error', (err) => { job.error = String(err?.message ?? err) })
  child.on('close', (code, signal) => {
    job.running = false
    job.done = true
    job.exitCode = code
    if (code == null && signal) job.error = job.error || `terminated by ${signal}`
    job.finishedAt = Date.now()
    try { opts.onExit && opts.onExit(job) } catch { /* wake-up is best-effort */ }
    setTimeout(() => jobs.delete(id), JOB_GC_MS)
  })
  return job
}

function stopJob(id) {
  const job = jobs.get(id)
  if (!job) return false
  if (job.running && job.pid != null) {
    try { process.kill(job.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  return true
}

// Serializable view for pollers. `includeOutput` off for the list; on (tail-capped) for
// a single job's live card.
function jobView(job, includeOutput = true) {
  const view = {
    id: job.id, command: job.command, cwd: job.cwd,
    running: job.running, done: job.done, exitCode: job.exitCode, error: job.error,
    percent: job.percent, startedAt: job.startedAt, finishedAt: job.finishedAt,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
  }
  if (includeOutput) {
    view.output = job.output.length > JOB_TAIL_BYTES ? job.output.slice(-JOB_TAIL_BYTES) : job.output
    view.outputTruncated = job.output.length > JOB_TAIL_BYTES
  }
  return view
}

// Tag for the "your script finished" wake-up turn (distinct from reminders so the
// reminder auto-cancel doesn't touch it).
const SCRIPT_DONE_TAG = 'jc-script-done'

// The message delivered to the launching session when its script finishes, so the model
// can pick up the result. Includes a bounded output tail.
function jobWakeMessage(job) {
  const secs = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000)
  const status = job.error ? `failed (${job.error})`
    : job.exitCode === 0 ? 'finished successfully'
    : `finished with exit code ${job.exitCode}`
  const tail = job.output.split('\n').slice(-40).join('\n')
  return [
    `A background script you started has ${status} after ${secs}s.`,
    '',
    `Command: ${job.command}`,
    `jobId: ${job.id}`,
    '',
    '--- recent output ---',
    tail || '(no output)',
    '',
    'Process this result and continue.',
  ].join('\n')
}

export default definePluginEntry({
  id: 'joaxclaw-fs',
  name: 'JoaxClaw FS',
  description: 'teams.* / processes.* (backed by <stateDir>), engines.* (host-side local-LLM probing), and host.metrics (host CPU/RAM/GPU) gateway methods.',
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

    // ── memory.* : write/remove memory SKILL.md files on the gateway host ─────────
    // Lets the desktop app manage memory-connection skills on a REMOTE gateway (the
    // local ~/.openclaw is the wrong machine there). memory.status is a presence probe.
    api.registerGatewayMethod('memory.status', async ({ respond }) => {
      respond(true, { ok: true, feature: 'memory-skills' })
    }, { scope: READ_SCOPE })

    api.registerGatewayMethod('memory.skill.set', async ({ params, respond }) => {
      const slug = params?.slug
      const markdown = params?.markdown
      if (typeof slug !== 'string' || !SKILL_SLUG_RE.test(slug)) {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `invalid skill slug ${JSON.stringify(slug)}`))
      }
      if (typeof markdown !== 'string' || !markdown.trim()) {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.skill.set requires markdown (non-empty string)'))
      }
      try {
        const dir = path.join(skillsDir(), slug)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, 'SKILL.md'), markdown, 'utf8')
        respond(true, { ok: true, slug })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })

    api.registerGatewayMethod('memory.skill.remove', async ({ params, respond }) => {
      const slug = params?.slug
      if (typeof slug !== 'string' || !SKILL_SLUG_RE.test(slug)) {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `invalid skill slug ${JSON.stringify(slug)}`))
      }
      try {
        await fs.rm(path.join(skillsDir(), slug), { recursive: true, force: true })
        respond(true, { ok: true, slug })
      } catch (err) { failed(respond, err) }
    }, { scope: WRITE_SCOPE })

    // Browse a server-local memory store from a remote gateway (content lives on this host).
    api.registerGatewayMethod('memory.list', async ({ params, respond }) => {
      const providerId = params?.providerId
      const config = params?.config ?? {}
      try {
        let items
        if (providerId === 'markdown') items = await mdList(config)
        else if (providerId === 'obsidian') items = await obsList(config)
        else return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `memory.list: unknown provider ${JSON.stringify(providerId)}`))
        respond(true, { items })
      } catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    api.registerGatewayMethod('memory.read', async ({ params, respond }) => {
      const providerId = params?.providerId
      const config = params?.config ?? {}
      const id = params?.id
      if (typeof id !== 'string' || !id) {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'memory.read requires id'))
      }
      try {
        let content
        if (providerId === 'markdown') content = await mdRead(id)
        else if (providerId === 'obsidian') content = await obsRead(config, id)
        else return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `memory.read: unknown provider ${JSON.stringify(providerId)}`))
        respond(true, { content })
      } catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    // Backlink graph for a server-local graph store (Obsidian) on a remote gateway.
    api.registerGatewayMethod('memory.graph', async ({ params, respond }) => {
      const providerId = params?.providerId
      const config = params?.config ?? {}
      try {
        if (providerId !== 'obsidian') {
          return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `memory.graph: unsupported provider ${JSON.stringify(providerId)}`))
        }
        const graph = await obsGraph(config)
        respond(true, { graph })
      } catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    // ── host.metrics : the gateway host's live CPU / RAM / GPU ────────────────────
    // So the desktop dashboard shows the REMOTE host's load instead of the client's.
    api.registerGatewayMethod('host.metrics', async ({ respond }) => {
      try {
        const [cpu, gpu] = await Promise.all([cpuPercent(), gpuStats()])
        const ramTotal = os.totalmem()
        const ramUsed = ramTotal - os.freemem()
        respond(true, { ok: true, cpu, ramUsed, ramTotal, gpu })
      } catch (err) { failed(respond, err) }
    }, { scope: READ_SCOPE })

    // ── jobs.* : desktop app reads live progress of script_start background jobs ───
    api.registerGatewayMethod('jobs.list', async ({ respond }) => {
      const list = [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).map(j => jobView(j, false))
      respond(true, { jobs: list })
    }, { scope: READ_SCOPE })

    api.registerGatewayMethod('jobs.get', async ({ params, respond }) => {
      const job = jobs.get(String(params?.jobId ?? ''))
      if (!job) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'unknown jobId'))
      respond(true, jobView(job, true))
    }, { scope: READ_SCOPE })

    api.registerGatewayMethod('jobs.stop', async ({ params, respond }) => {
      if (!stopJob(String(params?.jobId ?? ''))) {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'unknown jobId'))
      }
      respond(true, { ok: true })
    }, { scope: WRITE_SCOPE })

    // ── script_start / script_status / script_stop (agent tools) ────────────────
    if (typeof api.registerTool === 'function') {
      const canWake = typeof api.scheduleSessionTurn === 'function'
      api.registerTool((toolContext) => ({
        name: 'script_start',
        label: 'Start script',
        description:
          'Launch a long-running shell command/script on the host and track it in the BACKGROUND, returning a jobId immediately instead of blocking. Use this — not the bash/shell tool — for anything slow or long-lived: builds, installs, deploys, test suites, training runs, servers, data jobs. JoaxClaw shows the user a live progress card (status, elapsed, streaming output, a % bar if the script prints one). When the script finishes, THIS session is automatically woken with the result — so you do NOT need to poll or block: launch it, then continue other work or end your turn, and the result will be delivered back to you. (Set notifyOnDone:false to opt out — e.g. for a server you intend to leave running.)',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            command: { type: 'string', description: 'Shell command/script to run (executed via the shell on the gateway host).' },
            cwd: { type: 'string', description: 'Optional working directory.' },
            notifyOnDone: { type: 'boolean', description: 'Wake this session with the result when the script finishes. Default true. Set false for fire-and-forget / long-lived servers.' },
          },
          required: ['command'],
        },
        execute: async (_toolCallId, params) => {
          const command = typeof params?.command === 'string' ? params.command.trim() : ''
          if (!command) return toolText('script_start: `command` is required.')
          const cwd = typeof params?.cwd === 'string' && params.cwd.trim() ? params.cwd.trim() : undefined
          const sessionKey = toolContext?.sessionKey
          const notify = params?.notifyOnDone !== false && !!sessionKey && canWake
          // On completion, schedule a one-shot turn back to the launching session carrying
          // the result — the same session-turn scheduler the reminder tool uses.
          const onExit = notify ? (job) => {
            api.scheduleSessionTurn({
              delayMs: 1000, deleteAfterRun: true, sessionKey,
              message: jobWakeMessage(job), tag: SCRIPT_DONE_TAG, name: 'Script finished',
              deliveryMode: 'announce',
            }).catch(() => { /* best-effort wake */ })
          } : undefined
          const job = startJob(command, cwd, { sessionKey, onExit })
          if (job.done && job.error) return toolText(`Could not start script: ${job.error}`)
          return toolText(
            `Script started in the background.\njobId: ${job.id}\n` +
            (notify
              ? `When it finishes I'll automatically wake this session with the result — don't poll or wait, just continue or end your turn.`
              : `Don't block waiting — call script_status with this jobId to check on it, or set a reminder to come back.`),
          )
        },
      }))

      api.registerTool(() => ({
        name: 'script_status',
        label: 'Script status',
        description: 'Check a background script started with script_start: whether it is still running, its exit code, elapsed time, and the most recent output.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { jobId: { type: 'string', description: 'The jobId returned by script_start.' } },
          required: ['jobId'],
        },
        execute: async (_toolCallId, params) => {
          const job = jobs.get(String(params?.jobId ?? ''))
          if (!job) return toolText('No such job (it may have finished and been cleaned up).')
          const v = jobView(job, true)
          const tail = (v.output ?? '').split('\n').slice(-40).join('\n')
          const head = v.running
            ? `Still running (${Math.round(v.elapsedMs / 1000)}s elapsed${v.percent != null ? `, ~${v.percent}%` : ''}).`
            : v.error ? `Finished with error: ${v.error}.`
            : `Finished with exit code ${v.exitCode} after ${Math.round(v.elapsedMs / 1000)}s.`
          return toolText(`${head}\n\n--- recent output ---\n${tail || '(no output yet)'}`)
        },
      }))

      api.registerTool(() => ({
        name: 'script_stop',
        label: 'Stop script',
        description: 'Stop (SIGTERM) a background script started with script_start.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { jobId: { type: 'string', description: 'The jobId returned by script_start.' } },
          required: ['jobId'],
        },
        execute: async (_toolCallId, params) => {
          return toolText(stopJob(String(params?.jobId ?? '')) ? 'Sent stop signal to the script.' : 'No such job to stop.')
        },
      }))
    }

    // ── reminder_set / reminder_cancel (agent tools) ────────────────────────────
    if (typeof api.registerTool === 'function' && typeof api.scheduleSessionTurn === 'function') {
      // Factory form so each tool call sees its own session via toolContext.
      api.registerTool((toolContext) => ({
        name: 'reminder_set',
        label: 'Set reminder',
        description:
          'Schedule a reminder to ping yourself later. After the delay you receive `prompt` as a new message, ' +
          'reviving this conversation — use it when you are idle or waiting on something you cannot advance right now ' +
          '(a background script, a build, an external result) instead of stopping. Write `prompt` as a clear instruction ' +
          'to your future self, and assume the task may already be done when you wake: check first, and call reminder_cancel ' +
          'if there is nothing to do. One active reminder per session (calling this again replaces it).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompt: { type: 'string', description: 'The exact message to deliver to yourself when the timer fires.' },
            delaySeconds: { type: 'number', description: `Fire this many seconds from now (min ${REMINDER_MIN_S}, max ${REMINDER_MAX_S}). Provide this OR "at".` },
            at: { type: 'string', description: 'Absolute ISO-8601 time to fire (alternative to delaySeconds).' },
          },
          required: ['prompt'],
        },
        execute: async (_toolCallId, params) => {
          const sessionKey = toolContext?.sessionKey
          if (!sessionKey) return toolText('Reminder not set: no session context available.')
          const prompt = typeof params?.prompt === 'string' ? params.prompt.trim() : ''
          if (!prompt) return toolText('Reminder not set: `prompt` is required.')

          let delayMs
          if (typeof params?.at === 'string' && params.at.trim()) {
            const t = Date.parse(params.at.trim())
            if (Number.isNaN(t)) return toolText(`Reminder not set: could not parse "at" time ${JSON.stringify(params.at)}.`)
            delayMs = t - Date.now()
          } else if (params?.delaySeconds != null) {
            const s = Number(params.delaySeconds)
            if (!Number.isFinite(s)) return toolText('Reminder not set: `delaySeconds` must be a number.')
            delayMs = s * 1000
          } else {
            return toolText('Reminder not set: provide `delaySeconds` or `at`.')
          }

          const secs = Math.round(delayMs / 1000)
          if (secs < REMINDER_MIN_S) return toolText(`Reminder not set: minimum delay is ${REMINDER_MIN_S}s.`)
          if (secs > REMINDER_MAX_S) return toolText(`Reminder not set: maximum delay is ${Math.round(REMINDER_MAX_S / 86400)} days.`)

          const whenIso = new Date(Date.now() + delayMs).toISOString()
          try {
            // One reminder per session: clear any existing before scheduling the new one.
            await api.unscheduleSessionTurnsByTag({ sessionKey, tag: REMINDER_TAG })
            const handle = await api.scheduleSessionTurn({
              delayMs, deleteAfterRun: true, sessionKey, message: prompt,
              tag: REMINDER_TAG, name: REMINDER_NAME, deliveryMode: 'announce',
            })
            if (!handle) return toolText('Reminder could not be scheduled (the session turn scheduler is unavailable).')
            reminderSetAt.set(sessionKey, Date.now())
            return toolText(`Reminder set — I'll ping you at ${whenIso} (in ${fmtDur(secs)}). Call reminder_cancel if you finish sooner.`)
          } catch (err) {
            return toolText(`Reminder not set: ${String(err?.message ?? err)}`)
          }
        },
      }))

      api.registerTool((toolContext) => ({
        name: 'reminder_cancel',
        label: 'Cancel reminder',
        description: 'Cancel this session\'s pending self-ping reminder. Call as soon as the thing you were waiting for is done or no longer relevant.',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        execute: async () => {
          const sessionKey = toolContext?.sessionKey
          if (!sessionKey) return toolText('No session context available.')
          try {
            const res = await api.unscheduleSessionTurnsByTag({ sessionKey, tag: REMINDER_TAG })
            reminderSetAt.delete(sessionKey)
            return toolText(res?.removed ? `Cancelled ${res.removed} pending reminder(s).` : 'No pending reminder to cancel.')
          } catch (err) {
            return toolText(`Could not cancel reminder: ${String(err?.message ?? err)}`)
          }
        },
      }))

      // Auto-cancel on activity: if this session finishes a turn that ISN'T the reminder
      // ping itself, the wait is over — clear any stale pending reminder. Run-context marks
      // the turn that set the reminder so we don't cancel it in the very same turn.
      if (typeof api.registerAgentEventSubscription === 'function') {
        try {
          api.registerAgentEventSubscription({
            id: 'joaxclaw-fs.reminder-autocancel',
            description: 'Cancel a pending reminder once the agent does other work.',
            handle: async (event) => {
              try {
                const sessionKey = event?.sessionKey
                if (!sessionKey) return
                const setAt = reminderSetAt.get(sessionKey)
                if (!setAt) return  // no reminder tracked for this session
                const kind = event?.type ?? event?.kind ?? event?.event
                if (kind !== 'final' && kind !== 'turn-final' && kind !== 'turn.completed') return
                // Grace window: don't cancel the reminder within the same turn that set it
                // (that turn's own "final" would otherwise clear it immediately).
                if (Date.now() - setAt < REMINDER_AUTOCANCEL_GRACE_MS) return
                reminderSetAt.delete(sessionKey)
                await api.unscheduleSessionTurnsByTag({ sessionKey, tag: REMINDER_TAG })
              } catch { /* best-effort */ }
            },
          })
        } catch { /* subscription API shape differs — auto-cancel degrades gracefully */ }
      }
    }
  },
})
