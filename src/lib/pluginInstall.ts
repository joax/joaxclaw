// One install flow for every place that installs a plugin: the Browse modal, the channel
// form and Meetings setup.
//
// `plugins.install` never restarts the gateway. It always answers `restartRequired: true`
// and leaves the restart to the client, which is how OpenClaw's own Control UI does it:
// install → `gateway.restart.request` → wait for a hello-ok with a NEW `server.bootId` →
// re-read `plugins.list` to see what the plugin actually came up as. Before this, the app
// stopped after the first step and told you to restart the gateway yourself, which on a
// remote gateway meant an agent chat.
//
// The install can be refused three ways, and the gateway fills `details` in this order
// (plugins-mutations.ts): capability consent, then the install policy, then ClawHub trust.
// The first two are questions for a person and retry with an acknowledgement; the third
// is a verdict and doesn't retry.

import type { ConsentRequired, InstallParams } from './pluginCatalog'
import { readConsentRequired } from './pluginCatalog'

/** What to install, and how to talk about it. */
export interface InstallTarget {
  /** The identifying half of `plugins.install`, without any acknowledgement. */
  params: InstallParams
  /** The plugin's name as the user knows it ("Slack", "Zoom meetings"). */
  displayName: string
  /** The runtime id, when known up front. The install result's `plugin.id` wins. */
  pluginId?: string
  /**
   * Who started it (`channel:slack`, `browser`, `meetings`). A restart unmounts every view,
   * and this is how the one that started the install finds its way back to the result.
   */
  origin?: string
}

export function officialTarget(pluginId: string, displayName: string, origin?: string): InstallTarget {
  return { params: { source: 'official', pluginId }, displayName, pluginId, ...(origin ? { origin } : {}) }
}

export function clawhubTarget(packageName: string, displayName: string, opts: { version?: string; pluginId?: string; origin?: string } = {}): InstallTarget {
  return {
    params: { source: 'clawhub', packageName, ...(opts.version ? { version: opts.version } : {}) },
    displayName,
    ...(opts.pluginId ? { pluginId: opts.pluginId } : {}),
    ...(opts.origin ? { origin: opts.origin } : {}),
  }
}

/** Acknowledgements collected so far. A plugin can need both, one after the other. */
export interface InstallAcks {
  reviewToken?: string
  policyAck?: boolean
}

/**
 * The params for one attempt: the target's identity plus every acknowledgement gathered.
 * Both are carried together, because the gateway re-checks consent before the policy on
 * every attempt; dropping the first on the retry for the second would ask again.
 */
export function withAcks(params: InstallParams, acks: InstallAcks): Record<string, unknown> {
  return {
    ...params,
    ...(acks.policyAck ? { acknowledgeInstallPolicyWarning: true } : {}),
    ...(acks.reviewToken ? { acknowledgeCapabilities: { reviewToken: acks.reviewToken } } : {}),
  }
}

// ── Refusals ─────────────────────────────────────────────────────────────────

export type FindingSeverity = 'info' | 'warn' | 'critical'

export interface PolicyFinding {
  ruleId: string
  severity: FindingSeverity
  message: string
  file?: string
  line?: number
  evidence?: string
}

export interface InstallPolicyWarning {
  targetName: string
  reason: string
  findings: PolicyFinding[]
}

/**
 * The install-policy question inside a refusal, or null.
 *
 * The gateway's own reader rejects the whole warning over one malformed finding. Here a
 * bad finding is dropped instead: the reason is what the person needs to decide, and
 * losing it would turn a question into a raw error, which is what the app showed before.
 */
export function readInstallPolicyWarning(error: unknown): InstallPolicyWarning | null {
  const details = asRecord(asRecord(error)?.details)
  if (!details || details.installPolicyCode !== 'install_policy_warning_acknowledgement_required') return null
  const reason = str(details.reason)
  if (!reason) return null
  const findings: PolicyFinding[] = []
  if (Array.isArray(details.findings)) {
    for (const f of details.findings) {
      const r = asRecord(f)
      const ruleId = str(r?.ruleId)
      const message = str(r?.message)
      const severity = r?.severity
      if (!r || !ruleId || !message || (severity !== 'info' && severity !== 'warn' && severity !== 'critical')) continue
      findings.push({
        ruleId, severity, message,
        ...(str(r.file) ? { file: str(r.file)! } : {}),
        ...(typeof r.line === 'number' && Number.isSafeInteger(r.line) && r.line > 0 ? { line: r.line } : {}),
        ...(str(r.evidence) ? { evidence: str(r.evidence)! } : {}),
      })
    }
  }
  return { targetName: str(details.targetName) ?? '', reason, findings }
}

