// Manage models on a local engine (Ollama) — list installed, pull (with progress),
// delete — all routed through the gateway's joaxclaw-fs engines.* methods. Because the
// plugin runs on the engine's HOST, the same calls work for a local AND a remote
// gateway. Requires joaxclaw-fs (engines.pull/pullStatus/delete); without it the manager
// shows an install notice. Ollama-only (it's the engine with a real management API).

import { gatewayClient } from './gateway'

export interface InstalledModel {
  name: string
  sizeBytes?: number
  paramSize?: string   // e.g. "7B"
  quant?: string       // e.g. "Q4_K_M"
  family?: string      // e.g. "llama"
}

export interface PullProgress {
  status?: string
  completed?: number
  total?: number
  done?: boolean
  error?: string
  model?: string
}

export function isUnknownMethod(e: unknown): boolean {
  return /unknown method/i.test(e instanceof Error ? e.message : String(e))
}

// GET an engine JSON endpoint via the plugin and parse the body.
async function engineGet(baseUrl: string, pathSeg: string): Promise<Record<string, unknown> | null> {
  const r = await gatewayClient.request<{ ok: boolean; body?: string }>('engines.fetch', { url: baseUrl.replace(/\/+$/, '') + pathSeg })
  if (!r.ok || !r.body) return null
  try { return JSON.parse(r.body) as Record<string, unknown> } catch { return null }
}

interface OllamaTag { name: string; size?: number; details?: { parameter_size?: string; quantization_level?: string; family?: string } }

