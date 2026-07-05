import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConnectionStatus, GatewayConnection } from '../lib/types'
import { gatewayClient } from '../lib/gateway'
import { gatewayHost, isLocalGateway } from '../lib/ollamaHealth'
import { readLocalStore, patchLocalStore } from '../lib/localStore'
import { connectionSignal, type ConnectionSignal, type PingSample } from '../lib/connectionSignal'

interface HeartbeatEntry { time: number; ok: boolean }

// How often we ping the gateway to sample round-trip latency. Frequent enough to
// feel live in the status bar, but the ping is a cached-snapshot `health` call so
// the cost is negligible.
const PING_INTERVAL_MS = 10000

// How many times we silently retry a dropped connection before giving up and
// falling back to the manual connect screen. The gateway reloads (and briefly
// drops the WS) whenever a channel is added/enabled, so transient drops are
// expected and should self-heal rather than kick the user out.
export const RECONNECT_MAX_ATTEMPTS = 12

interface ConnectionState {
  status: ConnectionStatus
  statusDetail: string
  connection: GatewayConnection | null
  savedConnections: GatewayConnection[]
  heartbeats: HeartbeatEntry[]
  lastHeartbeat: number | null
  // Recent round-trip latency samples, used to gauge connection strength.
  pings: PingSample[]
  lastRtt: number | null
  uptime: number
  uptimeStart: number | null
  // True while we are silently retrying a dropped connection (gateway reload).
  reconnecting: boolean
  reconnectAttempt: number
  // Operator scopes the gateway granted this connection (from the connect handshake).
  // Drives client-side gating of admin-only UI; the gateway still enforces it.
  grantedScopes: string[]

  connect: (conn: GatewayConnection) => void
  disconnect: () => void
  cancelReconnect: () => void
  saveConnection: (conn: GatewayConnection) => void
  removeConnection: (url: string) => void
  setEngineUrl: (gatewayUrl: string, key: string, url: string) => void
}

// True when connected to a gateway on another host. Client-side system metrics
// (GPU/CPU/RAM and the local Ollama at localhost:11434) then describe THIS
// machine, not the gateway host where inference actually runs — so the UI hides
// them rather than present a laptop's stats as if they were the gateway's.
export function useIsRemoteGateway(): boolean {
  return useConnectionStore(s => s.status === 'connected' && !isLocalGateway(gatewayHost(s.connection?.url)))
}

// Non-hook variant for use inside stores / async logic (e.g. the teams store
// deciding whether a missing plugin should hard-fail or fall back to local files).
export function isRemoteGatewayState(): boolean {
  const s = useConnectionStore.getState()
  return s.status === 'connected' && !isLocalGateway(gatewayHost(s.connection?.url))
}

// Current connection strength (latency + reliability) derived from recent pings.
// Recompute in the component from `pings`/`status` rather than memoizing here so
// the returned object identity doesn't churn the whole store's subscribers.
export function useConnectionSignal(): ConnectionSignal {
  const pings = useConnectionStore(s => s.pings)
  const status = useConnectionStore(s => s.status)
  return connectionSignal(pings, status)
}

// True when the connection holds the operator.admin scope — required for managing
// other devices (approve/reject/remove, token rotate/revoke).
export function useIsAdmin(): boolean {
  return useConnectionStore(s => s.grantedScopes.includes('operator.admin'))
}

// Reconnect bookkeeping kept outside the store (timers / flags, not UI state).
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let intentionalDisconnect = false
let attempt = 0

function clearReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
}

// Latency-ping loop, only alive while connected (also a timer, not UI state).
let pingTimer: ReturnType<typeof setInterval> | null = null

function stopPingLoop() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
}

