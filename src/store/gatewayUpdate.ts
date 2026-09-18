import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { useConnectionStore } from './connection'
import {
  availableKey, buildGatewayUpdatePrompt, inferOutcome, isTerminal, mergeRunChanged, outcomeFromRun, outcomeText,
  parseRun, parseRunChanged, parseRunResponse, parseSchedule, parseUpdateAvailable, phaseLabel, rememberSeen, rpcErrorRefusal, runTarget,
  type Outcome, type Refusal, type UpdateAvailable, type UpdateRun, type UpdateSchedule,
} from '../lib/gatewayUpdate'
import { sendViaAgent } from '../lib/agentPrompt'
import { notify } from '../lib/notifications'

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
//
// Following: the run's phases come from `update.run.changed` (admin) and, because an
// event can be missed, a 2 s `update.runs.get` poll while it runs. After the restart the
// run record says how it ended; that result is shown once (the seen runIds persist).

const SKIP_KEY = 'joaxclaw-gateway-update-skip'  // persisted: a latestVersion the user skipped
// The run being followed, so a reload or a reconnect keeps following it.
const RUN_KEY = 'joaxclaw-gateway-update-run'
// Runs whose result was already shown, so a reload doesn't show it again.
const SEEN_KEY = 'joaxclaw-gateway-update-seen'

const RUN_TIMEOUT_MS = 15 * 60_000  // an unsupervised git checkout blocks through staging and validation
const POLL_MS = 2000
const POLL_MAX_MS = 20 * 60_000
// A via-agent update has no run record. The next reconnect within this long is taken
// as its restart, and reported by the version the gateway comes back on.
const VIA_AGENT_WINDOW_MS = 30 * 60_000
const ADMIN = 'operator.admin'

/** The run being followed. `runId` arrives with update.run's reply; the rest is known up front. */
export interface FollowedRun {
  runId?: string
  target?: string
  /** The gateway it was started on, so switching gateways doesn't attribute a result wrongly. */
  url?: string
  startedAtMs: number
  /** False for a run started elsewhere (the CLI, the Control UI) that we only watch. */
  own: boolean
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
  /** The followed run's latest record (or a stub built from events). */
  run: UpdateRun | null
  refusal: Refusal | null
  outcome: Outcome | null
  seen: string[]
  /** A via-agent update, which has no run record, waiting for its restart. */
  viaAgent: { target?: string; atMs: number } | null
  start: () => Promise<void>
  ingestHello: () => void
  ingestAvailable: (payload: unknown) => void
  ingestRunChanged: (payload: unknown) => void
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

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch { return null }
}

function writeJson(key: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch { /* ignore */ }
}

function readFollowed(): FollowedRun | null {
  const v = readJson<FollowedRun>(RUN_KEY)
  return v && typeof v.startedAtMs === 'number' ? { ...v, own: v.own !== false } : null
}

const hasAdmin = () => useConnectionStore.getState().grantedScopes.includes(ADMIN)

// A drop while update.run is pending is the update doing its job, not a failed call.
const isDropped = (e: unknown) => /Connection closed|Not connected/i.test(e instanceof Error ? e.message : String(e))

let subscribed = false
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollStartedAtMs = 0
// The phase we last re-armed the restart expectation for, so a poll doesn't re-arm it every 2 s.
let armedPhase: string | null = null

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
}

