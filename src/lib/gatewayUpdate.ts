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

/** How an update we followed ended. Shown once, in the banner. */
export type Outcome =
  | { kind: 'ok'; version: string; downtimeMs?: number | null; runId?: string }
  | { kind: 'already-current'; version: string; runId?: string }
  /** No run record to read (an older gateway, or no admin): only the version it came back on. */
  | { kind: 'back-on'; version: string }

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

export interface BannerInputs {
  available: UpdateAvailable | null
  /** An update.run call is in flight, or the run it started hasn't ended yet. */
  running: { target?: string; phase?: string } | null
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
  | { kind: 'running'; key: string; target?: string; phase?: string }
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

/** The banner key of the "update available" notice for a version. */
export function availableKey(latestVersion: string): string {
  return `available:${latestVersion}`
}

function pickBannerState(i: BannerInputs): BannerState {
  if (i.refusal) return { kind: 'refused', key: `refused:${i.refusal.reason}`, refusal: i.refusal }
  if (i.outcome) return { kind: 'result', key: `result:${i.outcome.kind}:${i.outcome.version}`, outcome: i.outcome }
  if (i.available && i.skipped !== i.available.latestVersion) {
    return { kind: 'available', key: availableKey(i.available.latestVersion), available: i.available }
  }
  return { kind: 'hidden' }
}

/**
 * The banner's colour, through stateTone: working for available and running, failed for a
 * refusal, done for a success, idle for the neutral "back on {version}".
 */
export function bannerTone(s: BannerState): StateTone {
  switch (s.kind) {
    case 'refused': return 'failed'
    case 'result': return s.outcome.kind === 'back-on' ? 'idle' : 'done'
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
