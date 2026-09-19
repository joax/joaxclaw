import type { StateTone } from './stateTone'

// "Update via agent" — builds a chat prompt that an agent on the gateway host runs
// to update OpenClaw itself (the gateway software). Mirrors the joaxclaw-fs install
// flow (see joaxclawFsInstall.ts): the agent runs `openclaw update` on the host, so
// it works for BOTH a local and a remote gateway — the agent always runs on the
// gateway host, whichever machine that is. `openclaw update` auto-detects the install
// method (git checkout vs npm/global package manager) and updates accordingly.

// The script the agent runs on the gateway host. `set -e` aborts on a failed update so
// the agent reports the real error instead of restarting a half-updated install.
// `--yes` makes it non-interactive (accepts downgrade prompts). We pass `--no-restart`
// and do the restart ourselves — detached + delayed — so the agent's turn finishes
// cleanly first; a synchronous restart mid-update kills the session and it hangs
// "running" (same reason the install script defers its restart). `update status`
// runs first so the chat shows the before/after version.
const UPDATE_SCRIPT = [
  '# Update OpenClaw (the gateway software) on this host.',
  'set -e',
  'openclaw update status || true',
  'openclaw update --yes --no-restart',
  'echo "OpenClaw updated. Restarting the gateway in a few seconds to load the new version."',
  "nohup sh -c 'sleep 4; openclaw gateway restart' >/dev/null 2>&1 &",
].join('\n')

export async function buildGatewayUpdatePrompt(): Promise<{ ok: boolean; prompt?: string; error?: string }> {
  const prompt = [
    'Update **OpenClaw** (the gateway software) on THIS gateway host to the latest',
    'version on its current update channel.',
    '',
    'Do it now: run the script below as a shell command, **exactly as written**. Run it',
    'in one shot (do not ask me to confirm first):',
    '',
    '```bash',
    UPDATE_SCRIPT,
    '```',
    '',
    'If `openclaw update` fails (e.g. this host has no internet, or a git checkout has',
    'local changes), stop and tell me the exact error — do not restart the gateway.',
    '',
    'The script restarts the gateway a few seconds after it finishes, so your turn will',
    'complete normally first and then the connection briefly drops — that is expected.',
    'JoaxClaw reconnects on its own. A one-line summary with the new version is enough.',
  ].join('\n')

  return { ok: true, prompt }
}

// ── Updating the gateway directly ─────────────────────────────────────────────────
//
// An admin connection updates the gateway in place with `update.run`, after one
// confirmation. Every connection learns about an update from the hello-ok snapshot and
// the `update.available` broadcast, which OpenClaw sends to clients of any scope. The
// shapes below were read from the OpenClaw 2026.9.4 protocol schemas
// (UpdateAvailableSchema, UpdateScheduleStateSchema, UpdateRunResultSchema). Everything
// is parsed defensively: `update.run`'s `result` and `handoff` are typed Unknown on the wire.

export interface UpdateAvailable {
  currentVersion: string
  latestVersion: string
  channel?: string
  /** Dev (git) channel only, and only for clients with operator.read. */
  commitsBehind?: number
  commits?: { sha: string; subject: string }[]
}

export type CampaignState = 'waiting-for-idle' | 'countdown' | 'applying'

/** An automatic update the gateway is about to apply (it needs update.auto.enabled). */
export interface UpdateCampaign {
  id: string
  state: CampaignState
  /** When the 60 s countdown ends (countdown state only). */
  applyAtMs?: number
  /** Set once the campaign was held; the gateway allows one hold per campaign. */
  holdUntilMs?: number
  /** The hard deadline: the update starts then even if work is still running. */
  forceAtMs: number
}

export interface UpdateSchedule {
  channel?: string
  autoEnabled: boolean
  /** The version (package installs) the schedule is aiming at, when known. */
  targetVersion?: string
  campaign?: UpdateCampaign
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const obj = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)

/** `updateAvailable` from the snapshot, the event or update.status; null when absent or unreadable. */
export function parseUpdateAvailable(raw: unknown): UpdateAvailable | null {
  const r = obj(raw)
  const currentVersion = str(r?.currentVersion)
  const latestVersion = str(r?.latestVersion)
  if (!r || !currentVersion || !latestVersion) return null
  const commits = Array.isArray(r.commits)
    ? r.commits.map(obj).filter((c): c is Record<string, unknown> => !!c && !!str(c.sha))
      .map(c => ({ sha: c.sha as string, subject: typeof c.subject === 'string' ? c.subject : '' }))
    : []
  return {
    currentVersion,
    latestVersion,
    ...(str(r.channel) ? { channel: r.channel as string } : {}),
    ...(num(r.commitsBehind) !== undefined ? { commitsBehind: r.commitsBehind as number } : {}),
    ...(commits.length ? { commits } : {}),
  }
}

const CAMPAIGN_STATES = new Set<string>(['waiting-for-idle', 'countdown', 'applying'])