export const useGatewayUpdateStore = create<GatewayUpdateState>((set, get) => {
  // ── following a run ──────────────────────────────────────────────────────────────

  const setFollowed = (f: FollowedRun | null) => {
    writeJson(RUN_KEY, f)
    set({ followed: f })
  }

  // The disconnect comes when the run activates (a managed service parks the old gateway
  // after validating). Re-arm the expectation then, with the phase in its words.
  const armFor = (run: UpdateRun) => {
    if (run.status !== 'running' || (run.phase !== 'activating' && run.phase !== 'restarting')) return
    if (armedPhase === `${run.runId}:${run.phase}`) return
    armedPhase = `${run.runId}:${run.phase}`
    const target = runTarget(run) ?? get().followed?.target
    useConnectionStore.getState().expectRestart({
      reason: 'Gateway is updating',
      detail: `Updating to ${target ?? 'the latest version'} · ${phaseLabel(run.phase)}. Update progress is saved on the gateway.`,
      windowMs: 10 * 60_000,
      untilMs: Date.now() + 15 * 60_000,
    })
  }

  const markSeen = (runId: string) => {
    const seen = rememberSeen(get().seen, runId)
    writeJson(SEEN_KEY, seen)
    set({ seen })
  }

  // A run reached its end: show its result once, and say so in a notification if the
  // app is in the background.
  const finish = (run: UpdateRun) => {
    stopPolling()
    const f = get().followed
    setFollowed(null)
    set({ run: null })
    if (get().seen.includes(run.runId)) return
    markSeen(run.runId)
    const outcome = outcomeFromRun(run, { target: f?.target, version: gatewayClient.serverVersion })
    if (outcome) set({ outcome, refusal: null, dismissedKey: null })
    if (outcome && outcome.kind !== 'already-current') {
      const failed = outcome.kind === 'failed' || outcome.kind === 'rolled-back'
      void notify({ title: failed ? 'Gateway update failed' : 'Gateway updated', body: outcomeText(outcome), tag: 'gateway-update', navigate: { section: 'gateway' } })
    }
  }

  // No run record to read (no admin, an older gateway, or the ledger forgot it): judge by
  // the version the gateway came back on.
  const finishWithoutRecord = (target?: string) => {
    stopPolling()
    setFollowed(null)
    const outcome = inferOutcome(gatewayClient.serverVersion, target)
    set({ run: null, ...(outcome ? { outcome, refusal: null, dismissedKey: null } : {}) })
  }

  const applyRun = (run: UpdateRun) => {
    const f = get().followed
    if (!f || (f.runId && f.runId !== run.runId)) return
    if (!f.runId) setFollowed({ ...f, runId: run.runId })
    if (isTerminal(run.status)) { finish(run); return }
    set({ run })
    armFor(run)
    ensurePolling()
  }

  // Read the followed run again: update.runs.get on 2026.9+, else update.status's
  // activeRun / lastRun. Admin only; nothing to poll without it.
  const refresh = async (): Promise<'ok' | 'gone' | 'unavailable'> => {
    const f = get().followed
    if (!f || !gatewayClient.connected || !hasAdmin()) return 'unavailable'
    try {
      if (f.runId && gatewayClient.hasMethod('update.runs.get')) {
        const res = await gatewayClient.request<{ run?: unknown }>('update.runs.get', { runId: f.runId })
        const run = parseRun(res?.run)
        if (!run) return 'gone'
        applyRun(run)
        return 'ok'
      }
      const res = await gatewayClient.request<{ activeRun?: unknown; lastRun?: unknown }>('update.status', {})
      return ingestStatusRuns(res) ? 'ok' : 'gone'
    } catch {
      return 'unavailable'
    }
  }

  // update.status's activeRun / lastRun: the followed run's record on gateways without
  // update.runs.get, a run started elsewhere, or (after a drop that ate update.run's
  // reply) the run our click created. Returns whether the followed run was found.
  const ingestStatusRuns = (res: { activeRun?: unknown; lastRun?: unknown } | null | undefined): boolean => {
    const active = parseRun(res?.activeRun)
    const last = parseRun(res?.lastRun)
    const f = get().followed
    if (!f) {
      if (active?.status === 'running' && !get().pending) {
        setFollowed({ runId: active.runId, ...(runTarget(active) ? { target: runTarget(active) } : {}), url: useConnectionStore.getState().connection?.url, startedAtMs: Date.now(), own: false })
        applyRun(active)
      }
      return false
    }
    const match = f.runId
      ? [active, last].find(r => r?.runId === f.runId)
      // Our reply was lost in the drop: the run under way, or the last one if it started
      // after our click, is ours (update.run is single-flight here). A minute of slack
      // covers a remote host's clock.
      : active ?? (last && last.createdAtMs >= f.startedAtMs - 60_000 ? last : undefined)
    if (!match) return false
    applyRun(match)
    return true
  }

  function ensurePolling() {
    if (pollTimer) return
    if (!pollStartedAtMs) pollStartedAtMs = Date.now()
    const tick = async () => {
      pollTimer = null
      const f = get().followed
      if (!f || Date.now() - pollStartedAtMs > POLL_MAX_MS) { pollStartedAtMs = 0; return }
      if (gatewayClient.connected) await refresh()
      if (get().followed) pollTimer = setTimeout(tick, POLL_MS)
      else pollStartedAtMs = 0
    }
    pollTimer = setTimeout(tick, POLL_MS)
  }

  return {
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
    run: null,
    refusal: null,
    outcome: null,
    seen: readJson<string[]>(SEEN_KEY) ?? [],
    viaAgent: null,

    // Called on every connect. The listeners are added once and survive reconnects: the
    // update events are scope-guarded broadcasts, with nothing to subscribe per connection.
    async start() {
      if (!subscribed) {
        subscribed = true
        gatewayClient.on(frame => {
          if (frame.event === 'update.available') get().ingestAvailable(frame.payload)
          else if (frame.event === 'update.run.changed') get().ingestRunChanged(frame.payload)
        })
      }
      get().ingestHello()
      armedPhase = null

      // Back after an update sent to an agent: no record, so the version tells.
      const va = get().viaAgent
      if (va) {
        set({ viaAgent: null })
        if (Date.now() - va.atMs < VIA_AGENT_WINDOW_MS) {
          const outcome = inferOutcome(gatewayClient.serverVersion, va.target)
          if (outcome) set({ outcome, dismissedKey: null })
        }
      }

      // update.status first: it carries the admin detail, and on gateways without
      // update.runs.get it is also where the followed run's record comes from.
      if (hasAdmin()) await get().check(true)

      const f = get().followed
      const url = useConnectionStore.getState().connection?.url
      if (!f || get().pending) return
      if (f.url && url && f.url !== url) { setFollowed(null); return }
      // update.status already had its record (older gateways): just keep following.
      if (get().run?.runId && get().run?.runId === f.runId) { ensurePolling(); return }
      const r = await refresh()
      // No record: runs.get says it's gone, or there's nothing to read it with.
      if (r !== 'ok' && get().followed) finishWithoutRecord(f.target)
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

    // update.run.changed (admin): {runId, phase, status, updatedAtMs}. Events for other
    // runs are ignored, except a running one when we follow nothing: an update started
    // elsewhere, which the banner shows too.
    ingestRunChanged(payload) {
      const ev = parseRunChanged(payload)
      if (!ev) return
      let f = get().followed
      if (!f) {
        if (ev.status !== 'running' || get().pending) return
        f = { runId: ev.runId, url: useConnectionStore.getState().connection?.url, startedAtMs: Date.now(), own: false }
        setFollowed(f)
      } else if (f.runId && f.runId !== ev.runId) {
        return
      }
      const run = mergeRunChanged(get().run, ev)
      // A terminal event has no steps or versions: read the full record before reporting.
      if (isTerminal(ev.status) && hasAdmin() && gatewayClient.hasMethod('update.runs.get')) {
        if (!f.runId) setFollowed({ ...f, runId: ev.runId })
        set({ run })
        void refresh().then(r => { if (r !== 'ok' && get().followed) finish(run) })
        return
      }
      applyRun(run)
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
        const res = await gatewayClient.request<{ updateAvailable?: unknown; schedule?: unknown; activeRun?: unknown; lastRun?: unknown }>('update.status', {})
        set({
          available: parseUpdateAvailable(res?.updateAvailable),
          ...(res && 'schedule' in res ? { schedule: parseSchedule(res.schedule) } : {}),
          checking: false,
          checkedAtMs: Date.now(),
        })
        ingestStatusRuns(res)
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
      if (!built.ok || !built.prompt) return
      set({ viaAgent: { target: get().available?.latestVersion, atMs: Date.now() } })
      sendViaAgent(built.prompt, onOpenChat)
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
      armedPhase = null
      setFollowed({ ...(target ? { target } : {}), ...(conn.connection?.url ? { url: conn.connection.url } : {}), startedAtMs: now, own: true })
      set({ pending: true, confirmOpen: false, refusal: null, outcome: null, run: null, dismissedKey: null })

      const giveUp = (patch: Partial<GatewayUpdateState>) => {
        useConnectionStore.getState().clearRestartExpectation()
        stopPolling()
        setFollowed(null)
        set({ pending: false, run: null, ...patch })
      }

      try {
        // No sessionKey: that would make the gateway post restart notices into whichever
        // chat happened to be open. The banner reports instead.
        const res = parseRunResponse(await gatewayClient.request('update.run', { note: 'Started from JoaxClaw' }, RUN_TIMEOUT_MS))
        if (res.kind === 'started') {
          const f = get().followed
          if (f) setFollowed({ ...f, runId: res.runId })
          set({ pending: false })
          // Its first record, then the 2 s poll until it ends.
          void refresh()
          ensurePolling()
        } else if (res.kind === 'already-current') {
          const version = get().available?.currentVersion ?? gatewayClient.serverVersion ?? ''
          if (res.runId) markSeen(res.runId)
          giveUp({ outcome: { kind: 'already-current', version, ...(res.runId ? { runId: res.runId } : {}) } })
        } else if (res.runId && get().seen.includes(res.runId)) {
          // A blocking (git checkout) update that failed: its terminal event beat the reply,
          // and the failed run is already shown with its record.
          giveUp({})
        } else {
          if (res.runId) markSeen(res.runId)
          giveUp({ refusal: res.refusal })
        }
      } catch (e) {
        // The socket dropped before the reply: expected while the gateway restarts. The run
        // is found again after the reconnect (see ingestStatusRuns).
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
  }
})
