// Devices store — manages OpenClaw gateway device pairings.
//
// The gateway pairs clients (CLI, web UIs, phones) with a keypair and issues them
// scoped operator tokens. This store mirrors the gateway's device.pair.* / device.token.*
// methods and live pairing events so Settings → Devices can manage them.
//
// Source of truth is the gateway: every mutation re-lists, and live pairing events
// trigger a re-list, so the view never drifts. Token VALUES are never returned by
// device.pair.list (only metadata); a fresh secret appears once, on rotate.

import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import type { GatewayNode, NodeHostStats } from '../lib/nodeStats'

// ── Types (mirror device.pair.list payloads) ───────────────────────────────────

export interface DeviceToken {
  role: string
  scopes: string[]
  createdAtMs: number
  rotatedAtMs?: number
  revokedAtMs?: number
}

export interface PairedDevice {
  deviceId: string
  publicKey: string
  displayName?: string
  platform?: string
  clientId?: string
  clientMode?: string
  role: string
  roles?: string[]
  scopes: string[]
  createdAtMs: number
  approvedAtMs?: number
  lastSeenAtMs?: number
  /** Why it was last seen — `connect`, `device-token-auth`, a background wake… */
  lastSeenReason?: string
  /** Live right now. Present in device.pair.list; the panel showed no online state at all. */
  connected?: boolean
  tokens?: DeviceToken[]
}

export interface PendingPair {
  requestId: string
  deviceId: string
  publicKey: string
  platform?: string
  clientId?: string
  clientMode?: string
  role: string
  roles?: string[]
  scopes: string[]
  silent?: boolean
  isRepair?: boolean
  ts: number
}

export interface RotatedToken {
  deviceId: string
  role: string
  token?: string   // absent if the gateway didn't return the secret for this caller/role
  scopes?: string[]
  rotatedAtMs?: number
}

interface DeviceListResponse {
  pending?: PendingPair[]
  paired?: PairedDevice[]
}

interface NodeListResponse {
  ts?: number
  nodes?: GatewayNode[]
}

// ── Helpers (pure, exported for tests) ──────────────────────────────────────────

const ADMIN_SCOPE = 'operator.admin'

/** device.pair.rename caps `label` at 64 characters. */
export const DEVICE_LABEL_MAX = 64

/** A device with at least one non-revoked admin token, or admin in its scope grant. */
export function deviceHasAdmin(d: PairedDevice): boolean {
  const liveAdminToken = (d.tokens ?? []).some(t => !t.revokedAtMs && t.scopes?.includes(ADMIN_SCOPE))
  if (liveAdminToken) return true
  // Fall back to the device's granted scopes when token metadata is absent.
  return (d.tokens?.length ?? 0) === 0 && d.scopes?.includes(ADMIN_SCOPE)
}

/**
 * True when `deviceId` is the ONLY admin-capable device — removing it (or revoking
 * its admin token) would leave no device able to manage pairings. Guarded in the UI
 * to avoid locking the gateway's device management out entirely.
 */
export function isLastAdminDevice(paired: PairedDevice[], deviceId: string): boolean {
  const admins = paired.filter(deviceHasAdmin)
  return admins.length === 1 && admins[0]?.deviceId === deviceId
}

// ── Store ───────────────────────────────────────────────────────────────────────

interface DevicesState {
  pending: PendingPair[]
  paired: PairedDevice[]
  /** Capability nodes (phones, CLI hosts) — a different roster from paired devices. */
  nodes: GatewayNode[]
  loading: boolean
  error: string | null
  busy: Record<string, boolean>          // keyed by requestId or deviceId
  rotated: RotatedToken | null           // reveal-once buffer for the rotate modal
  _subscribed: boolean

  load: () => Promise<void>
  approve: (requestId: string) => Promise<boolean>
  reject: (requestId: string) => Promise<boolean>
  remove: (deviceId: string) => Promise<boolean>
  /** `label` is the gateway's parameter name, capped at 64 chars. */
  rename: (deviceId: string, label: string) => Promise<boolean>
  rotateToken: (deviceId: string, role: string, scopes: string[]) => Promise<boolean>
  revokeToken: (deviceId: string, role: string) => Promise<boolean>
  clearRotated: () => void
  clearError: () => void
  _startEventListening: () => void
}

const errText = (e: unknown): string => {
  const s = e instanceof Error ? e.message : String(e)
  try { const p = JSON.parse(s) as { message?: string }; if (p?.message) return p.message } catch { /* not JSON */ }
  return s
}

