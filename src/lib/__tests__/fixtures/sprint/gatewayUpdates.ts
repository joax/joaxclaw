// Real gateway payloads for PRD 02 "Gateway updates, done properly" (QA, sprint 2026.9).
// Shapes come from the OpenClaw 2026.9.4 compiled source (…/scratchpad/gw/2026.9.4/package/dist);
// 2026.6.5 variants come from the globally installed openclaw
// (~/.nvm/versions/node/v24.14.0/lib/node_modules/openclaw/dist). Every interface cites the
// schema or handler it mirrors. Values are realistic (UUIDv4 runIds that pass the gateway's
// runId pattern, ms timestamps around 2026-09-18) but invented.
//
// Key facts these fixtures encode (see the QA checklist for the implications):
// - A terminal RunRecord always has phase "finished" (update-run-record-DyYy8-Zk.mjs:983);
//   which phase failed is only visible in `steps[]` (phase-named steps).
// - Every update.run call creates a ledger run, so refusals also return a runId and show up
//   in update.runs.list as status "skipped"/"failed" (update-C1wfgEl4.mjs:473,782).
// - `ok` is true for a managed-service handoff even though result.status is "skipped"
//   (update-C1wfgEl4.mjs:847); "already-current" comes back with ok:false.
// - update.status on 2026.6.5 returns only { sentinel } (no updateAvailable at all).

/* ────────────────────────────── shared constants ────────────────────────────── */

/** 2026-09-18T09:00:00Z-ish. */
export const NOW_MS = 1789722000000

/** dist/update-run-vocabulary-BYZF4sMi.mjs:2 — ordered; "repairing" sits between validating and activating. */
export const UPDATE_RUN_PHASES = ['requested', 'staging', 'validating', 'repairing', 'activating', 'restarting', 'verifying', 'finished'] as const
/** dist/update-run-vocabulary-BYZF4sMi.mjs:12 */
export const UPDATE_RUN_STATUSES = ['running', 'succeeded', 'failed', 'rolled-back', 'skipped'] as const
/** dist/update-run-vocabulary-BYZF4sMi.mjs:19 */
export const UPDATE_RUN_TRIGGERS = ['chat', 'control-ui', 'cli', 'campaign', 'mac-app', 'api'] as const
/** dist/update-run-vocabulary-BYZF4sMi.mjs:27 */
export const UPDATE_RUN_STEP_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'skipped'] as const

export type UpdateRunPhase = typeof UPDATE_RUN_PHASES[number]
export type UpdateRunStatus = typeof UPDATE_RUN_STATUSES[number]
export type UpdateRunTrigger = typeof UPDATE_RUN_TRIGGERS[number]
export type UpdateRunStepStatus = typeof UPDATE_RUN_STEP_STATUSES[number]

/** Campaign timing constants. dist/update-startup-B5Y6Lfsz.mjs:32-35 */
export const CAMPAIGN_FORCE_DELAY_MS = 900_000
export const CAMPAIGN_COUNTDOWN_MS = 60_000
export const CAMPAIGN_HOLD_MS = 3_600_000
/** Watcher poll that emits update.run.changed. dist/update-run-watcher-9rRNscAX.mjs:7 */
export const UPDATE_RUN_WATCHER_POLL_MS = 2_000
/** Control-plane write budget (update.run, update.hold, update.report). dist/control-plane-rate-limit-CUfpYCsm.mjs:3 + :38 */
export const CONTROL_PLANE_WRITES_PER_WINDOW = 30
export const CONTROL_PLANE_RATE_LIMIT_WINDOW_MS = 60_000

/** runId pattern from UpdateRunRecordSchema. dist/sessions-rlbLHLas.mjs:531 */
export const RUN_ID_PATTERN = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

export const RUN_IDS = {
  ours: '3f6c1e2a-8b4d-4c7e-9a15-2d0b7e6f4a91',
  oursRolledBack: '7a2e9c40-15d3-4f8b-b6e2-90c4d1a3e5f7',
  campaign: 'c91d4b7e-2a6f-4e03-8d5c-1b7f0e9a2c46',
  cli: '0e5b8d21-7c94-4a6f-a3b0-5d2e8f1c7a90',
  controlUi: '5d3a0f8e-6b21-4c9d-8e47-a2f1b0c9d3e6',
  failed: 'b4e7c2d9-3f10-4a85-9c6b-e0d2a7f5b1c3',
  refused: '9c0f6a3b-d2e8-4b71-a5c4-3e9d1f0b8a27',
  alreadyCurrent: 'e2a1b9f7-4c3d-4e6a-b8f0-7d5c2a9e1b34',
  abandoned: '1b8e3f5c-0a9d-4d27-8c61-f4e2b7a0d953',
  unknown: 'f0e1d2c3-b4a5-4968-8776-655443322110',
} as const

/* ────────────────────────────── availability + schedule ────────────────────────────── */

/** UpdateCommitSchema. dist/sessions-rlbLHLas.mjs:707 */
export interface UpdateCommit { sha: string; subject: string /* ≤120 chars */ }

/**
 * UpdateAvailableSchema (closed). dist/sessions-rlbLHLas.mjs:712. Clients without operator.read
 * (write implies read) get only the first three fields: projectUpdateAvailable,
 * dist/events-Dk8ohZI-.mjs:20.
 */
export interface UpdateAvailable {
  currentVersion: string
  latestVersion: string
  channel: string
  currentSha?: string
  upstreamRef?: string
  upstreamSha?: string
  commitsBehind?: number
  commits?: UpdateCommit[] // maxItems 5
}

/** GitUpdateStatusSchema (union on `status`). dist/sessions-rlbLHLas.mjs:727 */
export type GitUpdateStatus =
  | { status: 'current'; currentSha?: string; commitAtMs?: number; installedAtMs?: number }
  | { status: 'behind'; commitsBehind: number; currentSha?: string; commitAtMs?: number; installedAtMs?: number }
  | { status: 'ahead'; commitsAhead: number; currentSha?: string; commitAtMs?: number; installedAtMs?: number }
  | { status: 'diverged'; commitsAhead: number; commitsBehind: number; currentSha?: string; commitAtMs?: number; installedAtMs?: number }
  | { status: 'unavailable'; reason: 'fetch-failed' | 'no-upstream' | 'no-upstream-sha' | 'comparison-failed' | 'git-unavailable'; currentSha?: string; commitAtMs?: number; installedAtMs?: number }

/**
 * Campaign inside the schedule. dist/sessions-rlbLHLas.mjs:781. There is NO "held" state:
 * a hold sets state "waiting-for-idle" + holdUntilMs, and holdUntilMs stays on the campaign
 * after it expires (dist/update-startup-B5Y6Lfsz.mjs:103-110,152,181).
 */
export interface UpdateCampaign {
  id: string
  state: 'waiting-for-idle' | 'countdown' | 'applying'
  announcedAtMs: number
  applyAtMs?: number // only once state reached "countdown"
  holdUntilMs?: number
  forceAtMs: number
  updatedAtMs: number
}