/** `updateSchedule` (snapshot) or `schedule` (event, update.status, update.hold). */
export function parseSchedule(raw: unknown): UpdateSchedule | null {
  const r = obj(raw)
  if (!r) return null
  const target = obj(r.target)
  const c = obj(r.campaign)
  const campaign: UpdateCampaign | undefined = c && str(c.id) && CAMPAIGN_STATES.has(c.state as string) && num(c.forceAtMs) !== undefined
    ? {
        id: c.id as string,
        state: c.state as CampaignState,
        forceAtMs: c.forceAtMs as number,
        ...(num(c.applyAtMs) !== undefined ? { applyAtMs: c.applyAtMs as number } : {}),
        ...(num(c.holdUntilMs) !== undefined ? { holdUntilMs: c.holdUntilMs as number } : {}),
      }
    : undefined
  return {
    autoEnabled: r.autoEnabled === true,
    ...(str(r.channel) ? { channel: r.channel as string } : {}),
    ...(target?.kind === 'package' && str(target.version) ? { targetVersion: target.version as string } : {}),
    ...(campaign ? { campaign } : {}),
  }
}

/** Why the gateway didn't start an update. */
export interface Refusal {
  /** The gateway's `result.reason`, or 'rate-limited' / 'rpc-error' for a failed call. */
  reason: string
  /** Free text from the gateway; for 'rate-limited', the seconds to wait. */
  message?: string
  /** A command the gateway says is safe to run on the host instead (`handoff.command`). */
  command?: string
}

export type RunResponse =
  /** No runId before 2026.9: the run can't be followed, only judged after the restart. */
  | { kind: 'started'; runId?: string }
  | { kind: 'already-current'; runId?: string }
  | { kind: 'refused'; runId?: string; refusal: Refusal }

/**
 * Read an `update.run` reply. It is a *successful* RPC either way: `ok:false` with
 * `result.reason` is a refusal (restarts off, an outside supervisor, another update
 * running…), and `already-current` is a no-op, not a failure. For a managed service,
 * `ok:true` means the detached updater took over and the run carries on without us,
 * even though `result.status` says "skipped". Every call, refusals included, creates a
 * run in the gateway's ledger and returns its runId (2026.9; 2026.6.5 sends none).
 */
export function parseRunResponse(raw: unknown): RunResponse {
  const r = obj(raw) ?? {}
  const runId = str(r.runId)
  const result = obj(r.result)
  const handoff = obj(r.handoff)
  const reason = str(result?.reason) ?? str(r.code)
  if (reason === 'already-current') return { kind: 'already-current', ...(runId ? { runId } : {}) }
  if (r.ok === true) return { kind: 'started', ...(runId ? { runId } : {}) }
  const message = str(r.message) ?? str(handoff?.message)
  const command = str(handoff?.command)
  return {
    kind: 'refused',
    ...(runId ? { runId } : {}),
    refusal: { reason: reason ?? 'unknown', ...(message ? { message } : {}), ...(command ? { command } : {}) },
  }
}

/**
 * A failed `update.run` call, as opposed to a refusal: the gateway's error (from the
 * `gatewayError` the client attaches), or the rate limit (UNAVAILABLE + retryAfterMs;
 * control-plane writes are capped at 30 a minute).
 */
export function rpcErrorRefusal(err: unknown): Refusal {
  const ge = obj((err as { gatewayError?: unknown } | null)?.gatewayError)
  const retryAfterMs = num(ge?.retryAfterMs)
  // The drain before a restart also answers UNAVAILABLE + retryAfterMs; that isn't "busy".
  if (obj(ge?.details)?.reason === 'gateway-restarting') {
    return { reason: 'rpc-error', message: 'The gateway is restarting. Try again in a moment.' }
  }
  if (ge?.code === 'UNAVAILABLE' && retryAfterMs !== undefined) {
    return { reason: 'rate-limited', message: String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }
  }
  const message = str(ge?.message) ?? (err instanceof Error ? str(err.message) : str(err))
  return { reason: 'rpc-error', ...(message ? { message } : {}) }
}

/**
 * Whether a failed `update.run` is this client giving up on the reply (gateway.ts's own
 * timer: "Request update.run timed out"), rather than the gateway answering with an
 * error. The two mean opposite things. A reply the gateway sent is its verdict; a reply we
 * stopped waiting for says nothing about the run. An unsupervised git update holds its
 * reply through staging and validation, so a slow one can outlast the 15 minutes we wait
 * while it carries on, and finishes, on the gateway.
 */
export function isClientTimeout(err: unknown, method = 'update.run'): boolean {
  if (obj((err as { gatewayError?: unknown } | null)?.gatewayError)) return false
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return message === `Request ${method} timed out`
}

/**
 * The run our timed-out `update.run` created, from `update.runs.list` (newest first).
 * Every call makes a ledger run as it starts (2026.9), so it's the newest one created
 * since the click; a minute of slack covers a remote host's clock. Null when the ledger
 * has nothing that new, which means there's no run of ours to follow.
 */
export function runStartedSince(runs: readonly UpdateRun[], startedAtMs: number): UpdateRun | null {
  let best: UpdateRun | null = null
  for (const r of runs) {
    if (r.createdAtMs < startedAtMs - 60_000) continue
    if (!best || r.createdAtMs > best.createdAtMs) best = r
  }
  return best
}

