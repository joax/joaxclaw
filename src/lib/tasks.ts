import type { StateTone } from './stateTone'
import type { ScriptJob } from './scriptJobs'
import { isSameSession } from './progressCard'

// Background tasks: the gateway's record of work an agent started and left running —
// subagents, background commands, automation runs, media jobs — plus the script jobs the
// joaxclaw-fs plugin runs (`script_start`), merged into one list. Everything here is pure:
// the store (store/tasks.ts) does the RPCs, the components only render what this decides.
//
// Shapes are from the OpenClaw 2026.9.4 source (gateway-protocol schema/tasks.ts and
// server-methods/task-summary.ts). Timestamps arrive as epoch ms or as strings, and the
// status and kind sets grow between gateway releases, so parsing keeps what it doesn't
// recognise instead of dropping the task.

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

export type DeliveryStatus =
  | 'pending' | 'delivered' | 'session_queued' | 'failed' | 'dismissed' | 'parent_missing' | 'not_applicable'

export interface TaskSummary {
  id: string
  /** `taskKind ?? runtime`, e.g. "exec", "automation_run", "subagent". */
  kind?: string
  runtime?: string
  status: TaskStatus | string
  title: string
  agentId?: string
  /** The requester session: the chat that started it. */
  sessionKey?: string
  /** The session the task runs in (a subagent's own chat). */
  childSessionKey?: string
  ownerKey?: string
  runId?: string
  parentTaskId?: string
  hasTranscript: boolean
  createdAt?: number
  updatedAt?: number
  startedAt?: number
  endedAt?: number
  toolUseCount?: number
  lastToolName?: string
  lastActivity?: string
  diffStat?: { files: number; added: number; removed: number }
  progressSummary?: string
  terminalSummary?: string
  error?: string
  deliveryStatus?: DeliveryStatus | string
  terminalOutcome?: 'succeeded' | 'blocked' | string
  /** tasks.get only (≤4000 chars each). */
  prompt?: string
  result?: string
}

export const ACTIVE_STATUSES: TaskStatus[] = ['queued', 'running']
export const FINISHED_STATUSES: TaskStatus[] = ['completed', 'failed', 'timed_out', 'cancelled']

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Epoch ms from a number, a numeric string or a date string. */
export function toMs(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string' || !v.trim()) return undefined
  if (/^\d+$/.test(v.trim())) return Number(v.trim())
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : t
}

export function parseTask(raw: unknown): TaskSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id) ?? str(r.taskId)
  if (!id) return null
  const d = r.diffStat as Record<string, unknown> | undefined
  const diffStat = d && typeof d === 'object' && int(d.files) !== undefined
    ? { files: int(d.files) ?? 0, added: int(d.added) ?? 0, removed: int(d.removed) ?? 0 }
    : undefined
  return {
    id,
    kind: str(r.kind),
    runtime: str(r.runtime),
    status: str(r.status) ?? 'queued',
    title: str(r.title)?.trim() ?? 'Background task',
    agentId: str(r.agentId),
    sessionKey: str(r.sessionKey),
    childSessionKey: str(r.childSessionKey),
    ownerKey: str(r.ownerKey),
    runId: str(r.runId),
    parentTaskId: str(r.parentTaskId),
    hasTranscript: r.hasTranscript === true,
    createdAt: toMs(r.createdAt),
    updatedAt: toMs(r.updatedAt),
    startedAt: toMs(r.startedAt),
    endedAt: toMs(r.endedAt),
    toolUseCount: int(r.toolUseCount),
    lastToolName: str(r.lastToolName),
    lastActivity: str(r.lastActivity),
    diffStat,
    progressSummary: str(r.progressSummary),
    terminalSummary: str(r.terminalSummary),
    error: str(r.error),
    deliveryStatus: str(r.deliveryStatus),
    terminalOutcome: str(r.terminalOutcome),
    prompt: str(r.prompt),
    result: str(r.result),
  }
}