/** UpdateScheduleStateSchema (closed). dist/sessions-rlbLHLas.mjs:761 */
export interface UpdateSchedule {
  channel: string
  autoEnabled: boolean
  install?: { kind: 'package' | 'git' | 'unknown'; git?: GitUpdateStatus }
  target?:
    | { kind: 'package'; version: string }
    | { kind: 'git'; upstreamRef: string; upstreamSha: string; commitsBehind: number }
  campaign?: UpdateCampaign
}

export const availableFull: UpdateAvailable = {
  currentVersion: '2026.9.4',
  latestVersion: '2026.9.5',
  channel: 'stable',
}

/** Beta channel: the banner shows "(beta)". */
export const availableBeta: UpdateAvailable = {
  currentVersion: '2026.9.4',
  latestVersion: '2026.9.6-beta.2',
  channel: 'beta',
}

/** Dev git checkout, full detail (read-capable client). */
export const availableDevGit: UpdateAvailable = {
  currentVersion: '2026.9.4',
  latestVersion: '2026.9.4',
  channel: 'dev',
  currentSha: '4d8e2b1f9a0c7e6d5b4a3c2e1f0d9b8a7c6e5f4d',
  upstreamRef: 'origin/main',
  upstreamSha: 'a1c3e5f7092b4d6f8a0c2e4f6b8d0a2c4e6f8b0d',
  commitsBehind: 7,
  commits: [
    { sha: 'a1c3e5f7092b4d6f8a0c2e4f6b8d0a2c4e6f8b0d', subject: 'fix(update): keep campaign target pinned during countdown' },
    { sha: 'b2d4f6a8103c5e7a9b1d3f5a7c9e1b3d5f7a9c1e', subject: 'feat(gateway): progress cards for agent scopes' },
    { sha: 'c3e5a7b9214d6f8b0c2e4a6b8d0f2c4e6a8b0d2f', subject: 'chore(deps): bump typebox' },
    { sha: 'd4f6b8c0325e7a9c1d3f5b7c9e1a3d5f7b9c1e3a', subject: 'docs: automatic updates' },
    { sha: 'e5a7c9d1436f8b0d2e4a6c8d0f2b4e6a8c0d2f4b', subject: 'x'.repeat(120) },
  ],
}

/** Same availability projected for a client without operator.read (dist/events-Dk8ohZI-.mjs:22-26). */
export const availableReduced: UpdateAvailable = {
  currentVersion: availableDevGit.currentVersion,
  latestVersion: availableDevGit.latestVersion,
  channel: availableDevGit.channel,
}

export const scheduleNoCampaign: UpdateSchedule = {
  channel: 'stable',
  autoEnabled: false,
  install: { kind: 'package' },
  target: { kind: 'package', version: '2026.9.5' },
}

/** Just announced; waits for idle, forced 15 min after announcement (update-startup-B5Y6Lfsz.mjs:67-73). */
export const campaignWaiting: UpdateCampaign = {
  id: '6e0a2d4f-8b1c-4e3a-9f57-c2d8b0e4a619',
  state: 'waiting-for-idle',
  announcedAtMs: NOW_MS - 120_000,
  forceAtMs: NOW_MS - 120_000 + CAMPAIGN_FORCE_DELAY_MS,
  updatedAtMs: NOW_MS - 120_000,
}

/** Idle reached: 60 s countdown, applyAtMs 48 s from NOW_MS (update-startup-B5Y6Lfsz.mjs:147-155). */
export const campaignCountdown: UpdateCampaign = {
  id: campaignWaiting.id,
  state: 'countdown',
  announcedAtMs: campaignWaiting.announcedAtMs,
  applyAtMs: NOW_MS + 48_000,
  forceAtMs: campaignWaiting.forceAtMs,
  updatedAtMs: NOW_MS - 12_000,
}

/** After update.hold: back to waiting-for-idle, holdUntilMs = now+1h, forceAtMs = hold+15m (:101-110). */
export const campaignHeld: UpdateCampaign = {
  id: campaignWaiting.id,
  state: 'waiting-for-idle',
  announcedAtMs: campaignWaiting.announcedAtMs,
  holdUntilMs: NOW_MS + CAMPAIGN_HOLD_MS,
  forceAtMs: NOW_MS + CAMPAIGN_HOLD_MS + CAMPAIGN_FORCE_DELAY_MS,
  updatedAtMs: NOW_MS,
}

/** Hold expired, now counting down; holdUntilMs (past) is carried along (:152). Hold must stay hidden. */
export const campaignCountdownAfterHold: UpdateCampaign = {
  id: campaignWaiting.id,
  state: 'countdown',
  announcedAtMs: campaignWaiting.announcedAtMs,
  applyAtMs: NOW_MS + CAMPAIGN_HOLD_MS + 30_000,
  holdUntilMs: NOW_MS + CAMPAIGN_HOLD_MS,
  forceAtMs: NOW_MS + CAMPAIGN_HOLD_MS + CAMPAIGN_FORCE_DELAY_MS,
  updatedAtMs: NOW_MS + CAMPAIGN_HOLD_MS + 5_000,
}

/** Applying: no applyAtMs (beginApplying drops it, :177-184). */
export const campaignApplying: UpdateCampaign = {
  id: campaignWaiting.id,
  state: 'applying',
  announcedAtMs: campaignWaiting.announcedAtMs,
  forceAtMs: campaignWaiting.forceAtMs,
  updatedAtMs: NOW_MS + 48_000,
}

const withCampaign = (campaign: UpdateCampaign): UpdateSchedule => ({
  channel: 'beta',
  autoEnabled: true,
  install: { kind: 'package' },
  target: { kind: 'package', version: '2026.9.5' },
  campaign,
})

export const scheduleWaiting = withCampaign(campaignWaiting)
export const scheduleCountdown = withCampaign(campaignCountdown)
export const scheduleHeld = withCampaign(campaignHeld)
export const scheduleCountdownAfterHold = withCampaign(campaignCountdownAfterHold)
export const scheduleApplying = withCampaign(campaignApplying)

/** Dev git campaign: target has no `version`, only ref/sha/commitsBehind. */
export const scheduleDevGitCountdown: UpdateSchedule = {
  channel: 'dev',
  autoEnabled: true,
  install: { kind: 'git', git: { status: 'behind', commitsBehind: 7, currentSha: availableDevGit.currentSha, installedAtMs: NOW_MS - 86_400_000 } },
  target: { kind: 'git', upstreamRef: 'origin/main', upstreamSha: availableDevGit.upstreamSha!, commitsBehind: 7 },
  campaign: { ...campaignCountdown, id: '2f9b7d1e-0c3a-4b8d-a6e4-8f1c3d5b7a09' },
}

/* ────────────────────────────── hello-ok snapshot ────────────────────────────── */

/**
 * The update fields of hello-ok `snapshot` (buildGatewaySnapshot, dist/health-state-DsIuwAbj.mjs:58-82;
 * includeUpdateDetails = canReadDetailedUpdateMetadata(role, scopes), dist/message-handler-BBAGn2rf.mjs:2281).
 * Both are `undefined` (absent in JSON) when there is nothing to report.
 */
export interface HelloUpdateSnapshot {
  updateAvailable?: UpdateAvailable
  updateSchedule?: UpdateSchedule // read-capable clients only
}

