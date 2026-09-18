import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { useConnectionStore } from './connection'
import {
  installParamsFor,
  type ConsentRequired, type DeclaredSurface, type PluginInspect, type PluginSearchHit, type PluginSearchPackage,
} from '../lib/pluginCatalog'
import {
  classifyInstallError, installedOutcome, restartCompleted, restartOverlayCopy, withAcks,
  DEFERRED_RESTART_TIMEOUT_MS, RESTART_REASON, RESTART_TIMEOUT_MS,
  type InstallPolicyWarning, type InstallRun, type InstallTarget,
} from '../lib/pluginInstall'
import { requestGatewayRestart } from '../lib/gatewayRestart'

// Finding and installing plugins from ClawHub.
//
// Separate from the extensions store on purpose: that one is a local edit buffer over
// `config.patch` — change things, then Save. Installing is not a config edit and cannot
// be batched behind a save button; it runs on the gateway, takes time, and may need
// consent partway through.
//
// Every install goes through `installAndRestart`: install → (consent / policy review) →
// restart → wait for the restarted gateway → read back what the plugin came up as. The
// state lives here rather than in a component because the restart unmounts every view
// (the reconnect overlay replaces them); whoever started it reads `run` when it mounts again.

/** A consent challenge waiting on the user, with what the plugin declares. */
export interface PendingConsent {
  challenge: ConsentRequired
  /** The plugin's display name. */
  name: string
  /** From plugins.inspect — what the plugin declares in full. */
  declared?: DeclaredSurface
}

/** An install-policy question waiting on the user. */
export interface PendingPolicy {
  warning: InstallPolicyWarning
  name: string
}

interface PluginCatalogState {
  query: string
  results: PluginSearchHit[]
  searching: boolean
  searched: boolean
  /** Display name of the plugin installing/removing. One at a time. */
  busy: string | null
  error: string | null
  /** Set when the gateway refuses until the declared surface is acknowledged. */
  consent: PendingConsent | null
  /** Set when the gateway's install policy wants a person to look first. */
  policy: PendingPolicy | null
  /** The current (or last) install, from Install to its verified outcome. */
  run: InstallRun | null
  /** Plugin ids installed this session, so the search browser can say so before a reload. */
  justInstalled: string[]
  restartRequired: boolean
  /** The Browse modal is open. Kept here so it reopens after an install's restart. */
  browserOpen: boolean

  search: (query: string) => Promise<void>
  /** The search browser's Install: the same flow as everything else. */
  install: (pkg: PluginSearchPackage) => Promise<void>
  installAndRestart: (target: InstallTarget) => Promise<void>
  /** Retry the pending install, acknowledging the declared surface. */
  acceptConsent: () => Promise<void>
  dismissConsent: () => void
  /** Retry the pending install, acknowledging the install-policy warning. */
  acceptPolicy: () => Promise<void>
  dismissPolicy: () => void
  /** Try again after a failed restart, a timeout or a missing plugin. */
  retryRun: () => Promise<void>
  /** Forget a finished run, or only one whose origin starts with `originPrefix`. */
  clearRun: (originPrefix?: string) => void
  uninstall: (pluginId: string) => Promise<boolean>
  clearError: () => void
  reset: () => void
  setBrowserOpen: (open: boolean) => void
}

const errText = (e: unknown): string => {
  const s = e instanceof Error ? e.message : String(e)
  try { const p = JSON.parse(s) as { message?: string }; if (p?.message) return p.message } catch { /* not JSON */ }
  return s
}

/** The structured error object, which the client attaches alongside the message. */
const structured = (e: unknown): unknown => (e as { gatewayError?: unknown })?.gatewayError ?? e

// A ClawHub install downloads and unpacks a package, which can outlast the default 30 s.
const INSTALL_TIMEOUT_MS = 5 * 60_000

// Restart-wait bookkeeping: timers and a subscription, not UI state.
let runToken = 0
let stopWatching: (() => void) | null = null
let timeoutTimer: ReturnType<typeof setTimeout> | null = null
let restartFrom: { bootId?: string; seq: number } | null = null

function stopRestartWait() {
  stopWatching?.()
  stopWatching = null
  if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null }
}

/**
 * plugins.list, retried while the gateway is still draining for the restart ("unavailable
 * during gateway restart", retryable with a retryAfterMs).
 */
async function listAfterRestart(): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gatewayClient.request<unknown>('plugins.list', {})
    } catch (e) {
      const g = structured(e) as { retryable?: unknown; retryAfterMs?: unknown; details?: { reason?: unknown } } | null
      if (attempt >= 5 || g?.details?.reason !== 'gateway-restarting') throw e
      const wait = typeof g.retryAfterMs === 'number' ? Math.min(g.retryAfterMs, 5000) : 1000
      await new Promise(r => setTimeout(r, wait))
    }
  }
}

/** A run that's between Install and its outcome: another Install must wait. */
export function runActive(run: InstallRun | null): boolean {
  return !!run && run.phase !== 'done' && run.phase !== 'failed'
}

