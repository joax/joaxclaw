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

export async function listRunning(baseUrl: string): Promise<Set<string>> {
  const j = await engineGet(baseUrl, '/api/ps')
  const models = (j?.models as { name: string }[] | undefined) ?? []
  return new Set(models.map(m => m.name))
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