/** Read/write/admin connection with a live campaign. */
export const helloSnapshotReadCampaign: HelloUpdateSnapshot = { updateAvailable: availableFull, updateSchedule: scheduleCountdown }
/** Read-capable, update available, auto updates off. */
export const helloSnapshotReadNoCampaign: HelloUpdateSnapshot = { updateAvailable: availableFull, updateSchedule: scheduleNoCampaign }
/** Dev git checkout, read-capable: commits included. */
export const helloSnapshotDevGit: HelloUpdateSnapshot = { updateAvailable: availableDevGit, updateSchedule: scheduleDevGitCountdown }
/** Connection with no operator.read/write (e.g. a talk-only or empty grant): reduced shape, no schedule. */
export const helloSnapshotNoRead: HelloUpdateSnapshot = { updateAvailable: availableReduced }
/** No update: both keys absent. */
export const helloSnapshotNone: HelloUpdateSnapshot = {}
/** Read-capable, no update, but the schedule is still sent (auto on, idle). */
export const helloSnapshotScheduleOnly: HelloUpdateSnapshot = { updateSchedule: { channel: 'stable', autoEnabled: true, install: { kind: 'package' } } }
/**
 * 2026.6.5: snapshot.updateAvailable (3 fields) goes to EVERY connection; there is no
 * updateSchedule. dist/health-state-VRUXjZyB.js:28,43 (2026.6.5).
 */
export const helloSnapshot2026_6_5: HelloUpdateSnapshot = { updateAvailable: { currentVersion: '2026.6.5', latestVersion: '2026.9.4', channel: 'stable' } }

/* ────────────────────────────── update.available event ────────────────────────────── */

/**
 * `update.available` payload. Scope guard: [] (every connection), dist/server-start-DzfvczE1.mjs:2979.
 * Read-capable connections get `{updateAvailable, schedule?}`; others get
 * `{updateAvailable: <3 fields> | null}`. dist/server-startup-post-attach-HBBOikle.mjs:793-838.
 * `schedule` is included on availability changes only once a schedule was seen (:826-829).
 * Sent with dropIfSlow, so it can be lost.
 */
export interface UpdateAvailableEvent {
  updateAvailable: UpdateAvailable | null
  schedule?: UpdateSchedule
}

export const evAvailableDetailed: UpdateAvailableEvent = { updateAvailable: availableFull, schedule: scheduleNoCampaign }
export const evAvailableLegacy: UpdateAvailableEvent = { updateAvailable: availableReduced }
export const evAvailableCleared: UpdateAvailableEvent = { updateAvailable: null, schedule: { channel: 'stable', autoEnabled: true, install: { kind: 'package' } } }
export const evAvailableClearedLegacy: UpdateAvailableEvent = { updateAvailable: null }
/** Schedule-only change (campaign moved to countdown); updateAvailable repeats the last value. */
export const evCampaignCountdown: UpdateAvailableEvent = { updateAvailable: availableFull, schedule: scheduleCountdown }
export const evCampaignHeld: UpdateAvailableEvent = { updateAvailable: availableFull, schedule: scheduleHeld }
export const evCampaignApplying: UpdateAvailableEvent = { updateAvailable: availableFull, schedule: scheduleApplying }
/** A failed apply clears the campaign (update-startup-B5Y6Lfsz.mjs:185-189): schedule without `campaign`. */
export const evCampaignCleared: UpdateAvailableEvent = { updateAvailable: availableFull, schedule: scheduleNoCampaign }
/** A non-read connection never sees schedule changes; the gateway still sends the reduced frame. */
export const evCampaignCountdownLegacy: UpdateAvailableEvent = { updateAvailable: availableReduced }
/** 2026.6.5: `{ updateAvailable }` to everyone (dist/server-startup-post-attach-s4oDk9tN.js:647-649). */
export const evAvailable2026_6_5: UpdateAvailableEvent = { updateAvailable: helloSnapshot2026_6_5.updateAvailable! }

/* ────────────────────────────── RunRecord ────────────────────────────── */

/** dist/sessions-rlbLHLas.mjs:534 — every field optional and nullable. */
export interface UpdateRunVersion { version?: string | null; sha?: string | null; buildId?: string | null }

/** dist/sessions-rlbLHLas.mjs:590-596. Phase names also appear as steps (ledger upsertStep, update-run-ledger-B_LBZZgT.mjs:258-270). */
export interface UpdateRunStep {
  step: string // ≤1024
  status: UpdateRunStepStatus
  startedAtMs?: number
  endedAtMs?: number
  detail?: string // ≤1024; summarizeUpdateStepFailure caps it at 300 (update-run-record-DyYy8-Zk.mjs:972)
}

/** dist/sessions-rlbLHLas.mjs:597-614 */
export interface UpdateRunVerification {
  booted?: boolean
  runningVersion?: string
  runningBuildId?: string
  serviceRunning?: boolean
  pid?: number
  port?: number
  versionMatch?: boolean
  pluginErrors?: string[] // maxItems 32
  channelsReady?: boolean
  readyz?: boolean
  settled?: boolean
  noticeDelivered?: boolean
  doctorHint?: string
}

/** dist/sessions-rlbLHLas.mjs:615-629 */
export interface UpdateRepairAttempt {
  attempt: number
  status: 'succeeded' | 'failed' | 'skipped'
  startedAtMs: number
  endedAtMs?: number
  summary?: string
  reason?: string
}

interface UpdateRunDriver { host: string; pid: number; startIdentity: string }

/** UpdateRunRecordSchema (closed object). dist/sessions-rlbLHLas.mjs:554-633 */
export interface UpdateRunRecord {
  runId: string
  createdAtMs: number
  updatedAtMs: number
  trigger: UpdateRunTrigger
  phase: UpdateRunPhase
  status: UpdateRunStatus
  reason: string | null
  origin: {
    driver?: UpdateRunDriver
    previousDrivers?: UpdateRunDriver[]
    requester?: { channel?: string; accountId?: string; senderId?: string }
    sessionKey?: string
    deliveryContext?: { channel?: string; to?: string; accountId?: string; threadId?: string }
    campaignId?: string
    doctorHint?: string
    nextAction?: string
  }
  target: { channel?: string; tag?: string; kind?: 'package' | 'git'; version?: string; sha?: string }
  before: UpdateRunVersion
  after: UpdateRunVersion
  steps: UpdateRunStep[] // maxItems 128
  verification: UpdateRunVerification
  repair: UpdateRepairAttempt[] // maxItems 16
  confirmedAtMs: number | null
  finishedAtMs: number | null
  downtimeMs: number | null
}

const T0 = NOW_MS - 60_000
const DOCTOR_HINT = 'Run `openclaw doctor --non-interactive` for details.'
const DRIVER: UpdateRunDriver = { host: 'studio', pid: 48213, startIdentity: '1789721940123' }

const phaseStep = (step: string, status: UpdateRunStepStatus, startedAtMs: number, endedAtMs?: number): UpdateRunStep =>
  endedAtMs === undefined ? { step, status, startedAtMs } : { step, status, startedAtMs, endedAtMs }