export const usePluginCatalogStore = create<PluginCatalogState>((set, get) => {
  const patchRun = (patch: Partial<InstallRun>) => set(s => (s.run ? { run: { ...s.run, ...patch } } : {}))
  const fail = (failure: InstallRun['failure'], message?: string) => {
    patchRun({ phase: 'failed', failure, ...(message !== undefined ? { message } : {}) })
    set({ busy: null })
  }

  async function attempt(token: number) {
    const run = get().run
    if (!run) return
    set({ busy: run.target.displayName, error: null })
    patchRun({ phase: 'installing', failure: undefined, message: undefined })
    try {
      // The result's `plugin` is a plugins.list row: its id is the one to verify against.
      const res = await gatewayClient.request<{ plugin?: { id?: string }; warnings?: unknown }>(
        'plugins.install', withAcks(run.target.params, run.acks), INSTALL_TIMEOUT_MS,
      )
      if (token !== runToken) return
      const pluginId = res?.plugin?.id ?? run.target.pluginId
      if (pluginId) set(s => ({ justInstalled: s.justInstalled.includes(pluginId) ? s.justInstalled : [...s.justInstalled, pluginId] }))
      const warnings = Array.isArray(res?.warnings) ? res.warnings.filter((w): w is string => typeof w === 'string' && !!w.trim()) : []
      patchRun({ pluginId, ...(warnings.length ? { warnings } : {}) })
      await restart(token)
    } catch (e) {
      if (token !== runToken) return
      const refusal = classifyInstallError(structured(e), errText(e))
      switch (refusal.kind) {
        case 'consent': {
          // Not a failure: the gateway is asking whether this plugin may do what it
          // declares. The token in the challenge is what acknowledges it — but only after
          // a person has actually seen the surface, so this parks in `consent` rather than
          // retrying itself.
          const declared = await gatewayClient
            .request<PluginInspect>('plugins.inspect', { pluginId: refusal.challenge.pluginId })
            .then(r => r.declared)
            .catch(() => undefined)
          if (token !== runToken) return
          patchRun({ phase: 'consent' })
          set({ busy: null, consent: { challenge: refusal.challenge, name: run.target.displayName, ...(declared ? { declared } : {}) } })
          return
        }
        case 'policy':
          patchRun({ phase: 'review' })
          set({ busy: null, policy: { warning: refusal.warning, name: run.target.displayName } })
          return
        case 'trust': fail('trust', refusal.message); return
        case 'trustUnavailable': fail('trustUnavailable', refusal.message); return
        case 'dropped': fail('dropped'); return
        case 'error': fail('install', refusal.message); return
      }
    }
  }

  /** Ask for the restart, then wait for the restarted gateway's hello. */
  async function restart(token: number) {
    const run = get().run
    if (!run) return
    const copy = restartOverlayCopy(run.target.displayName)
    restartFrom = { bootId: gatewayClient.bootId, seq: gatewayClient.connectionSeq }
    useConnectionStore.getState().expectRestart(copy)
    patchRun({ phase: 'restarting', deferred: false })
    // Watch before asking: the socket can drop before the request's answer arrives.
    watchForRestart(token, RESTART_TIMEOUT_MS)
    try {
      const { status, delayMs } = await requestGatewayRestart(RESTART_REASON)
      if (token !== runToken) return
      // Coalesced into a restart already pending (the 30 s cooldown): it may start late.
      if (delayMs > 0 && status !== 'deferred') watchForRestart(token, RESTART_TIMEOUT_MS + delayMs)
      if (status === 'deferred') {
        // The gateway waits for running work before restarting. Keep the overlay's
        // explanation armed for that long, and don't call it a timeout at 90 s.
        const now = Date.now()
        useConnectionStore.getState().expectRestart({ ...copy, windowMs: DEFERRED_RESTART_TIMEOUT_MS, untilMs: now + DEFERRED_RESTART_TIMEOUT_MS + 5 * 60_000 })
        patchRun({ deferred: true })
        watchForRestart(token, DEFERRED_RESTART_TIMEOUT_MS)
      }
    } catch (e) {
      if (token !== runToken) return
      // The gateway went down before it answered: that IS the restart. Keep waiting.
      if (classifyInstallError(structured(e), errText(e)).kind === 'dropped') return
      stopRestartWait()
      useConnectionStore.getState().clearRestartExpectation()
      fail('restart', errText(e))
    }
  }

  function watchForRestart(token: number, timeoutMs: number) {
    stopRestartWait()
    const from = restartFrom
    if (!from) return
    const check = (s: { status: string; connectionSeq: number }) => {
      if (s.status !== 'connected') return
      if (!restartCompleted({ bootIdBefore: from.bootId, bootIdNow: gatewayClient.bootId, seqBefore: from.seq, seqNow: s.connectionSeq })) return
      stopRestartWait()
      void verify(token)
    }
    stopWatching = useConnectionStore.subscribe(check)
    timeoutTimer = setTimeout(() => {
      timeoutTimer = null
      if (token !== runToken || get().run?.phase !== 'restarting') return
      // Keep the subscription: if the gateway does come back later, the run resolves on
      // its own instead of staying on the timeout message.
      fail('timeout')
    }, timeoutMs)
  }

  async function verify(token: number) {
    const run = get().run
    if (!run) return
    patchRun({ phase: 'verifying' })
    try {
      const list = await listAfterRestart()
      if (token !== runToken) return
      const id = run.pluginId ?? run.target.pluginId
      const { outcome, error } = id ? installedOutcome(list, id) : { outcome: 'enabled' as const, error: undefined }
      if (outcome === 'missing') { fail('missing'); return }
      patchRun({ phase: 'done', outcome, ...(error ? { message: error } : {}) })
      set({ busy: null })
    } catch (e) {
      if (token !== runToken) return
      fail('missing', errText(e))
    }
  }

  return {
    query: '',
    results: [],
    searching: false,
    searched: false,
    busy: null,
    error: null,
    consent: null,
    policy: null,
    run: null,
    justInstalled: [],
    restartRequired: false,
    browserOpen: false,

    async search(query) {
      const q = query.trim()
      if (!q) { set({ results: [], searched: false, query: '' }); return }
      set({ searching: true, error: null, query: q })
      try {
        const res = await gatewayClient.request<{ results?: PluginSearchHit[] }>('plugins.search', { query: q, limit: 25 })
        set({ results: res.results ?? [], searching: false, searched: true })
      } catch (e) {
        set({ searching: false, searched: true, results: [], error: errText(e) })
      }
    },

    async install(pkg) {
      // Official packages install by runtime id; installParamsFor chooses the shape.
      const params = installParamsFor(pkg)
      await get().installAndRestart({
        params, displayName: pkg.displayName, origin: 'browser',
        ...(pkg.runtimeId ? { pluginId: pkg.runtimeId } : {}),
      })
    },

    async installAndRestart(target) {
      if (runActive(get().run)) return
      stopRestartWait()
      const token = ++runToken
      set({ run: { target, phase: 'installing', acks: {} }, consent: null, policy: null })
      await attempt(token)
    },

    async acceptConsent() {
      const pending = get().consent
      if (!pending || !get().run) return
      patchRun({ acks: { ...get().run!.acks, reviewToken: pending.challenge.reviewToken } })
      set({ consent: null })
      await attempt(runToken)
    },

    dismissConsent() {
      ++runToken
      set({ consent: null, run: null, busy: null })
    },

    async acceptPolicy() {
      if (!get().policy || !get().run) return
      patchRun({ acks: { ...get().run!.acks, policyAck: true } })
      set({ policy: null })
      await attempt(runToken)
    },

    dismissPolicy() {
      ++runToken
      set({ policy: null, run: null, busy: null })
    },

    async retryRun() {
      const run = get().run
      if (!run || run.phase !== 'failed') return
      const token = ++runToken
      // The restart itself failed or never came back. If the gateway has restarted since,
      // just read the result; otherwise ask again.
      if (run.failure === 'restart' || run.failure === 'timeout') {
        const from = restartFrom
        if (from && restartCompleted({ bootIdBefore: from.bootId, bootIdNow: gatewayClient.bootId, seqBefore: from.seq, seqNow: gatewayClient.connectionSeq })) {
          await verify(token)
        } else {
          set({ busy: run.target.displayName })
          await restart(token)
        }
        return
      }
      // Dropped mid-install or missing after the restart: if the gateway lists it now,
      // it only needs the restart; otherwise install again from the start.
      const id = run.pluginId ?? run.target.pluginId
      if (id) {
        const list = await gatewayClient.request<unknown>('plugins.list', {}).catch(() => null)
        if (token !== runToken) return
        if (list && installedOutcome(list, id).outcome !== 'missing' && run.failure === 'dropped') {
          set({ busy: run.target.displayName })
          await restart(token)
          return
        }
      }
      set({ run: { target: run.target, phase: 'installing', acks: {} } })
      await attempt(token)
    },

    clearRun(originPrefix) {
      const run = get().run
      if (!run || runActive(run)) return
      if (originPrefix && !run.target.origin?.startsWith(originPrefix)) return
      set({ run: null })
    },

    async uninstall(pluginId) {
      set({ busy: pluginId, error: null })
      try {
        const res = await gatewayClient.request<{ restartRequired?: boolean }>('plugins.uninstall', { pluginId })
        set(s => ({
          busy: null,
          // Uninstall always requires a restart, per the method's own result schema.
          restartRequired: s.restartRequired || res?.restartRequired !== false,
          justInstalled: s.justInstalled.filter(id => id !== pluginId),
        }))
        return true
      } catch (e) {
        set({ busy: null, error: errText(e) })
        return false
      }
    },

    clearError() { set({ error: null }) },
    reset() { set({ query: '', results: [], searched: false, error: null }) },
    setBrowserOpen(open) { set({ browserOpen: open }) },
  }
})
