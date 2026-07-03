import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { useConnectionStore } from './connection'

// Detects whether the connected OpenClaw gateway has an update available, via the
// gateway's own `update.status` RPC (operator.admin) — which is channel-aware, so we
// don't guess against npm. The response carries an optional `updateAvailable` object
// ({ currentVersion, latestVersion, channel }); its presence means an update exists.
// The update *action* is the existing agent-driven `openclaw update` flow (gatewayUpdate.ts).

const SKIP_KEY = 'joaxclaw-gateway-update-skip'  // persisted: a latestVersion the user skipped

export interface GatewayUpdateInfo { currentVersion: string; latestVersion: string; channel?: string }

interface GatewayUpdateState {
  info: GatewayUpdateInfo | null  // present ⇒ an update is available
  checking: boolean
  checkedAtMs: number | null
  error: string | null
  skipped: string | null
  dismissed: boolean  // session-only
  check: (force?: boolean) => Promise<void>
  skip: () => void
  dismiss: () => void
}

export const useGatewayUpdateStore = create<GatewayUpdateState>((set, get) => ({
  info: null,
  checking: false,
  checkedAtMs: null,
  error: null,
  skipped: (() => { try { return localStorage.getItem(SKIP_KEY) } catch { return null } })(),
  dismissed: false,

  async check(force = false) {
    const st = get()
    if (st.checking) return
    // update.status is operator.admin — only meaningful once connected with that scope.
    const conn = useConnectionStore.getState()
    if (conn.status !== 'connected' || !conn.grantedScopes.includes('operator.admin')) return
    if (!force && st.checkedAtMs && Date.now() - st.checkedAtMs < 30 * 60_000) return
    set({ checking: true, error: null })
    try {
      const res = await gatewayClient.request<{ updateAvailable?: GatewayUpdateInfo }>('update.status', {})
      const ua = res?.updateAvailable
      const info = ua && ua.currentVersion && ua.latestVersion
        ? { currentVersion: ua.currentVersion, latestVersion: ua.latestVersion, channel: ua.channel }
        : null
      set({ info, checking: false, checkedAtMs: Date.now() })
    } catch (e) {
      set({ checking: false, error: String(e), checkedAtMs: Date.now() })
    }
  },

  skip() {
    const v = get().info?.latestVersion
    if (!v) return
    try { localStorage.setItem(SKIP_KEY, v) } catch { /* ignore */ }
    set({ skipped: v })
  },

  dismiss() { set({ dismissed: true }) },
}))