/** Just created by update.run (update-C1wfgEl4.mjs:473-488 + createUpdateRun, update-run-ledger-B_LBZZgT.mjs:56-80). */
export const runRequested: UpdateRunRecord = {
  runId: RUN_IDS.ours,
  createdAtMs: T0,
  updatedAtMs: T0 + 40,
  trigger: 'api', // JoaxClaw connects as client.id "gateway-client" → "api" (update-C1wfgEl4.mjs:453)
  phase: 'requested',
  status: 'running',
  reason: null,
  origin: { doctorHint: DOCTOR_HINT },
  target: { channel: 'stable', kind: 'package', version: '2026.9.5' },
  before: { version: '2026.9.4' },
  after: {},
  steps: [phaseStep('requested', 'in_progress', T0)],
  verification: { runningVersion: '2026.9.4', serviceRunning: true, pid: 4121 },
  repair: [],
  confirmedAtMs: null,
  finishedAtMs: null,
  downtimeMs: null,
}

/** Managed service: handoff started, detached CLI now in validating (canary). */
export const runValidating: UpdateRunRecord = {
  ...runRequested,
  updatedAtMs: T0 + 21_000,
  phase: 'validating',
  origin: { doctorHint: DOCTOR_HINT, driver: DRIVER },
  steps: [
    phaseStep('requested', 'completed', T0, T0 + 1_800),
    { step: 'managed-service update handoff', status: 'completed', startedAtMs: T0 + 300, endedAtMs: T0 + 1_700 },
    phaseStep('staging', 'completed', T0 + 1_800, T0 + 14_000),
    phaseStep('validating', 'in_progress', T0 + 14_000),
    { step: 'candidate gateway canary', status: 'in_progress', startedAtMs: T0 + 14_500 },
  ],
}

export const runRestarting: UpdateRunRecord = {
  ...runValidating,
  updatedAtMs: T0 + 95_000,
  phase: 'restarting',
  after: { version: '2026.9.5' },
  steps: [
    ...runValidating.steps.slice(0, 3),
    phaseStep('validating', 'completed', T0 + 14_000, T0 + 80_000),
    { step: 'candidate gateway canary', status: 'completed', startedAtMs: T0 + 14_500, endedAtMs: T0 + 79_000 },
    phaseStep('activating', 'completed', T0 + 80_000, T0 + 92_000),
    phaseStep('restarting', 'in_progress', T0 + 92_000),
  ],
  verification: { runningVersion: '2026.9.4', serviceRunning: false, pid: 4121 },
}

/** Repair from verifying: phase goes BACKWARD verifying → repairing (update-run-ledger-B_LBZZgT.mjs:258). */
export const runRepairing: UpdateRunRecord = {
  ...runRestarting,
  updatedAtMs: T0 + 140_000,
  phase: 'repairing',
  steps: [
    ...runRestarting.steps.slice(0, 6),
    phaseStep('restarting', 'completed', T0 + 92_000, T0 + 118_000),
    phaseStep('verifying', 'completed', T0 + 118_000, T0 + 131_000),
    phaseStep('repairing', 'in_progress', T0 + 131_000),
  ],
  verification: { booted: true, runningVersion: '2026.9.5', serviceRunning: true, pid: 5310, port: 18789, versionMatch: true, pluginErrors: ['joaxclaw-fs: failed to load (Cannot find module "./dist/index.js")'], channelsReady: true, readyz: false },
  repair: [{ attempt: 1, status: 'failed', startedAtMs: T0 + 131_000, summary: 'Reinstall plugin joaxclaw-fs' }],
}

/** Succeeded: phase "finished", downtime recorded (finishUpdateRunRecord, update-run-record-DyYy8-Zk.mjs:975-991). */
export const runSucceeded: UpdateRunRecord = {
  ...runRestarting,
  updatedAtMs: T0 + 132_000,
  phase: 'finished',
  status: 'succeeded',
  after: { version: '2026.9.5', buildId: 'b20260917.3' },
  steps: [
    ...runRestarting.steps.slice(0, 6),
    phaseStep('restarting', 'completed', T0 + 92_000, T0 + 118_000),
    phaseStep('verifying', 'completed', T0 + 118_000, T0 + 132_000),
    { step: 'notice:ack', status: 'completed', startedAtMs: T0 + 200, endedAtMs: T0 + 250 },
  ],
  verification: { booted: true, runningVersion: '2026.9.5', runningBuildId: 'b20260917.3', serviceRunning: true, pid: 5310, port: 18789, versionMatch: true, pluginErrors: [], channelsReady: true, readyz: true, settled: true, noticeDelivered: false },
  confirmedAtMs: T0 + 131_500,
  finishedAtMs: T0 + 132_000,
  downtimeMs: 38_000,
}

/** Failed at verifying: record.phase is "finished"; the "verifying" step carries status "failed". */
export const runFailedAtVerifying: UpdateRunRecord = {
  ...runRepairing,
  runId: RUN_IDS.failed,
  updatedAtMs: T0 + 190_000,
  phase: 'finished',
  status: 'failed',
  reason: 'post-update-verification-failed',
  steps: [
    ...runRepairing.steps.slice(0, 7),
    phaseStep('verifying', 'completed', T0 + 118_000, T0 + 131_000),
    phaseStep('repairing', 'completed', T0 + 131_000, T0 + 170_000),
    phaseStep('verifying', 'failed', T0 + 170_000, T0 + 190_000),
    { step: 'plugin load', status: 'failed', startedAtMs: T0 + 171_000, endedAtMs: T0 + 189_000, detail: 'Exit code: 1; Error: Cannot find module "./dist/index.js" `joaxclaw-fs`' },
  ],
  repair: [
    { attempt: 1, status: 'failed', startedAtMs: T0 + 131_000, endedAtMs: T0 + 150_000, summary: 'Reinstall plugin joaxclaw-fs', reason: 'npm ERR! 404' },
    { attempt: 2, status: 'skipped', startedAtMs: T0 + 150_000, endedAtMs: T0 + 150_010, reason: 'repair budget exhausted' },
  ],
  finishedAtMs: T0 + 190_000,
  downtimeMs: 52_000,
}

