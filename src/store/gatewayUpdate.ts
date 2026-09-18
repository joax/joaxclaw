import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { useConnectionStore } from './connection'
import { availableKey, buildGatewayUpdatePrompt, inferOutcome, parseRunResponse, parseSchedule, parseUpdateAvailable, rpcErrorRefusal, type Outcome, type Refusal, type UpdateAvailable, type UpdateSchedule } from '../lib/gatewayUpdate'
import { sendViaAgent } from '../lib/agentPrompt'

// Whether the connected OpenClaw gateway has an update, and updating it.
//
// Detection reaches every connection: the hello-ok snapshot carries `updateAvailable`
// (and `updateSchedule` for read-capable clients), and the `update.available` broadcast
// keeps it current. Before 2026.9 that snapshot was thrown away and only admin
// connections learned anything, through `update.status`, which is still called for admin
// because it's the only source on older gateways.
//
// Updating: an admin connection confirms, then calls `update.run` directly. Without
// admin, the old path stays: an agent on the gateway host runs `openclaw update`.

const SKIP_KEY = 'joaxclaw-gateway-update-skip'  // persisted: a latestVersion the user skipped
// The update this app started, so a reload or a reconnect keeps following it.
const RUN_KEY = 'joaxclaw-gateway-update-run'

const RUN_TIMEOUT_MS = 15 * 60_000  // an unsupervised git checkout blocks through staging and validation
const ADMIN = 'operator.admin'

/** The update this app started. `runId` arrives with the reply; the rest is known up front. */
export interface FollowedRun {
  runId?: string
  target?: string
  /** The gateway it was started on, so switching gateways doesn't attribute a result wrongly. */
  url?: string
  startedAtMs: number
}

interface GatewayUpdateState {
  available: UpdateAvailable | null  // present ⇒ an update is available
  schedule: UpdateSchedule | null
  checking: boolean
  checkedAtMs: number | null
  error: string | null
  skipped: string | null
  dismissedKey: string | null  // session-only: the banner state the user closed
  confirmOpen: boolean
  /** update.run is in flight. */
  pending: boolean
  followed: FollowedRun | null
  refusal: Refusal | null
  outcome: Outcome | null
  start: () => void
  ingestHello: () => void
  ingestAvailable: (payload: unknown) => void
  check: (force?: boolean) => Promise<void>
  /** The Update button: confirm and run with admin, otherwise hand it to an agent. */
  beginUpdate: (onOpenChat?: () => void) => void
  updateViaAgent: (onOpenChat?: () => void) => Promise<void>
  openConfirm: () => void
  closeConfirm: () => void
  runUpdate: () => Promise<void>
  skip: () => void
  dismiss: (key: string) => void
}

function readFollowed(): FollowedRun | null {
  try {
    const raw = localStorage.getItem(RUN_KEY)
    const v = raw ? JSON.parse(raw) as FollowedRun : null
    return v && typeof v.startedAtMs === 'number' ? v : null
  } catch { return null }
}

function writeFollowed(v: FollowedRun | null) {
  try {
    if (v) localStorage.setItem(RUN_KEY, JSON.stringify(v))
    else localStorage.removeItem(RUN_KEY)
  } catch { /* ignore */ }
}

const hasAdmin = () => useConnectionStore.getState().grantedScopes.includes(ADMIN)

// A drop while update.run is pending is the update doing its job, not a failed call.
const isDropped = (e: unknown) => /Connection closed|Not connected/i.test(e instanceof Error ? e.message : String(e))

let subscribed = false

