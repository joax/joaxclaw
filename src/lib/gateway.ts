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

// Operator scopes we ask the gateway for at connect time. The gateway grants a
// subset based on the token's authorization; anything requested here but absent
// from the granted set means RPCs needing it will be rejected (surfaced in the
// Connection log panel as "withheld").
export const REQUESTED_OPERATOR_SCOPES = [
  'operator.admin', 'operator.read', 'operator.write',
  'operator.approvals', 'operator.pairing', 'operator.talk.secrets'
] as const

// The scopes without which the app is fundamentally broken (nearly every RPC needs
// read; most management needs write). A token missing these — typically one minted
// by an older gateway before a scope was split out — connects but then fails every
// call with "missing scope: …". Admin/approvals/pairing/talk are optional (the UI
// degrades gracefully), so their absence must NOT trigger the warning banner.
export const CRITICAL_OPERATOR_SCOPES = ['operator.read', 'operator.write'] as const

// Progressively narrower scope requests for handshake negotiation. 2026.7.x
// gateways grant an EMPTY scope set when a connection asks for ANY scope its token
// isn't entitled to (rather than granting the entitled subset) — so demanding
// operator.admin on a read-only token loses even operator.read. We ask for
// everything first and, if operator.read doesn't come back, retry with a smaller
// request until the token's real entitlement is granted. Every tier includes
// operator.read (the floor the app needs to be usable at all).
const SCOPE_NEGOTIATION_TIERS: string[][] = [
  [...REQUESTED_OPERATOR_SCOPES],                              // full (admin + everything)
  ['operator.read', 'operator.write', 'operator.approvals'],  // operator without admin/pairing/talk
  ['operator.read', 'operator.write'],                        // read + write
  ['operator.read'],                                          // read-only token
]

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