/** Rolled back (campaign). finishUpdateRunRecord marks the in-progress step "completed" for rolled-back. */
export const runRolledBack: UpdateRunRecord = {
  runId: RUN_IDS.oursRolledBack,
  createdAtMs: NOW_MS - 7 * 86_400_000,
  updatedAtMs: NOW_MS - 7 * 86_400_000 + 64_000 + 90_000,
  trigger: 'campaign',
  phase: 'finished',
  status: 'rolled-back',
  reason: 'candidate-verification-failed',
  origin: { campaignId: campaignWaiting.id, doctorHint: DOCTOR_HINT, driver: DRIVER },
  target: { channel: 'beta', kind: 'package', version: '2026.9.3' },
  before: { version: '2026.9.2' },
  after: { version: '2026.9.2' },
  steps: [
    phaseStep('requested', 'completed', NOW_MS - 7 * 86_400_000, NOW_MS - 7 * 86_400_000 + 900),
    phaseStep('staging', 'completed', NOW_MS - 7 * 86_400_000 + 900, NOW_MS - 7 * 86_400_000 + 12_000),
    phaseStep('validating', 'completed', NOW_MS - 7 * 86_400_000 + 12_000, NOW_MS - 7 * 86_400_000 + 70_000),
    phaseStep('activating', 'completed', NOW_MS - 7 * 86_400_000 + 70_000, NOW_MS - 7 * 86_400_000 + 80_000),
    phaseStep('restarting', 'completed', NOW_MS - 7 * 86_400_000 + 80_000, NOW_MS - 7 * 86_400_000 + 110_000),
    phaseStep('verifying', 'completed', NOW_MS - 7 * 86_400_000 + 110_000, NOW_MS - 7 * 86_400_000 + 154_000),
    { step: 'channels ready', status: 'failed', detail: 'telegram: getMe timed out after 30000ms' },
    { step: 'rollback', status: 'completed', detail: 'Restored 2026.9.2 package tree' },
  ],
  verification: { booted: true, runningVersion: '2026.9.2', serviceRunning: true, versionMatch: false, pluginErrors: [], channelsReady: false, readyz: true },
  repair: [],
  confirmedAtMs: null,
  finishedAtMs: NOW_MS - 7 * 86_400_000 + 154_000,
  downtimeMs: 64_000,
}

/** A refused update.run is also a ledger run: status "skipped", reason = refusal (update-C1wfgEl4.mjs:782-786). */
export const runRefusedRestartDisabled: UpdateRunRecord = {
  ...runRequested,
  runId: RUN_IDS.refused,
  updatedAtMs: T0 + 300,
  phase: 'finished',
  status: 'skipped',
  reason: 'restart-disabled',
  target: { channel: 'dev', kind: 'git' },
  steps: [phaseStep('requested', 'skipped', T0, T0 + 300)],
  finishedAtMs: T0 + 300,
}

/** Git checkout already at upstream: skipped + already-current (update-control-plane-sentinel-D6xfGgXT.mjs:35-43). */
export const runAlreadyCurrent: UpdateRunRecord = {
  ...runRefusedRestartDisabled,
  runId: RUN_IDS.alreadyCurrent,
  reason: 'already-current',
  before: { version: '2026.9.4', sha: availableDevGit.currentSha },
  after: { version: '2026.9.4', sha: availableDevGit.currentSha },
}

/** Driver died: reconciled to failed/abandoned (update-run-ledger-B_LBZZgT.mjs:218-228). */
export const runAbandoned: UpdateRunRecord = {
  ...runValidating,
  runId: RUN_IDS.abandoned,
  trigger: 'cli',
  updatedAtMs: NOW_MS - 3 * 86_400_000,
  createdAtMs: NOW_MS - 3 * 86_400_000 - 600_000,
  phase: 'finished',
  status: 'failed',
  reason: 'abandoned',
  steps: [...runValidating.steps.slice(0, 3), phaseStep('validating', 'failed', NOW_MS - 3 * 86_400_000 - 500_000, NOW_MS - 3 * 86_400_000), { step: 'reconcile:abandoned', status: 'failed', endedAtMs: NOW_MS - 3 * 86_400_000, detail: 'driver-exited' }],
  finishedAtMs: NOW_MS - 3 * 86_400_000,
}

/** Minimal legal record: every optional key absent, nullable keys null. */
export const runMinimal: UpdateRunRecord = {
  runId: RUN_IDS.controlUi,
  createdAtMs: NOW_MS - 30_000,
  updatedAtMs: NOW_MS - 30_000,
  trigger: 'control-ui',
  phase: 'requested',
  status: 'running',
  reason: null,
  origin: {},
  target: {},
  before: {},
  after: {},
  steps: [],
  verification: {},
  repair: [],
  confirmedAtMs: null,
  finishedAtMs: null,
  downtimeMs: null,
}

/** Oversize: 128 steps (schema maxItems), long details, 32 plugin errors. */
export const runOversize: UpdateRunRecord = {
  ...runFailedAtVerifying,
  runId: RUN_IDS.cli,
  trigger: 'cli',
  steps: Array.from({ length: 128 }, (_, i): UpdateRunStep => ({
    step: `plugin repair ${i + 1}`,
    status: i % 3 === 0 ? 'failed' : 'completed',
    startedAtMs: T0 + i * 100,
    endedAtMs: T0 + i * 100 + 90,
    ...(i % 3 === 0 ? { detail: `Exit code: 1; ${'e'.repeat(290)}` } : {}),
  })),
  verification: { ...runFailedAtVerifying.verification, pluginErrors: Array.from({ length: 32 }, (_, i) => `plugin-${i}: failed to load`) },
}

/** Values the app has not seen: a newer gateway could add them. Only for parse-robustness tests. */
export const runUnknownVocabulary = { ...runValidating, phase: 'rehearsing', status: 'paused', trigger: 'webhook' } as unknown as UpdateRunRecord

/* ────────────────────────────── update.run.changed event ────────────────────────────── */

/**
 * UpdateRunChangedEventSchema. dist/sessions-rlbLHLas.mjs:641; emitted by the watcher on every
 * updatedAtMs change and once more when terminal (update-run-watcher-9rRNscAX.mjs:109-118).
 * Scope guard [operator.admin] (server-start-DzfvczE1.mjs:2980). Terminal events carry phase "finished".
 */
export interface UpdateRunChangedEvent { runId: string; phase: UpdateRunPhase; status: UpdateRunStatus; updatedAtMs: number }

export const evRunChangedSequence: UpdateRunChangedEvent[] = [
  { runId: RUN_IDS.ours, phase: 'requested', status: 'running', updatedAtMs: T0 + 40 },
  { runId: RUN_IDS.ours, phase: 'staging', status: 'running', updatedAtMs: T0 + 1_800 },
  { runId: RUN_IDS.ours, phase: 'validating', status: 'running', updatedAtMs: T0 + 14_000 },
  { runId: RUN_IDS.ours, phase: 'validating', status: 'running', updatedAtMs: T0 + 40_000 }, // same phase, new revision (heartbeat)
  { runId: RUN_IDS.ours, phase: 'activating', status: 'running', updatedAtMs: T0 + 80_000 },
  { runId: RUN_IDS.ours, phase: 'restarting', status: 'running', updatedAtMs: T0 + 92_000 },
  // …socket drops; the NEW gateway's watcher picks the active run up again…
  { runId: RUN_IDS.ours, phase: 'verifying', status: 'running', updatedAtMs: T0 + 118_000 },
  { runId: RUN_IDS.ours, phase: 'finished', status: 'succeeded', updatedAtMs: T0 + 132_000 },
]
export const evRunChangedValidating: UpdateRunChangedEvent = evRunChangedSequence[2]
export const evRunChangedOtherRunRunning: UpdateRunChangedEvent = { runId: RUN_IDS.cli, phase: 'staging', status: 'running', updatedAtMs: NOW_MS }
export const evRunChangedOtherRunTerminal: UpdateRunChangedEvent = { runId: RUN_IDS.cli, phase: 'finished', status: 'failed', updatedAtMs: NOW_MS }
export const evRunChangedRolledBack: UpdateRunChangedEvent = { runId: RUN_IDS.oursRolledBack, phase: 'finished', status: 'rolled-back', updatedAtMs: runRolledBack.updatedAtMs }
export const evRunChangedRepairing: UpdateRunChangedEvent = { runId: RUN_IDS.ours, phase: 'repairing', status: 'running', updatedAtMs: T0 + 131_000 }