export function parseTaskList(raw: unknown): { tasks: TaskSummary[]; nextCursor?: string } {
  const r = (raw ?? {}) as { tasks?: unknown; nextCursor?: unknown }
  const tasks = Array.isArray(r.tasks) ? r.tasks.map(parseTask).filter((t): t is TaskSummary => t !== null) : []
  return { tasks, nextCursor: str(r.nextCursor) }
}

export const isActive = (t: Pick<TaskSummary, 'status'>) => t.status === 'queued' || t.status === 'running'

/**
 * "Needs you" means exactly one thing: the work finished but its result couldn't be
 * delivered back to the chat. Retry and Dismiss only exist for that case, and this is the
 * Control UI's own rule for showing them.
 */
export function isNeedsYou(t: Pick<TaskSummary, 'terminalOutcome' | 'deliveryStatus'>): boolean {
  return t.terminalOutcome === 'blocked' && t.deliveryStatus === 'failed'
}

/**
 * Whether Retry delivery and Dismiss delivery can work on a needs-you task. The gateway
 * can only re-drive (or drop) a SUBAGENT's completion delivery; for any other runtime it
 * answers `ok:false "task has no recoverable subagent completion"`, so the buttons aren't
 * offered. It still refuses a subagent whose delivery isn't suspended ("completion
 * delivery is not blocked"), which the summary can't show; the row reports that refusal.
 */
export function canRecover(t: Pick<TaskSummary, 'terminalOutcome' | 'deliveryStatus' | 'runtime'>): boolean {
  return isNeedsYou(t) && t.runtime === 'subagent'
}

export interface ItemState { label: string; tone: StateTone }

export function taskState(t: TaskSummary): ItemState {
  if (isNeedsYou(t)) return { label: 'Needs you', tone: 'needsYou' }
  switch (t.status) {
    case 'queued': return { label: 'Queued', tone: 'working' }
    case 'running': return { label: 'Running', tone: 'working' }
    case 'completed': return { label: 'Done', tone: 'done' }
    case 'failed': return { label: 'Failed', tone: 'failed' }
    case 'timed_out': return { label: 'Timed out', tone: 'failed' }
    case 'cancelled': return { label: 'Stopped', tone: 'idle' }
    default: {
      const s = String(t.status).replace(/_/g, ' ')
      return { label: s.charAt(0).toUpperCase() + s.slice(1), tone: 'idle' }
    }
  }
}

/** Icon names the components map onto lucide icons (a pure lib can't import React). */
export type KindIcon = 'subagent' | 'command' | 'automation' | 'image' | 'music' | 'video' | 'maintenance' | 'acp' | 'cli' | 'script' | 'task'
export interface KindInfo { label: string; icon: KindIcon }

const KINDS: Record<string, KindInfo> = {
  subagent: { label: 'Subagent', icon: 'subagent' },
  exec: { label: 'Background command', icon: 'command' },
  automation_run: { label: 'Automation', icon: 'automation' },
  cron: { label: 'Automation', icon: 'automation' },
  image_generation: { label: 'Image', icon: 'image' },
  music_generation: { label: 'Music', icon: 'music' },
  video_generation: { label: 'Video', icon: 'video' },
  context_engine_turn_maintenance: { label: 'Maintenance', icon: 'maintenance' },
  acp: { label: 'Coding agent', icon: 'acp' },
  cli: { label: 'CLI run', icon: 'cli' },
}
export const SCRIPT_KIND: KindInfo = { label: 'Script', icon: 'script' }

/** The task's kind, falling back to its runtime, then to plain "Task". */
export function kindInfo(t: Pick<TaskSummary, 'kind' | 'runtime'>): KindInfo {
  return (t.kind && KINDS[t.kind]) || (t.runtime && KINDS[t.runtime]) || { label: 'Task', icon: 'task' }
}

// ── Script jobs ──────────────────────────────────────────────────────────────

export function scriptState(job: ScriptJob | null, expired: boolean): ItemState {
  if (job?.running && !expired) return { label: 'Running', tone: 'working' }
  if (!job || (expired && !job.done)) return { label: 'Ended', tone: 'idle' }
  const failed = job.exitCode ? job.exitCode !== 0 : !!job.error
  if (failed) return { label: job.exitCode != null ? `Failed · exit ${job.exitCode}` : 'Failed', tone: 'failed' }
  return { label: 'Done', tone: 'done' }
}