/** True when any finding is critical: the Continue button then uses the danger style. */
export function hasCriticalFinding(w: InstallPolicyWarning | null | undefined): boolean {
  return !!w?.findings.some(f => f.severity === 'critical')
}

/** "scripts/postinstall.js:3", "README.md", or "" when the finding names no file. */
export function findingLocation(f: PolicyFinding): string {
  if (!f.file) return ''
  return f.line ? `${f.file}:${f.line}` : f.file
}

export type TrustCode = 'clawhub_security_unavailable' | 'clawhub_download_blocked'

export interface TrustRefusal {
  code?: TrustCode
  version?: string
  warning?: string
}

/** ClawHub's security verdict inside a refusal, or null. */
export function readTrustRefusal(error: unknown): TrustRefusal | null {
  const details = asRecord(asRecord(error)?.details)
  if (!details) return null
  const code = details.clawhubTrustCode === 'clawhub_security_unavailable' || details.clawhubTrustCode === 'clawhub_download_blocked'
    ? details.clawhubTrustCode : undefined
  const version = str(details.version)
  const warning = str(details.warning)
  if (!code && !version && !warning) return null
  return { ...(code ? { code } : {}), ...(version ? { version } : {}), ...(warning ? { warning } : {}) }
}

export type InstallRefusal =
  | { kind: 'consent'; challenge: ConsentRequired }
  | { kind: 'policy'; warning: InstallPolicyWarning }
  | { kind: 'trust'; message: string }
  | { kind: 'dropped' }
  | { kind: 'error'; message: string }

/** Messages the client itself rejects pending requests with when the socket goes away. */
const DROPPED = /^(Connection closed|Disconnected)$/

/**
 * What a failed `plugins.install` means, in the gateway's precedence order. `message` is
 * the readable text of the error; `error` is the structured `{ code, message, details }`.
 */
export function classifyInstallError(error: unknown, message: string): InstallRefusal {
  const challenge = readConsentRequired(error)
  if (challenge) return { kind: 'consent', challenge }
  const warning = readInstallPolicyWarning(error)
  if (warning) return { kind: 'policy', warning }
  const trust = readTrustRefusal(error)
  if (trust) return { kind: 'trust', message: trust.warning ?? message }
  // The socket dropped with the request in flight. The install may or may not have
  // happened, so this can't be reported as a failure of the install.
  if (DROPPED.test(message.trim())) return { kind: 'dropped' }
  return { kind: 'error', message }
}

// ── After the restart ──────────────────────────────────────────────────────────

/** How long to wait for the gateway to come back before offering Try again. */
export const RESTART_TIMEOUT_MS = 90_000
/**
 * A "deferred" restart waits for the gateway's running work (chat runs, cron jobs,
 * background tasks) to finish first, which can take much longer than a restart does.
 */
export const DEFERRED_RESTART_TIMEOUT_MS = 10 * 60_000

/**
 * Whether the connection that just came up is the restarted gateway.
 *
 * The Control UI compares hello-ok's `server.bootId`, which changes on every process
 * start, so a network blip that reconnects to the same process isn't mistaken for the
 * restart. A gateway that doesn't send a bootId falls back to "a new connection".
 */
export function restartCompleted(a: { bootIdBefore?: string; bootIdNow?: string; seqBefore: number; seqNow: number }): boolean {
  if (a.seqNow <= a.seqBefore) return false
  if (a.bootIdBefore && a.bootIdNow) return a.bootIdNow !== a.bootIdBefore
  return true
}

export type InstallOutcome = 'enabled' | 'needs-setup' | 'disabled' | 'error' | 'missing'