/* ────────────────────────────── update.status ────────────────────────────── */

/**
 * UpdateStatusResultSchema. dist/sessions-rlbLHLas.mjs:796; handler update-C1wfgEl4.mjs:350-399.
 * `sentinel` is Unknown (the last update restart sentinel or null/undefined).
 */
export interface UpdateStatusResult {
  sentinel?: unknown
  updateAvailable?: UpdateAvailable | null // 2026.9.4 always sends the key; 2026.6.5 never does
  activeRun?: UpdateRunRecord
  lastRun?: UpdateRunRecord
  effectiveChannel?: 'stable' | 'extended-stable' | 'beta' | 'dev'
  schedule?: UpdateSchedule
}

export const statusIdle: UpdateStatusResult = { sentinel: null, updateAvailable: availableFull, lastRun: runRolledBack, effectiveChannel: 'stable', schedule: scheduleNoCampaign }
export const statusActiveRun: UpdateStatusResult = { sentinel: null, updateAvailable: availableFull, activeRun: runValidating, lastRun: runValidating, effectiveChannel: 'stable', schedule: scheduleNoCampaign }
export const statusCampaign: UpdateStatusResult = { sentinel: null, updateAvailable: availableFull, effectiveChannel: 'beta', schedule: scheduleCountdown }
export const statusNothing: UpdateStatusResult = { sentinel: null, updateAvailable: null, effectiveChannel: 'stable' }
/** 2026.6.5 update.status: `{ sentinel }` only (dist/update-B6J_RJip.js:37-40, 2026.6.5). */
export const status2026_6_5: UpdateStatusResult = { sentinel: null }

/* ────────────────────────────── update.run ────────────────────────────── */

/** Request params. UpdateRunParamsSchema (closed). dist/sessions-rlbLHLas.mjs:817 */
export interface UpdateRunParams {
  requester?: { channel?: string; accountId?: string; senderId?: string }
  sessionKey?: string
  deliveryContext?: { channel?: string; to?: string; accountId?: string; threadId?: string | number }
  note?: string
  continuationMessage?: string
  restartDelayMs?: number // min 0; clamped to 0–60000, default 2000 (restart-PDAKwQWW.mjs:741-743)
  timeoutMs?: number // min 1; server-side step/canary budget, NOT the client request timeout
  target?: { kind: 'git'; upstreamRef: string; upstreamSha: string }
}

export const runParamsJoaxClaw: UpdateRunParams = { note: 'Started from JoaxClaw' }

/** `result` object (typed Unknown on the wire). Shapes from refusedUpdate + handoff branch, update-C1wfgEl4.mjs:546-554,679-693,755-761. */
export interface UpdateRunResultBody {
  status: 'ok' | 'error' | 'skipped'
  mode: string // 'git' | 'npm' | 'pnpm' | 'bun' | 'unknown' | …
  root?: string
  reason?: string
  before?: { version?: string | null; sha?: string | null }
  after?: { version?: string | null; sha?: string | null }
  steps: { name: string; command: string; cwd: string; durationMs: number; exitCode: number | null; stderrTail?: string }[]
  durationMs: number
}

/** `handoff` (Unknown on the wire). update-C1wfgEl4.mjs:658-705 */
export type UpdateRunHandoff =
  | { status: 'started'; pid?: number; command: string }
  | { status: 'already-running'; command: string; message: string }
  | { status: 'unavailable'; command: string; message: string }

/** `restart` (Unknown on the wire): scheduleGatewaySigusr1Restart result or null (restart-PDAKwQWW.mjs:750-757). */
export interface UpdateRunRestart { ok: boolean; pid: number; signal: string; reason: string; mode: string; cooldownMsApplied: number; delayMs: number; coalesced: boolean; emitHooksQueued: boolean }

/**
 * update.run response. Schema UpdateRunResultSchema (dist/sessions-rlbLHLas.mjs:648) + the fields
 * the handler actually sends (update-C1wfgEl4.mjs:845-859: ackQueued, acknowledgement too).
 * Refusals are SUCCESSFUL responses with ok:false. `code`/`message` only for owner_required
 * (chat requesters) or a sentinel-write failure.
 */
export interface UpdateRunResponse {
  runId: string
  ok: boolean
  code?: string
  message?: string
  ackDelivered?: boolean
  ackQueued?: boolean
  acknowledgement?: string
  result: UpdateRunResultBody
  handoff?: UpdateRunHandoff
  restart?: UpdateRunRestart | null
  sentinel?: { persisted: boolean; payload: unknown }
}

const HANDOFF_CMD = 'openclaw update --yes --json'
const ROOT = '/home/studio/.local/share/pnpm/global/5/node_modules/openclaw'
const sentinelFor = (status: string, reason: string, runId: string) => ({
  persisted: false,
  payload: { kind: 'update', status, ts: T0 + 300, message: 'Started from JoaxClaw', doctorHint: DOCTOR_HINT, stats: { runId, mode: 'pnpm', reason, before: { version: '2026.9.4' }, after: null, steps: [] } },
})
const refusal = (status: 'skipped' | 'error', reason: string, mode = 'pnpm'): UpdateRunResponse => ({
  runId: RUN_IDS.refused,
  ok: false,
  ackDelivered: false,
  ackQueued: false,
  result: { status, mode, root: ROOT, ...(status === 'skipped' ? { before: { version: '2026.9.4' } } : {}), reason, steps: [], durationMs: 0 },
  restart: null,
  sentinel: sentinelFor(status, reason, RUN_IDS.refused),
})

/** Normal install: managed-service handoff → ok:true while result.status is "skipped". No restart yet. */
export const runResponseHandoffStarted: UpdateRunResponse = {
  runId: RUN_IDS.ours,
  ok: true,
  ackDelivered: false,
  ackQueued: false,
  result: {
    status: 'skipped',
    mode: 'pnpm',
    root: ROOT,
    reason: 'managed-service-handoff-started',
    before: { version: '2026.9.4' },
    steps: [{ name: 'managed-service update handoff', command: HANDOFF_CMD, cwd: ROOT, durationMs: 1_412, exitCode: null }],
    durationMs: 1_412,
  },
  handoff: { status: 'started', pid: 51877, command: HANDOFF_CMD },
  restart: null,
  sentinel: { persisted: true, payload: { kind: 'update', status: 'skipped', ts: T0 + 1_700, message: 'Started from JoaxClaw', doctorHint: DOCTOR_HINT, stats: { runId: RUN_IDS.ours, mode: 'pnpm', root: ROOT, target: 'stable channel', handoffId: '8d2c4e6a-0b1f-4a3c-9e5d-7f1b3d5a9c0e', before: { version: '2026.9.4' }, after: null, steps: [] } } },
}