// ── One list for both ────────────────────────────────────────────────────────

export interface BackgroundItem {
  /** Unique across both sources: `task:<id>` or `script:<jobId>`. Also the hide key. */
  key: string
  source: 'task' | 'script'
  id: string
  title: string
  state: ItemState
  kind: KindInfo
  active: boolean
  needsYou: boolean
  startedAt?: number
  endedAt?: number
  agentId?: string
  task?: TaskSummary
  job?: ScriptJob
  /** A script that printed a percentage. */
  percent?: number | null
}

export function fromTask(t: TaskSummary): BackgroundItem {
  return {
    key: `task:${t.id}`,
    source: 'task',
    id: t.id,
    title: t.title,
    state: taskState(t),
    kind: kindInfo(t),
    active: isActive(t),
    needsYou: isNeedsYou(t),
    startedAt: t.startedAt ?? t.createdAt,
    // A finished task without endedAt still finished; its last update is when.
    endedAt: isActive(t) ? undefined : t.endedAt ?? t.updatedAt,
    agentId: t.agentId,
    task: t,
  }
}

/**
 * A script job as a background item. `expiredAt` is when the app noticed the host had
 * forgotten a job it last saw running (plugin restart), which is the best end time known.
 */
export function fromScriptJob(job: ScriptJob, opts: { expired?: boolean; expiredAt?: number } = {}): BackgroundItem {
  const expired = !!opts.expired
  const state = scriptState(job, expired)
  const active = state.tone === 'working'
  return {
    key: `script:${job.id}`,
    source: 'script',
    id: job.id,
    title: job.command || 'script',
    state,
    kind: SCRIPT_KIND,
    active,
    needsYou: false,
    startedAt: job.startedAt,
    endedAt: active ? undefined : job.finishedAt ?? opts.expiredAt,
    job,
    percent: active ? job.percent ?? null : null,
  }
}

/**
 * Running and queued first, oldest start first; then needs-you; then everything else,
 * newest end first. The Control UI's order, and GitHub Actions'. Ties go by id so the
 * list doesn't shuffle between renders.
 */
