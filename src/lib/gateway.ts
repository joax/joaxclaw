import type { GwFrame, GwResFrame } from './types'
import { useSettingsStore } from '../store/settings'
import { chatIdentityName } from './userProfile'

type Listener = (frame: GwEventFrame) => void
interface GwEventFrame { type: 'event'; event: string; payload?: unknown; seq?: number }

export interface ConnLog {
  dir: 'in' | 'out' | 'info'
  text: string
  ts: number
}

// Access the Electron IPC WebSocket proxy exposed via the preload script
type WsApi = {
  connect: (url: string, token: string) => Promise<{ ok: boolean }>
  disconnect: () => Promise<{ ok: boolean }>
  send: (data: string) => Promise<{ ok: boolean; error?: string }>
  onMessage: (cb: (raw: string) => void) => () => void
  onStatus: (cb: (status: string, detail?: string) => void) => () => void
  onLog: (cb: (dir: string, text: string) => void) => () => void
}
const wsApi = (): WsApi => (window as unknown as { api: { ws: WsApi } }).api.ws

let _reqCounter = 0
function nextId(): string { return `req_${++_reqCounter}` }

// A gateway rejects an RPC it doesn't implement with an INVALID_REQUEST whose message
// reads "unknown method: <name>". Match that so we can stop re-sending it.
function isUnknownMethodError(error: unknown): boolean {
  const s = typeof error === 'string' ? error : JSON.stringify(error ?? '')
  return /unknown method/i.test(s)
}

export class GatewayClient {
  private pending = new Map<string, { resolve: (r: GwResFrame) => void; reject: (e: unknown) => void }>()
  private listeners: Listener[] = []
  private _url = ''
  private _token = ''
  private _handshakeDone = false
  private _connected = false
  // Methods this gateway answered with "unknown method" — older gateways don't
  // implement every RPC the client knows (e.g. plugins.list). We skip re-sending a
  // doomed request each fetch, which also stops the host logging an INVALID_REQUEST
  // every time. Cleared on each new handshake so a re-connected/upgraded gateway is
  // re-probed.
  private unsupportedMethods = new Set<string>()

  private _unsubMessage: (() => void) | null = null
  private _unsubStatus: (() => void) | null = null
  private _unsubLog: (() => void) | null = null

  readonly log: ConnLog[] = []
  // Operator scopes the gateway granted this connection (from the connect response's
  // `auth.scopes`). Empty until the handshake completes. Used to gate admin-only UI
  // (e.g. device management) client-side; the gateway still enforces authorization.
  grantedScopes: string[] = []
  onLog?: (entry: ConnLog) => void
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error', detail?: string) => void
  onHeartbeat?: () => void

  connect(url: string, token: string): void {
    this._url = url
    this._token = token
    this.log.length = 0
    this._handshakeDone = false
    this._connected = false
    this._open()
  }

  private _addLog(dir: ConnLog['dir'], text: string) {
    const entry: ConnLog = { dir, text, ts: Date.now() }
    this.log.push(entry)
    if (this.log.length > 100) this.log.shift()
    this.onLog?.(entry)
  }

  private _teardownListeners() {
    this._unsubMessage?.()
    this._unsubStatus?.()
    this._unsubLog?.()
    this._unsubMessage = null
    this._unsubStatus = null
    this._unsubLog = null
  }

  private _open(): void {
    this._teardownListeners()

    const ws = wsApi()

    this._unsubLog = ws.onLog((dir, text) => {
      this._addLog(dir as ConnLog['dir'], text)
    })

    this._unsubStatus = ws.onStatus((status, detail) => {
      if (status === 'disconnected') {
        this._connected = false
        this._handshakeDone = false
        this.onStatusChange?.('disconnected', detail)
        this.pending.forEach(cb => cb.reject(new Error('Connection closed')))
        this.pending.clear()
      } else if (status === 'error') {
        this._connected = false
        this.onStatusChange?.('error', detail)
      } else if (status === 'connecting') {
        this.onStatusChange?.('connecting')
      }
    })

    this._unsubMessage = ws.onMessage((raw) => {
      this._addLog('in', raw)

      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(raw)
      } catch {
        this._addLog('info', 'Non-JSON frame (ignored)')
        return
      }

      const type = frame.type as string
      const event = frame.event as string | undefined

      if (type === 'res') {
        const cb = this.pending.get(frame.id as string)
        if (cb) {
          this.pending.delete(frame.id as string)
          cb.resolve(frame as unknown as GwResFrame)
        }
        return
      }

      if (type === 'event' && event === 'connect.challenge') {
        const payload = (frame.payload ?? {}) as Record<string, unknown>
        const nonce = payload.nonce as string
        this._addLog('info', `Challenge received — nonce=${nonce?.slice(0, 8)}…`)
        this._respondToChallenge(nonce)
        return
      }

      if (this._handshakeDone && type === 'event') {
        const gw = frame as { type: string; event: string; payload?: unknown; seq?: number }
        if (gw.event === 'tick') this.onHeartbeat?.()
        this.listeners.forEach(fn => fn(gw as GwEventFrame))
        return
      }

      if (!this._handshakeDone) {
        this._addLog('info', `Unknown frame during handshake (type="${type}", event="${event ?? ''}") — still waiting`)
      }
    })

