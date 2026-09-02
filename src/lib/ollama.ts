import type { OllamaModel } from './types'
import { fetchBody, type EngineInstance } from './localEngines'

const BASE = 'http://localhost:11434'

// One Ollama instance's models. `viaGateway` routes the reads through the gateway
// HOST (joaxclaw-fs plugin) — on a remote gateway the engine is loopback-bound there
// and unreachable from this client, and its models are the ones the agents actually use.
async function fetchInstanceModels(baseUrl: string, viaGateway: boolean): Promise<OllamaModel[]> {
  try {
    const parse = (body: string | null): { models?: { name: string; size: number; size_vram?: number }[] } => {
      if (!body) return { models: [] }
      try { return JSON.parse(body) } catch { return { models: [] } }
    }
    const [tagsRes, psRes] = await Promise.all([
      fetchBody(`${baseUrl}/api/tags`, viaGateway).then(parse).catch(() => ({ models: [] })),
      fetchBody(`${baseUrl}/api/ps`, viaGateway).then(parse).catch(() => ({ models: [] }))
    ])

    const running: Record<string, number> = {}
    for (const m of (psRes.models ?? [])) {
      running[m.name] = m.size_vram ?? 0
    }

    return (tagsRes.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      loaded: m.name in running,
      vramUsed: running[m.name]
    }))
  } catch {
    return []
  }
}

export async function listOllamaModels(viaGateway = false): Promise<OllamaModel[]> {
  return fetchInstanceModels(BASE, viaGateway)
}

/** Loaded models for one local engine instance, kept separate per instance. */
export interface EngineModels {
  key: string        // provider id, e.g. "ollama" / "ollama-cron"
  label: string      // "Ollama"
  isCron: boolean    // the isolated background instance
  baseUrl: string
  models: OllamaModel[]
}

// Every configured local Ollama instance, not just the default port. A gateway
// commonly runs a second isolated instance for cron/background work (the
// :11434 → :11435 convention); it loads its own copy of a model into the SAME
// GPU, so reporting only the first instance understates what is actually resident.
// Non-Ollama engines are skipped: /api/ps has no OpenAI-compatible equivalent, so
// there is no loaded-vs-available distinction to show.
export async function listEngineModels(
  instances: EngineInstance[],
  viaGateway = false,
): Promise<EngineModels[]> {
  const ollama = instances.filter(i => i.api === 'ollama')
  if (ollama.length === 0) {
    return [{ key: 'ollama', label: 'Ollama', isCron: false, baseUrl: BASE, models: await listOllamaModels(viaGateway) }]
  }
  return Promise.all(
    ollama.map(async inst => ({
      key: inst.key,
      label: inst.label,
      isCron: inst.isCron,
      baseUrl: inst.baseUrl,
      models: await fetchInstanceModels(inst.baseUrl.replace(/\/+$/, ''), viaGateway),
    })),
  )
}

// Provider-qualified ids ("<provider>/<model>") of every model resident on ANY
// configured local instance. The prefix is the PROVIDER key, not a hardcoded "ollama/":
// the isolated cron instance loads its own copy into the same GPU, so
// `ollama-cron/<name>` and `ollama/<name>` are separate residencies and either one can
// be loaded without the other. Pickers key off this to draw the "loaded" dot.
export function loadedModelIds(engines: EngineModels[]): Set<string> {
  const out = new Set<string>()
  for (const e of engines) {
    for (const m of e.models) if (m.loaded) out.add(`${e.key}/${m.name}`)
  }
  return out
}

/** A resident model tagged with the instance holding it. */
export interface LoadedModel extends OllamaModel {
  engineKey: string
  engineLabel: string
  isCron: boolean
}

// Every model resident across ALL local instances. Surfaces that total VRAM must use
// this: counting only the interactive instance understates what is actually on the GPU
// by a whole model whenever a cron job is running.
export function loadedModels(engines: EngineModels[]): LoadedModel[] {
  return engines.flatMap(e =>
    e.models.filter(m => m.loaded).map(m => ({ ...m, engineKey: e.key, engineLabel: e.label, isCron: e.isCron })),
  )
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