export interface RefusalCopy {
  text: string
  /** The way round it: hand it to an agent, show the command, or nothing (wait, or fix the config). */
  action: 'viaAgent' | 'command' | 'none'
  command?: string
}

/** The banner's words for a refusal, and the way round it offers (PRD 02 §5.7, r.*). */
export function refusalCopy(refusal: Refusal): RefusalCopy {
  switch (refusal.reason) {
    case 'external-supervisor-update-required':
      return { text: "This gateway is run by an outside supervisor, so it can't update itself. Update it the way it was installed.", action: 'none' }
    case 'restart-disabled':
    case 'restart-unavailable':
      return { text: "Gateway restarts are turned off, so the update wasn't applied. Turn restarts on in the gateway config, then try again.", action: 'none' }
    case 'managed-service-handoff-unavailable':
      return { text: "The gateway can't hand the update to its service safely. Run this on the gateway host instead:", action: 'command', command: refusal.command ?? 'openclaw update' }
    case 'managed-service-handoff-already-running':
      return { text: 'Another update is already running. Wait for it to finish.', action: 'none' }
    case 'update-campaign-applying':
      return { text: 'An automatic update is already being applied.', action: 'none' }
    // Reasons the 2026.9.4 source can return that the PRD's list doesn't name.
    case 'managed-service-handoff-failed':
      return { text: "The gateway couldn't start its service's updater. Run this on the gateway host instead:", action: 'command', command: refusal.command ?? 'openclaw update' }
    case 'owner_required':
      return { text: "Only the gateway's owner can start an update.", action: 'none' }
    case 'invalid-update-target':
    case 'unsupported-update-target':
      return { text: "The gateway can't install the version it was asked for. Run this on the gateway host instead:", action: 'command', command: 'openclaw update' }
    // A package install whose package manager the gateway couldn't detect (seen live on an
    // isolated 2026.9.3 gateway; update-command-result's hint says to update it by hand).
    case 'not-git-install':
      return { text: "The gateway couldn't tell how OpenClaw was installed, so it can't update itself. Update it with your package manager on the gateway host, for example:", action: 'command', command: 'npm i -g openclaw@latest && openclaw gateway restart' }
    case 'update-target-upstream-mismatch':
      return { text: 'The version it was asked for comes from a different branch than the gateway follows.', action: 'viaAgent' }
    case 'rate-limited':
      return { text: `The gateway is busy. Try again in ${refusal.message ?? '60'}s.`, action: 'none' }
    case 'rpc-error':
      return { text: refusal.message ? withPeriod(refusal.message) : 'The request failed.', action: 'viaAgent' }
    default:
      return { text: `The gateway refused the update (${refusal.reason}).`, action: 'viaAgent' }
  }
}

function withPeriod(s: string): string {
  const t = s.trim()
  return /[.!?:]$/.test(t) ? t : `${t}.`
}

// ── Following a run ───────────────────────────────────────────────────────────────
//
// The gateway keeps a ledger of update runs (UpdateRunRecordSchema, 2026.9): the phase,
// the steps, the verification checks. `update.run.changed` (admin) says a run moved;
// `update.runs.get` reads the whole record. Each phase is also recorded as a step named
// after it, with its own status, which is how a finished run says where it failed.

export interface UpdateRunStep {
  step: string
  /** pending · in_progress · completed · failed · skipped */
  status: string
  detail?: string
  startedAtMs?: number
  endedAtMs?: number
}

export interface UpdateRun {
  runId: string
  createdAtMs: number
  updatedAtMs: number
  /** chat · control-ui · cli · campaign · mac-app · api */
  trigger: string
  /** requested → staging → validating → [repairing] → activating → restarting → verifying → finished */
  phase: string
  /** running · succeeded · failed · rolled-back · skipped */
  status: string
  reason: string | null
  target: { version?: string; sha?: string; channel?: string; tag?: string; kind?: string }
  before: { version?: string; sha?: string }
  after: { version?: string; sha?: string }
  steps: UpdateRunStep[]
  verification: {
    serviceRunning?: boolean
    versionMatch?: boolean
    pluginErrors?: string[]
    channelsReady?: boolean
    readyz?: boolean
    runningVersion?: string
  }
  repair: { attempt: number; status: string; summary?: string; reason?: string }[]
  finishedAtMs: number | null
  downtimeMs: number | null
  /** What the gateway suggests doing next, when it has a suggestion. */
  nextAction?: string
}

const MAX_STEPS = 128  // the schema's own cap

function version(v: unknown): { version?: string; sha?: string } {
  const r = obj(v)
  return { ...(str(r?.version) ? { version: r!.version as string } : {}), ...(str(r?.sha) ? { sha: r!.sha as string } : {}) }
}

/**
 * A run record from update.runs.get / runs.list / update.status. Unknown phases and
 * statuses are kept as strings (a newer gateway may add some); only a record without a
 * runId, phase or status is unreadable.
 */