export const useGatewayUpdateStore = create<GatewayUpdateState>((set, get) => ({
  available: null,
  schedule: null,
  checking: false,
  checkedAtMs: null,
  error: null,
  skipped: (() => { try { return localStorage.getItem(SKIP_KEY) } catch { return null } })(),
  dismissedKey: null,
  confirmOpen: false,
  pending: false,
  followed: readFollowed(),
  refusal: null,
  outcome: null,

  // Called on every connect. The listener is added once and survives reconnects: the
  // update events are scope-guarded broadcasts, with nothing to subscribe per connection.
  start() {
    if (!subscribed) {
      subscribed = true
      gatewayClient.on(frame => {
        if (frame.event === 'update.available') get().ingestAvailable(frame.payload)
      })
    }
    get().ingestHello()
    if (hasAdmin()) void get().check(true)

    // Back after the update we started: with no run record to read yet, judge by the
    // version the gateway came back on.
    const f = get().followed
    const url = useConnectionStore.getState().connection?.url
    if (f && !get().pending) {
      const outcome = f.url && url && f.url !== url ? null : inferOutcome(gatewayClient.serverVersion, f.target)
      writeFollowed(null)
      set({ followed: null, ...(outcome ? { outcome, dismissedKey: null } : {}) })
    }
  },

  ingestHello() {
    const h = gatewayClient.helloUpdate
    set({ available: parseUpdateAvailable(h.available), schedule: parseSchedule(h.schedule) })
  },

  ingestAvailable(payload) {
    const p = (payload && typeof payload === 'object' ? payload : {}) as { updateAvailable?: unknown; schedule?: unknown }
    // Clients without operator.read get no `schedule` key at all; keep what we have then.
    set({ available: parseUpdateAvailable(p.updateAvailable), ...('schedule' in p ? { schedule: parseSchedule(p.schedule) } : {}) })
  },

  // update.status (operator.admin): the only source on gateways older than 2026.9, and on
  // newer ones the fresher word, since it may have re-checked since the handshake.
  async check(force = false) {
    const st = get()
    if (st.checking) return
    const conn = useConnectionStore.getState()
    if (conn.status !== 'connected' || !conn.grantedScopes.includes(ADMIN)) return
    if (!force && st.checkedAtMs && Date.now() - st.checkedAtMs < 30 * 60_000) return
    set({ checking: true, error: null })
    try {
      const res = await gatewayClient.request<{ updateAvailable?: unknown; schedule?: unknown }>('update.status', {})
      set({
        available: parseUpdateAvailable(res?.updateAvailable),
        ...(res && 'schedule' in res ? { schedule: parseSchedule(res.schedule) } : {}),
        checking: false,
        checkedAtMs: Date.now(),
      })
    } catch (e) {
      set({ checking: false, error: String(e), checkedAtMs: Date.now() })
    }
  },

  beginUpdate(onOpenChat) {
    if (hasAdmin() && gatewayClient.hasMethod('update.run')) get().openConfirm()
    else void get().updateViaAgent(onOpenChat)
  },

  async updateViaAgent(onOpenChat) {
    const built = await buildGatewayUpdatePrompt()
    if (built.ok && built.prompt) sendViaAgent(built.prompt, onOpenChat)
  },

  openConfirm() { set({ confirmOpen: true }) },
  closeConfirm() { set({ confirmOpen: false }) },

  async runUpdate() {
    const st = get()
    // Single-flight: a second click can't start another run while one is pending or followed.
    if (st.pending || st.followed) return
    const conn = useConnectionStore.getState()
    const target = st.schedule?.targetVersion ?? st.available?.latestVersion
    const now = Date.now()
    // A managed service validates the new version first, so the drop can come minutes
    // after the click: a 10 min window, and up to 15 min of reconnecting after it.
    conn.expectRestart({
      reason: 'Gateway is updating',
      detail: `Updating to ${target ?? 'the latest version'}. JoaxClaw reconnects on its own.`,
      windowMs: 10 * 60_000,
      untilMs: now + 15 * 60_000,
    })
    const followed: FollowedRun = { ...(target ? { target } : {}), ...(conn.connection?.url ? { url: conn.connection.url } : {}), startedAtMs: now }
    writeFollowed(followed)
    set({ pending: true, confirmOpen: false, refusal: null, outcome: null, followed, dismissedKey: null })

    const giveUp = (patch: Partial<GatewayUpdateState>) => {
      useConnectionStore.getState().clearRestartExpectation()
      writeFollowed(null)
      set({ pending: false, followed: null, ...patch })
    }

    try {
      // No sessionKey: that would make the gateway post restart notices into whichever
      // chat happened to be open. The banner reports instead.
      const res = parseRunResponse(await gatewayClient.request('update.run', { note: 'Started from JoaxClaw' }, RUN_TIMEOUT_MS))
      if (res.kind === 'started') {
        const next = { ...followed, runId: res.runId }
        writeFollowed(next)
        set({ pending: false, followed: next })
      } else if (res.kind === 'already-current') {
        const version = get().available?.currentVersion ?? gatewayClient.serverVersion ?? ''
        giveUp({ outcome: { kind: 'already-current', version, ...(res.runId ? { runId: res.runId } : {}) } })
      } else {
        giveUp({ refusal: res.refusal })
      }
    } catch (e) {
      // The socket dropped before the reply: expected while the gateway restarts. The run
      // is picked up again after the reconnect.
      if (isDropped(e) && useConnectionStore.getState().restartExpectation) set({ pending: false })
      else giveUp({ refusal: rpcErrorRefusal(e) })
    }
  },

  skip() {
    const v = get().available?.latestVersion
    if (!v) return
    try { localStorage.setItem(SKIP_KEY, v) } catch { /* ignore */ }
    set({ skipped: v })
  },

  dismiss(key) {
    // A dismissed refusal or result is done with, so it's dropped. The notice underneath
    // it is closed too: × means "quiet for now", not "show me the next thing".
    const avail = get().available
    if (key.startsWith('refused:') || key.startsWith('result:')) {
      set({ refusal: null, outcome: null, dismissedKey: avail ? availableKey(avail.latestVersion) : key })
    } else {
      set({ dismissedKey: key })
    }
  },
}))
