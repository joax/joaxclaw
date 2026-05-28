import type { OllamaModel } from './types'

const BASE = 'http://localhost:11434'

export async function listOllamaModels(): Promise<OllamaModel[]> {
  try {
    const [tagsRes, psRes] = await Promise.all([
      fetch(`${BASE}/api/tags`).then(r => r.json()).catch(() => ({ models: [] })),
      fetch(`${BASE}/api/ps`).then(r => r.json()).catch(() => ({ models: [] }))
    ])

    const running: Record<string, number> = {}
    for (const m of (psRes.models ?? [])) {
      running[m.name] = m.size_vram ?? 0
    }

    return (tagsRes.models ?? []).map((m: { name: string; size: number }) => ({
      name: m.name,
      size: m.size,
      loaded: m.name in running,
      vramUsed: running[m.name]
    }))
  } catch {
    return []
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