export function parseRun(raw: unknown): UpdateRun | null {
  const r = obj(raw)
  const runId = str(r?.runId)
  if (!r || !runId || !str(r.phase) || !str(r.status)) return null
  const t = obj(r.target) ?? {}
  const v = obj(r.verification) ?? {}
  const o = obj(r.origin) ?? {}
  const steps: UpdateRunStep[] = (Array.isArray(r.steps) ? r.steps : []).map(obj)
    .filter((s): s is Record<string, unknown> => !!s && !!str(s.step))
    .slice(0, MAX_STEPS)
    .map(s => ({
      step: s.step as string,
      status: str(s.status) ?? 'pending',
      ...(str(s.detail) ? { detail: s.detail as string } : {}),
      ...(num(s.startedAtMs) !== undefined ? { startedAtMs: s.startedAtMs as number } : {}),
      ...(num(s.endedAtMs) !== undefined ? { endedAtMs: s.endedAtMs as number } : {}),
    }))
  const repair = (Array.isArray(r.repair) ? r.repair : []).map(obj)
    .filter((x): x is Record<string, unknown> => !!x)
    .map((x, i) => ({
      attempt: num(x.attempt) ?? i + 1,
      status: str(x.status) ?? 'failed',
      ...(str(x.summary) ? { summary: x.summary as string } : {}),
      ...(str(x.reason) ? { reason: x.reason as string } : {}),
    }))
  const bool = (k: string) => (typeof v[k] === 'boolean' ? { [k]: v[k] as boolean } : {})
  const pluginErrors = Array.isArray(v.pluginErrors) ? v.pluginErrors.filter((e): e is string => typeof e === 'string') : undefined
  return {
    runId,
    createdAtMs: num(r.createdAtMs) ?? 0,
    updatedAtMs: num(r.updatedAtMs) ?? num(r.createdAtMs) ?? 0,
    trigger: str(r.trigger) ?? 'api',
    phase: r.phase as string,
    status: r.status as string,
    reason: str(r.reason) ?? null,
    target: {
      ...(str(t.version) ? { version: t.version as string } : {}),
      ...(str(t.sha) ? { sha: t.sha as string } : {}),
      ...(str(t.channel) ? { channel: t.channel as string } : {}),
      ...(str(t.tag) ? { tag: t.tag as string } : {}),
      ...(str(t.kind) ? { kind: t.kind as string } : {}),
    },
    before: version(r.before),
    after: version(r.after),
    steps,
    verification: {
      ...bool('serviceRunning'), ...bool('versionMatch'), ...bool('channelsReady'), ...bool('readyz'),
      ...(pluginErrors ? { pluginErrors } : {}),
      ...(str(v.runningVersion) ? { runningVersion: v.runningVersion as string } : {}),
    },
    repair,
    finishedAtMs: num(r.finishedAtMs) ?? null,
    downtimeMs: num(r.downtimeMs) ?? null,
    ...(str(o.nextAction) ? { nextAction: o.nextAction as string } : {}),
  }
}

/** An `update.run.changed` event: `{runId, phase, status, updatedAtMs}`. */
export function parseRunChanged(raw: unknown): { runId: string; phase: string; status: string; updatedAtMs: number } | null {
  const r = obj(raw)
  if (!r || !str(r.runId) || !str(r.phase) || !str(r.status)) return null
  return { runId: r.runId as string, phase: r.phase as string, status: r.status as string, updatedAtMs: num(r.updatedAtMs) ?? 0 }
}

/**
 * Fold an event into the record we hold. Events carry no steps, so a run first seen
 * through an event starts as a stub, and a stale event never moves a newer record back.
 */
export function mergeRunChanged(run: UpdateRun | null, ev: { runId: string; phase: string; status: string; updatedAtMs: number }): UpdateRun {
  if (run && run.runId === ev.runId) {
    return ev.updatedAtMs < run.updatedAtMs ? run : { ...run, phase: ev.phase, status: ev.status, updatedAtMs: ev.updatedAtMs }
  }
  return {
    runId: ev.runId, createdAtMs: ev.updatedAtMs, updatedAtMs: ev.updatedAtMs, trigger: 'api',
    phase: ev.phase, status: ev.status, reason: null, target: {}, before: {}, after: {},
    steps: [], verification: {}, repair: [], finishedAtMs: null, downtimeMs: null,
  }
}

export const isTerminal = (status: string) => status !== 'running'

const PHASE_LABEL: Record<string, string> = {
  requested: 'Requested', staging: 'Staging', validating: 'Validating', repairing: 'Repairing',
  activating: 'Activating', restarting: 'Restarting', verifying: 'Verifying', finished: 'Finished',
}

/** A phase's label; an unknown one is shown as the gateway named it. */
export function phaseLabel(phase: string | undefined): string {
  if (!phase) return 'Requested'
  return PHASE_LABEL[phase] ?? phase.charAt(0).toUpperCase() + phase.slice(1)
}

export type PhaseMark = 'done' | 'current' | 'pending' | 'failed'

