import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { stopJob } from '../lib/scriptJobs'
import { useConnectionStore } from './connection'
import {
  parseTask, parseTaskList, mergeTask, isActive, addHidden, readGatewayError, isTaskGone,
  ACTIVE_STATUSES, FINISHED_STATUSES, type TaskSummary, type BackgroundItem,
} from '../lib/tasks'

// The gateway's background tasks (subagents, background commands, automation runs, media
// jobs), for the Background strip, the task drawer, the Dashboard and the tray.
//
// Two sources, like the progress cards store. Lists are read on connect (every agent's
// active work plus the latest finished work) and when a chat opens (that chat's tasks);
// the `task` event then keeps them live. The event is sent with dropIfSlow, so it can be
// lost on a slow link, and the gateway sends no catch-up after a reconnect. So the lists
// are read again on reconnect, on `restored`, and every 60 s while anything is running.
// The event isn't subscription-gated (the gateway delivers it to any operator.read client
// that can see the requester session), so there's nothing to subscribe per connection.
//
// All shapes verified against OpenClaw 2026.9.4 (server-methods/tasks.ts, task-summary.ts,
// server-runtime-subscriptions.ts).

const HIDDEN_KEY = 'joaxclaw-background-hidden'
const ACTIVE_LIMIT = 500   // Control UI parity
const RECENT_LIMIT = 100
const SESSION_LIMIT = 100
const TICK_MS = 15_000
const RELOAD_WHILE_ACTIVE_MS = 60_000

export type TaskAction = 'stop' | 'retry' | 'dismiss'

export interface TaskDrawerState {
  open: boolean
  mode: 'list' | 'detail'
  taskId?: string
  jobId?: string
}

interface TasksState {
  byId: Record<string, TaskSummary>
  /** Task ids the gateway returned for a chat's own list (it resolves session-key aliases). */
  sessionIndex: Record<string, string[]>
  /** The every-agent lists have come back at least once on this connection. */
  loaded: boolean
  /** The last list failure, for the drawer's list mode. The strip keeps its data. */
  error: string | null
  /** Per session key, the rows closed with ×. Persisted. */
  hidden: Record<string, string[]>
  /** In-flight row actions, by item key (`task:<id>` / `script:<jobId>`). */
  pending: Record<string, TaskAction>
  /** The last failed action's message, by item key. */
  actionError: Record<string, string>
  drawer: TaskDrawerState

  /** On connect: attach the event listener once, then (re)load every list on screen. */
  start: () => void
  loadGlobal: () => Promise<void>
  loadSession: (sessionKey: string) => Promise<void>
  ingest: (payload: unknown) => void
  /** A view showing tasks; enables the fallback poll on gateways without the `task` event. */
  watch: (sessionKey?: string) => () => void

  stop: (item: Pick<BackgroundItem, 'key' | 'source' | 'id'>) => Promise<void>
  retry: (taskId: string) => Promise<void>
  dismiss: (taskId: string) => Promise<void>
  hide: (sessionKey: string, itemKey: string) => void
  clearActionError: (itemKey: string) => void

  openDrawer: (taskId: string) => void
  openJob: (jobId: string) => void
  openList: () => void
  closeDrawer: () => void
}

function readHidden(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, string[]> : {}
  } catch { return {} }
}

