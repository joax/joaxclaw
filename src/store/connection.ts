import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConnectionStatus, GatewayConnection } from '../lib/types'
import { gatewayClient } from '../lib/gateway'

interface HeartbeatEntry { time: number; ok: boolean }

interface ConnectionState {
  status: ConnectionStatus
  statusDetail: string
  connection: GatewayConnection | null
  savedConnections: GatewayConnection[]
  heartbeats: HeartbeatEntry[]
  lastHeartbeat: number | null
  uptime: number
  uptimeStart: number | null

  connect: (conn: GatewayConnection) => void
  disconnect: () => void
  saveConnection: (conn: GatewayConnection) => void
  removeConnection: (url: string) => void
  setOllamaUrls: (gatewayUrl: string, urls: { main?: string; cron?: string }) => void
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

      connect(conn) {
        set({ status: 'connecting', connection: conn, heartbeats: [], lastHeartbeat: null })

        gatewayClient.onStatusChange = (status, detail) => {
          if (status === 'connected') {
            set({ status: 'connected', statusDetail: '', uptimeStart: Date.now() })
          } else if (status === 'connecting') {
            set({ status: 'connecting', statusDetail: '' })
          } else {
            set({ status: status as ConnectionStatus, statusDetail: detail ?? '', uptimeStart: null, uptime: 0 })
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
        gatewayClient.disconnect()
        set({ status: 'disconnected', connection: null, uptimeStart: null, uptime: 0 })
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