export interface PhaseProgress {
  phases: { id: string; label: string; mark: PhaseMark }[]
  completed: number
  total: number
  /** 0–100, or null (indeterminate) until the first phase is known. */
  pct: number | null
  /** The label for "Updating to X · {current}". */
  currentLabel: string
}

// The phases a run visibly moves through. "requested" is before the first of them and
// "finished" after the last. Repairing is shown only when a run actually enters it.
const VISIBLE_PHASES = ['staging', 'validating', 'activating', 'restarting', 'verifying']

/**
 * Where a run is, for the phase line: each visible phase marked done, current, pending or
 * failed, and "n of total" complete. A phase's own step (the ledger records one per phase)
 * is the best evidence; without steps (a run known only from events), the phase order is.
 */
export function phaseProgress(run: Pick<UpdateRun, 'phase' | 'status'> & { steps?: UpdateRunStep[] } | null): PhaseProgress {
  if (!run) {
    return { phases: VISIBLE_PHASES.map(id => ({ id, label: phaseLabel(id), mark: 'pending' as const })), completed: 0, total: VISIBLE_PHASES.length, pct: null, currentLabel: phaseLabel('requested') }
  }
  // A phase can be recorded more than once (verifying, then repairing, then verifying
  // again), so its latest step is the one that counts.
  const steps = [...(run.steps ?? [])].reverse()
  const stepOf = (id: string) => steps.find(s => s.step === id)
  const ids = [...VISIBLE_PHASES]
  if (run.phase === 'repairing' || stepOf('repairing')) {
    // The ledger repairs either a failed validation or a failed verification.
    ids.splice(stepOf('verifying') ? ids.indexOf('verifying') + 1 : ids.indexOf('validating') + 1, 0, 'repairing')
  }
  const terminal = isTerminal(run.status)
  const succeeded = run.status === 'succeeded'
  const at = ids.indexOf(run.phase)
  const phases = ids.map((id, i) => {
    const step = stepOf(id)
    let mark: PhaseMark
    if (step?.status === 'completed' || step?.status === 'skipped') mark = 'done'
    else if (step?.status === 'failed') mark = 'failed'
    else if (step?.status === 'in_progress') mark = terminal ? (succeeded ? 'done' : 'failed') : 'current'
    else if (run.phase === 'finished') mark = succeeded ? 'done' : 'pending'
    else if (at < 0) mark = 'pending'
    else if (i < at) mark = 'done'
    else if (i === at) mark = terminal ? (succeeded ? 'done' : 'failed') : 'current'
    else mark = 'pending'
    return { id, label: phaseLabel(id), mark }
  })
  // A rollback marks the phase it was in "completed" (finishUpdateRunRecord), so a run that
  // didn't succeed may show no failed phase at all. The last phase it reached is where it
  // stopped.
  // Only for a run that failed or rolled back: a refused (skipped) run stopped without
  // anything failing, and its skipped step must not read as a failure in History.
  if ((run.status === 'failed' || run.status === 'rolled-back') && !phases.some(p => p.mark === 'failed')) {
    const last = phases.map((p, i) => (p.mark === 'done' && stepOf(p.id) ? i : -1)).filter(i => i >= 0).pop()
    if (last !== undefined) phases[last] = { ...phases[last], mark: 'failed' }
  }
  const completed = phases.filter(p => p.mark === 'done').length
  return { phases, completed, total: ids.length, pct: Math.round((completed / ids.length) * 100), currentLabel: phaseLabel(run.phase) }
}

/** A run's state colour: working while running, done, failed (failed or rolled back), idle (skipped). */
export function runTone(status: string): StateTone {
  switch (status) {
    case 'running': return 'working'
    case 'succeeded': return 'done'
    case 'failed':
    case 'rolled-back': return 'failed'
    default: return 'idle'
  }
}

/** What the run was updating to, as best the record says. */
export function runTarget(run: Pick<UpdateRun, 'target' | 'after'>): string | undefined {
  return run.target.version ?? run.after.version ?? run.target.tag ?? (run.target.sha ? run.target.sha.slice(0, 7) : undefined)
}

// Skipped runs that are no-ops, not failures (update-outcome's SKIPPED_UPDATE_OUTCOMES,
// plus the ledger's own non-failures).
const NOOP_SKIPS = new Set(['managed-service-handoff-already-running', 'managed-service-handoff-cancelled', 'cancelled', 'dry-run', 'interrupted'])

/**
 * A finished run the gateway refused: every update.run call makes a ledger run, and a
 * refusal ends as `skipped` with its reason. One seen only through its record (started by
 * the CLI, or our reply lost in a drop) is shown with the same copy as a direct refusal.
 */
export function refusalFromRun(run: Pick<UpdateRun, 'status' | 'reason'>): Refusal | null {
  if (run.status !== 'skipped' || !run.reason || run.reason === 'already-current' || NOOP_SKIPS.has(run.reason)) return null
  return { reason: run.reason }
}