export async function listInstalled(baseUrl: string): Promise<InstalledModel[]> {
  const j = await engineGet(baseUrl, '/api/tags')
  const models = (j?.models as OllamaTag[] | undefined) ?? []
  return models
    .map(m => ({ name: m.name, sizeBytes: m.size, paramSize: m.details?.parameter_size, quant: m.details?.quantization_level, family: m.details?.family }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// A resident (loaded) model, from Ollama's /api/ps — carries the REAL footprint:
// `size` is total resident bytes (weights + KV cache at the loaded context), `sizeVram`
// the portion on the GPU, and `contextLength` the context window it was loaded with.
export interface RunningModel { name: string; size?: number; sizeVram?: number; contextLength?: number }

export async function listRunning(baseUrl: string): Promise<Map<string, RunningModel>> {
  const j = await engineGet(baseUrl, '/api/ps')
  const models = (j?.models as Array<Record<string, unknown>> | undefined) ?? []
  const out = new Map<string, RunningModel>()
  for (const m of models) {
    const name = String(m.name ?? m.model ?? '')
    if (!name) continue
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    out.set(name, { name, size: num(m.size), sizeVram: num(m.size_vram), contextLength: num(m.context_length) })
  }
  return out
}

// Start a background pull on the host. Returns a pullId to poll.
export async function startPull(baseUrl: string, model: string): Promise<string> {
  const r = await gatewayClient.request<{ pullId: string }>('engines.pull', { baseUrl, model })
  return r.pullId
}

export async function pullStatus(pullId: string): Promise<PullProgress> {
  return gatewayClient.request<PullProgress>('engines.pullStatus', { pullId })
}

export async function deleteModel(baseUrl: string, model: string): Promise<boolean> {
  const r = await gatewayClient.request<{ ok: boolean }>('engines.delete', { baseUrl, model })
  return !!r.ok
}

export interface ModelDetails { family?: string; paramSize?: string; quant?: string; contextLength?: number; license?: string }

export async function showModel(baseUrl: string, model: string): Promise<ModelDetails | null> {
  const r = await gatewayClient.request<{ ok: boolean; body?: string }>('engines.show', { baseUrl, model })
  if (!r.ok || !r.body) return null
  let j: Record<string, unknown>
  try { j = JSON.parse(r.body) } catch { return null }
  const details = (j.details ?? {}) as { family?: string; parameter_size?: string; quantization_level?: string }
  const info = (j.model_info ?? {}) as Record<string, unknown>
  const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'))
  const ctx = ctxKey ? Number(info[ctxKey]) : undefined
  const license = typeof j.license === 'string' ? j.license.split('\n')[0].slice(0, 80) : undefined
  return { family: details.family, paramSize: details.parameter_size, quant: details.quantization_level, contextLength: Number.isFinite(ctx) ? ctx : undefined, license }
}

// Load (keepAlive < 0, resident) or unload (0) a model.
export async function setKeepAlive(baseUrl: string, model: string, keepAlive: number): Promise<boolean> {
  const r = await gatewayClient.request<{ ok: boolean }>('engines.keepAlive', { baseUrl, model, keepAlive })
  return !!r.ok
}

export function fmtContext(n?: number): string {
  if (!n || n <= 0) return '—'
  return n >= 1024 ? `${Math.round(n / 1024)}k` : String(n)
}

// Overall % for a pull (best-effort — Ollama reports per-layer bytes).
export function pullPercent(p: PullProgress): number | null {
  if (p.done) return 100
  if (p.total && p.completed != null && p.total > 0) return Math.min(99, Math.round((p.completed / p.total) * 100))
  return null
}

export function fmtBytes(n?: number): string {
  if (!n || n <= 0) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}

// ── RAM footprint estimate ────────────────────────────────────────────────────
// Running a model needs the weights (≈ the download size) plus a context/KV-cache
// buffer. We don't have the model architecture here, so the context buffer is a rough
// GQA-aware fp16 heuristic from the parameter count and a default context window — enough
// to show, visually, how much of the machine's RAM a model would take. Clearly approximate.

const DEFAULT_CTX_TOKENS = 8192
// ~18 KB of KV cache per (billion params × token) — tuned so a 7B at 8k ctx ≈ ~1 GB.
const KV_BYTES_PER_B_TOKEN = 18_000

// Parse a parameter-count label ("7B", "1.5B", "135M", "8x7B") to billions of params.
export function parseParamsB(paramSize?: string): number | undefined {
  if (!paramSize) return undefined
  const m = /([\d.]+)\s*([bm])/i.exec(paramSize)
  if (!m) return undefined
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return undefined
  const b = m[2].toLowerCase() === 'm' ? n / 1000 : n
  // "8x7B" mixture-of-experts: multiply the leading count in.
  const x = /^(\d+)\s*x/i.exec(paramSize.trim())
  return x ? b * parseInt(x[1], 10) : b
}

// Estimated context/KV-cache bytes for a model at a given context window.
export function estimateContextBytes(paramSize?: string, ctxTokens = DEFAULT_CTX_TOKENS): number {
  const b = parseParamsB(paramSize)
  if (!b) return 0
  return b * ctxTokens * KV_BYTES_PER_B_TOKEN
}

export interface RamFootprintInput {
  diskBytes?: number      // installed size on disk (weights proxy)
  paramSize?: string      // e.g. "7B" (for the estimate)
  ramTotal: number        // system RAM bytes
  vramTotal?: number      // GPU VRAM bytes (0/undefined if no GPU data)
  // Actual resident stats from Ollama /api/ps — present only while the model is loaded:
  actualSize?: number     // total resident bytes (weights + KV cache at the loaded ctx)
  actualVram?: number     // resident bytes on the GPU
  contextTokens?: number  // context window the model was loaded with
}

export interface RamFootprint {
  weights: number                 // model weight bytes
  context: number                 // context/KV-cache bytes (real when loaded, else estimated)
  total: number                   // weights + context
  actual: boolean                 // true = real numbers from /api/ps, false = estimate
  onGpu: boolean                  // resident mostly on the GPU (VRAM)
  capacity: number                // bytes compared against (VRAM if on GPU, else RAM)
  capacityLabel: 'RAM' | 'VRAM'
  contextTokens?: number          // context window used (for the label)
  fracWeights: number             // 0..1 of capacity
  fracContext: number             // 0..1 of capacity
  fracTotal: number               // 0..1 of capacity (uncapped)
  overCapacity: boolean           // needs more than that memory pool
}

// Compute a model's memory footprint. When the model is loaded, uses the REAL resident
// size from /api/ps (which reflects the actual context) and compares against VRAM if it's
// on the GPU; otherwise falls back to an estimate at a default context window.
export function ramFootprint(input: RamFootprintInput): RamFootprint {
  const { diskBytes, paramSize, ramTotal, vramTotal, actualSize, actualVram, contextTokens } = input
  let weights: number, context: number, total: number, actual: boolean, onGpu: boolean, ctxUsed: number | undefined

  if (actualSize && actualSize > 0) {
    actual = true
    total = actualSize
    weights = Math.min(diskBytes ?? actualSize, actualSize)
    context = Math.max(0, total - weights)
    onGpu = (actualVram ?? 0) / total > 0.5
    ctxUsed = contextTokens
  } else {
    actual = false
    weights = diskBytes ?? 0
    context = estimateContextBytes(paramSize, contextTokens)
    total = weights + context
    onGpu = false
    ctxUsed = contextTokens ?? DEFAULT_CTX_TOKENS
  }

  const useVram = onGpu && !!vramTotal && vramTotal > 0
  const capacity = useVram ? vramTotal! : (ramTotal > 0 ? ramTotal : total || 1)
  return {
    weights, context, total, actual, onGpu,
    capacity, capacityLabel: useVram ? 'VRAM' : 'RAM', contextTokens: ctxUsed,
    fracWeights: weights / capacity,
    fracContext: context / capacity,
    fracTotal: total / capacity,
    overCapacity: total > capacity,
  }
}
