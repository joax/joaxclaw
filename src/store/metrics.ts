import { create } from 'zustand'
import type { SystemMetrics, OllamaModel } from '../lib/types'
import { listOllamaModels } from '../lib/ollama'
import { gatewayClient } from '../lib/gateway'
import { isRemoteGatewayState } from './connection'

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
    // Local (Electron) metrics describe the CLIENT machine — wrong for a remote gateway.
    // There, ask the gateway host for its own CPU/RAM/GPU via the joaxclaw-fs plugin's
    // host.metrics RPC. If the plugin is older (no host.metrics), the request rejects and
    // we keep prior metrics rather than misreport the client's numbers as the host's.
    const localMetrics = () =>
      (window as unknown as { api?: { metrics?: { get: () => Promise<SystemMetrics & { ok: boolean }> } } })
        .api?.metrics?.get().catch(() => null) ?? Promise.resolve(null)
    const remoteMetrics = () =>
      gatewayClient.request<SystemMetrics & { ok?: boolean }>('host.metrics').catch(() => null)

    const tick = async () => {
      const remote = isRemoteGatewayState()
      const [metricsResult, ollamaModels] = await Promise.all([
        remote ? remoteMetrics() : localMetrics(),
        listOllamaModels()
      ])

      set(state => ({
        // Only overwrite metrics with a usable frame; on failure keep the last-good value
        // (avoids flicker to null on a transient miss; stays null when unavailable).
        metrics: metricsResult && metricsResult.ok !== false ? metricsResult : state.metrics,
        ollamaModels,
        activeModel: ollamaModels.find(m => m.loaded)?.name ?? null
      }))
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
