// Minimal `window.api` shim for non-Electron runtimes (a Capacitor webview, or a
// plain browser during dev). It lets the renderer BOOT without the Electron preload
// bridge: the local-only namespaces stay absent (their callers are already
// optional-chained), and `ws` is a safe no-op that reports "disconnected" instead of
// letting `wsApi()` throw on a missing `window.api`.
//
// This is Phase 0 scaffolding. Phase 1 replaces the `ws` and `deviceAuth` stubs with
// real native Capacitor plugins (an Origin-controllable WebSocket + Ed25519 signing /
// secure storage). Inert on desktop — if the Electron bridge is present it does
// nothing.
type Unsub = () => void

interface WsShim {
  connect: (url: string, token: string) => Promise<{ ok: boolean; error?: string }>
  disconnect: () => Promise<{ ok: boolean }>
  send: (data: string) => Promise<{ ok: boolean; error?: string }>
  onMessage: (cb: (raw: string) => void) => Unsub
  onStatus: (cb: (status: string, detail?: string) => void) => Unsub
  onLog: (cb: (dir: string, text: string) => void) => Unsub
}
interface ApiWindow { api?: { ws?: unknown } & Record<string, unknown> }

export function installMobileBridge(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as ApiWindow
  if (w.api?.ws) return // Electron preload bridge is present — leave it alone.

  const noop: Unsub = () => {}
  const NOT_READY = 'The mobile gateway transport is not installed yet (native plugin lands in Phase 1).'
  const ws: WsShim = {
    connect: async () => ({ ok: false, error: NOT_READY }),
    disconnect: async () => ({ ok: true }),
    send: async () => ({ ok: false, error: 'Not connected' }),
    onMessage: () => noop,
    // Report disconnected on the next tick so the UI settles into a clean state.
    onStatus: (cb) => { setTimeout(() => cb('disconnected', NOT_READY), 0); return noop },
    onLog: () => noop,
  }
  w.api = { ...(w.api ?? {}), ws }
}
