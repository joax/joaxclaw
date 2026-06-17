import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConnectionStatus, GatewayConnection } from '../lib/types'
import { gatewayClient } from '../lib/gateway'
import { gatewayHost, isLocalGateway } from '../lib/ollamaHealth'

interface HeartbeatEntry { time: number; ok: boolean }

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
  uptime: number
  uptimeStart: number | null
  // True while we are silently retrying a dropped connection (gateway reload).
  reconnecting: boolean
  reconnectAttempt: number

  connect: (conn: GatewayConnection) => void
  disconnect: () => void
  cancelReconnect: () => void
  saveConnection: (conn: GatewayConnection) => void
  removeConnection: (url: string) => void
  setOllamaUrls: (gatewayUrl: string, urls: { main?: string; cron?: string }) => void
}

// True when connected to a gateway on another host. Client-side system metrics
// (GPU/CPU/RAM and the local Ollama at localhost:11434) then describe THIS
// machine, not the gateway host where inference actually runs — so the UI hides
// them rather than present a laptop's stats as if they were the gateway's.
export function useIsRemoteGateway(): boolean {
  return useConnectionStore(s => s.status === 'connected' && !isLocalGateway(gatewayHost(s.connection?.url)))
}

// Reconnect bookkeeping kept outside the store (timers / flags, not UI state).
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let intentionalDisconnect = false
let attempt = 0

function clearReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
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
      uptime: 0,
      uptimeStart: null,
      reconnecting: false,
      reconnectAttempt: 0,

      connect(conn) {
        intentionalDisconnect = false
        attempt = 0
        clearReconnect()
        set({ status: 'connecting', connection: conn, heartbeats: [], lastHeartbeat: null, reconnecting: false, reconnectAttempt: 0 })

        gatewayClient.onStatusChange = (status, detail) => {
          if (status === 'connected') {
            attempt = 0
            clearReconnect()
            set({ status: 'connected', statusDetail: '', uptimeStart: Date.now(), reconnecting: false, reconnectAttempt: 0 })
          } else if (status === 'connecting') {
            // Don't clobber the "reconnecting" banner with a plain connecting state.
            if (!get().reconnecting) set({ status: 'connecting', statusDetail: '' })
          } else if (status === 'error' && /auth rejected/i.test(detail ?? '')) {
            // Bad token — looping would never succeed, so stop and surface it.
            intentionalDisconnect = true
            clearReconnect()
            set({ status: 'error', statusDetail: detail ?? '', uptimeStart: null, uptime: 0, reconnecting: false, reconnectAttempt: 0 })
          } else {
            // Unexpected drop or transient error → auto-reconnect (gateway reload).
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
        gatewayClient.disconnect()
        set({ status: 'disconnected', connection: null, uptimeStart: null, uptime: 0, reconnecting: false, reconnectAttempt: 0 })
      },

      cancelReconnect() {
        intentionalDisconnect = true
        clearReconnect()
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

      setOllamaUrls(gatewayUrl, urls) {
        const merge = (c: GatewayConnection): GatewayConnection =>
          c.url === gatewayUrl ? { ...c, ollamaUrls: { ...c.ollamaUrls, ...urls } } : c
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
