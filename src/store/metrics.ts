import { create } from 'zustand'
import type { SystemMetrics, OllamaModel } from '../lib/types'
import { listOllamaModels } from '../lib/ollama'
import { gatewayClient } from '../lib/gateway'
import { isRemoteGatewayState } from './connection'

// Which machine the current `metrics` value came from — so a stale reading from the
// OTHER context (e.g. local metrics seeded before a remote connect) is cleared rather
// than shown, while a transient same-context miss keeps the last-good value.
type MetricsSource = 'host' | 'local' | null
let lastMetricsSource: MetricsSource = null

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
      const ok = !!(metricsResult && metricsResult.ok !== false)
      const wantSource: MetricsSource = remote ? 'host' : 'local'

      set(state => {
        let metrics = state.metrics
        if (ok) {
          metrics = metricsResult
          lastMetricsSource = wantSource
        } else if (lastMetricsSource !== wantSource) {
          // No fresh reading AND the last value came from a DIFFERENT context — e.g. local
          // metrics seeded before connect, now that we're remote. Clear rather than show the
          // client machine's numbers under a "host" label. A transient miss in the same
          // context keeps the last-good value (no flicker); an unavailable host.metrics
          // (older plugin) leaves this null, so the UI shows the "update the plugin" hint.
          metrics = null
          lastMetricsSource = null
        }
        return {
          metrics,
          ollamaModels,
          activeModel: ollamaModels.find(m => m.loaded)?.name ?? null
        }
      })
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