    ws.connect(this._url, this._token)
  }

  private _respondToChallenge(nonce: string): void {
    const params = {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: 'gateway-client',
        // The label the model attributes messages to. Uses the user's profile name when
        // they've opted in (Settings → You), else the default "JoaxClaw". Read at connect
        // time — changing the name takes effect on the next (re)connect.
        displayName: chatIdentityName(useSettingsStore.getState().userProfile, useSettingsStore.getState().useNameAsIdentity),
        version: '0.1.0',
        platform: 'linux',
        mode: 'backend'
      },
      caps: ['tool-events'],
      auth: { token: this._token },
      role: 'operator',
      scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing', 'operator.talk.secrets']
    }

    this._addLog('info', 'Sending connect request…')
    this.request<{ auth?: { scopes?: string[] } }>('connect', params as Record<string, unknown>).then((res) => {
      this._handshakeDone = true
      this._connected = true
      this.unsupportedMethods.clear()  // fresh connection — re-probe method support
      this.grantedScopes = Array.isArray(res?.auth?.scopes) ? res.auth!.scopes! : []
      this._addLog('info', 'Handshake complete ✓')
      this.onStatusChange?.('connected')
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      this._addLog('info', `Auth rejected: ${msg}`)
      this.onStatusChange?.('error', `Auth rejected by gateway: ${msg}`)
      wsApi().disconnect()
    })
  }

  disconnect(): void {
    this._teardownListeners()
    this._handshakeDone = false
    this._connected = false
    this.grantedScopes = []
    this.unsupportedMethods.clear()
    wsApi().disconnect()
    this.onStatusChange?.('disconnected')
    this.pending.forEach(cb => cb.reject(new Error('Disconnected')))
    this.pending.clear()
  }

  // timeoutMs <= 0 disables the timeout — for long-running calls (e.g. chat.send to a
  // slow local model) whose completion is driven by the event stream, not the reply.
  // A genuine disconnect still rejects pending requests, so these can't leak forever.
  async request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
    if (!this._connected && method !== 'connect') {
      throw new Error('Not connected')
    }
    // This gateway already told us it doesn't implement this method — reject client-side
    // instead of re-sending (and re-logging INVALID_REQUEST on the host) every fetch.
    if (this.unsupportedMethods.has(method)) {
      throw new Error(`unknown method: ${method}`)
    }
    const id = nextId()
    const frame = { type: 'req', id, method, params }
    const json = JSON.stringify(frame)

    const result = await wsApi().send(json)
    if (!result.ok) throw new Error(result.error ?? 'Send failed')

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (res) => {
          if (res.ok) resolve(res.payload as T)
          else {
            if (isUnknownMethodError(res.error)) this.unsupportedMethods.add(method)
            reject(new Error(JSON.stringify(res.error)))
          }
        },
        reject
      })
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id)
            reject(new Error(`Request ${method} timed out`))
          }
        }, timeoutMs)
      }
    })
  }

  // Measure round-trip latency to the gateway. Uses `health` with probe:false —
  // a scope-free method (authorized for any connected client) that the gateway
  // answers from its cached snapshot, so it's a cheap universal ping that works
  // against a local OR remote gateway. Resolves with the round-trip time in ms;
  // rejects (or times out) when the gateway can't be reached.
  async ping(timeoutMs = 8000): Promise<number> {
    const start = Date.now()
    await this.request('health', { probe: false }, timeoutMs)
    return Date.now() - start
  }

  on(listener: Listener): () => void {
    this.listeners.push(listener)
    return () => { this.listeners = this.listeners.filter(l => l !== listener) }
  }

  get connected(): boolean {
    return this._connected
  }

  getLog(): ConnLog[] { return [...this.log] }
}

export const gatewayClient = new GatewayClient()
