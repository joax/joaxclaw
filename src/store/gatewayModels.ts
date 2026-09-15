import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { parseModelChoices, type GatewayModel } from '../lib/gatewayModels'

// The gateway's list of models, read on every connect and on first use. See
// lib/gatewayModels.ts for what it's used for.

interface GatewayModelsState {
  /** null until loaded, or when this gateway can't list its models. */
  models: GatewayModel[] | null
  /** Re-read the list. Concurrent calls share one request. */
  load: () => Promise<void>
  /** Load once, if nothing has been loaded yet. Safe to call from render effects. */
  ensure: () => void
}

let inflight: Promise<void> | null = null

export const useGatewayModelsStore = create<GatewayModelsState>((set, get) => ({
  models: null,

  load() {
    inflight ??= (async () => {
      try {
        const res = await gatewayClient.request<unknown>('models.list', {})
        set({ models: parseModelChoices(res) })
      } catch {
        // Not fatal. Without the list every thinking level is offered, and local models
        // are recognised by their provider instead.
      } finally {
        inflight = null
      }
    })()
    return inflight
  },

  ensure() {
    if (get().models === null) void get().load()
  },
}))