/** Unsupervised git checkout, in-process update succeeded: restart scheduled after restartDelayMs. */
export const runResponseGitOk: UpdateRunResponse = {
  runId: RUN_IDS.ours,
  ok: true,
  ackDelivered: false,
  ackQueued: false,
  result: {
    status: 'ok',
    mode: 'git',
    root: '/home/studio/src/openclaw',
    before: { version: '2026.9.4', sha: availableDevGit.currentSha },
    after: { version: '2026.9.4', sha: availableDevGit.upstreamSha },
    steps: [{ name: 'git pull', command: 'git pull --ff-only', cwd: '/home/studio/src/openclaw', durationMs: 2_210, exitCode: 0 }],
    durationMs: 184_000,
  },
  restart: { ok: true, pid: 4121, signal: 'SIGUSR1', reason: 'update.run', mode: 'emit', cooldownMsApplied: 0, delayMs: 2_000, coalesced: false, emitHooksQueued: false },
  sentinel: { persisted: true, payload: {} },
}

/** Git checkout already current: ok:false, status skipped, reason already-current. */
export const runResponseAlreadyCurrent: UpdateRunResponse = { ...refusal('skipped', 'already-current', 'git'), runId: RUN_IDS.alreadyCurrent }

export const runResponseRestartDisabled = refusal('skipped', 'restart-disabled', 'git')
export const runResponseRestartUnavailable = refusal('skipped', 'restart-unavailable')
export const runResponseExternalSupervisor = refusal('skipped', 'external-supervisor-update-required')
export const runResponseHandoffUnavailable: UpdateRunResponse = {
  ...refusal('skipped', 'managed-service-handoff-unavailable'),
  handoff: {
    status: 'unavailable',
    command: HANDOFF_CMD,
    // buildManagedServiceHandoffUnavailableMessage, update-managed-service-handoff-CxXgpcs9.mjs:2089-2091
    message: `OpenClaw updates cannot safely run inside the live gateway process without a managed-service handoff.\nStop the foreground Gateway, run \`${HANDOFF_CMD}\` from a shell, then launch the Gateway again. For a managed deployment, use its host's stop, update, and restart workflow.`,
  },
}
export const runResponseHandoffAlreadyRunning: UpdateRunResponse = {
  ...refusal('skipped', 'managed-service-handoff-already-running'),
  handoff: { status: 'already-running', command: HANDOFF_CMD, message: 'Another managed update is already running; retry after it completes.' },
}
export const runResponseHandoffFailed = refusal('error', 'managed-service-handoff-failed')
export const runResponseCampaignApplying = refusal('error', 'update-campaign-applying')
export const runResponseNotOpenclawRoot = refusal('error', 'not-openclaw-root', 'unknown')
export const runResponseUnsupportedGitChannel = refusal('error', 'unsupported_git_channel', 'git')
export const runResponseTargetMismatch = refusal('error', 'update-target-campaign-mismatch', 'git')
export const runResponseUnexpected: UpdateRunResponse = { ...refusal('error', 'unexpected-error', 'unknown'), result: { status: 'error', mode: 'unknown', reason: 'unexpected-error', steps: [], durationMs: 0 } }
/** Every refusal reason the 2026.9.4 handler can return from the gateway process. */
export const REFUSAL_REASONS = [
  'external-supervisor-update-required',
  'restart-disabled',
  'restart-unavailable',
  'managed-service-handoff-unavailable',
  'managed-service-handoff-already-running',
  'managed-service-handoff-failed',
  'update-campaign-applying',
  'not-openclaw-root',
  'unsupported_git_channel',
  'invalid-update-target',
  'unsupported-update-target',
  'update-target-upstream-mismatch',
  'update-target-campaign-mismatch',
  'unexpected-error',
  'owner_required',
] as const

/** 2026.6.5 update.run: no runId; restart scheduled straight after a started handoff (dist/update-B6J_RJip.js:180-205). */
export const runResponse2026_6_5 = {
  ok: true,
  result: { status: 'skipped', mode: 'pnpm', root: ROOT, reason: 'managed-service-handoff-started', before: { version: '2026.6.5' }, steps: [], durationMs: 1_104 },
  handoff: { status: 'started', pid: 30115, command: HANDOFF_CMD },
  restart: { ok: true, pid: 2204, signal: 'SIGUSR1', reason: 'update.run', mode: 'emit', cooldownMsApplied: 0, delayMs: 4_000, coalesced: false, emitHooksQueued: false },
  sentinel: { path: '/home/studio/.openclaw/restart-sentinel.json', payload: {} },
} as const

/* ────────────────────────────── update.hold ────────────────────────────── */

/** UpdateHoldParamsSchema is closed `{}`; result `{ok, schedule?}`. dist/sessions-rlbLHLas.mjs:810-815; handler update-C1wfgEl4.mjs:400-425 */
export interface UpdateHoldResult { ok: boolean; schedule?: UpdateSchedule }

export const holdOk: UpdateHoldResult = { ok: true, schedule: scheduleHeld }
/** Already held once in this campaign → ok:false, current schedule echoed. */
export const holdRefusedAlreadyHeld: UpdateHoldResult = { ok: false, schedule: scheduleHeld }
export const holdRefusedApplying: UpdateHoldResult = { ok: false, schedule: scheduleApplying }
/** No campaign (schedule without `campaign`). */
export const holdRefusedNoCampaign: UpdateHoldResult = { ok: false, schedule: scheduleNoCampaign }
/** No schedule cached at all (update checks off). */
export const holdRefusedNoSchedule: UpdateHoldResult = { ok: false }

/* ────────────────────────────── update.runs.list / get ────────────────────────────── */

/** `{limit?: 1..100}` default 20, newest first by createdAtMs (update-run-record-DyYy8-Zk.mjs:913). */
export interface UpdateRunsListParams { limit?: number }
export interface UpdateRunsListResult { runs: UpdateRunRecord[] } // maxItems 100
/** `{runId}` must match RUN_ID_PATTERN or the call fails INVALID_REQUEST. */
export interface UpdateRunsGetParams { runId: string }
export interface UpdateRunsGetResult { run: UpdateRunRecord | null }

export const runsListTypical: UpdateRunsListResult = { runs: [runRefusedRestartDisabled, runAbandoned, runRolledBack] }
export const runsListWithActive: UpdateRunsListResult = { runs: [runValidating, runSucceeded, runRolledBack] }
export const runsListEmpty: UpdateRunsListResult = { runs: [] }
export const runsListFull: UpdateRunsListResult = {
  runs: Array.from({ length: 20 }, (_, i): UpdateRunRecord => ({
    ...runSucceeded,
    runId: `${(0x10000000 + i).toString(16)}-4b2c-4d3e-8f4a-5b6c7d8e9f0a`,
    createdAtMs: NOW_MS - (i + 1) * 86_400_000,
    updatedAtMs: NOW_MS - (i + 1) * 86_400_000 + 132_000,
    finishedAtMs: NOW_MS - (i + 1) * 86_400_000 + 132_000,
    trigger: UPDATE_RUN_TRIGGERS[i % UPDATE_RUN_TRIGGERS.length],
    status: i % 7 === 3 ? 'failed' : 'succeeded',
  })),
}