export function orderItems(items: BackgroundItem[]): BackgroundItem[] {
  const rank = (i: BackgroundItem) => (i.active ? 0 : i.needsYou ? 1 : 2)
  return [...items].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r) return r
    if (rank(a) === 0) {
      const d = (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity)
      if (d) return d
    } else {
      const d = (b.endedAt ?? 0) - (a.endedAt ?? 0)
      if (d) return d
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export const orderTasks = (tasks: TaskSummary[]) => orderItems(tasks.map(fromTask))

/** Finished work stays in a chat's strip this long… */
export const STRIP_DONE_MS = 10 * 60 * 1000
/** …and failures this long, since they're what you'd come back for. */
export const STRIP_FAILED_MS = 24 * 60 * 60 * 1000

function dedupe(items: BackgroundItem[]): BackgroundItem[] {
  const seen = new Map<string, BackgroundItem>()
  for (const i of items) if (!seen.has(i.key)) seen.set(i.key, i)
  return [...seen.values()]
}

/**
 * What one chat's Background strip lists: everything running or queued, everything that
 * needs you, failures from the last 24 h, and other finished work from the last 10 min
 * or that finished while the chat was open. `hidden` holds the keys the user closed with
 * ×; a needs-you item can't be hidden that way, only by Dismiss delivery.
 */
export function stripItems(args: {
  tasks: TaskSummary[]
  jobs: BackgroundItem[]
  now: number
  /** When this chat was opened; anything finishing after that stays until hidden. */
  openedAtMs: number
  hidden: ReadonlySet<string>
}): BackgroundItem[] {
  const { now, openedAtMs, hidden } = args
  const all = dedupe([...args.tasks.map(fromTask), ...args.jobs])
  return orderItems(all.filter(i => {
    if (i.active || i.needsYou) return true
    if (hidden.has(i.key)) return false
    const ended = i.endedAt
    if (ended === undefined) return false
    if (ended >= openedAtMs) return true
    return now - ended <= (i.state.tone === 'failed' ? STRIP_FAILED_MS : STRIP_DONE_MS)
  }))
}

/** The Dashboard's Background section, for every agent: running, needs you, recent failures. */
export function dashboardItems(args: { tasks: TaskSummary[]; jobs: BackgroundItem[]; now: number }): BackgroundItem[] {
  const all = dedupe([...args.tasks.map(fromTask), ...args.jobs])
  return orderItems(all.filter(i =>
    i.active || i.needsYou
    || (i.state.tone === 'failed' && i.endedAt !== undefined && args.now - i.endedAt <= STRIP_FAILED_MS)))
}

export interface ItemCounts { running: number; needsYou: number; failed: number; done: number }

export function countItems(items: BackgroundItem[]): ItemCounts {
  const c: ItemCounts = { running: 0, needsYou: 0, failed: 0, done: 0 }
  for (const i of items) {
    if (i.active) c.running++
    else if (i.needsYou) c.needsYou++
    else if (i.state.tone === 'failed') c.failed++
    // Stopped and ended items are finished too; the headline has no separate part for them.
    else c.done++
  }
  return c
}

/** "2 running · 1 needs you · 3 done", leaving out the parts that are zero. */
export function summaryLine(items: BackgroundItem[]): string {
  const c = countItems(items)
  return [
    c.running && `${c.running} running`,
    c.needsYou && `${c.needsYou} needs you`,
    c.failed && `${c.failed} failed`,
    c.done && `${c.done} done`,
  ].filter(Boolean).join(' · ')
}

/** The phone chip: "Background 2 · 1 ⚠" (running, then needs-you). */
export function chipLabel(items: BackgroundItem[]): string {
  const c = countItems(items)
  return `Background${c.running ? ` ${c.running}` : ''}${c.needsYou ? ` · ${c.needsYou} ⚠` : ''}`
}

const TONE_RANK: Record<StateTone, number> = { failed: 4, needsYou: 3, working: 2, done: 1, idle: 0 }

/** The strip takes the colour of its worst item: failed > needs you > working > done > idle. */
export function worstTone(items: BackgroundItem[]): StateTone {
  let worst: StateTone = 'idle'
  for (const i of items) if (TONE_RANK[i.state.tone] > TONE_RANK[worst]) worst = i.state.tone
  return worst
}

/** Whether a task belongs to a chat: it started there, runs there, or is owned by it. */
export function taskMatchesSession(t: Pick<TaskSummary, 'sessionKey' | 'childSessionKey' | 'ownerKey'>, key: string): boolean {
  return [t.sessionKey, t.childSessionKey, t.ownerKey].some(k => !!k && isSameSession(k, key))
}

// ── Row text ─────────────────────────────────────────────────────────────────

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** "+120 −8 in 3 files" */
export function changesLine(d: { files: number; added: number; removed: number }): string {
  return `+${d.added} −${d.removed} in ${d.files} ${d.files === 1 ? 'file' : 'files'}`
}

/**
 * The row's second line: Kind · agent · elapsed · n tools · now: tool · changes. Parts the
 * item doesn't have are left out; a needs-you task explains itself instead.
 */
export function metaLine(i: BackgroundItem, now: number): string {
  if (i.needsYou) return `${i.kind.label} · Completed, but the result couldn't be delivered back`
  const parts: string[] = [i.kind.label]
  const t = i.task
  if (t?.agentId) parts.push(t.agentId)
  if (i.startedAt !== undefined) parts.push(fmtDuration((i.endedAt ?? now) - i.startedAt))
  else if (i.job) parts.push(fmtDuration(i.job.elapsedMs))
  if (t?.toolUseCount) parts.push(`${t.toolUseCount} ${t.toolUseCount === 1 ? 'tool' : 'tools'}`)
  if (i.active && t?.lastToolName) parts.push(`now: ${t.lastToolName}`)
  if (t?.diffStat && (t.diffStat.added || t.diffStat.removed || t.diffStat.files)) parts.push(changesLine(t.diffStat))
  return parts.join(' · ')
}

// ── Scopes and errors ────────────────────────────────────────────────────────

/** Stop, Retry and Dismiss need write; admin implies it. */
export function canManageTasks(scopes: readonly string[]): boolean {
  return scopes.includes('operator.write') || scopes.includes('operator.admin')
}

export interface GatewayErrorInfo { code?: string; message: string; retryAfterMs?: number }

/** The gateway's structured error from a rejected request (gateway.ts attaches it). */
export function readGatewayError(e: unknown): GatewayErrorInfo {
  const g = (e as { gatewayError?: unknown })?.gatewayError
  if (g && typeof g === 'object') {
    const r = g as Record<string, unknown>
    const details = (r.details && typeof r.details === 'object' ? r.details : {}) as Record<string, unknown>
    return {
      code: str(r.code),
      message: str(r.message) ?? 'Request failed',
      retryAfterMs: int(r.retryAfterMs) ?? int(details.retryAfterMs),
    }
  }
  return { message: e instanceof Error ? e.message : String(e) }
}

/**
 * What to say after `tasks.cancel`, or null when it worked. The gateway answers
 * `{found:false, cancelled:false}` with no reason when this connection can't write to the
 * task (or it's gone), and gives a reason such as "Task is already terminal." otherwise.
 */
export function cancelMessage(res: { found?: boolean; cancelled?: boolean; reason?: string } | undefined): string | null {
  if (res?.cancelled) return null
  const why = res?.reason ?? (res?.found === false
    ? "this connection can't find it — it may be gone, or belong to a chat you can't manage"
    : 'the gateway gave no reason')
  return `Couldn't stop it: ${why}`
}

/**
 * What to say after `tasks.retry` / `tasks.dismiss` for one task, or null when it worked.
 * A refusal is expected, not exceptional: e.g. "completion delivery is not blocked" when
 * the delivery isn't suspended any more, or "completion delivery redrive limit reached".
 */
export function recoveryMessage(verb: 'retry' | 'dismiss', r: { ok?: boolean; reason?: string } | undefined): string | null {
  if (r?.ok) return null
  return `Couldn't ${verb}: ${r?.reason ?? 'the gateway gave no reason'}`
}

/** tasks.list's "invalid or expired … cursor": restart paging from the top. */
export const isStaleCursor = (e: GatewayErrorInfo) => /cursor/i.test(e.message) && e.code === 'INVALID_REQUEST'

/** tasks.get / tasks.history on a task that's gone (deleted, or past retention). */
export const isTaskGone = (e: GatewayErrorInfo) => /task not found/i.test(e.message)

// ── Merging ──────────────────────────────────────────────────────────────────

/**
 * Which copy of a task to keep. A list request can be answered after a newer `task` event
 * for the same task arrived, so the one updated later wins; on a tie the incoming copy
 * does. `tasks.get` adds prompt and result, which list rows and events leave out, so those
 * carry over rather than being wiped by a later summary.
 */
export function mergeTask(existing: TaskSummary | undefined, incoming: TaskSummary): TaskSummary {
  if (!existing) return incoming
  if ((incoming.updatedAt ?? 0) < (existing.updatedAt ?? 0)) return existing
  return {
    ...incoming,
    prompt: incoming.prompt ?? existing.prompt,
    result: incoming.result ?? existing.result,
  }
}

// ── Locally hidden rows ──────────────────────────────────────────────────────

export const HIDDEN_CAP = 200

/** Add a hidden key for a session, keeping only the newest `cap` across all sessions. */
export function addHidden(map: Record<string, string[]>, sessionKey: string, key: string, cap = HIDDEN_CAP): Record<string, string[]> {
  const next: Record<string, string[]> = { ...map, [sessionKey]: [...(map[sessionKey] ?? []).filter(k => k !== key), key] }
  let total = Object.values(next).reduce((n, l) => n + l.length, 0)
  // Drop the oldest entries of the biggest lists first; a hidden row coming back is harmless.
  while (total > cap) {
    const biggest = Object.keys(next).reduce((a, b) => (next[a].length >= next[b].length ? a : b))
    next[biggest] = next[biggest].slice(1)
    if (next[biggest].length === 0) delete next[biggest]
    total--
  }
  return next
}
