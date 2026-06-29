import { create } from 'zustand'
import type { ProcessDef } from '../lib/processParser'
import { parseProcessFile } from '../lib/processParser'
import { compileProcessToJob, buildLaunchPrompt } from '../lib/processCompiler'
import { gatewayClient } from '../lib/gateway'
import { isRemoteGatewayState } from './connection'
import { nanoid } from '../lib/nanoid'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fileApi = () => (window as any)?.api?.file as {
  read:    (path: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  write:   (path: string, text: string) => Promise<{ ok: boolean; error?: string }>
  delete:  (path: string) => Promise<{ ok: boolean; error?: string }>
  listdir: (dir: string, ext?: string) => Promise<{ ok: boolean; files: { name: string; path: string }[]; error?: string }>
} | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const homedir = (): string => (window as any)?.api?.system?.homedir ?? '~'

export function processesDir(): string {
  return `${homedir()}/.openclaw/processes`
}

export function runsDir(): string {
  return `${processesDir()}/.runs`
}

// ── Storage backends (mirrors src/store/teams.ts) ──────────────────────────────
// Process definitions (<id>.md) and run state (.runs/<id>.json) live as files on
// the gateway host. We reach them via the joaxclaw-fs plugin's processes.* RPC
// (works local AND remote, and sees agent-authored processes), or — on a LOCAL
// gateway without the plugin — direct Electron file I/O. On a REMOTE gateway with
// no plugin there's no path to the host's files, so the view shows install help.

interface ProcDefRaw { id: string; md: string | null }
interface ProcRunRaw { id: string; run: string | null }
interface ProcessesBackend {
  kind: 'rpc' | 'file'
  list: () => Promise<{ defs: ProcDefRaw[]; runs: ProcRunRaw[] }>
  getDef: (id: string) => Promise<string | null>
  setDef: (id: string, md: string) => Promise<void>
  deleteDef: (id: string) => Promise<void>
  setRun: (id: string, run: string) => Promise<void>
}

const idFromMdPath = (p: string): string => (p.split('/').pop() ?? p).replace(/\.md$/, '')
const mdPathFor = (id: string): string => `${processesDir()}/${id}.md`
const isUnknownMethod = (e: unknown): boolean => /unknown method/i.test(e instanceof Error ? e.message : String(e))

const rpcBackend: ProcessesBackend = {
  kind: 'rpc',
  async list() {
    const r = await gatewayClient.request<{ defs?: ProcDefRaw[]; runs?: ProcRunRaw[] }>('processes.list')
    return { defs: r.defs ?? [], runs: r.runs ?? [] }
  },
  async getDef(id) {
    const r = await gatewayClient.request<{ md?: string | null }>('processes.get', { id })
    return r.md ?? null
  },
  async setDef(id, md) { await gatewayClient.request('processes.set', { id, md }) },
  async deleteDef(id) { await gatewayClient.request('processes.delete', { id }) },
  async setRun(id, run) { await gatewayClient.request('processes.runs.set', { id, run }) },
}

async function readFileText(p: string): Promise<string | null> {
  const api = fileApi(); if (!api) return null
  const r = await api.read(p)
  return r.ok && r.text != null ? r.text : null
}
const fileBackend: ProcessesBackend = {
  kind: 'file',
  async list() {
    const api = fileApi(); if (!api) throw new Error('File API not available')
    const { ok, files, error } = await api.listdir(processesDir(), '.md')
    if (!ok) throw new Error(error ?? 'Failed to list processes')
    const defs = await Promise.all(files.map(async f => ({ id: idFromMdPath(f.path), md: await readFileText(f.path) })))
    const runsRes = await api.listdir(runsDir(), '.json').catch(() => ({ ok: false as const, files: [] as { name: string; path: string }[] }))
    const runs = runsRes.ok
      ? await Promise.all(runsRes.files.map(async f => ({ id: f.name.replace(/\.json$/, ''), run: await readFileText(f.path) })))
      : []
    return { defs, runs }
  },
  async getDef(id) { return readFileText(mdPathFor(id)) },
  async setDef(id, md) {
    const api = fileApi(); if (!api) throw new Error('File API not available')
    const r = await api.write(mdPathFor(id), md)
    if (!r.ok) throw new Error(r.error ?? 'Failed to write process')
  },
  async deleteDef(id) {
    const api = fileApi(); if (!api) return
    await api.delete(mdPathFor(id)).catch(() => {})
    await api.delete(`${runsDir()}/${id}.json`).catch(() => {})
  },
  async setRun(id, run) {
    const api = fileApi(); if (!api) return
    await api.write(`${runsDir()}/${id}.json`, run).catch(() => {})
  },
}

// Prefer the plugin (probe processes.list); fall back to local files on a local
// gateway, or signal needsPlugin on a remote one.
async function resolveBackend(): Promise<{ backend: ProcessesBackend | null; needsPlugin: boolean }> {
  try {
    await rpcBackend.list()
    return { backend: rpcBackend, needsPlugin: false }
  } catch (e) {
    if (!isUnknownMethod(e)) throw e
    return isRemoteGatewayState()
      ? { backend: null, needsPlugin: true }
      : { backend: fileBackend, needsPlugin: false }
  }
}

export type RunStatus = 'idle' | 'running' | 'done' | 'error'

export interface RunLogEntry {
  ts: number
  text: string
}

export interface RunProgress {
  current: number   // steps completed
  total: number     // total steps in process
  label?: string    // human-readable label for the current step
}

export interface ProcessRun {
  processId: string
  sessionKey?: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  objective?: string   // the task this run was launched with (a reusable team, run against a concrete goal)
  currentAgent?: string
  stepsDone: number
  progress?: RunProgress  // explicit progress reported by the agent via [PROGRESS:N/T:label]
  error?: string
  log: RunLogEntry[]
  outputBuffer: string
}

// ── Module-level session routing ──────────────────────────────────────────────
// Maps sessionKey → processId so the event handler can route gateway frames. Holds
// both the controller key and every worker key we've linked to the run.
const _runSessions = new Map<string, string>()
// Sub-session tracking: processId → Set of worker keys spawned directly by the
// controller that haven't fired 'final' yet. Drives the "currently delegating" display.
const _pendingSubSessions = new Map<string, Set<string>>()
// Maps toolCallId → processId for in-flight sessions_spawn calls.
// data.name is only present on phase:'start', not phase:'result', so we match by id.
const _spawnCallIds = new Map<string, string>()

// Session keys look like "agent:<agentId>:<kind>:<uuid>" (e.g.
// "agent:research-worker:subagent:…"). Recover the human-readable agent id.
function agentIdFromKey(key: string): string {
  const parts = key.split(':')
  if (parts[0] === 'agent' && parts[1]) return parts[1]
  const at = key.indexOf('@')   // legacy "agentId@…" shape
  return at > 0 ? key.slice(0, at) : key
}

// Drop all routing/bookkeeping for a finished run so stale keys can't reroute later frames.
function clearRunRouting(processId: string): void {
  for (const [k, pid] of _runSessions) if (pid === processId) _runSessions.delete(k)
  _pendingSubSessions.delete(processId)
  for (const [cid, pid] of _spawnCallIds) if (pid === processId) _spawnCallIds.delete(cid)
}

// ── Persist run state to disk ─────────────────────────────────────────────────

async function persistRun(run: ProcessRun) {
  const backend = useProcessesStore.getState()._backend
  if (!backend) return
  try {
    await backend.setRun(run.processId, JSON.stringify(run, null, 2))
  } catch { /* non-critical */ }
}

// ── Gateway-authoritative completion + restart recovery ─────────────────────────
// A team/process run executes on the GATEWAY (controller session + worker sub-
// sessions), independent of the app. So we treat the gateway as the source of truth
// for "is this run still going": `sessions.list` carries each session's
// status/hasActiveRun (known-good fields the app already uses) and parentSessionKey.
// Used both as a completion safety net (event inference is fragile) and to RE-ATTACH
// to an in-flight run after an app restart. A hard cap guarantees we never hang.
const _completionGuards = new Set<string>()
const _reattached = new Set<string>()

// Count sessions in the run's tree that are still active. Returns -1 if the gateway
// query fails (unknown — never treat that as "idle"). includeRoot also counts the
// controller's own activity (it stays active for the whole flow, even while yielding).
async function countLiveInTree(rootKey: string, includeRoot: boolean): Promise<number> {
  let sessions: Array<Record<string, unknown>>
  try {
    const res = await gatewayClient.request<{ sessions?: Array<Record<string, unknown>> }>('sessions.list', {})
    sessions = res.sessions ?? []
  } catch { return -1 }
  const isActive = (s: Record<string, unknown>) =>
    s.hasActiveRun === true || s.hasActiveSubagentRun === true || /^(active|running|busy)$/i.test(String(s.status ?? ''))
  const byParent = new Map<string, Array<Record<string, unknown>>>()
  const byKey = new Map<string, Record<string, unknown>>()
  for (const s of sessions) {
    const key = String(s.key ?? '')
    if (key) byKey.set(key, s)
    const parent = String(s.parentSessionKey ?? s.parentSession ?? '')
    if (parent) { if (!byParent.has(parent)) byParent.set(parent, []); byParent.get(parent)!.push(s) }
  }
  let live = 0
  if (includeRoot) { const root = byKey.get(rootKey); if (root && isActive(root)) live++ }
  const seen = new Set<string>([rootKey])
  const stack = [rootKey]
  while (stack.length) {
    for (const child of byParent.get(stack.pop()!) ?? []) {
      const key = String(child.key ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (isActive(child)) live++
      stack.push(key)
    }
  }
  return live
}

// Poll the gateway until the run's session tree is GENUINELY idle, then mark it done.
//
// Completion is gated on a sustained idle streak — never on a timer. A member can work
// for a long time; while any session in the tree is active the watcher just keeps
// polling. The wall-clock value below is only the watcher's own lifetime bound; it does
// NOT force-complete an active tree (that was the bug: a member working past the cap got
// the whole flow falsely marked done). If the lifetime cap is hit while still active, we
// stop watching but leave the run running and keep routing, so the controller's next
// `final` re-arms this watcher and it eventually completes for real.
const COMPLETION_GRACE_MS = 1500            // let sessions settle before the first read
const COMPLETION_IDLE_READS = 3             // consecutive idle reads required to confirm done
const COMPLETION_IDLE_GAP_MS = 3000         // spacing between idle reads (≈6–9s sustained idle)
const COMPLETION_ACTIVE_POLL_MS = 5000      // re-poll cadence while the tree is active
const COMPLETION_WATCH_MAX_MS = 2 * 60 * 60_000  // watcher lifetime (2h) — generous; agents can run long

async function watchTreeUntilIdle(processId: string, rootKey: string, includeRoot: boolean, openingLog?: string): Promise<void> {
  if (_completionGuards.has(processId)) return
  _completionGuards.add(processId)
  const deadline = Date.now() + COMPLETION_WATCH_MAX_MS
  if (openingLog) {
    useProcessesStore.setState(s => {
      const run = s.runs[processId]; if (!run) return s
      return { runs: { ...s.runs, [processId]: { ...run, log: [...run.log, { ts: Date.now(), text: openingLog }] } } }
    })
  }
  let idleStreak = 0
  let announced = false
  let confirmedIdle = false   // only true once we observe a sustained idle streak
  try {
    await new Promise(r => setTimeout(r, COMPLETION_GRACE_MS))
    while (Date.now() < deadline) {
      if (useProcessesStore.getState().runs[processId]?.status !== 'running') return  // superseded by a live final / abort
      const live = await countLiveInTree(rootKey, includeRoot)
      if (live === 0) {
        if (++idleStreak >= COMPLETION_IDLE_READS) { confirmedIdle = true; break }
        await new Promise(r => setTimeout(r, COMPLETION_IDLE_GAP_MS))
        continue
      }
      idleStreak = 0  // active (>0) or query failed (<0): not idle
      if (live > 0 && !announced && !includeRoot) {
        announced = true
        useProcessesStore.setState(s => {
          const run = s.runs[processId]; if (!run) return s
          return { runs: { ...s.runs, [processId]: { ...run, currentAgent: undefined, log: [...run.log, { ts: Date.now(), text: `Controller done — waiting for ${live} worker(s)…` }] } } }
        })
      }
      await new Promise(r => setTimeout(r, COMPLETION_ACTIVE_POLL_MS))
    }
  } finally {
    _completionGuards.delete(processId)
    if (confirmedIdle) {
      // The tree went genuinely idle for a sustained window — the run is done.
      clearRunRouting(processId)
      useProcessesStore.setState(s => {
        const run = s.runs[processId]
        if (!run || run.status !== 'running') return s
        const updated: ProcessRun = { ...run, status: 'done', finishedAt: Date.now(), currentAgent: undefined, log: [...run.log, { ts: Date.now(), text: 'Process completed' }] }
        persistRun(updated)
        return { runs: { ...s.runs, [processId]: updated } }
      })
    } else {
      // Lifetime cap reached while still active — do NOT complete a working run. Stop
      // watching but keep routing so a later controller `final` re-arms this watcher.
      useProcessesStore.setState(s => {
        const run = s.runs[processId]
        if (!run || run.status !== 'running') return s
        return { runs: { ...s.runs, [processId]: { ...run, log: [...run.log, { ts: Date.now(), text: 'Still active on the gateway — paused auto-monitoring; will resume on the next update. Use Stop to end it.' }] } } }
      })
    }
  }
}

// Re-attach to a run that was still in-flight when the app last closed. The run keeps
// executing on the gateway, so we just re-route its live events and reconcile
// completion against the live session tree. Idempotent per run per app session.
function reattachRunningRun(run: ProcessRun): void {
  const { processId, sessionKey } = run
  if (!sessionKey || _reattached.has(processId)) return
  _reattached.add(processId)
  _runSessions.set(sessionKey, processId)   // route the controller's live events again
  void watchTreeUntilIdle(processId, sessionKey, true, '↻ Re-attached after restart — checking the run on the gateway…')
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface ProcessesState {
  processes: ProcessDef[]
  runs: Record<string, ProcessRun>
  loading: boolean
  error: string | null
  _subscribed: boolean
  // True on a remote gateway when the joaxclaw-fs plugin isn't installed → the
  // view shows install instructions instead of the (unreachable) process list.
  needsPlugin: boolean
  _backend: ProcessesBackend | null

  load:   () => Promise<void>
  reload: (path: string) => Promise<void>
  save:   (path: string, text: string) => Promise<boolean>
  delete: (path: string) => Promise<boolean>

  startRun: (processId: string, def: ProcessDef, controllerAgentId: string, objective?: string) => Promise<void>
  stopRun:  (processId: string) => Promise<void>

  _startEventListening: () => void
}

export const useProcessesStore = create<ProcessesState>((set, get) => ({
  processes: [],
  runs: {},
  loading: false,
  error: null,
  _subscribed: false,
  needsPlugin: false,
  _backend: null,

  // ── Event subscription ────────────────────────────────────────────────────────

  _startEventListening() {
    if (get()._subscribed) return
    set({ _subscribed: true })

    gatewayClient.on((frame) => {
      // Detect process sessions created externally (e.g. via the process-builder skill).
      // The skill tags the session with label "process:<processId>" so we can link it.
      if (frame.event === 'sessions.changed') {
        const p = (frame.payload ?? {}) as Record<string, unknown>
        const sessionKey = String(p.sessionKey ?? p.key ?? '')
        const label      = String(p.label ?? '')
        if (!sessionKey || !label.startsWith('process:')) return
        if (_runSessions.has(sessionKey)) return  // already tracked

        const processId = label.slice('process:'.length)
        const def = get().processes.find(pr => pr.id === processId)
        if (!def) return

        _runSessions.set(sessionKey, processId)
        const now = Date.now()
        set(s => {
          const existing = s.runs[processId]
          if (existing?.status === 'running') return s
          return {
            runs: {
              ...s.runs,
              [processId]: {
                processId, sessionKey, status: 'running', startedAt: now,
                stepsDone: 0, outputBuffer: '',
                log: [{ ts: now, text: 'Process started via skill' }],
              },
            },
          }
        })
        return
      }

      if (frame.event !== 'chat' && frame.event !== 'agent') return
      const p = (frame.payload ?? {}) as Record<string, unknown>
      const sk = String(p.sessionKey ?? '')
      const now = Date.now()

      // Resolve the owning run. The controller routes by its own key. Workers don't —
      // but every worker frame carries `spawnedBy` = the key of the session that spawned
      // it. This gateway emits no `delegating`/`waiting` chat state and the sessions_spawn
      // tool-result usually omits the child key, so `spawnedBy` is the only reliable link
      // from a worker back to its run. Register the worker the first time we see it so its
      // later frames (including its `final`) route here too.
      let processId = _runSessions.get(sk)
      if (!processId) {
        const spawnedBy = String(p.spawnedBy ?? '')
        const owner = spawnedBy ? _runSessions.get(spawnedBy) : undefined
        if (!owner) return
        processId = owner
        _runSessions.set(sk, owner)
        // Count it as a flow step only when it's a direct child of the controller —
        // deeper sub-agents are a worker's own business, not a node in the process graph.
        const run0 = get().runs[owner]
        if (run0?.sessionKey === spawnedBy) {
          const tracked = _pendingSubSessions.get(owner) ?? new Set<string>()
          if (!tracked.has(sk)) {
            tracked.add(sk)
            _pendingSubSessions.set(owner, tracked)
            const agentId = agentIdFromKey(sk)
            set(s => {
              const run = s.runs[owner]
              if (!run) return s
              const updated: ProcessRun = { ...run, currentAgent: agentId, log: [...run.log, { ts: now, text: `Delegating to ${agentId}` }] }
              persistRun(updated)
              return { runs: { ...s.runs, [owner]: updated } }
            })
          }
        }
      }

      // agent event: detect sessions_spawn tool calls to track active sub-agent
      if (frame.event === 'agent') {
        const data = p.data as Record<string, unknown> | undefined
        if (p.stream === 'tool') {
          const toolCallId = String(data?.toolCallId ?? '')

          if (data?.phase === 'start' && data?.name === 'sessions_spawn') {
            const args = data.args as Record<string, unknown> | undefined
            const subName = String(args?.taskName ?? args?.agentId ?? 'sub-agent')
            // Record the toolCallId so we can match the result event (name absent on result)
            if (toolCallId) _spawnCallIds.set(toolCallId, processId)
            set(s => {
              const run = s.runs[processId]
              if (!run) return s
              const updated: ProcessRun = { ...run, currentAgent: subName }
              persistRun(updated)
              return { runs: { ...s.runs, [processId]: updated } }
            })
          } else if (data?.phase === 'result') {
            // Match by toolCallId — name field is not present on result events
            const ownerProcessId = toolCallId ? _spawnCallIds.get(toolCallId) : undefined
            if (ownerProcessId) {
              _spawnCallIds.delete(toolCallId)
              if (!data.isError) {
                const r = typeof data.result === 'string'
                  ? (() => { try { return JSON.parse(data.result as string) as Record<string, unknown> } catch { return {} as Record<string, unknown> } })()
                  : (data.result ?? {}) as Record<string, unknown>
                // The gateway returns the new worker's key as `childSessionKey` (and
                // sometimes `sessionKey`/`key`). Missing it leaves _pendingSubSessions
                // empty, so the controller's `final` would mark the run done while the
                // worker is still running — read all three.
                const rr = r as Record<string, unknown>
                const subKey = String(rr.childSessionKey ?? rr.sessionKey ?? rr.key ?? '')
                if (subKey) {
                  _runSessions.set(subKey, ownerProcessId)
                  if (!_pendingSubSessions.has(ownerProcessId)) _pendingSubSessions.set(ownerProcessId, new Set())
                  _pendingSubSessions.get(ownerProcessId)!.add(subKey)
                }
              }
            }
          }
        }
        return
      }

      // chat events
      const state = String(p.state ?? '')

      if (state === 'delta' && p.deltaText) {
        const raw = String(p.deltaText)
        // Parse [PROGRESS:N/T:label] markers emitted by the controller agent
        const PROG_RE = /\[PROGRESS:(\d+)\/(\d+)(?::([^\]]*))?\]/g
        const cleaned = raw.replace(PROG_RE, '')
        let progress: RunProgress | undefined
        let m: RegExpExecArray | null
        const scanRe = /\[PROGRESS:(\d+)\/(\d+)(?::([^\]]*))?\]/g
        while ((m = scanRe.exec(raw)) !== null) {
          progress = { current: parseInt(m[1]), total: parseInt(m[2]), label: m[3]?.trim() || undefined }
        }
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          const newLog = progress?.label && progress.label !== run.progress?.label
            ? [...run.log, { ts: now, text: `→ ${progress.label}` }]
            : run.log
          const updated: ProcessRun = {
            ...run,
            outputBuffer: run.outputBuffer + cleaned,
            ...(progress && { progress, stepsDone: progress.current }),
            log: newLog,
          }
          // Persist on an explicit PROGRESS marker so a reconnect (or another app
          // instance) restores the run mid-flight rather than at its launch snapshot.
          // Plain deltas stream per-token and are deliberately NOT persisted.
          if (progress) persistRun(updated)
          return { runs: { ...s.runs, [processId]: updated } }
        })
        return
      }

      if (state === 'waiting' || state === 'delegating') {
        const subKey = String(p.waitingSessionKey ?? p.subSessionKey ?? p.childSessionKey ?? '')
        // Register the awaited worker so the controller's `final` waits for it and its
        // own `final` routes back here to decrement — a safety net for any delegation
        // the spawn-result path above didn't capture.
        if (subKey) {
          _runSessions.set(subKey, processId)
          if (!_pendingSubSessions.has(processId)) _pendingSubSessions.set(processId, new Set())
          _pendingSubSessions.get(processId)!.add(subKey)
        }
        const entry: RunLogEntry = { ts: now, text: `Delegating to ${subKey || 'sub-agent'}` }
        // When sub-sessions are tracked, stepsDone is driven by sub-session 'final' events instead
        const trackingSubSessions = (_pendingSubSessions.get(processId)?.size ?? 0) > 0
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          const updated: ProcessRun = {
            ...run,
            currentAgent: subKey || run.currentAgent,
            stepsDone: trackingSubSessions ? run.stepsDone : run.stepsDone + 1,
            outputBuffer: '',
            log: [...run.log, entry],
          }
          persistRun(updated)
          return { runs: { ...s.runs, [processId]: updated } }
        })
        return
      }

      if (state === 'final') {
        const pending = _pendingSubSessions.get(processId)
        const isController = get().runs[processId]?.sessionKey === sk

        if (!isController) {
          // A worker finished. Drop it from routing, and if it was a tracked flow step
          // (a direct child of the controller), advance the step count. Never mark the
          // run done here — the controller may resume to run the next handoff/agent.
          _runSessions.delete(sk)
          const wasStep = pending?.delete(sk) ?? false
          if (wasStep) {
            const agentId = agentIdFromKey(sk)
            set(s => {
              const run = s.runs[processId]
              if (!run) return s
              const updated: ProcessRun = { ...run, stepsDone: run.stepsDone + 1, currentAgent: undefined, log: [...run.log, { ts: now, text: `✓ ${agentId} done` }] }
              persistRun(updated)
              return { runs: { ...s.runs, [processId]: updated } }
            })
          }
          return
        }

        // The controller's turn ended. With sessions_yield this fires after EVERY spawn,
        // not only at the true end, and the controller goes idle between steps — so we
        // cannot treat it as "done". Defer to the gateway: complete only once the
        // controller AND all of its descendants are idle. includeRoot=true keeps the
        // watcher alive while the controller is resumed for the next step; the guard
        // inside watchTreeUntilIdle makes repeated controller finals idempotent. The
        // controller key stays routed so its next turn's frames still reach us.
        if (pending && pending.size > 0) {
          set(s => {
            const run = s.runs[processId]
            if (!run) return s
            return { runs: { ...s.runs, [processId]: { ...run, log: [...run.log, { ts: now, text: 'Controller yielded — workers running…' }] } } }
          })
        }
        void watchTreeUntilIdle(processId, sk, true)
        return
      }

      if (state === 'error') {
        // A worker erroring doesn't fail the run — the controller may recover or route
        // around it. Only the controller's own error is terminal.
        if (get().runs[processId]?.sessionKey !== sk) {
          _runSessions.delete(sk)
          _pendingSubSessions.get(processId)?.delete(sk)
          set(s => {
            const run = s.runs[processId]
            if (!run) return s
            return { runs: { ...s.runs, [processId]: { ...run, currentAgent: undefined, log: [...run.log, { ts: now, text: `⚠ ${agentIdFromKey(sk)} failed: ${String(p.errorMessage ?? 'unknown')}` }] } } }
          })
          return
        }
        clearRunRouting(processId)
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          const updated: ProcessRun = {
            ...run, status: 'error', finishedAt: now, currentAgent: undefined,
            error: String(p.errorMessage ?? 'Unknown error'),
            log: [...run.log, { ts: now, text: `Error: ${String(p.errorMessage ?? 'unknown')}` }],
          }
          persistRun(updated)
          return { runs: { ...s.runs, [processId]: updated } }
        })
        return
      }

      if (state === 'aborted') {
        // A single worker being aborted doesn't stop the run; only the controller's abort
        // (e.g. the user pressing Stop) does.
        if (get().runs[processId]?.sessionKey !== sk) {
          _runSessions.delete(sk)
          _pendingSubSessions.get(processId)?.delete(sk)
          return
        }
        clearRunRouting(processId)
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          const updated: ProcessRun = {
            ...run, status: 'idle', finishedAt: now, currentAgent: undefined,
            log: [...run.log, { ts: now, text: 'Process stopped' }],
          }
          persistRun(updated)
          return { runs: { ...s.runs, [processId]: updated } }
        })
      }
    })
  },

  // ── Run actions ───────────────────────────────────────────────────────────────

  async startRun(processId, def, controllerAgentId, objective) {
    get()._startEventListening()
    const task = objective?.trim() || undefined

    let sessionKey: string
    try {
      const res = await gatewayClient.request<{ key: string }>('sessions.create', { agentId: controllerAgentId })
      sessionKey = res.key
    } catch (e) {
      const now = Date.now()
      set(s => ({
        runs: {
          ...s.runs,
          [processId]: {
            processId, status: 'error', startedAt: now, finishedAt: now,
            stepsDone: 0, outputBuffer: '', error: String(e),
            log: [{ ts: now, text: `Failed to create session: ${String(e)}` }],
          },
        },
      }))
      return
    }

    _runSessions.set(sessionKey, processId)

    const now = Date.now()
    set(s => ({
      runs: {
        ...s.runs,
        [processId]: {
          processId, sessionKey, status: 'running', startedAt: now,
          ...(task ? { objective: task } : {}),
          stepsDone: 0, outputBuffer: '',
          log: [
            { ts: now, text: `Session created: ${sessionKey}` },
            ...(task ? [{ ts: now, text: `Task: ${task}` }] : []),
          ],
        },
      },
    }))

    const job    = compileProcessToJob(def)
    const prompt = buildLaunchPrompt(def, job, task)

    try {
      await gatewayClient.request('chat.send', { sessionKey, message: prompt, idempotencyKey: nanoid(16) })
      set(s => {
        const run = s.runs[processId]
        if (!run) return s
        const updated: ProcessRun = { ...run, log: [...run.log, { ts: Date.now(), text: 'Prompt sent — Team Lead is executing…' }] }
        // Persist the in-flight run (with its controller sessionKey) so a later app
        // restart can re-attach to it — the run keeps executing on the gateway.
        persistRun(updated)
        return { runs: { ...s.runs, [processId]: updated } }
      })
    } catch (e) {
      _runSessions.delete(sessionKey)
      set(s => {
        const run = s.runs[processId]
        if (!run) return s
        const updated: ProcessRun = {
          ...run, status: 'error', finishedAt: Date.now(), error: String(e),
          log: [...run.log, { ts: Date.now(), text: `Failed to send prompt: ${String(e)}` }],
        }
        persistRun(updated)
        return { runs: { ...s.runs, [processId]: updated } }
      })
    }
  },

  async stopRun(processId) {
    // Abort any running sub-sessions first
    const pending = _pendingSubSessions.get(processId)
    if (pending) {
      for (const subKey of pending) {
        try { await gatewayClient.request('sessions.abort', { key: subKey }) } catch { /* ignore */ }
      }
      _pendingSubSessions.delete(processId)
    }
    for (const [cid, pid] of _spawnCallIds) { if (pid === processId) _spawnCallIds.delete(cid) }
    const run = get().runs[processId]
    if (!run?.sessionKey) return
    try {
      await gatewayClient.request('sessions.abort', { key: run.sessionKey })
    } catch { /* event handler will update state on aborted event */ }
  },

  // ── File operations ───────────────────────────────────────────────────────────

  async load() {
    get()._startEventListening()  // ensure we catch externally-started processes
    set({ loading: true, error: null, needsPlugin: false })
    try {
      const { backend, needsPlugin } = await resolveBackend()
      if (!backend) {
        set({ loading: false, needsPlugin, _backend: null, processes: [], runs: {} })
        return
      }

      const { defs: rawDefs, runs: rawRuns } = await backend.list()

      const defs: ProcessDef[] = []
      for (const d of rawDefs) {
        if (!d.md) continue
        const def = parseProcessFile(mdPathFor(d.id), d.md)
        if (def) defs.push(def)
      }

      // Restore persisted run states
      const restoredRuns: Record<string, ProcessRun> = {}
      const toReattach: ProcessRun[] = []
      for (const r of rawRuns) {
        if (!r.run) continue
        try {
          const run = JSON.parse(r.run) as ProcessRun
          // A persisted 'running' run means the gateway was still executing it when the
          // app last closed. The team runs on the gateway, independent of the app, so we
          // re-attach instead of declaring it interrupted.
          if (run.status === 'running' && run.sessionKey) toReattach.push(run)
          restoredRuns[run.processId] = run
        } catch { /* skip corrupt run files */ }
      }

      set(s => {
        // Preserve any in-memory running processes — the on-disk snapshot only
        // advances at progress points (steps, PROGRESS markers, delegations), so the
        // live in-memory run is always at least as fresh. A full replace would
        // discard the latest per-token output of active team (or process) runs when
        // load() is called by another view (e.g. ProcessesView, DashboardView).
        const merged: Record<string, ProcessRun> = { ...restoredRuns }
        for (const [id, run] of Object.entries(s.runs)) {
          if (run.status === 'running') merged[id] = run
        }
        return { _backend: backend, processes: defs, runs: merged, loading: false, needsPlugin: false }
      })

      // Re-route live events for each recovered run and reconcile its completion
      // against the gateway (idempotent — runs at most once per run per app session).
      for (const run of toReattach) {
        if (get().runs[run.processId]?.status === 'running') reattachRunningRun(run)
      }
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  async reload(path) {
    const backend = get()._backend
    if (!backend) return
    const id = idFromMdPath(path)
    const md = await backend.getDef(id).catch(() => null)
    if (!md) return
    const def = parseProcessFile(mdPathFor(id), md)
    if (!def) return
    set(s => ({
      processes: s.processes.some(p => p.path === def.path)
        ? s.processes.map(p => p.path === def.path ? def : p)
        : [...s.processes, def],
    }))
  },

  async save(path, text) {
    let backend = get()._backend
    if (!backend) { const r = await resolveBackend().catch(() => null); backend = r?.backend ?? null }
    if (!backend) { set({ error: 'Process storage is unavailable on this gateway' }); return false }
    try {
      await backend.setDef(idFromMdPath(path), text)
    } catch (e) { set({ error: String(e) }); return false }
    await get().reload(path)
    return true
  },

  async delete(path) {
    const backend = get()._backend
    if (!backend) { set({ error: 'Process storage is unavailable on this gateway' }); return false }
    try {
      await backend.deleteDef(idFromMdPath(path))
      set(s => ({ processes: s.processes.filter(p => p.path !== path), error: null }))
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    }
  },
}))