/** What the plugin came up as, from a `plugins.list` result. */
export function installedOutcome(listResult: unknown, pluginId: string): { outcome: InstallOutcome; error?: string } {
  const list = asRecord(listResult)?.plugins
  const hit = (Array.isArray(list) ? list : []).map(asRecord).find(e => e?.id === pluginId)
  if (!hit || hit.installed === false || hit.state === 'not-installed') return { outcome: 'missing' }
  if (hit.state === 'error') return { outcome: 'error', ...(str(hit.error) ? { error: str(hit.error)! } : {}) }
  if (hit.state === 'needs-setup') return { outcome: 'needs-setup' }
  if (hit.state === 'disabled' || hit.enabled === false) return { outcome: 'disabled' }
  return { outcome: 'enabled' }
}

// ── The run ──────────────────────────────────────────────────────────────────

export type InstallPhase = 'installing' | 'consent' | 'review' | 'restarting' | 'verifying' | 'done' | 'failed'

/** Why a run failed, which decides the copy and whether Try again restarts or reinstalls. */
export type InstallFailure = 'install' | 'trust' | 'dropped' | 'restart' | 'timeout' | 'missing'

export interface InstallRun {
  target: InstallTarget
  phase: InstallPhase
  acks: InstallAcks
  /** The plugin's runtime id, once known. */
  pluginId?: string
  outcome?: InstallOutcome
  /** The gateway's text, for failures and the plugin's own error state. */
  message?: string
  failure?: InstallFailure
  /** The restart was accepted but waits for running work to finish. */
  deferred?: boolean
}

export type Tone = 'working' | 'needsYou' | 'failed' | 'done'

/**
 * The inline line a run shows where it was started. Null while a dialog is asking the
 * question (consent, review): the dialog is the status then.
 */
export function runStatusLine(run: InstallRun): { tone: Tone; text: string; retry?: boolean } | null {
  const name = run.target.displayName
  switch (run.phase) {
    case 'installing': return { tone: 'working', text: 'Installing…' }
    case 'consent':
    case 'review': return null
    case 'restarting':
      return run.deferred
        ? { tone: 'working', text: `Installed ${name}. The gateway restarts to load it once the work it's running finishes.` }
        : { tone: 'working', text: `Restarting the gateway to load ${name}…` }
    case 'verifying': return { tone: 'working', text: `Checking ${name}…` }
    case 'done':
      switch (run.outcome) {
        case 'needs-setup': return { tone: 'needsYou', text: `Installed. ${name} needs setup before it works.` }
        case 'disabled': return { tone: 'needsYou', text: `Installed, but ${name} is switched off. Turn it on under Extensions → Plugins.` }
        case 'error': return { tone: 'failed', text: `Installed, but ${name} failed to load${run.message ? `: ${run.message}` : '.'}` }
        default: return { tone: 'done', text: `Installed. ${name} is ready.` }
      }
    case 'failed':
      switch (run.failure) {
        case 'trust': return { tone: 'failed', text: `ClawHub blocked this download: ${run.message ?? 'no reason given'}` }
        case 'dropped': return { tone: 'failed', text: `The connection dropped while installing ${name}. Check the plugin list, then try again.`, retry: true }
        case 'restart': return { tone: 'failed', text: `Installed ${name}, but the gateway couldn't restart: ${run.message ?? 'unknown error'}. Restart it from the Gateway tab.`, retry: true }
        case 'timeout': return { tone: 'failed', text: `The gateway didn't come back after installing ${name}. Check it on the Gateway tab, then try again.`, retry: true }
        case 'missing': return { tone: 'failed', text: `The gateway restarted, but ${name} isn't listed as installed. Try again.`, retry: true }
        default: return { tone: 'failed', text: run.message ?? `Couldn't install ${name}.` }
      }
  }
}

/** Heading and detail for the reconnect overlay while the gateway restarts. */
export function restartOverlayCopy(name: string): { reason: string; detail: string } {
  return {
    reason: `Restarting to finish installing ${name}`,
    detail: 'The gateway restarts to load new plugins. It usually takes a few seconds. JoaxClaw reconnects on its own.',
  }
}

/** The reason recorded in the gateway's restart log. Matches the Control UI's. */
export const RESTART_REASON = 'Apply an installed plugin change'

function asRecord(v: unknown): Record<string, unknown> | null {
  return !!v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
