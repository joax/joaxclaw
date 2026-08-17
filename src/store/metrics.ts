import { create } from 'zustand'
import type { SystemMetrics, OllamaModel } from '../lib/types'
import { listEngineModels, type EngineModels } from '../lib/ollama'
import { detectFromConfig } from '../lib/localEngines'
import { useModelsStore } from './models'
import { gatewayClient } from '../lib/gateway'
import { isRemoteGatewayState, useConnectionStore } from './connection'

// Which machine the current `metrics` value describes — the gateway URL when the
// numbers came from the host, 'client' when they came from this machine's own probe.
// A stale reading from a DIFFERENT machine (local metrics seeded before a remote
// connect, or the previous gateway after switching) is cleared rather than shown,
// while a transient miss in the same context keeps the last-good value.
let lastMetricsContext: string | null = null

interface MetricsState {
  metrics: SystemMetrics | null
  // Per-instance: a gateway often runs a second, isolated Ollama for cron work whose
  // models occupy the same GPU. Surfaces that show "what is loaded" must use this.
  engineModels: EngineModels[]
  // Flattened view of the INTERACTIVE instance, kept for the model pickers that key
  // off `ollama/<name>`.
  ollamaModels: OllamaModel[]
  activeModel: string | null
  intervalId: ReturnType<typeof setInterval> | null
  start: () => void
  stop: () => void
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  metrics: null,
  engineModels: [],
  ollamaModels: [],
  activeModel: null,
  intervalId: null,

  start() {
    if (get().intervalId) return
    // Always prefer the gateway HOST's own numbers, local gateway included: there the
    // host IS this machine, so one path serves both and the two readings can never
    // disagree. They used to: the Electron probe falls back to nvidia-smi only, so an
    // AMD or Apple GPU vanished from the monitor on a local gateway while the same
    // machine reported it fine through the plugin (which probes ROCm and
    // system_profiler too). The local probe stays as the fallback for a local gateway
    // whose plugin is missing or too old, and for when we aren't connected at all.
    const localMetrics = () =>
      (window as unknown as { api?: { metrics?: { get: () => Promise<SystemMetrics & { ok: boolean }> } } })
        .api?.metrics?.get().catch(() => null) ?? Promise.resolve(null)
    const hostMetrics = () =>
      gatewayClient.request<SystemMetrics & { ok?: boolean }>('host.metrics').catch(() => null)

    const usable = (m: (SystemMetrics & { ok?: boolean }) | null) => (m && m.ok !== false ? m : null)

    const tick = async () => {
      const { status, connection } = useConnectionStore.getState()
      const connected = status === 'connected'
      const remote = isRemoteGatewayState()
      // Loaded models must come from the machine the agents actually run on, and from
      // EVERY configured local instance — the cron engine loads its own copy into the
      // same GPU. Falls back to the default instance until the config has loaded.
      const engines = detectFromConfig(useModelsStore.getState().providers)
      const [hostResult, engineModels] = await Promise.all([
        connected ? hostMetrics() : Promise.resolve(null),
        listEngineModels(engines, remote),
      ])
      const ollamaModels = (engineModels.find(e => !e.isCron) ?? engineModels[0])?.models ?? []

      let fresh = usable(hostResult)
      // Falling back to this client's probe is only honest when the gateway is local
      // (or absent) — on a remote gateway these would be the wrong machine's numbers.
      let context = connected ? (connection?.url ?? 'gateway') : 'client'
      if (!fresh && !remote) {
        fresh = usable(await localMetrics())
        if (fresh) context = 'client'
      }

      set(state => {
        let metrics = state.metrics
        if (fresh) {
          metrics = fresh
          lastMetricsContext = context
        } else if (lastMetricsContext !== context) {
          // No fresh reading AND the last value describes a DIFFERENT machine — clear
          // rather than mislabel it. A transient miss in the same context keeps the
          // last-good value (no flicker); an unavailable host.metrics on a remote
          // gateway (older plugin) leaves this null, so the UI shows the update hint.
          metrics = null
          lastMetricsContext = null
        }
        return {
          metrics,
          engineModels,
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
