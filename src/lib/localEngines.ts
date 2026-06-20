// Generalized local LLM engine detection + health probing.
//
// Mirrors the gateway's own model-preflight logic:
//   - a provider is "local" when its baseUrl host is loopback / .local / private IPv4
//   - health path is `/api/tags` for ollama, `/models` for OpenAI-compatible engines
// Engines are discovered from the gateway's configured providers (models.providers)
// and, on a local gateway, by probing well-known default ports.

import type { GwModelProvider } from './types'
import { gatewayClient } from './gateway'

export type EngineApiKind = 'ollama' | 'openai'
export type EngineStatus = 'up' | 'down' | 'unknown'

export interface EngineDef {
  id: string
  label: string
  api: EngineApiKind
  defaultPort: number
  basePath: string   // path segment appended to host, e.g. '' (ollama) or '/v1' (openai-compatible)
}

// Known local engines for default-port detection. Engines that share a port
// (llama.cpp / LocalAI on 8080) are listed once with a combined label.
export const KNOWN_ENGINES: EngineDef[] = [
  { id: 'ollama',    label: 'Ollama',              api: 'ollama', defaultPort: 11434, basePath: '' },
  { id: 'lmstudio',  label: 'LM Studio',           api: 'openai', defaultPort: 1234,  basePath: '/v1' },
  { id: 'vllm',      label: 'vLLM',                api: 'openai', defaultPort: 8000,  basePath: '/v1' },
  { id: 'llamacpp',  label: 'llama.cpp / LocalAI', api: 'openai', defaultPort: 8080,  basePath: '/v1' },
  { id: 'jan',       label: 'Jan',                 api: 'openai', defaultPort: 1337,  basePath: '/v1' },
  { id: 'koboldcpp', label: 'KoboldCpp',           api: 'openai', defaultPort: 5001,  basePath: '/v1' },
]

export interface EngineInstance {
  key: string             // provider id (config) or `${engineId}:${port}` (detected)
  engineId: string        // canonical engine id (ollama, lmstudio, …) or the bare provider base
  label: string
  baseUrl: string
  api: EngineApiKind
  source: 'config' | 'detected'
  isCron: boolean         // provider id ends with -cron (the isolated background instance)
}

// An engine grouped into its interactive ("main") and background ("cron") instances.
export interface EngineGroup {
  engineId: string
  label: string
  main?: EngineInstance
  cron?: EngineInstance
}

function hostOf(url: string): string | null {
  try {
    let h = new URL(url).hostname.toLowerCase()
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
    return h || null
  } catch {
    return null
  }
}