function startPingLoop() {
  stopPingLoop()
  const run = async () => {
    if (!gatewayClient.connected) return
    let sample: PingSample
    try {
      const rtt = await gatewayClient.ping()
      sample = { time: Date.now(), rtt, ok: true }
    } catch {
      sample = { time: Date.now(), rtt: 0, ok: false }
    }
    useConnectionStore.setState(s => ({
      lastRtt: sample.ok ? sample.rtt : s.lastRtt,
      pings: [...s.pings.slice(-29), sample],
    }))
  }
  void run() // sample immediately so the indicator populates on connect
  pingTimer = setInterval(run, PING_INTERVAL_MS)
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      status: 'disconnected',
      statusDetail: '',
      connection: null,
      savedConnections: [],
      heartbeats: [],
      lastHeartbeat: null,
      pings: [],
      lastRtt: null,
      uptime: 0,
      uptimeStart: null,
      reconnecting: false,
      reconnectAttempt: 0,
      grantedScopes: [],

      connect(conn) {
        intentionalDisconnect = false
        attempt = 0
        clearReconnect()
        stopPingLoop()
        set({ status: 'connecting', connection: conn, heartbeats: [], lastHeartbeat: null, pings: [], lastRtt: null, reconnecting: false, reconnectAttempt: 0 })

        gatewayClient.onStatusChange = (status, detail) => {
          if (status === 'connected') {
            attempt = 0
            clearReconnect()
            set({ status: 'connected', statusDetail: '', uptimeStart: Date.now(), reconnecting: false, reconnectAttempt: 0, grantedScopes: [...gatewayClient.grantedScopes] })
            startPingLoop()
          } else if (status === 'connecting') {
            // Don't clobber the "reconnecting" banner with a plain connecting state.
            if (!get().reconnecting) set({ status: 'connecting', statusDetail: '' })
          } else if (status === 'error' && /auth rejected/i.test(detail ?? '')) {
            // Bad token — looping would never succeed, so stop and surface it.
            intentionalDisconnect = true
            clearReconnect()
            stopPingLoop()
            set({ status: 'error', statusDetail: detail ?? '', uptimeStart: null, uptime: 0, reconnecting: false, reconnectAttempt: 0 })
          } else {
            // Unexpected drop or transient error → auto-reconnect (gateway reload).
            stopPingLoop()
            set({ status: 'disconnected', statusDetail: detail ?? '', uptimeStart: null, uptime: 0 })
            scheduleReconnect(get, set)
          }
        }

        gatewayClient.onHeartbeat = () => {
          const now = Date.now()
          set(s => ({
            lastHeartbeat: now,
            heartbeats: [...s.heartbeats.slice(-29), { time: now, ok: true }]
          }))
        }

        gatewayClient.connect(conn.url, conn.token)

        // Save connection if not already saved
        const exists = get().savedConnections.some(c => c.url === conn.url)
        if (!exists) {
          set(s => ({ savedConnections: [...s.savedConnections, conn] }))
        }
      },

      disconnect() {
        intentionalDisconnect = true
        clearReconnect()
        stopPingLoop()
        gatewayClient.disconnect()
        set({ status: 'disconnected', connection: null, uptimeStart: null, uptime: 0, pings: [], lastRtt: null, reconnecting: false, reconnectAttempt: 0, grantedScopes: [] })
      },

      cancelReconnect() {
        intentionalDisconnect = true
        clearReconnect()
        stopPingLoop()
        gatewayClient.disconnect()
        set({ status: 'disconnected', statusDetail: '', reconnecting: false, reconnectAttempt: 0 })
      },

      saveConnection(conn) {
        set(s => {
          const filtered = s.savedConnections.filter(c => c.url !== conn.url)
          return { savedConnections: [...filtered, conn] }
        })
      },

      removeConnection(url) {
        set(s => ({ savedConnections: s.savedConnections.filter(c => c.url !== url) }))
      },

      setEngineUrl(gatewayUrl, key, url) {
        const merge = (c: GatewayConnection): GatewayConnection => {
          if (c.url !== gatewayUrl) return c
          const next = { ...(c.engineUrls ?? {}) }
          if (url.trim()) next[key] = url.trim()
          else delete next[key]
          return { ...c, engineUrls: next }
        }
        set(s => ({
          connection: s.connection ? merge(s.connection) : s.connection,
          savedConnections: s.savedConnections.map(merge),
        }))
      }
    }),
    {
      name: 'joaxclaw-connection',
      partialize: (s) => ({ savedConnections: s.savedConnections })
    }
  )
)

// ── Durable connection backup ──────────────────────────────────────────────────
// The persist target above is localStorage, which Electron can reset (origin
// change, concurrent instances, profile corruption) — that's how a set of saved
// connections was lost once. To make them resilient we ALSO mirror them to the
// file-based localstore (~/.joaxclaw/store.json) and restore any missing on start.
// Merge by url so neither source clobbers the other; the in-store (localStorage)
// entry wins for a shared url, keeping the freshest token.

let _backupWired = false

function mirrorConnections(conns: GatewayConnection[]): void {
  void patchLocalStore({ savedConnections: conns })
}

// Called once on app start (after localStorage has rehydrated). Restores any
// connections present only in the file backup, then keeps the backup in sync.
export async function restoreConnectionsFromBackup(): Promise<void> {
  let backup: GatewayConnection[] = []
  try { backup = (await readLocalStore()).savedConnections ?? [] } catch { backup = [] }

  const byUrl = new Map(useConnectionStore.getState().savedConnections.map(c => [c.url, c]))
  let restored = 0
  for (const c of backup) {
    if (c?.url && !byUrl.has(c.url)) { byUrl.set(c.url, c); restored++ }
  }
  const merged = [...byUrl.values()]
  if (restored > 0) useConnectionStore.setState({ savedConnections: merged })
  mirrorConnections(merged)

  if (!_backupWired) {
    _backupWired = true
    useConnectionStore.subscribe((s, prev) => {
      if (s.savedConnections !== prev.savedConnections) mirrorConnections(s.savedConnections)
    })
  }
}

// Schedule a single reconnect attempt with exponential backoff (1→2→4→5s cap).
// A failed attempt re-fires onStatusChange('disconnected'), which calls this
// again, so the loop advances itself until it connects or hits the cap.
type SetFn = (partial: Partial<ConnectionState>) => void
type GetFn = () => ConnectionState

function scheduleReconnect(get: GetFn, set: SetFn) {
  if (intentionalDisconnect) return
  const conn = get().connection
  if (!conn) return

  if (attempt >= RECONNECT_MAX_ATTEMPTS) {
    clearReconnect()
    set({ reconnecting: false, status: 'disconnected', statusDetail: 'Could not reconnect — the gateway may still be restarting. Try again.' })
    return
  }

  attempt += 1
  const delay = Math.min(1000 * 2 ** (attempt - 1), 5000)
  set({ reconnecting: true, reconnectAttempt: attempt, status: 'connecting' })

  clearReconnect()
  reconnectTimer = setTimeout(() => {
    if (intentionalDisconnect) return
    gatewayClient.connect(conn.url, conn.token)
  }, delay)
}