// Device-identity signer exposed by the preload (main-process crypto). Optional —
// absent on older preloads, in which case we fall back to a device-less handshake.
export interface DeviceConnectBlock { id: string; publicKey: string; signature: string; signedAt: number; nonce: string }
type DeviceAuthApi = {
  buildConnectBlock: (input: {
    nonce: string; role: string; scopes: string[]; token?: string | null
    clientId: string; clientMode: string; platform: string; deviceFamily?: string
  }) => Promise<{ ok: true; block: DeviceConnectBlock } | { ok: false; error: string }>
  identity: () => Promise<{ ok: true; deviceId: string } | { ok: false; error: string }>
}
const deviceAuthApi = (): DeviceAuthApi | undefined =>
  (window as unknown as { api: { deviceAuth?: DeviceAuthApi } }).api.deviceAuth

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
  // Index into SCOPE_NEGOTIATION_TIERS for the current handshake attempt. Reset on
  // each fresh connect(); advanced when the gateway returns a grant without
  // operator.read (see _respondToChallenge).
  private _scopeTier = 0
  // True while we're internally reconnecting to renegotiate scopes, so the transient
  // socket drop isn't surfaced to the store as a real disconnect.
  private _negotiating = false
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
  // Multiple views observe the connection log (the connect screen and the
  // Gateway → Connection log panel), so this is a subscriber set rather than a
  // single callback — otherwise the last mounter clobbers the others.
  private logListeners = new Set<(entry: ConnLog) => void>()
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error', detail?: string) => void
  onHeartbeat?: () => void

  // Subscribe to live log entries; returns an unsubscribe. Existing entries are
  // available via getLog() — seed from there on mount, then stream new ones here.
  onLogEntry(listener: (entry: ConnLog) => void): () => void {
    this.logListeners.add(listener)
    return () => { this.logListeners.delete(listener) }
  }

  connect(url: string, token: string): void {
    this._url = url
    this._token = token
    this.log.length = 0
    this._handshakeDone = false
    this._connected = false
    this._scopeTier = 0
    this._negotiating = false
    this._open()
  }

  private _addLog(dir: ConnLog['dir'], text: string) {
    const entry: ConnLog = { dir, text, ts: Date.now() }
    this.log.push(entry)
    if (this.log.length > 100) this.log.shift()
    this.logListeners.forEach(fn => fn(entry))
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
      // During an internal scope renegotiation we tear down and reopen the socket;
      // don't surface that transient drop as a real disconnect/error to the store.
      if (this._negotiating && (status === 'disconnected' || status === 'error')) return
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
        // A fresh challenge means the (re)opened socket is up — past any transient
        // drop from a scope renegotiation, so resume surfacing status normally.
        this._negotiating = false
        const payload = (frame.payload ?? {}) as Record<string, unknown>
        const nonce = payload.nonce as string
        this._addLog('info', `Challenge received — nonce=${nonce?.slice(0, 8)}…`)
        void this._respondToChallenge(nonce)
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

  private async _respondToChallenge(nonce: string): Promise<void> {
    const scopes = [...SCOPE_NEGOTIATION_TIERS[this._scopeTier]]
    const CLIENT_ID = 'gateway-client'
    const CLIENT_MODE = 'backend'
    const PLATFORM = 'linux'

    // Sign the challenge with our device identity (main-process crypto). OpenClaw
    // 2026.7.x rejects a remote device-less operator connection with
    // DEVICE_IDENTITY_REQUIRED, so the connect params must carry a signed `device`
    // block. Every signed field below must equal what we send in params (client.id,
    // client.mode, role, scopes, auth.token, client.platform) or the gateway's
    // signature check fails. Best-effort: an older preload without deviceAuth falls
    // back to a device-less handshake (works only on loopback).
    let device: DeviceConnectBlock | undefined
    const da = deviceAuthApi()
    if (da) {
      try {
        const res = await da.buildConnectBlock({
          nonce, role: 'operator', scopes, token: this._token,
          clientId: CLIENT_ID, clientMode: CLIENT_MODE, platform: PLATFORM
        })
        if (res.ok) device = res.block
        else this._addLog('info', `Device identity error: ${res.error}`)
      } catch (e: unknown) {
        this._addLog('info', `Device identity unavailable: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    const params = {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: CLIENT_ID,
        // The label the model attributes messages to. Uses the user's profile name when
        // they've opted in (Settings → You), else the default "JoaxClaw". Read at connect
        // time — changing the name takes effect on the next (re)connect.
        displayName: chatIdentityName(useSettingsStore.getState().userProfile, useSettingsStore.getState().useNameAsIdentity),
        version: '0.1.0',
        platform: PLATFORM,
        mode: CLIENT_MODE
      },
      caps: ['tool-events'],
      auth: { token: this._token },
      role: 'operator',
      scopes,
      ...(device ? { device } : {})
    }

    this._addLog('info', `Sending connect request… (scope request: [${scopes.join(', ')}]${device ? `, device ${device.id.slice(0, 8)}…` : ', no device identity'})`)
    this.request<{ auth?: { scopes?: string[] } }>('connect', params as Record<string, unknown>).then((res) => {
      this.grantedScopes = Array.isArray(res?.auth?.scopes) ? res.auth!.scopes! : []

      // Some gateways return an EMPTY grant when we request a scope the token can't
      // hold (instead of granting the entitled subset), which would leave the app
      // with no operator.read and every RPC rejected. Retry with a narrower request
      // until read comes back or we run out of tiers.
      if (!this.grantedScopes.includes('operator.read') && this._scopeTier < SCOPE_NEGOTIATION_TIERS.length - 1) {
        this._scopeTier++
        this._addLog('info', `Gateway granted [${this.grantedScopes.join(', ') || 'none'}] — retrying with a narrower scope request: [${SCOPE_NEGOTIATION_TIERS[this._scopeTier].join(', ')}]…`)
        this._renegotiate()
        return
      }

      this._handshakeDone = true
      this._connected = true
      this.unsupportedMethods.clear()  // fresh connection — re-probe method support
      // Report what the token was ultimately granted vs. the full ideal set, so the
      // scope chips / warning banner reflect reality (this is the source of truth).
      const missing = REQUESTED_OPERATOR_SCOPES.filter(s => !this.grantedScopes.includes(s))
      this._addLog('info', `Handshake complete ✓ — granted scopes: [${this.grantedScopes.join(', ') || 'none'}]`)
      if (missing.length) {
        this._addLog('info', `Not granted by this token: [${missing.join(', ')}] — features needing them are unavailable.`)
      }
      this.onStatusChange?.('connected')
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      // A new device presents its identity but hasn't been approved yet: the gateway
      // rejects with a pairing/not-paired error. Surface a clear, actionable message
      // (with the deviceId to approve) instead of a bare "auth rejected".
      const pairing = /not[_ ]?paired|pair|approv|device.*identity/i.test(msg)
      if (pairing && device) {
        const hint = `This device isn't approved on the gateway yet. On the gateway host run:  openclaw devices approve  (device ${device.id.slice(0, 12)}…), then reconnect.`
        this._addLog('info', hint)
        this.onStatusChange?.('error', hint)
      } else {
        this._addLog('info', `Auth rejected: ${msg}`)
        this.onStatusChange?.('error', `Auth rejected by gateway: ${msg}`)
      }
      wsApi().disconnect()
    })
  }

  // Reopen the socket to re-run the handshake with the (already advanced) scope tier.
  // A fresh challenge re-enters _respondToChallenge, which reads _scopeTier. The
  // transient drop is masked from the store via _negotiating.
  private _renegotiate(): void {
    this._negotiating = true
    this._handshakeDone = false
    this._connected = false
    this.pending.clear()
    this._open()
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