/** runs.get rejects a runId that isn't a UUID (UpdateRunRecordSchema's runId pattern). */
export function isRunId(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

/** How a finished run should be reported, or null when there's nothing to report (running, or a no-op). */
export function outcomeFromRun(run: UpdateRun, fallback: { target?: string; version?: string } = {}): Outcome | null {
  const target = runTarget(run) ?? fallback.target ?? 'the new version'
  switch (run.status) {
    case 'running':
      return null
    case 'succeeded':
      return { kind: 'ok', version: run.after.version ?? run.verification.runningVersion ?? run.target.version ?? fallback.version ?? target, downtimeMs: run.downtimeMs, runId: run.runId }
    case 'rolled-back':
      return { kind: 'rolled-back', target, ...(run.before.version ? { before: run.before.version } : {}), runId: run.runId }
    case 'skipped':
      // A refused run is reported as its refusal (refusalFromRun); a no-op as nothing.
      if (run.reason === 'already-current') return { kind: 'already-current', version: run.before.version ?? fallback.version ?? target, runId: run.runId }
      return null
    default:
      return { kind: 'failed', target, ...(run.before.version ? { before: run.before.version } : {}), runId: run.runId }
  }
}

/** "38s", "1m 04s", "1h 02m"; empty for no measurement. */
export function formatDowntime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** Plain-text banner copy for an outcome (the notification body uses it). */
export function outcomeText(o: Outcome): string {
  switch (o.kind) {
    case 'ok': {
      const down = formatDowntime(o.downtimeMs)
      return `Gateway updated to ${o.version}${down ? ` · down for ${down}` : ''}.`
    }
    case 'already-current': return `The gateway is already on ${o.version}.`
    case 'back-on': return `The gateway is back on ${o.version}.`
    case 'failed': return `The update to ${o.target} failed.${o.before ? ` The gateway is still on ${o.before}.` : ''}`
    case 'rolled-back': return `The update to ${o.target} didn't pass its checks and was rolled back${o.before ? ` to ${o.before}` : ''}.`
    case 'unconfirmed': return 'The update may still be running — check the Gateway tab.'
  }
}

/** Remember a result as shown, newest last, capped so the list can't grow forever. */
export function rememberSeen(seen: string[], runId: string, cap = 20): string[] {
  return [...seen.filter(id => id !== runId), runId].slice(-cap)
}

/** How an update we followed ended. Shown once, in the banner. */
export type Outcome =
  | { kind: 'ok'; version: string; downtimeMs?: number | null; runId?: string }
  | { kind: 'already-current'; version: string; runId?: string }
  /** No run record to read (an older gateway, or no admin): only the version it came back on. */
  | { kind: 'back-on'; version: string }
  | { kind: 'failed'; target: string; before?: string; runId?: string }
  | { kind: 'rolled-back'; target: string; before?: string; runId?: string }
  /**
   * We stopped waiting for update.run's reply and this gateway has no run ledger to ask
   * (before 2026.9): the update may well still be going, so this is neither a result nor
   * a refusal.
   */
  | { kind: 'unconfirmed'; target?: string }

/**
 * The result after a reconnect when there's no run record to read. If the gateway came
 * back on the version we were updating to, it worked. Otherwise all we can honestly say
 * is which version it's on now.
 */
export function inferOutcome(serverVersion: string | undefined, target: string | undefined): Outcome | null {
  if (!serverVersion) return null
  if (target && serverVersion === target) return { kind: 'ok', version: serverVersion }
  return { kind: 'back-on', version: serverVersion }
}

export interface RunningInput {
  target?: string
  /** The run's record, once known; the phase line is drawn from it. */
  run?: UpdateRun | null
  own?: boolean
  /** update.run's reply timed out, and the run is followed from the gateway's ledger instead. */
  slow?: boolean
}

export interface BannerInputs {
  available: UpdateAvailable | null
  /**
   * An update is under way: our update.run is in flight, or a run we follow hasn't ended.
   * `own` is false for a run started elsewhere (the CLI, the Control UI, a campaign).
   */
  running: RunningInput | null
  refusal: Refusal | null
  outcome: Outcome | null
  /** A latestVersion the user chose to skip (persisted). */
  skipped: string | null
  /** The key of the banner state the user dismissed this session. */
  dismissedKey: string | null
  /** The automatic-update schedule, for the campaign states. */
  schedule?: UpdateSchedule | null
  now?: number
}

export type BannerState =
  | { kind: 'hidden' }
  | { kind: 'available'; key: string; available: UpdateAvailable }
  | ({ kind: 'running'; key: string } & RunningInput)
  | { kind: 'refused'; key: string; refusal: Refusal }
  | { kind: 'result'; key: string; outcome: Outcome }
  | { kind: 'campaign'; key: string; countdown: CampaignCountdown; target?: string; campaignId: string; holdUsed: boolean }

/**
 * The one banner state to show. Precedence: running > refused > result > available.
 * Running can't be dismissed, because it explains the disconnect that's coming. Dismiss
 * hides the state it was pressed on (by key), so a later state, such as the run's
 * result, still shows. Skip only ever hides the notice for that one version.
 */
export function bannerState(i: BannerInputs): BannerState {
  if (i.running) return { kind: 'running', key: 'running', ...i.running }
  // An automatic update being applied is the same disconnect as ours, for every
  // connection: non-admin ones just get no phase detail.
  if (i.schedule?.campaign?.state === 'applying') {
    const target = i.schedule.targetVersion ?? i.available?.latestVersion
    return { kind: 'running', key: 'running', own: false, ...(target ? { target } : {}) }
  }
  const s = pickBannerState(i)
  return s.kind !== 'hidden' && s.key === i.dismissedKey ? { kind: 'hidden' } : s
}

function outcomeKey(o: Outcome): string {
  const id = 'runId' in o && o.runId ? o.runId : 'version' in o ? o.version : o.target ?? ''
  return `result:${o.kind}:${id}`
}

/** The banner key of the "update available" notice for a version. */
export function availableKey(latestVersion: string): string {
  return `available:${latestVersion}`
}

function pickBannerState(i: BannerInputs): BannerState {
  if (i.refusal) return { kind: 'refused', key: `refused:${i.refusal.reason}`, refusal: i.refusal }
  if (i.outcome) return { kind: 'result', key: outcomeKey(i.outcome), outcome: i.outcome }
  const c = i.schedule?.campaign
  const countdown = campaignCountdown(i.schedule ?? null, i.now ?? Date.now())
  if (c && countdown) {
    // Keyed by campaign, so a dismiss holds through its countdown → waiting → held changes.
    const target = i.schedule?.targetVersion ?? i.available?.latestVersion
    return { kind: 'campaign', key: `campaign:${c.id}`, countdown, campaignId: c.id, holdUsed: c.holdUntilMs !== undefined, ...(target ? { target } : {}) }
  }
  if (i.available && i.skipped !== i.available.latestVersion) {
    return { kind: 'available', key: availableKey(i.available.latestVersion), available: i.available }
  }
  return { kind: 'hidden' }
}

/**
 * The banner's colour, through stateTone: working for available and running, failed for a
 * refusal or a failed run, done for a success, idle for the neutral "back on {version}".
 */
export function bannerTone(s: BannerState): StateTone {
  switch (s.kind) {
    case 'refused': return 'failed'
    case 'campaign': return s.countdown.kind === 'held' ? 'idle' : 'needsYou'
    case 'result':
      if (s.outcome.kind === 'back-on' || s.outcome.kind === 'unconfirmed') return 'idle'
      return s.outcome.kind === 'failed' || s.outcome.kind === 'rolled-back' ? 'failed' : 'done'
    default: return 'working'
  }
}

// ── Automatic updates (campaigns) ─────────────────────────────────────────────────
//
// With update.auto.enabled, the gateway runs a campaign per new version: it waits for
// active work to finish (waiting-for-idle), counts down 60 s, then applies. A 15 min
// deadline (forceAtMs) starts it even if work remains. Hold defers it by an hour, once
// per campaign; the deadline moves to holdUntilMs + 15 min (UpdateCampaignController).

export type CampaignCountdown =
  | { kind: 'waiting'; ms: number }
  | { kind: 'countdown'; ms: number }
  | { kind: 'held'; untilMs: number }

/** What the campaign is counting down to, or null when there's no campaign to show (none, or applying). */
export function campaignCountdown(schedule: UpdateSchedule | null, now: number): CampaignCountdown | null {
  const c = schedule?.campaign
  if (!c || c.state === 'applying') return null
  if (c.holdUntilMs !== undefined && c.holdUntilMs > now) return { kind: 'held', untilMs: c.holdUntilMs }
  if (c.state === 'countdown' && c.applyAtMs !== undefined) return { kind: 'countdown', ms: Math.max(0, c.applyAtMs - now) }
  return { kind: 'waiting', ms: Math.max(0, c.forceAtMs - now) }
}

/** "0:48", "14:05", "75:00": minutes and seconds, clamped at 0:00. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "09:12", local time. */
export function formatHm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── History ───────────────────────────────────────────────────────────────────────

const TRIGGER_LABEL: Record<string, string> = {
  campaign: 'Automatic', chat: 'From a chat', 'control-ui': 'Control UI', cli: 'Command line', 'mac-app': 'Mac app',
}

/**
 * Who started a run. JoaxClaw's own calls are recorded as `api` (it isn't a browser
 * operator UI and passes no sessionKey), or as `campaign` when they adopt an automatic
 * update, so the runIds this app started are what tell them apart.
 */
export function triggerLabel(trigger: string, runId: string, ownRunIds: readonly string[]): string {
  if (ownRunIds.includes(runId)) return 'JoaxClaw'
  if (trigger === 'api') return 'App or API'
  return TRIGGER_LABEL[trigger] ?? trigger
}

const RESULT_LABEL: Record<string, string> = {
  running: 'Running', succeeded: 'Succeeded', failed: 'Failed', 'rolled-back': 'Rolled back', skipped: 'Skipped',
}

export function resultLabel(status: string): string {
  return RESULT_LABEL[status] ?? status
}

/** "2026.9.3 → 2026.9.4", or as much of it as the record knows. */
export function versionLine(run: Pick<UpdateRun, 'before' | 'after' | 'target'>): string {
  const from = run.before.version
  // The version it aimed at, not where it ended: a rollback ends where it started.
  const to = runTarget(run)
  if (from && to && from !== to) return `${from} → ${to}`
  return to ?? from ?? '—'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Today 09:12" or "Sep 11 02:00", local time. */
export function formatWhen(ms: number, now: number): string {
  const d = new Date(ms)
  const n = new Date(now)
  const today = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return `${today ? 'Today' : `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`} ${formatHm(ms)}`
}

export type CheckValue = 'Passed' | 'Failed' | 'Not checked'

/** The verification checks, in the Control UI's order. */
export function verificationChecks(v: UpdateRun['verification']): { label: string; value: CheckValue; note?: string }[] {
  const b = (x: boolean | undefined): CheckValue => (x === undefined ? 'Not checked' : x ? 'Passed' : 'Failed')
  const errors = v.pluginErrors
  return [
    { label: 'Service', value: b(v.serviceRunning) },
    { label: 'Version', value: b(v.versionMatch) },
    {
      label: 'Plugins',
      value: errors === undefined ? 'Not checked' : errors.length ? 'Failed' : 'Passed',
      ...(errors?.length ? { note: errors.length === 1 ? '1 error' : `${errors.length} errors` } : {}),
    },
    { label: 'Channels', value: b(v.channelsReady) },
    { label: 'Ready', value: b(v.readyz) },
  ]
}

const esc = (s: string) => s.replace(/`/g, '\\`')
const code = (s: string) => '`' + s.replace(/`/g, "'") + '`'

/**
 * A failed run as Markdown, for pasting into an issue: the versions, who started it, the
 * reason, the failed steps with their detail, the checks, and any repair attempts.
 * Gateway text is escaped so a backtick in it can't break the formatting.
 */
export function failureMarkdown(run: UpdateRun, startedBy: string): string {
  const lines = [
    `### OpenClaw update: ${resultLabel(run.status).toLowerCase()}`,
    '',
    `- **Version:** ${esc(versionLine(run))}`,
    `- **Started by:** ${esc(startedBy)}`,
    `- **When:** ${new Date(run.createdAtMs).toISOString()}`,
    ...(run.reason ? [`- **Reason:** ${code(run.reason)}`] : []),
    `- **Run:** ${code(run.runId)}`,
  ]
  const failed = run.steps.filter(s => s.status === 'failed')
  if (failed.length) {
    lines.push('', '**Failed steps**', ...failed.map(s => `- ${code(s.step)}${s.detail ? `: ${esc(s.detail)}` : ''}`))
  }
  lines.push('', '**Checks**', ...verificationChecks(run.verification).map(c => `- ${c.label}: ${c.value}${c.note ? ` (${c.note})` : ''}`))
  for (const e of run.verification.pluginErrors ?? []) lines.push(`  - ${esc(e)}`)
  if (run.repair.length) {
    lines.push('', '**Repair attempts**', ...run.repair.map(r => `- #${r.attempt} ${r.status}${r.summary ? `: ${esc(r.summary)}` : ''}${r.reason ? ` (${esc(r.reason)})` : ''}`))
  }
  if (run.nextAction) lines.push('', `**Suggested next step:** ${esc(run.nextAction)}`)
  return lines.join('\n')
}

/** Only a failed or rolled-back run has failure details worth copying or reporting. */
export const isFailedRun = (run: Pick<UpdateRun, 'status'>) => run.status === 'failed' || run.status === 'rolled-back'

export interface ReportPreview { attemptId: string; title: string; body: string; previewDigest: string }

/** `update.report {action:"preview"}` → `{status:"ready", attemptId, title, body, previewDigest}`. */
export function parseReportPreview(raw: unknown): ReportPreview | null {
  const r = obj(raw)
  if (r?.status !== 'ready' || !str(r.title) || typeof r.body !== 'string' || !str(r.previewDigest)) return null
  return { attemptId: str(r.attemptId) ?? '', title: r.title as string, body: r.body as string, previewDigest: r.previewDigest as string }
}

export interface ReportResult { status: string; message?: string; url?: string; fallbackUrl?: string }

/** `update.report {action:"submit"}` → created · fallback · pending · retryable · duplicate. */
export function parseReportResult(raw: unknown): ReportResult | null {
  const r = obj(raw)
  const status = str(r?.status)
  if (!r || !status) return null
  // Only http(s) links are ever made clickable.
  const link = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : undefined)
  const url = link(r.url)
  const fallbackUrl = link(r.fallbackUrl)
  return { status, ...(str(r.message) ? { message: r.message as string } : {}), ...(url ? { url } : {}), ...(fallbackUrl ? { fallbackUrl } : {}) }
}

/** The default release channels go unnamed; any other (beta, dev) is worth saying. */
export function showChannel(channel: string | undefined): boolean {
  return !!channel && !['stable', 'latest', 'release'].includes(channel)
}

/** "1 chat is running now." / "2 chats are running now." — or nothing for none. */
export function runningChatsLine(n: number): string | null {
  if (n <= 0) return null
  return n === 1 ? '1 chat is running now.' : `${n} chats are running now.`
}