let _refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useDevicesStore = create<DevicesState>((set, get) => ({
  pending: [],
  paired: [],
  nodes: [],
  loading: false,
  error: null,
  busy: {},
  rotated: null,
  _subscribed: false,

  _startEventListening() {
    if (get()._subscribed) return
    set({ _subscribed: true })
    gatewayClient.on((frame) => {
      // Any pairing lifecycle change → re-list (cheap + authoritative). Debounced so a
      // burst (approve emits several events) collapses into one fetch.
      if (frame.event.startsWith('device.pair') || frame.event.startsWith('device.pairing')) {
        if (_refreshTimer) clearTimeout(_refreshTimer)
        _refreshTimer = setTimeout(() => { void get().load() }, 250)
        return
      }
      // A resource snapshot for one node, sent on connect and every 60s. Patched in
      // place: re-listing on each would be a request per node per minute.
      if (frame.event === 'node.hostStats') {
        const p = (frame.payload ?? {}) as { nodeId?: string; hostStats?: NodeHostStats }
        if (!p.nodeId || !p.hostStats) return
        set(s => ({
          nodes: s.nodes.map(n => (n.nodeId === p.nodeId ? { ...n, hostStats: p.hostStats } : n)),
        }))
        return
      }
      // Presence and pairing changes alter the roster itself, so re-list.
      if (frame.event === 'node.presence' || frame.event.startsWith('node.pair')) {
        if (_refreshTimer) clearTimeout(_refreshTimer)
        _refreshTimer = setTimeout(() => { void get().load() }, 250)
      }
    })
  },

  async load() {
    get()._startEventListening()
    set({ loading: true, error: null })
    try {
      const r = await gatewayClient.request<DeviceListResponse>('device.pair.list', {})
      const paired = [...(r.paired ?? [])].sort((a, b) => (b.approvedAtMs ?? b.createdAtMs ?? 0) - (a.approvedAtMs ?? a.createdAtMs ?? 0))
      const pending = [...(r.pending ?? [])].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
      // Nodes are a separate roster and a separate method. A gateway with none answers
      // with an empty list; one that withholds the scope rejects it — neither should
      // cost us the device list, so it degrades on its own.
      const nodes = await gatewayClient
        .request<NodeListResponse>('node.list', {})
        .then(n => (Array.isArray(n?.nodes) ? n.nodes : []))
        .catch(() => [])
      set({ paired, pending, nodes, loading: false })
    } catch (e) {
      set({ loading: false, error: errText(e) })
    }
  },

  async approve(requestId) { return run(set, get, requestId, () => gatewayClient.request('device.pair.approve', { requestId })) },
  async reject(requestId)  { return run(set, get, requestId, () => gatewayClient.request('device.pair.reject',  { requestId })) },
  async remove(deviceId)   { return run(set, get, deviceId,  () => gatewayClient.request('device.pair.remove',  { deviceId })) },
  async rename(deviceId, label) {
    const trimmed = label.trim().slice(0, DEVICE_LABEL_MAX)
    if (!trimmed) return false          // the schema requires at least one character
    return run(set, get, deviceId, () => gatewayClient.request('device.pair.rename', { deviceId, label: trimmed }))
  },
  async revokeToken(deviceId, role) {
    return run(set, get, deviceId, () => gatewayClient.request('device.token.revoke', { deviceId, role }))
  },

  async rotateToken(deviceId, role, scopes) {
    return run(set, get, deviceId, async () => {
      const res = await gatewayClient.request<RotatedToken>('device.token.rotate', { deviceId, role, scopes })
      set({ rotated: { deviceId, role, token: res?.token, scopes: res?.scopes, rotatedAtMs: res?.rotatedAtMs } })
    })
  },

  clearRotated() { set({ rotated: null }) },
  clearError() { set({ error: null }) },
}))

// Run a mutation with per-key busy tracking + error capture, then refresh. Returns
// whether it succeeded. (Live events also refresh, but we re-list immediately so the
// UI updates even if an event is missed.)
async function run(
  set: (partial: Partial<DevicesState> | ((s: DevicesState) => Partial<DevicesState>)) => void,
  get: () => DevicesState,
  key: string,
  fn: () => Promise<unknown>,
): Promise<boolean> {
  set(s => ({ busy: { ...s.busy, [key]: true }, error: null }))
  try {
    await fn()
    await get().load()
    return true
  } catch (e) {
    set({ error: errText(e) })
    return false
  } finally {
    set(s => { const busy = { ...s.busy }; delete busy[key]; return { busy } })
  }
}