function writeHidden(v: Record<string, string[]>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(v)) } catch { /* private mode: the × lasts this run only */ }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * tasks.list, retried once when the registry was still settling ("Task activity did not
 * stabilize", with retryAfterMs) — FR-15.
 */
async function listTasks(params: Record<string, unknown>) {
  try {
    return parseTaskList(await gatewayClient.request('tasks.list', params))
  } catch (e) {
    const err = readGatewayError(e)
    if (err.code === 'UNAVAILABLE' && err.retryAfterMs !== undefined) {
      await sleep(Math.min(err.retryAfterMs, 5000))
      return parseTaskList(await gatewayClient.request('tasks.list', params))
    }
    throw e
  }
}

/** Finished tasks, newest end first. `sortBy` is 2026.8+; the schema is closed, so older gateways reject it. */
async function listRecent() {
  const params = { status: FINISHED_STATUSES, limit: RECENT_LIMIT }
  try {
    return await listTasks({ ...params, sortBy: 'endedAt' })
  } catch (e) {
    if (readGatewayError(e).code !== 'INVALID_REQUEST') throw e
    return listTasks(params)
  }
}

let listening = false
let connectedUrl: string | undefined
let ticker: ReturnType<typeof setInterval> | undefined
let lastGlobalAt = 0
let globalSeq = 0
const sessionSeq = new Map<string, number>()
/** Views on screen, by session key ('' for views that aren't one chat's). */
const watchers = new Map<string, number>()

const canList = () => gatewayClient.connected && gatewayClient.hasMethod('tasks.list')

export const useTasksStore = create<TasksState>((set, get) => {
  const merge = (tasks: TaskSummary[]) => {
    if (!tasks.length) return
    set(s => {
      const byId = { ...s.byId }
      for (const t of tasks) byId[t.id] = mergeTask(byId[t.id], t)
      return { byId }
    })
  }

  const remove = (taskId: string) => set(s => {
    if (!s.byId[taskId]) return s
    const byId = { ...s.byId }
    delete byId[taskId]
    const sessionIndex: Record<string, string[]> = {}
    for (const [k, ids] of Object.entries(s.sessionIndex)) sessionIndex[k] = ids.filter(id => id !== taskId)
    return { byId, sessionIndex }
  })

  const listen = () => {
    if (listening) return
    listening = true
    gatewayClient.on(frame => {
      if (frame.event === 'task') get().ingest(frame.payload)
    })
  }

  // One ticker for both fallbacks: the 60 s reload while anything runs (the event can be
  // dropped), and, on a gateway that doesn't send the event at all, a 15 s poll while a
  // view is on screen.
  const tick = () => {
    if (!canList()) return
    const s = get()
    if (!gatewayClient.hasEvent('task')) {
      if (watchers.size === 0) return
      void s.loadGlobal()
      for (const key of watchers.keys()) if (key) void s.loadSession(key)
      return
    }
    const anyActive = Object.values(s.byId).some(isActive)
    if (anyActive && Date.now() - lastGlobalAt >= RELOAD_WHILE_ACTIVE_MS) void s.loadGlobal()
  }

  const ensureRunning = () => {
    listen()
    if (!ticker) ticker = setInterval(tick, TICK_MS)
  }

  const setPending = (key: string, action: TaskAction | null) => set(s => {
    const pending = { ...s.pending }
    if (action) pending[key] = action
    else delete pending[key]
    const actionError = { ...s.actionError }
    if (action) delete actionError[key]
    return { pending, actionError }
  })
  const fail = (key: string, message: string) => set(s => ({ actionError: { ...s.actionError, [key]: message } }))

  // tasks.retry and tasks.dismiss share params and result.
  const recover = async (method: 'tasks.retry' | 'tasks.dismiss', taskId: string) => {
    const key = `task:${taskId}`
    const verb = method === 'tasks.retry' ? 'retry' : 'dismiss'
    setPending(key, verb)
    try {
      const res = await gatewayClient.request<{ results?: { ok?: boolean; reason?: string; task?: unknown }[] }>(method, { taskIds: [taskId] })
      const r = res?.results?.[0]
      const t = parseTask(r?.task)
      if (t) merge([t])
      if (!r?.ok) fail(key, `Couldn't ${verb}: ${r?.reason ?? 'the gateway gave no reason.'}`)
    } catch (e) {
      fail(key, `Couldn't ${verb}: ${readGatewayError(e).message}`)
    } finally {
      setPending(key, null)
    }
  }

  // One task, read directly: `tasks.get` also carries prompt and result.
  const refreshOne = async (taskId: string) => {
    try {
      const res = await gatewayClient.request<{ task?: unknown }>('tasks.get', { taskId })
      const t = parseTask(res?.task)
      if (t) merge([t])
    } catch (e) {
      if (isTaskGone(readGatewayError(e))) remove(taskId)
    }
  }

  return {
    byId: {},
    sessionIndex: {},
    loaded: false,
    error: null,
    hidden: readHidden(),
    pending: {},
    actionError: {},
    drawer: { open: false, mode: 'list' },

    start() {
      ensureRunning()
      const sessions = Object.keys(get().sessionIndex)
      // Another gateway has other tasks: nothing from the last one may linger.
      const url = useConnectionStore.getState().connection?.url
      if (url !== connectedUrl) {
        connectedUrl = url
        set({ byId: {}, sessionIndex: {}, loaded: false, error: null, pending: {}, actionError: {} })
      }
      // A reconnect starts from what the gateway says now: it sends no catch-up.
      lastGlobalAt = 0
      void get().loadGlobal()
      for (const key of sessions) void get().loadSession(key)
    },

    async loadGlobal() {
      if (!canList()) return
      const id = ++globalSeq
      lastGlobalAt = Date.now()
      try {
        const [active, recent] = await Promise.all([
          listTasks({ status: ACTIVE_STATUSES, limit: ACTIVE_LIMIT }),
          listRecent(),
        ])
        if (id !== globalSeq) return
        merge([...active.tasks, ...recent.tasks])
        set({ loaded: true, error: null })
        // A task we still think is running but that is in neither list finished (or went)
        // while an event was dropped. Ask about each directly; there are only ever a few.
        const seen = new Set([...active.tasks, ...recent.tasks].map(t => t.id))
        const stale = Object.values(get().byId).filter(t => isActive(t) && !seen.has(t.id)).slice(0, 20)
        for (const t of stale) void refreshOne(t.id)
      } catch (e) {
        if (id !== globalSeq) return
        set({ error: readGatewayError(e).message })
      }
    },

    async loadSession(sessionKey) {
      ensureRunning()
      if (!canList()) return
      const id = (sessionSeq.get(sessionKey) ?? 0) + 1
      sessionSeq.set(sessionKey, id)
      try {
        const { tasks } = await listTasks({ sessionKey, limit: SESSION_LIMIT })
        if (sessionSeq.get(sessionKey) !== id) return
        merge(tasks)
        set(s => ({ sessionIndex: { ...s.sessionIndex, [sessionKey]: tasks.map(t => t.id) } }))
      } catch {
        // A token without operator.read, or a transient failure: the strip keeps what it had.
      }
    },

    ingest(payload) {
      const p = payload as { action?: unknown; task?: unknown; taskId?: unknown } | undefined
      switch (p?.action) {
        case 'upserted': {
          const t = parseTask(p.task)
          if (t) merge([t])
          break
        }
        case 'deleted':
          if (typeof p.taskId === 'string') remove(p.taskId)
          break
        case 'restored':
          // The registry was reloaded from disk: what we hold may be wrong in any way.
          void get().loadGlobal()
          for (const key of Object.keys(get().sessionIndex)) void get().loadSession(key)
          break
      }
    },

    watch(sessionKey) {
      ensureRunning()
      const k = sessionKey ?? ''
      watchers.set(k, (watchers.get(k) ?? 0) + 1)
      return () => {
        const n = (watchers.get(k) ?? 1) - 1
        if (n <= 0) watchers.delete(k)
        else watchers.set(k, n)
      }
    },

    async stop(item) {
      setPending(item.key, 'stop')
      try {
        if (item.source === 'script') {
          await stopJob(item.id)
          return
        }
        // The gateway only answers once the run has settled as cancelled, so this can take a
        // moment; the row says "Stopping…" until then.
        const res = await gatewayClient.request<{ found?: boolean; cancelled?: boolean; reason?: string; task?: unknown }>(
          'tasks.cancel', { taskId: item.id }, 0)
        const t = parseTask(res?.task)
        if (t) merge([t])
        if (!res?.cancelled) {
          fail(item.key, `Couldn't stop it: ${res?.reason ?? (res?.found === false ? 'Task not found.' : 'the gateway gave no reason.')}`)
        }
      } catch (e) {
        fail(item.key, `Couldn't stop it: ${readGatewayError(e).message}`)
      } finally {
        setPending(item.key, null)
      }
    },

    retry: taskId => recover('tasks.retry', taskId),
    dismiss: taskId => recover('tasks.dismiss', taskId),

    hide(sessionKey, itemKey) {
      const hidden = addHidden(get().hidden, sessionKey, itemKey)
      writeHidden(hidden)
      set({ hidden })
    },

    clearActionError(itemKey) {
      set(s => {
        if (!(itemKey in s.actionError)) return s
        const actionError = { ...s.actionError }
        delete actionError[itemKey]
        return { actionError }
      })
    },

    openDrawer: taskId => set({ drawer: { open: true, mode: 'detail', taskId } }),
    openJob: jobId => set({ drawer: { open: true, mode: 'detail', jobId } }),
    openList: () => set({ drawer: { open: true, mode: 'list' } }),
    closeDrawer: () => set(s => ({ drawer: { ...s.drawer, open: false } })),
  }
})
