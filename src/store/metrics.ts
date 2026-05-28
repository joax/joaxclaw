import { create } from 'zustand'
import type { SystemMetrics, OllamaModel } from '../lib/types'
import { listOllamaModels } from '../lib/ollama'

interface MetricsState {
  metrics: SystemMetrics | null
  ollamaModels: OllamaModel[]
  activeModel: string | null
  intervalId: ReturnType<typeof setInterval> | null
  start: () => void
  stop: () => void
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  metrics: null,
  ollamaModels: [],
  activeModel: null,
  intervalId: null,

  start() {
    if (get().intervalId) return
    const tick = async () => {
      const [metricsResult, ollamaModels] = await Promise.all([
        (window as unknown as { api?: { metrics?: { get: () => Promise<SystemMetrics & { ok: boolean }> } } }).api?.metrics?.get().catch(() => null) ?? Promise.resolve(null),
        listOllamaModels()
      ])

      if (metricsResult?.ok !== false) {
        set({
          metrics: metricsResult ?? null,
          ollamaModels,
          activeModel: ollamaModels.find(m => m.loaded)?.name ?? null
        })
      }
    }

    tick()
    const id = setInterval(tick, 3000)
    set({ intervalId: id })
  },

  stop() {
    const id = get().intervalId
    if (id) clearInterval(id)
    set({ intervalId: null })
  }
}))
