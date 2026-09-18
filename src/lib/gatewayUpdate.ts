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
  | { kind: 'started'; runId: string }
  | { kind: 'already-current'; runId?: string }
  | { kind: 'refused'; runId?: string; refusal: Refusal }

/**
 * Read an `update.run` reply. It is a *successful* RPC either way: `ok:false` with
 * `result.reason` is a refusal (restarts off, an outside supervisor, another update
 * running…), and `already-current` is a no-op, not a failure. For a managed service,
 * `ok:true` means the detached updater took over and the run carries on without us.
 */
export function parseRunResponse(raw: unknown): RunResponse {
  const r = obj(raw) ?? {}
  const runId = str(r.runId)
  const result = obj(r.result)
  const handoff = obj(r.handoff)
  const reason = str(result?.reason) ?? str(r.code)
  if (reason === 'already-current') return { kind: 'already-current', ...(runId ? { runId } : {}) }
  if (r.ok === true && runId) return { kind: 'started', runId }
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
  if (ge?.code === 'UNAVAILABLE' && retryAfterMs !== undefined) {
    return { reason: 'rate-limited', message: String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }
  }
  const message = str(ge?.message) ?? (err instanceof Error ? str(err.message) : str(err))
  return { reason: 'rpc-error', ...(message ? { message } : {}) }
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
  const steps = run.steps ?? []
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
      if (run.reason === 'already-current') return { kind: 'already-current', version: run.before.version ?? fallback.version ?? target, runId: run.runId }
      if (run.reason && NOOP_SKIPS.has(run.reason)) return null
      return { kind: 'failed', target, ...(run.before.version ? { before: run.before.version } : {}), runId: run.runId }
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
}

export type BannerState =
  | { kind: 'hidden' }
  | { kind: 'available'; key: string; available: UpdateAvailable }
  | ({ kind: 'running'; key: string } & RunningInput)
  | { kind: 'refused'; key: string; refusal: Refusal }
  | { kind: 'result'; key: string; outcome: Outcome }

/**
 * The one banner state to show. Precedence: running > refused > result > available.
 * Running can't be dismissed, because it explains the disconnect that's coming. Dismiss
 * hides the state it was pressed on (by key), so a later state, such as the run's
 * result, still shows. Skip only ever hides the notice for that one version.
 */
export function bannerState(i: BannerInputs): BannerState {
  if (i.running) return { kind: 'running', key: 'running', ...i.running }
  const s = pickBannerState(i)
  return s.kind !== 'hidden' && s.key === i.dismissedKey ? { kind: 'hidden' } : s
}

function outcomeKey(o: Outcome): string {
  const id = 'runId' in o && o.runId ? o.runId : 'version' in o ? o.version : o.target
  return `result:${o.kind}:${id}`
}

/** The banner key of the "update available" notice for a version. */
export function availableKey(latestVersion: string): string {
  return `available:${latestVersion}`
}

function pickBannerState(i: BannerInputs): BannerState {
  if (i.refusal) return { kind: 'refused', key: `refused:${i.refusal.reason}`, refusal: i.refusal }
  if (i.outcome) return { kind: 'result', key: outcomeKey(i.outcome), outcome: i.outcome }
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
    case 'result':
      if (s.outcome.kind === 'back-on') return 'idle'
      return s.outcome.kind === 'failed' || s.outcome.kind === 'rolled-back' ? 'failed' : 'done'
    default: return 'working'
  }
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