export const runsGetRunning: UpdateRunsGetResult = { run: runRestarting }
export const runsGetSucceeded: UpdateRunsGetResult = { run: runSucceeded }
export const runsGetRolledBack: UpdateRunsGetResult = { run: runRolledBack }
export const runsGetNull: UpdateRunsGetResult = { run: null }

/* ────────────────────────────── update.report ────────────────────────────── */

/** UpdateReportParamsSchema. dist/sessions-rlbLHLas.mjs:839-852 */
export type UpdateReportParams =
  | { action: 'preview'; attemptId: string }
  | { action: 'submit'; attemptId: string; previewDigest: string }

/** UpdateReportResultSchema. dist/sessions-rlbLHLas.mjs:858-896 (preview also echoes attemptId). */
export type UpdateReportResult =
  | { status: 'ready'; attemptId: string; body: string; previewDigest: string; title: string }
  | { status: 'created'; url: string; message?: string }
  | { status: 'fallback'; fallbackUrl: string; message: string }
  | { status: 'pending'; message: string }
  | { status: 'retryable'; message: string }
  | { status: 'duplicate'; message: string; url?: string; fallbackUrl?: string }

const DIGEST = '9f2c4a6e8b0d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a'
export const reportPreviewReady: UpdateReportResult = {
  status: 'ready',
  attemptId: RUN_IDS.failed,
  title: 'Update to 2026.9.5 failed: post-update-verification-failed',
  body: '### Update failure\n\n- From: 2026.9.4\n- Target: 2026.9.5\n- Mode: pnpm\n- Reason: post-update-verification-failed\n\n#### Failed steps\n- verifying (exit code: n/a)\n- plugin load (exit code: 1)\n',
  previewDigest: DIGEST,
}
export const reportSubmitCreated: UpdateReportResult = { status: 'created', url: 'https://github.com/openclaw/openclaw/issues/48213' }
export const reportSubmitFallback: UpdateReportResult = { status: 'fallback', fallbackUrl: 'https://github.com/openclaw/openclaw/issues/new?title=Update%20to%202026.9.5%20failed&body=%23%23%23%20Update%20failure', message: 'GitHub is not connected on this gateway. Open the prefilled issue to submit it yourself.' }
export const reportSubmitPending: UpdateReportResult = { status: 'pending', message: 'A report for this attempt is already being submitted.' }
export const reportSubmitRetryable: UpdateReportResult = { status: 'retryable', message: 'GitHub is rate limiting issue creation. Try again in a minute.' }
export const reportSubmitDuplicate: UpdateReportResult = { status: 'duplicate', message: 'This failure was already reported.', url: 'https://github.com/openclaw/openclaw/issues/48190' }
export const reportSubmitDuplicateNoLink: UpdateReportResult = { status: 'duplicate', message: 'This failure was already reported.' }

/* ────────────────────────────── error frames ────────────────────────────── */

/** errorShape(code, message, opts) → `{code, message, ...opts}`. dist/error-codes-C3Z5XSDw.mjs:65-71 */
export interface GatewayError {
  code: 'INVALID_REQUEST' | 'FORBIDDEN' | 'UNAVAILABLE' | 'NOT_PAIRED' | string
  message: string
  retryable?: boolean
  retryAfterMs?: number
  details?: Record<string, unknown>
}
/** Response frame `{type:"res", id, ok:false, error}` (e.g. message-handler-BBAGn2rf.mjs:481-492). */
export interface GatewayErrorFrame { type: 'res'; id: string; ok: false; error: GatewayError }

const errFrame = (id: string, error: GatewayError): GatewayErrorFrame => ({ type: 'res', id, ok: false, error })

/** Unknown method (e.g. update.runs.list on 2026.8). dist/server-methods-v1T0byyX.mjs:396 */
export const errUnknownRunsList = errFrame('req-41', { code: 'INVALID_REQUEST', message: 'unknown method: update.runs.list' })
export const errUnknownHold = errFrame('req-42', { code: 'INVALID_REQUEST', message: 'unknown method: update.hold' })
/** Non-admin calls an admin method. missingScopeErrorShape, dist/error-codes-C3Z5XSDw.mjs:82-85 */
export const errMissingAdminForRun = errFrame('req-43', { code: 'FORBIDDEN', message: 'missing scope: operator.admin', details: { code: 'MISSING_SCOPE', missingScope: 'operator.admin', requiredScopes: ['operator.admin'] } })
/** Bad runId (not a UUID). validateGatewayMethodParams, dist/validation-Cn7ErDZ-.mjs:6-9 */
export const errInvalidRunId = errFrame('req-44', { code: 'INVALID_REQUEST', message: 'invalid update.runs.get params: at /runId: must match pattern "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"' })
/** Extra param on the closed update.hold schema. */
export const errHoldExtraParam = errFrame('req-45', { code: 'INVALID_REQUEST', message: "invalid update.hold params: at root: unexpected property 'durationMs'" })
/** Control-plane write rate limit (update.run / update.hold / update.report). dist/server-methods-v1T0byyX.mjs:303-310 */
export const errRateLimitedRun = errFrame('req-46', { code: 'UNAVAILABLE', message: 'rate limit exceeded for update.run; retry after 37s', retryable: true, retryAfterMs: 36_512, details: { method: 'update.run', limit: '30 per 60s' } })
/** Polling during the restart drain. dist/server-methods-v1T0byyX.mjs:336-346; reason "gateway-restarting" (src-7tzZ8j12.mjs:2007) */
export const errRestartDraining = errFrame('req-47', { code: 'UNAVAILABLE', message: 'update.runs.get unavailable during gateway restart', retryable: true, retryAfterMs: 1_000, details: { method: 'update.runs.get', reason: 'gateway-restarting', phase: 'running' } })
/** Startup window. dist/server-methods-v1T0byyX.mjs:269-276 */
export const errStartupUnavailable = errFrame('req-48', { code: 'UNAVAILABLE', message: 'update.status unavailable during gateway startup', retryable: true, retryAfterMs: 500, details: { method: 'update.status' } })
/** Status result failed its own schema. update-C1wfgEl4.mjs:391-396 */
export const errStatusUnavailable = errFrame('req-49', { code: 'UNAVAILABLE', message: 'update status is temporarily unavailable' })
export const errHoldUnavailable = errFrame('req-50', { code: 'UNAVAILABLE', message: 'update hold status is temporarily unavailable' })
/** update.report without owner/system authority. update-C1wfgEl4.mjs:282-287 */
export const errReportForbidden = errFrame('req-51', { code: 'FORBIDDEN', message: 'Update failure reports require gateway-owner or system administrator authority.' })
/** attemptId is not the latest reportable run. update-C1wfgEl4.mjs:295-300 */
export const errReportStale = errFrame('req-52', { code: 'INVALID_REQUEST', message: 'This failed update attempt is stale or unavailable.' })
export const errReportUnsafe = errFrame('req-53', { code: 'INVALID_REQUEST', message: 'Update report could not be prepared safely.' })
export const errReportNoAuthority = errFrame('req-54', { code: 'INVALID_REQUEST', message: 'Update report access requires a current authenticated client.' })
