import { gatewayClient } from './gateway'
import type { ChatMessage, ToolCall } from './types'

// Live progress for a background script the model launched via the joaxclaw-fs
// `script_start` tool. The job runs on the gateway host (surviving app reconnects);
// the chat's ScriptJobCard polls jobs.get to render it. See plugins/joaxclaw-fs.

export interface ScriptJob {
  id: string
  command: string
  cwd?: string
  running: boolean
  done: boolean
  exitCode: number | null
  error?: string | null
  percent?: number | null
  startedAt: number
  finishedAt: number | null
  elapsedMs: number
  output?: string
  outputTruncated?: boolean
  // Session that launched the job (joaxclaw-fs ≥ 0.11.5). Lets a chat re-attach to its
  // running scripts after an app reload, when the reloaded transcript no longer carries
  // the script_start tool call to parse a jobId from.
  sessionKey?: string
}

// script_start's tool result embeds "jobId: <uuid>" — parse it so the chat can attach a
// live card to that tool call. Pure + tested.
const JOB_ID_RE = /jobId:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function parseJobId(result?: string): string | null {
  if (!result) return null
  const m = JOB_ID_RE.exec(result)
  return m ? m[1] : null
}

export function jobStatus(jobId: string): Promise<ScriptJob> {
  return gatewayClient.request<ScriptJob>('jobs.get', { jobId })
}

// ── Jobs launched from one conversation ───────────────────────────────────────

export interface JobRef { jobId: string; command?: string }

const isScriptStart = (name: string) => /^script_start$/i.test(name)

function commandOf(call: ToolCall): string | undefined {
  if (!call.args) return undefined
  try {
    const a = JSON.parse(call.args) as { command?: unknown }
    return typeof a?.command === 'string' ? a.command : undefined
  } catch { return undefined }
}

// Every script job started somewhere in a conversation (including inside sub-agent
// threads), oldest first and deduped. The chat's sticky ScriptJobDock uses this to
// follow the conversation's own jobs rather than every job on the host. Pure + tested.
export function collectJobRefs(messages: ChatMessage[]): JobRef[] {
  const found = new Map<string, JobRef>()
  for (const msg of messages) {
    const calls: ToolCall[] = [
      ...(msg.toolCalls ?? []),
      ...(msg.threads ?? []).flatMap(t => t.toolCalls ?? []),
    ]
    for (const call of calls) {
      if (!isScriptStart(call.name)) continue
      const jobId = parseJobId(call.result)
      if (jobId && !found.has(jobId)) found.set(jobId, { jobId, command: commandOf(call) })
    }
  }
  return [...found.values()]
}

// Running jobs the host attributes to one session. This is how a chat finds its scripts
// again after an app reload: the transcript comes back without tool calls, but the job
// is still alive on the host and remembers who launched it. Jobs from a gateway plugin
// older than 0.11.5 carry no sessionKey and are left to the Dashboard's global list.
export function jobRefsForSession(jobs: ScriptJob[], sessionKey: string): JobRef[] {
  return jobs
    .filter(j => j.running && !!j.sessionKey && j.sessionKey === sessionKey)
    .map(j => ({ jobId: j.id, command: j.command }))
}

// ── Shared job watcher ────────────────────────────────────────────────────────
// One poll loop per jobId, however many views show it — the inline card in the
// transcript and the sticky dock at the top of the chat watch the same job.

export interface JobState {
  job: ScriptJob | null
  expired: boolean   // jobs.get no longer knows this id (finished + GC'd, or old plugin)
}

interface Watch {
  state: JobState
  listeners: Set<(s: JobState) => void>
  timer?: ReturnType<typeof setTimeout>
  polling: boolean
  settled: boolean   // job finished or expired — nothing left to poll for
}

const watches = new Map<string, Watch>()
const POLL_MS = 1500

function emit(w: Watch, state: JobState) {
  w.state = state
  for (const l of [...w.listeners]) l(state)
}

function startPolling(jobId: string, w: Watch) {
  if (w.polling || w.settled) return
  w.polling = true
  const tick = async () => {
    if (w.listeners.size === 0) { w.polling = false; return }
    try {
      const job = await jobStatus(jobId)
      emit(w, { job, expired: false })
      if (job.done) { w.polling = false; w.settled = true; return }
    } catch {
      // Unknown jobId — stop polling and keep whatever we last saw.
      emit(w, { job: w.state.job, expired: true })
      w.polling = false
      w.settled = true
      return
    }
    w.timer = setTimeout(tick, POLL_MS)
  }
  void tick()
}

// Watch a job until the listener unsubscribes. The listener fires immediately with the
// last known state, so a view mounting mid-run renders without waiting for a poll.
export function subscribeJob(jobId: string, listener: (s: JobState) => void): () => void {
  let w = watches.get(jobId)
  if (!w) {
    w = { state: { job: null, expired: false }, listeners: new Set(), polling: false, settled: false }
    watches.set(jobId, w)
  }
  const watch = w
  watch.listeners.add(listener)
  listener(watch.state)
  startPolling(jobId, watch)
  return () => {
    watch.listeners.delete(listener)
    if (watch.listeners.size === 0) {
      if (watch.timer) clearTimeout(watch.timer)
      watch.timer = undefined
      watches.delete(jobId)
    }
  }
}

// All script jobs the gateway is tracking (running + recently finished). Returns [] when
// the plugin is too old to provide jobs.list (unknown method), so callers stay simple.
export function listJobs(): Promise<ScriptJob[]> {
  return gatewayClient.request<{ jobs: ScriptJob[] }>('jobs.list')
    .then(r => r.jobs ?? [])
    .catch(() => [])
}

// Compact elapsed formatter shared by the job card and the dashboard.
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function stopJob(jobId: string): Promise<{ ok: boolean }> {
  return gatewayClient.request<{ ok: boolean }>('jobs.stop', { jobId })
}
