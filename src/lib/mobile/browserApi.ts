// Browser `window.api` shim for a PWA / mobile companion. In Electron the preload
// provides `window.api`; in a plain browser it's absent, so we synthesize the same
// surface here. Only `ws` (a real browser WebSocket) and `deviceAuth` (WebCrypto
// device identity + a localStorage device-token cache) are functional — everything
// else is a desktop / local-gateway feature the app already routes through gateway
// RPCs when remote, so these degrade to safe no-ops. Mirrors electron/preload/index.ts
// namespace-for-namespace so no `window.api.X.method()` call hits `undefined`.
//
// Install is a no-op under Electron (window.api already set) — see installBrowserApi().
import {
  buildConnectBlockWeb, webDeviceId, type DeviceConnectInput, type DeviceConnectBlock,
} from './deviceIdentityWeb'

type Unsub = () => void

// ── ws: a real browser WebSocket behind the preload's ws interface ───────────────
let sock: WebSocket | null = null
const messageCbs = new Set<(raw: string) => void>()
const statusCbs = new Set<(status: string, detail?: string) => void>()
const logCbs = new Set<(dir: string, text: string) => void>()
const emitStatus = (s: string, d?: string) => statusCbs.forEach(cb => cb(s, d))
const emitLog = (dir: string, text: string) => logCbs.forEach(cb => cb(dir, text))

function wsConnect(url: string): { ok: boolean; error?: string } {
  try { sock?.close() } catch { /* already gone */ }
  emitLog('info', `Connecting to ${url}…`)
  emitStatus('connecting')
  try {
    // A browser WebSocket sends an Origin header — the gateway must allow it
    // (gateway.controlUi.allowedOrigins / same-origin). Scopes come from the signed
    // device handshake, not from omitting Origin (Phase 0/1 findings).
    sock = new WebSocket(url)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emitStatus('error', msg)
    return { ok: false, error: msg }
  }
  sock.onopen = () => emitLog('info', 'WebSocket open — waiting for the gateway challenge…')
  sock.onmessage = ev => { const raw = typeof ev.data === 'string' ? ev.data : ''; if (raw) messageCbs.forEach(cb => cb(raw)) }
  sock.onerror = () => {
    // Browsers don't expose WS error detail (security). The close event that follows
    // carries the code, which distinguishes causes (see onclose).
    emitLog('info', `WebSocket error connecting to ${url} — check the gateway is reachable and the URL (ws:// vs wss://) is correct.`)
    emitStatus('error', 'websocket error')
  }
  sock.onclose = ev => {
    // 1006 = abnormal (never opened): unreachable host / connection refused / TLS / blocked.
    // 1008 or 4xxx with a reason = the gateway rejected it (e.g. origin not allowed).
    const hint = ev.code === 1006
      ? ' (no connection — gateway not reachable at this URL, refused, or a ws/wss or TLS mismatch)'
      : ev.reason ? ` — ${ev.reason}` : ''
    emitLog('info', `WebSocket closed [code ${ev.code}]${hint}`)
    emitStatus('disconnected', ev.reason || undefined)
  }
  return { ok: true }
}