function isPrivateIpv4(host: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
  const [a, b] = host.split('.').map(n => parseInt(n, 10))
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

// Matches the gateway's isLocalProviderBaseUrl host classification.
export function isLocalHost(host: string | null): boolean {
  if (!host) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
    host === '::1' || host === '::ffff:7f00:1' || host === '::ffff:127.0.0.1' ||
    host.endsWith('.local') || isPrivateIpv4(host)
}

export function healthUrl(api: EngineApiKind, baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  return api === 'ollama' ? `${b}/api/tags` : `${b}/models`
}

// Maps a gateway provider `api` string to a probe family, or null if not a local engine api.
function apiKind(api: string | undefined): EngineApiKind | null {
  const a = (api ?? '').toLowerCase()
  if (a === 'ollama') return 'ollama'
  if (a === 'lmstudio' || a === 'vllm' || a === 'openai' || a.startsWith('openai-')) return 'openai'
  return null
}

function engineMeta(providerId: string): { engineId: string; label: string } {
  const base = providerId.replace(/-cron$/i, '').toLowerCase()
  const known = KNOWN_ENGINES.find(e => base === e.id || base.startsWith(e.id))
  if (known) return { engineId: known.id, label: known.label }
  return { engineId: base, label: providerId.replace(/-cron$/i, '') }
}

// ── Probe (via the Electron main process; falls back to direct fetch) ──────────

async function probeUrl(url: string): Promise<boolean> {
  const api = (window as unknown as { api?: { ollama?: { probe?: (u: string) => Promise<{ ok: boolean }> } } })?.api?.ollama
  if (api?.probe) {
    try { return (await api.probe(url)).ok } catch { return false }
  }
  try { const r = await fetch(url); return r.ok } catch { return false }
}

function isUnknownMethod(e: unknown): boolean {
  return /unknown method/i.test(e instanceof Error ? e.message : String(e))
}

// Probe a health URL and classify the result. When `viaGateway`, the probe runs on
// the gateway HOST via the joaxclaw-fs `engines.probe` method — that's how loopback
// engines on a remote gateway (unreachable from this client) get a real up/down.
// 'unknown' means we couldn't tell: the plugin isn't installed on the host.
async function probeStatus(url: string, viaGateway: boolean): Promise<EngineStatus> {
  if (!viaGateway) return (await probeUrl(url)) ? 'up' : 'down'
  try {
    const r = await gatewayClient.request<{ ok: boolean }>('engines.probe', { url })
    return r.ok ? 'up' : 'down'
  } catch (e) {
    return isUnknownMethod(e) ? 'unknown' : 'down'
  }
}

// ── Model listing ───────────────────────────────────────────────────────────
// Fetch the model URL's raw body. Local → main-process fetch (not CORS-bound,
// reaches localhost); remote → engines.fetch on the gateway host. null on failure
// or when the remote plugin is absent.
async function fetchBody(url: string, viaGateway: boolean): Promise<string | null> {
  if (viaGateway) {
    try {
      const r = await gatewayClient.request<{ ok: boolean; body?: string }>('engines.fetch', { url })
      return r.ok ? (r.body ?? '') : null
    } catch {
      return null
    }
  }
  const api = (window as unknown as { api?: { ollama?: { fetch?: (u: string) => Promise<{ ok: boolean; body?: string }> } } })?.api?.ollama
  if (api?.fetch) {
    try { const r = await api.fetch(url); return r.ok ? (r.body ?? '') : null } catch { return null }
  }
  try { const r = await fetch(url); return r.ok ? await r.text() : null } catch { return null }
}

// Extract model ids from a health/models response body. Ollama `/api/tags` returns
// { models: [{ name }] }; OpenAI-compatible `/models` returns { data: [{ id }] }.
export function parseModelIds(api: EngineApiKind, body: string): string[] {
  try {
    const j = JSON.parse(body) as Record<string, unknown>
    const pick = (arr: unknown): string[] =>
      Array.isArray(arr)
        ? arr.map(m => (m && typeof m === 'object' ? ((m as Record<string, unknown>).id ?? (m as Record<string, unknown>).name) : null))
            .filter((s): s is string => typeof s === 'string' && s.length > 0)
        : []
    if (api === 'ollama') return pick(j.models)
    return pick(j.data).length ? pick(j.data) : pick(j.models)
  } catch {
    return []
  }
}

// List the model ids a reachable engine is serving. Gateway-aware, mirroring
// checkInstance's routing (local/override → direct; remote → via the plugin).
export async function fetchEngineModels(
  inst: EngineInstance,
  gatewayIsLocal: boolean,
  overrideUrl?: string
): Promise<string[]> {
  const override = overrideUrl?.trim()
  const baseUrl = override || inst.baseUrl
  const viaGateway = !gatewayIsLocal && !override
  const body = await fetchBody(healthUrl(inst.api, baseUrl), viaGateway)
  return body == null ? [] : parseModelIds(inst.api, body)
}

// Probes one instance. An override URL (reachable from this client, e.g. a tailnet
// address) takes precedence over the config baseUrl. Routing:
//   - local gateway, or an explicit override → probe directly from this client
//   - remote gateway, no override → probe on the host via engines.probe (plugin);
//     'unknown' if the plugin isn't installed
export async function checkInstance(
  inst: EngineInstance,
  gatewayIsLocal: boolean,
  overrideUrl?: string
): Promise<EngineStatus> {
  const override = overrideUrl?.trim()
  const baseUrl = override || inst.baseUrl
  const viaGateway = !gatewayIsLocal && !override
  return probeStatus(healthUrl(inst.api, baseUrl), viaGateway)
}

// ── Detection ─────────────────────────────────────────────────────────────────

export function detectFromConfig(providers: Record<string, GwModelProvider>): EngineInstance[] {
  const out: EngineInstance[] = []
  for (const [pid, p] of Object.entries(providers)) {
    const baseUrl = (p.baseUrl ?? '').trim()
    if (!baseUrl) continue
    const kind = apiKind(p.api)
    if (!kind) continue
    if (!isLocalHost(hostOf(baseUrl))) continue
    const { engineId, label } = engineMeta(pid)
    out.push({ key: pid, engineId, label, baseUrl, api: kind, source: 'config', isCron: /-cron$/i.test(pid) })
  }
  return out
}

// Isolated "cron" instances run on the main engine's default port + 1 — the Ollama
// :11434→:11435 convention, generalized to every known engine. We probe these so the
// panel can flag an isolated instance (and prompt for an <engine>-cron provider) even
// when it isn't declared in config. None of these offsets collide with another
// engine's main default port. Unused ports just probe `down` — no false positives.
const CRON_PORT_OFFSET = 1
const CRON_COMPANIONS: { engineId: string; label: string; api: EngineApiKind; port: number; basePath: string }[] =
  KNOWN_ENGINES.map(e => ({ engineId: e.id, label: e.label, api: e.api, port: e.defaultPort + CRON_PORT_OFFSET, basePath: e.basePath }))

// Probes default `localhost` ports for engines not already in config. Locally this
// hits the client's own ports; with `viaGateway` (remote gateway + joaxclaw-fs plugin)
// it probes the gateway HOST's loopback ports, discovering engines running there.
export async function detectByPort(existing: EngineInstance[], viaGateway = false): Promise<EngineInstance[]> {
  const usedPorts = new Set(existing.map(e => { try { return new URL(e.baseUrl).port } catch { return '' } }))
  const found: EngineInstance[] = []

  await Promise.all(KNOWN_ENGINES.map(async e => {
    if (usedPorts.has(String(e.defaultPort))) return
    const baseUrl = `http://localhost:${e.defaultPort}${e.basePath}`
    if (await probeStatus(healthUrl(e.api, baseUrl), viaGateway) === 'up') {
      found.push({ key: `${e.id}:${e.defaultPort}`, engineId: e.id, label: e.label, baseUrl, api: e.api, source: 'detected', isCron: false })
    }
  }))

  await Promise.all(CRON_COMPANIONS.map(async c => {
    if (usedPorts.has(String(c.port))) return
    const baseUrl = `http://localhost:${c.port}${c.basePath}`
    if (await probeStatus(healthUrl(c.api, baseUrl), viaGateway) === 'up') {
      found.push({ key: `${c.engineId}-cron:${c.port}`, engineId: c.engineId, label: c.label, baseUrl, api: c.api, source: 'detected', isCron: true })
    }
  }))

  return found
}

// Groups instances by engine into main + cron pairs.
export function groupEngines(instances: EngineInstance[]): EngineGroup[] {
  const byEngine = new Map<string, EngineGroup>()
  for (const inst of instances) {
    const g = byEngine.get(inst.engineId) ?? { engineId: inst.engineId, label: inst.label }
    if (inst.isCron) g.cron = inst
    else g.main = inst
    g.label = g.main?.label ?? g.label
    byEngine.set(inst.engineId, g)
  }
  return [...byEngine.values()]
}