const ws = {
  connect: (url: string, _token: string) => Promise.resolve(wsConnect(url)),
  disconnect: () => { try { sock?.close() } catch { /* noop */ } sock = null; return Promise.resolve({ ok: true }) },
  send: (data: string) => {
    if (!sock || sock.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, error: 'socket not open' })
    try { sock.send(data); return Promise.resolve({ ok: true }) }
    catch (e) { return Promise.resolve({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
  },
  onMessage: (cb: (raw: string) => void): Unsub => { messageCbs.add(cb); return () => messageCbs.delete(cb) },
  onStatus: (cb: (status: string, detail?: string) => void): Unsub => { statusCbs.add(cb); return () => statusCbs.delete(cb) },
  onLog: (cb: (dir: string, text: string) => void): Unsub => { logCbs.add(cb); return () => logCbs.delete(cb) },
}

// ── deviceAuth: WebCrypto identity + localStorage per-host device-token cache ─────
const TOKENS_KEY = 'joaxclaw-web-device-tokens'
type TokenEntry = { token: string; scopes: string[]; issuedAtMs?: number }
type TokenStore = Record<string, Record<string, TokenEntry>>  // host -> role -> entry
function readTokens(): TokenStore { try { return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') } catch { return {} } }
function writeTokens(s: TokenStore) { localStorage.setItem(TOKENS_KEY, JSON.stringify(s)) }

const deviceAuth = {
  buildConnectBlock: async (input: DeviceConnectInput): Promise<{ ok: true; block: DeviceConnectBlock } | { ok: false; error: string }> => {
    try { return { ok: true, block: await buildConnectBlockWeb(input) } }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  },
  identity: async (): Promise<{ ok: true; deviceId: string } | { ok: false; error: string }> => {
    try { return { ok: true, deviceId: await webDeviceId() } }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  },
  getDeviceToken: (host: string, role: string) =>
    Promise.resolve({ ok: true as const, entry: readTokens()[host]?.[role] ?? null }),
  storeDeviceToken: (host: string, role: string, token: string, scopes: string[], issuedAtMs?: number) => {
    const s = readTokens(); s[host] = { ...(s[host] ?? {}), [role]: { token, scopes, issuedAtMs } }; writeTokens(s)
    return Promise.resolve({ ok: true })
  },
  clearDeviceToken: (host: string, role: string) => {
    const s = readTokens(); if (s[host]?.[role]) { delete s[host][role]; writeTokens(s) }
    return Promise.resolve({ ok: true })
  },
}

// ── localstore: back the app's ~/.joaxclaw/store.json with localStorage ──────────
const LOCALSTORE_KEY = 'joaxclaw-web-localstore'
const localstore = {
  read: () => { try { return Promise.resolve(JSON.parse(localStorage.getItem(LOCALSTORE_KEY) ?? '{}')) } catch { return Promise.resolve({}) } },
  write: (data: unknown) => { try { localStorage.setItem(LOCALSTORE_KEY, JSON.stringify(data)) } catch { /* quota */ } return Promise.resolve({ ok: true }) },
}

const noop = () => {}
const unavailable = (feature: string) => Promise.resolve({ ok: false, error: `${feature} is unavailable in the browser companion` })

// Desktop / local-gateway namespaces the remote app doesn't need — safe stubs so no
// call path crashes. (When remote, the stores use gateway RPCs instead of these.)
export function buildBrowserApi() {
  return {
    app: {
      version: () => Promise.resolve('pwa'),
      onNavigate: (_cb: (section: string) => void): Unsub => noop,
      openExternal: (url: string) => { try { window.open(url, '_blank', 'noopener,noreferrer') } catch { /* noop */ } return Promise.resolve({ ok: true }) },
    },
    tray: { update: (_c: { agents: number; teams: number }) => Promise.resolve({ ok: true }) },
    updater: {
      check: () => unavailable('Auto-update'),
      download: () => unavailable('Auto-update'),
      install: () => unavailable('Auto-update'),
      openReleasePage: (url?: string) => { if (url) window.open(url, '_blank', 'noopener,noreferrer'); return Promise.resolve({ ok: true }) },
      restart: () => Promise.resolve({ ok: true }),
      onProgress: (_cb: (p: { received: number; total: number; percent: number }) => void): Unsub => noop,
    },
    zoom: { set: noop, get: () => 0 },
    window: {
      minimize: noop, maximize: noop, close: noop, setTitleBarOverlay: noop,
      popOutChat: noop, returnChat: noop,
      popoutInfo: () => Promise.resolve({ connection: null }),
      listPoppedOut: () => Promise.resolve([] as string[]),
      onPoppedOut: (_cb: (keys: string[]) => void): Unsub => noop,
      onFocusSession: (_cb: (sessionKey: string) => void): Unsub => noop,
      onMaximized: (_cb: (maximized: boolean) => void): Unsub => noop,
    },
    config: { read: () => unavailable('Local config'), write: () => unavailable('Local config') },
    gateway: { restart: () => unavailable('Gateway control'), restartSafe: () => unavailable('Gateway control'), stop: () => unavailable('Gateway control'), status: () => Promise.resolve({ ok: false }) },
    file: {
      read: () => unavailable('Local files'), write: () => unavailable('Local files'),
      delete: () => unavailable('Local files'), find: () => Promise.resolve(null),
      listdir: () => Promise.resolve([]), readBinary: () => unavailable('Local files'),
    },
    theme: {
      import: () => unavailable('Theme import'), export: () => unavailable('Theme export'),
      pickImage: () => unavailable('Image picking'), deleteAssets: () => Promise.resolve({ ok: true }),
    },
    plugins: { list: () => Promise.resolve({ ok: false, plugins: [] }) },
    obsidian: { detect: () => Promise.resolve({ installed: false }), writeSkill: () => unavailable('Obsidian skill'), removeSkill: () => Promise.resolve({ ok: true }) },
    memory: { writeSkill: () => unavailable('Local memory skill'), removeSkill: () => Promise.resolve({ ok: true }) },
    env: { get: () => Promise.resolve(null) },
    // Native-skill archive building needs Node (zip) — skip; remote skill install
    // degrades to a no-op list, so nothing is attempted.
    skills: { installNative: () => Promise.resolve({ ok: true, results: [] }), listNative: () => Promise.resolve([]), buildArchive: () => unavailable('Skill archive') },
    localstore,
    system: { homedir: '' },
    metrics: { get: () => Promise.resolve({ ok: false, cpu: 0, ramUsed: 0, ramTotal: 0, gpu: [] }) },
    ollama: { watch: noop, probe: () => Promise.resolve({ ok: false }), fetch: () => Promise.resolve({ ok: false }), onProgress: (_cb: unknown): Unsub => noop },
    ws,
    deviceAuth,
  }
}

/** Install the browser api shim if not running under Electron (idempotent). */
export function installBrowserApi(): void {
  const w = window as unknown as { api?: unknown }
  if (w.api) return  // Electron preload already provided the real bridge
  w.api = buildBrowserApi()
}
