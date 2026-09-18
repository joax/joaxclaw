// Background tasks (PRD 03) — real gateway payload shapes, taken from OpenClaw 2026.9.4
// compiled source (QA, sprint 2026.9). Paths are relative to the package's `dist/`.
//
//   Schemas      src-7tzZ8j12.mjs:1640-1774 (schema/tasks.ts), :5112-5217 (schema/task-suggestions.ts)
//   Handlers     tasks-D9hXEMUl.mjs (tasks.* incl. tasks.history), task-suggestions-BfEdNAaD.mjs
//   Mapper       task-summary-Cb8eETle.mjs:108-152 (mapTaskSummary)
//   Event        server-runtime-subscriptions-dSZ219Ld.mjs:1608-1647 (`task`)
//   Push         server-start-DzfvczE1.mjs:2034-2046, :2081-2154; control-ui-shared-DqFhbHR8.mjs:11-17
//   Scopes       method-scopes-tKV11oMS.mjs:859-900, :2454-2465, :2926-2931; events server-start-DzfvczE1.mjs:2977-2978
//   Errors       error-codes-C3Z5XSDw.mjs:65-85, validation-Cn7ErDZ-.mjs:6-9
//   2026.6.5     (globally installed, older) node_modules/openclaw/dist/tasks-45-fMvsF.js
//
// Timestamps are ms, around 2026-09-18 14:00Z. Everything here is data only — no app code.
import type { GwEventFrame, GwResFrame } from '../../../types'
import type { ScriptJob } from '../../../scriptJobs'

export const NOW = 1_789_740_000_000 // 2026-09-18T14:00:00.000Z
const MIN = 60_000
const HOUR = 60 * MIN

// ── Shapes ────────────────────────────────────────────────────────────────────

/** Public ledger status. Registry `succeeded` → `completed`, `lost` → `failed` (task-summary-Cb8eETle.mjs:90-98). src-7tzZ8j12.mjs:1648 */
export type TaskLedgerStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

/** src-7tzZ8j12.mjs:1657 */
export type TaskDeliveryStatus =
  | 'pending' | 'delivered' | 'session_queued' | 'failed' | 'dismissed' | 'parent_missing' | 'not_applicable'

/** src-7tzZ8j12.mjs:1666 */
export type TaskTerminalOutcome = 'succeeded' | 'blocked'

/** `runtime` values written by the registry (subagent | acp | cron | cli). Schema types it as a plain string. src-7tzZ8j12.mjs:1680 */
export type TaskRuntime = 'subagent' | 'acp' | 'cron' | 'cli'

/**
 * TaskSummary. Schema src-7tzZ8j12.mjs:1677-1710 (closedObject: every field but id/status optional).
 * Built by mapTaskSummary task-summary-Cb8eETle.mjs:108-152, which ALWAYS sets id, taskId, kind, runtime,
 * status, title, sessionKey, hasTranscript, ownerKey, createdAt, updatedAt, deliveryStatus.
 * `prompt`/`result` only with includePrompt (tasks.get, tasks.retry/dismiss `task`) — never in
 * tasks.list, tasks.cancel or the `task` event.
 * 2026.6.5 (tasks-45-fMvsF.js:38-65) lacks hasTranscript, toolUseCount, lastToolName, lastActivity,
 * diffStat, deliveryStatus, terminalOutcome, prompt, result.
 */
export interface TaskSummary {
  id: string
  /** Same value as `id`. */
  taskId?: string
  /** `taskKind ?? runtime`: exec | automation_run | image_generation | music_generation | video_generation | context_engine_turn_maintenance | <runtime>. */
  kind?: string
  runtime?: TaskRuntime | string
  status: TaskLedgerStatus
  /** label || task text, sanitized, ≤80 chars, fallback "Background task" (task-status-BFjrFnwd.mjs:16, :76-81). */
  title?: string
  agentId?: string
  /** The REQUESTER session (task.requesterSessionKey). */
  sessionKey?: string
  childSessionKey?: string
  hasTranscript?: boolean
  ownerKey?: string
  runId?: string
  flowId?: string
  parentTaskId?: string
  sourceId?: string
  /** Schema allows ISO string or integer ms (src-7tzZ8j12.mjs:1656); the registry emits ms numbers. */
  createdAt?: number | string
  /** lastEventAt ?? endedAt ?? startedAt ?? createdAt (task-summary-Cb8eETle.mjs:99-101). */
  updatedAt?: number | string
  startedAt?: number | string
  endedAt?: number | string
  toolUseCount?: number
  lastToolName?: string
  /** since 2026.8; sanitized to ≤120 chars by the mapper (schema max 200). */
  lastActivity?: string
  /** since 2026.8 (src-7tzZ8j12.mjs:1671). */
  diffStat?: { files: number; added: number; removed: number }
  /** ≤120 chars (task-summary-Cb8eETle.mjs:113). */
  progressSummary?: string
  /** ≤120 chars (task-summary-Cb8eETle.mjs:114). */
  terminalSummary?: string
  /** ≤120 chars. */
  error?: string
  deliveryStatus?: TaskDeliveryStatus
  terminalOutcome?: TaskTerminalOutcome
  /** ≤4000 chars. subagent/acp: full progress result; other runtimes: terminal || progress (task-summary-Cb8eETle.mjs:118). */
  result?: string
  /** ≤4000 chars. */
  prompt?: string
}

/** src-7tzZ8j12.mjs:1713-1723. limit 1..500 (default 100, tasks-D9hXEMUl.mjs:128); cursor ≤512; sortBy since 2026.8. Closed object: unknown keys are INVALID_REQUEST. */
export interface TasksListParams {
  status?: TaskLedgerStatus | TaskLedgerStatus[]
  agentId?: string
  /** Matches requester, child or owner key; main aliases are canonicalized (tasks-D9hXEMUl.mjs:199-211, task-registry-BgL80S2s.mjs:792). */
  sessionKey?: string
  limit?: number
  cursor?: string
  sortBy?: 'updatedAt' | 'endedAt'
}

/** src-7tzZ8j12.mjs:1725-1728. Default order: updatedAt DESC, ties by taskId ASC (task-registry-BgL80S2s.mjs:826-831). */
export interface TasksListResult { tasks: TaskSummary[]; nextCursor?: string }

/** src-7tzZ8j12.mjs:1730-1732 */
export interface TasksGetParams { taskId: string }
export interface TasksGetResult { task: TaskSummary }

/** src-7tzZ8j12.mjs:1734-1744. limit 1..200, default 100 (tasks-D9hXEMUl.mjs:79); cursor 1..8192 chars, opaque. */
export interface TasksHistoryParams { taskId: string; cursor?: string; limit?: number }
/**
 * src-7tzZ8j12.mjs:1745-1749. `messages` are chat.history entries of the task's transcript session
 * (child session for subagents, else child || requester — task-summary-Cb8eETle.mjs:80-82). Offset 0 is the
 * NEWEST page; nextCursor pages OLDER. Page ≤4 MiB. Dedupe by messageId / __openclaw.id.
 */
export interface TasksHistoryResult { messages: unknown[]; nextCursor?: string }

/** src-7tzZ8j12.mjs:1751-1754 */
export interface TasksCancelParams { taskId: string; reason?: string }
/** src-7tzZ8j12.mjs:1756-1761. Always ok:true at the RPC level; failure is cancelled:false (+ reason when known). */
export interface TasksCancelResult { found: boolean; cancelled: boolean; reason?: string; task?: TaskSummary }

/** src-7tzZ8j12.mjs:1762-1765 — shared by tasks.retry and tasks.dismiss. */
export interface TasksRecoveryParams { taskIds: string[] }
/** src-7tzZ8j12.mjs:1766-1773. duplicateRisk only from tasks.retry (tasks-D9hXEMUl.mjs:358). */
export interface TaskRecoveryItem { taskId: string; ok: boolean; reason?: string; duplicateRisk?: boolean; task?: TaskSummary }
export interface TasksRecoveryResult { results: TaskRecoveryItem[] }

/** `task` event payload — full snapshots, not deltas (server-runtime-subscriptions-dSZ219Ld.mjs:1613-1637). */
export type TaskEventPayload =
  | { action: 'upserted'; task: TaskSummary }
  | { action: 'deleted'; taskId: string }
  | { action: 'restored' }

/** src-7tzZ8j12.mjs:5151-5160 */
export interface TaskSuggestion {
  id: string
  /** 1..60 chars */
  title: string
  /** 1..32768 chars */
  prompt: string
  /** 1..1024 chars */
  tldr: string
  /** absolute path */
  cwd: string
  sessionKey: string
  agentId?: string
  createdAt: number
}
/** src-7tzZ8j12.mjs:5162-5166 */
export interface TaskSuggestionsListParams { sessionKey?: string; agentId?: string }
export interface TaskSuggestionsListResult { suggestions: TaskSuggestion[] }
/** src-7tzZ8j12.mjs:5186-5197. mode defaults to "worktree" (task-suggestions-BfEdNAaD.mjs:475). */
export interface TaskSuggestionsAcceptParams { taskId: string; mode?: 'worktree' | 'local' | 'cloud' | 'session'; cloudProfileId?: string }
export interface TaskSuggestionsAcceptResult { taskId: string; key: string }
/** src-7tzZ8j12.mjs:5199-5206 — result carries taskId as well as dismissed. */
export interface TaskSuggestionsDismissParams { taskId: string; reason?: string }
export interface TaskSuggestionsDismissResult { taskId: string; dismissed: boolean }
/** src-7tzZ8j12.mjs:5208-5217 */
export type TaskSuggestionEventPayload =
  | { action: 'created'; suggestion: TaskSuggestion }
  | { action: 'resolved'; taskId: string; resolution: 'dismissed' | 'accepted' | 'expired' }

/** errorShape (error-codes-C3Z5XSDw.mjs:65-71); the frame is `{type:"res", id, ok:false, error}`. */
export interface GatewayErrorShape {
  code: 'INVALID_REQUEST' | 'FORBIDDEN' | 'UNAVAILABLE' | 'NOT_PAIRED' | 'APPROVAL_NOT_FOUND' | string
  message: string
  details?: Record<string, unknown>
  retryable?: boolean
  retryAfterMs?: number
}

/** Web Push body the gateway sends (server-start-DzfvczE1.mjs:2142-2148). */
export interface GatewayWebPushPayload { title: string; body: string; tag: string; renotify: false; url: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

export function resOk<T>(id: string, payload: T): GwResFrame {
  return { type: 'res', id, ok: true, payload }
}
export function resErr(id: string, error: GatewayErrorShape): GwResFrame {
  return { type: 'res', id, ok: false, error }
}
let seq = 400
export function taskEventFrame(payload: TaskEventPayload): GwEventFrame {
  seq += 1
  return { type: 'event', event: 'task', payload, seq }
}
export function suggestionEventFrame(payload: TaskSuggestionEventPayload): GwEventFrame {
  seq += 1
  return { type: 'event', event: 'task.suggestion', payload, seq }
}

// ── Session keys ──────────────────────────────────────────────────────────────

/** A JoaxClaw chat (requester) — the Control UI path is chat/main/dashboard/<uuid>. */
export const CHAT_KEY = 'agent:main:dashboard:4f1c2b3a-9d8e-4a71-b2c6-0e5f7d9a1c33'
export const MAIN_KEY = 'agent:main:main'
export const OTHER_CHAT_KEY = 'agent:researcher:dashboard:7a0e9c21-1b44-4f0b-9e36-5d2c8f1e6b07'
export const SUBAGENT_CHILD_KEY = 'agent:researcher:subagent:c3d9f1a2-6e5b-4c07-8a1d-2f4e6b8c0d19'

// ── TaskSummary samples (as tasks.list / `task` event carry them) ─────────────

/** Running subagent, requester = CHAT_KEY, 2026.9 activity fields present. */
export const TASK_SUBAGENT_RUNNING: TaskSummary = {
  id: '0b6f3c1e-8a2d-4e57-9c14-7d3a5e2f9b80',
  taskId: '0b6f3c1e-8a2d-4e57-9c14-7d3a5e2f9b80',
  kind: 'subagent',
  runtime: 'subagent',
  status: 'running',
  title: 'Research competitor pricing',
  agentId: 'researcher',
  sessionKey: CHAT_KEY,
  childSessionKey: SUBAGENT_CHILD_KEY,
  hasTranscript: true,
  ownerKey: CHAT_KEY,
  runId: 'run_8f2a61d0c4',
  createdAt: NOW - 3 * MIN - 20_000,
  updatedAt: NOW - 4_000,
  startedAt: NOW - 3 * MIN - 12_000,
  toolUseCount: 14,
  lastToolName: 'web_fetch',
  lastActivity: 'Fetching https://globex.io/plans',
  progressSummary: 'Found 3 tiers on acme.com; checking globex.io next.',
  deliveryStatus: 'pending',
}

/** Queued background command (exec, runtime cli) — no startedAt yet. */
export const TASK_EXEC_QUEUED: TaskSummary = {
  id: '5e1d2c7b-3f40-4a8e-b6d9-1c0a2e4f6b71',
  taskId: '5e1d2c7b-3f40-4a8e-b6d9-1c0a2e4f6b71',
  kind: 'exec',
  runtime: 'cli',
  status: 'queued',
  title: 'npm run test -- --coverage',
  agentId: 'main',
  sessionKey: CHAT_KEY,
  hasTranscript: true,
  ownerKey: CHAT_KEY,
  createdAt: NOW - 5_000,
  updatedAt: NOW - 5_000,
  deliveryStatus: 'not_applicable',
}

/** Needs you: completed + terminalOutcome blocked + deliveryStatus failed (subagent-completion-admission.store-9z9LjJoT.mjs:1235-1245). */
export const TASK_NEEDS_YOU: TaskSummary = {
  id: '9a4e7d21-0c3b-4f68-a5e2-8b1d6c9f0a42',
  taskId: '9a4e7d21-0c3b-4f68-a5e2-8b1d6c9f0a42',
  kind: 'subagent',
  runtime: 'subagent',
  status: 'completed',
  title: 'Summarize the inbox',
  agentId: 'researcher',
  sessionKey: CHAT_KEY,
  childSessionKey: 'agent:researcher:subagent:11aa22bb-33cc-44dd-55ee-66ff77008899',
  hasTranscript: true,
  ownerKey: CHAT_KEY,
  runId: 'run_1c9e40b7aa',
  createdAt: NOW - 42 * MIN,
  updatedAt: NOW - 30 * MIN,
  startedAt: NOW - 41 * MIN,
  endedAt: NOW - 31 * MIN,
  toolUseCount: 22,
  lastToolName: 'sessions_send',
  progressSummary: '12 unread threads; 3 need a reply today (Acme renewal, payroll, dentist).',
  terminalSummary: 'Required completion delivery failed before reaching the requester: requester session is not available.',
  error: 'requester session is not available',
  deliveryStatus: 'failed',
  terminalOutcome: 'blocked',
}

/** Completed + blocked but delivery already DISMISSED — must render Done, not Needs you (subagent-completion-delivery-D_jYLxNd.mjs:212-221). */
export const TASK_BLOCKED_DISMISSED: TaskSummary = {
  ...TASK_NEEDS_YOU,
  id: '2d8c6b4a-1e0f-4d93-8a27-c5b3e1f0d964',
  taskId: '2d8c6b4a-1e0f-4d93-8a27-c5b3e1f0d964',
  title: 'Draft follow-up emails',
  updatedAt: NOW - 20 * MIN,
  terminalSummary: 'Task completed; result delivery was dismissed by the operator.',
  deliveryStatus: 'dismissed',
  terminalOutcome: 'blocked',
}

/** Completed + delivered, with a 2026.8 diffStat. Ended 4 min ago (inside the strip's 10-min window). */
export const TASK_SUBAGENT_DONE: TaskSummary = {
  id: '7c2a9e5f-4b18-4d06-9e3c-a1f8d2b6c057',
  taskId: '7c2a9e5f-4b18-4d06-9e3c-a1f8d2b6c057',
  kind: 'subagent',
  runtime: 'subagent',
  status: 'completed',
  title: 'Draft the pricing table',
  agentId: 'researcher',
  sessionKey: CHAT_KEY,
  childSessionKey: 'agent:researcher:subagent:5b6c7d8e-9f00-4112-a334-b556c778d990',
  hasTranscript: true,
  ownerKey: CHAT_KEY,
  runId: 'run_4d7e22f915',
  createdAt: NOW - 7 * MIN,
  updatedAt: NOW - 4 * MIN,
  startedAt: NOW - 6 * MIN - 4_000,
  endedAt: NOW - 4 * MIN,
  toolUseCount: 9,
  lastToolName: 'write',
  diffStat: { files: 3, added: 120, removed: 8 },
  progressSummary: 'Wrote pricing.md with a 3×4 comparison table.',
  deliveryStatus: 'delivered',
  terminalOutcome: 'succeeded',
}

/** Completed 25 min ago — outside the strip's 10-min window unless it ended while the chat was open. */
export const TASK_DONE_STALE: TaskSummary = {
  ...TASK_SUBAGENT_DONE,
  id: 'e4f5a6b7-c8d9-4e0f-8a1b-2c3d4e5f6a7b',
  taskId: 'e4f5a6b7-c8d9-4e0f-8a1b-2c3d4e5f6a7b',
  title: 'Collect G2 reviews',
  createdAt: NOW - 40 * MIN,
  updatedAt: NOW - 25 * MIN,
  startedAt: NOW - 39 * MIN,
  endedAt: NOW - 25 * MIN,
  diffStat: undefined,
}

/** Failed image generation (media task), 2 h ago — inside the 24 h failed window. */
export const TASK_IMAGE_FAILED: TaskSummary = {
  id: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b',
  taskId: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b',
  kind: 'image_generation',
  runtime: 'cli',
  status: 'failed',
  title: 'Generate hero illustration',
  agentId: 'main',
  sessionKey: CHAT_KEY,
  hasTranscript: true,
  ownerKey: CHAT_KEY,
  sourceId: 'image_generate:img_77c1',
  createdAt: NOW - 2 * HOUR - 90_000,
  updatedAt: NOW - 2 * HOUR,
  startedAt: NOW - 2 * HOUR - 80_000,
  endedAt: NOW - 2 * HOUR,
  error: 'Provider rejected the prompt: content policy.',
  terminalSummary: 'Image generation failed: Provider rejected the prompt: content policy.',
  deliveryStatus: 'delivered',
}

/** Timed out 30 h ago — OUTSIDE the 24 h failed window. */
export const TASK_TIMED_OUT_OLD: TaskSummary = {
  id: 'a0b1c2d3-e4f5-4a6b-9c7d-8e9f0a1b2c3d',
  taskId: 'a0b1c2d3-e4f5-4a6b-9c7d-8e9f0a1b2c3d',
  kind: 'exec',
  runtime: 'cli',
  status: 'timed_out',
  title: 'rsync backups to nas',
  agentId: 'main',
  sessionKey: CHAT_KEY,
  hasTranscript: true,
  ownerKey: CHAT_KEY,
  createdAt: NOW - 31 * HOUR,
  updatedAt: NOW - 30 * HOUR,
  startedAt: NOW - 31 * HOUR,
  endedAt: NOW - 30 * HOUR,
  error: 'Command exceeded 3600s timeout.',
  deliveryStatus: 'not_applicable',
}

/** Cancelled by operator → label "Stopped", tone idle. */
export const TASK_CANCELLED: TaskSummary = {
  id: '3b4c5d6e-7f80-4912-a3b4-c5d6e7f8091a',
  taskId: '3b4c5d6e-7f80-4912-a3b4-c5d6e7f8091a',
  kind: 'exec',
  runtime: 'cli',
  status: 'cancelled',
  title: 'python scrape.py --all',
  agentId: 'main',
  sessionKey: CHAT_KEY,
  hasTranscript: true,
  ownerKey: CHAT_KEY,
  createdAt: NOW - 3 * MIN,
  updatedAt: NOW - 60_000,
  startedAt: NOW - 3 * MIN,
  endedAt: NOW - 60_000,
  terminalSummary: 'Cancelled by operator.',
  deliveryStatus: 'not_applicable',
}

/** Automation run (cron runtime, taskKind automation_run) on another agent's session — Dashboard only. */
export const TASK_AUTOMATION_RUNNING: TaskSummary = {
  id: 'c6d7e8f9-0a1b-4c2d-8e3f-4a5b6c7d8e9f',
  taskId: 'c6d7e8f9-0a1b-4c2d-8e3f-4a5b6c7d8e9f',
  kind: 'automation_run',
  runtime: 'cron',
  status: 'running',
  title: 'Morning brief',
  agentId: 'researcher',
  sessionKey: OTHER_CHAT_KEY,
  childSessionKey: 'agent:researcher:cron:morning-brief:run:1789739700000',
  hasTranscript: true,
  ownerKey: OTHER_CHAT_KEY,
  sourceId: 'cron:morning-brief',
  createdAt: NOW - 5 * MIN,
  updatedAt: NOW - 10_000,
  startedAt: NOW - 5 * MIN,
  toolUseCount: 3,
  lastToolName: 'calendar_list',
  deliveryStatus: 'pending',
}

/** Context-engine maintenance — kind label "Maintenance". Task with NO transcript (hasTranscript false). */
export const TASK_MAINTENANCE_NO_TRANSCRIPT: TaskSummary = {
  id: '8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b',
  taskId: '8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b',
  kind: 'context_engine_turn_maintenance',
  runtime: 'cli',
  status: 'completed',
  title: 'Background task',
  agentId: 'main',
  sessionKey: CHAT_KEY,
  hasTranscript: false,
  ownerKey: CHAT_KEY,
  createdAt: NOW - 2 * MIN,
  updatedAt: NOW - 90_000,
  startedAt: NOW - 2 * MIN,
  endedAt: NOW - 90_000,
  terminalSummary: 'Compacted 48 turns into 6.',
  deliveryStatus: 'not_applicable',
}

/** ACP coding agent with a string (ISO) timestamp — schema allows either (src-7tzZ8j12.mjs:1656). */
export const TASK_ACP_STRING_TIMES: TaskSummary = {
  id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  kind: 'acp',
  runtime: 'acp',
  status: 'running',
  title: 'Refactor gateway client',
  agentId: 'coder',
  sessionKey: CHAT_KEY,
  childSessionKey: 'agent:coder:acp:9f8e7d6c',
  hasTranscript: true,
  ownerKey: CHAT_KEY,
  createdAt: '2026-09-18T13:50:00.000Z',
  updatedAt: '2026-09-18T13:59:30.000Z',
  startedAt: '2026-09-18T13:50:02.000Z',
  deliveryStatus: 'pending',
}

/** Minimal / unknown values: unknown kind + runtime must survive parsing; title absent (schema-optional). */
export const TASK_UNKNOWN_KIND_MINIMAL: TaskSummary = {
  id: 'zz-legacy-0001',
  kind: 'podcast_generation',
  runtime: 'workflow',
  status: 'running',
}

/** Task matched to CHAT_KEY only through ownerKey (requester differs). */
export const TASK_OWNER_MATCH_ONLY: TaskSummary = {
  ...TASK_SUBAGENT_RUNNING,
  id: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c',
  taskId: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c',
  title: 'Owner-only match',
  sessionKey: 'agent:main:telegram:direct:5551234',
  childSessionKey: undefined,
  ownerKey: CHAT_KEY,
}

/** Title at the 80-char cap (formatTaskStatusTitleText). */
export const TASK_LONG_TITLE: TaskSummary = {
  ...TASK_SUBAGENT_RUNNING,
  id: '4c5d6e7f-8091-4a2b-b3c4-d5e6f708192a',
  taskId: '4c5d6e7f-8091-4a2b-b3c4-d5e6f708192a',
  title: 'Investigate why the nightly export to the data warehouse drops rows for EU accou',
}

/** 2026.6.5 shape (tasks-45-fMvsF.js:38-65): no hasTranscript / deliveryStatus / activity fields. */
export const TASK_2026_6_5_RUNNING: TaskSummary = {
  id: 'b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e',
  taskId: 'b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e',
  kind: 'subagent',
  runtime: 'subagent',
  status: 'running',
  title: 'Research competitor pricing',
  agentId: 'researcher',
  sessionKey: CHAT_KEY,
  childSessionKey: SUBAGENT_CHILD_KEY,
  ownerKey: CHAT_KEY,
  runId: 'run_0aa1bb2cc3',
  createdAt: NOW - 2 * MIN,
  updatedAt: NOW - 20_000,
  startedAt: NOW - 2 * MIN,
  progressSummary: 'Reading acme.com/pricing',
}

// ── tasks.list ────────────────────────────────────────────────────────────────

/** FR-1 active load, exactly as the app must send it. */
export const LIST_PARAMS_ACTIVE: TasksListParams = { status: ['queued', 'running'], limit: 500 }
/** FR-1 recent load. */
export const LIST_PARAMS_RECENT: TasksListParams = {
  status: ['completed', 'failed', 'timed_out', 'cancelled'], sortBy: 'endedAt', limit: 100,
}
/** FR-2 per-chat load. */
export const LIST_PARAMS_SESSION: TasksListParams = { sessionKey: CHAT_KEY, limit: 100 }

/** Gateway order (updatedAt DESC) — NOT the app's display order. */
export const LIST_ACTIVE_RESULT: TasksListResult = {
  tasks: [TASK_EXEC_QUEUED, TASK_SUBAGENT_RUNNING, TASK_AUTOMATION_RUNNING],
}
/** A page with more to come. Cursor format "1.<offset>.<taskRevision>.<accessRevision>.<binding>" (tasks-D9hXEMUl.mjs:155-163) — opaque to clients. */
export const LIST_RECENT_PAGE_1: TasksListResult = {
  tasks: [TASK_CANCELLED, TASK_SUBAGENT_DONE, TASK_NEEDS_YOU, TASK_IMAGE_FAILED],
  nextCursor: '1.4.9182.37.pQ2v8K0xWm3nY6tR1sZ4uA7bC9dE0fG2hJ5kL8mN1oP',
}
export const LIST_RECENT_PAGE_2: TasksListResult = { tasks: [TASK_TIMED_OUT_OLD] }
export const LIST_SESSION_RESULT: TasksListResult = {
  tasks: [
    TASK_EXEC_QUEUED, TASK_SUBAGENT_RUNNING, TASK_CANCELLED, TASK_MAINTENANCE_NO_TRANSCRIPT,
    TASK_SUBAGENT_DONE, TASK_BLOCKED_DISMISSED, TASK_DONE_STALE, TASK_NEEDS_YOU, TASK_IMAGE_FAILED, TASK_TIMED_OUT_OLD,
  ],
}
export const LIST_EMPTY: TasksListResult = { tasks: [] }
/** 2026.6.5 cursor is a plain numeric offset string (tasks-45-fMvsF.js:89-94, :116). */
export const LIST_2026_6_5_RESULT: TasksListResult = { tasks: [TASK_2026_6_5_RUNNING], nextCursor: '100' }

// ── tasks.get ─────────────────────────────────────────────────────────────────

export const GET_RESULT_RUNNING: TasksGetResult = {
  task: {
    ...TASK_SUBAGENT_RUNNING,
    prompt: 'Research the pricing pages of acme.com, globex.io and initech.dev. For each, list tiers, monthly price, seat limits and any annual discount. Save the comparison to pricing.md.',
    result: 'Found 3 tiers on acme.com; checking globex.io next.',
  },
}
export const GET_RESULT_NEEDS_YOU: TasksGetResult = {
  task: {
    ...TASK_NEEDS_YOU,
    prompt: 'Read my inbox and summarize what needs attention today.',
    result: '## Inbox summary\n\n12 unread threads. **Reply today:**\n\n1. Acme renewal — they want a call Thursday.\n2. Payroll — approve September run.\n3. Dentist — confirm Monday 9:00.',
  },
}
/** Oversize result: truncated to 4000 chars by the gateway (TASK_RESULT_MAX_CHARS). */
export const GET_RESULT_OVERSIZE: TasksGetResult = {
  task: { ...TASK_SUBAGENT_DONE, prompt: 'Draft the pricing table.', result: `${'| Tier | Price | Seats |\n'.repeat(165)}…`.slice(0, 4000) },
}
/** No prompt/result at all (e.g. empty texts, or 2026.6.5 which never includes them). */
export const GET_RESULT_NO_PROMPT: TasksGetResult = { task: { ...TASK_MAINTENANCE_NO_TRANSCRIPT } }

// ── tasks.history ─────────────────────────────────────────────────────────────

export const HISTORY_PARAMS_HEAD: TasksHistoryParams = { taskId: TASK_SUBAGENT_RUNNING.id, limit: 50 }

/** chat.history entries of the child session (same objects chat.history returns). */
export const HISTORY_PAGE_HEAD: TasksHistoryResult = {
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Research the pricing pages of acme.com, globex.io and initech.dev.' }],
      timestamp: NOW - 3 * MIN - 10_000,
      __openclaw: { id: 'e_01J8ZK1', seq: 1 },
    },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Starting with acme.com.' },
        { type: 'toolCall', id: 'call_a1', name: 'web_fetch', arguments: { url: 'https://acme.com/pricing' } },
      ],
      model: 'claude-sonnet-4-5',
      timestamp: NOW - 3 * MIN,
      __openclaw: { id: 'e_01J8ZK2', seq: 2 },
    },
    {
      role: 'toolResult',
      toolCallId: 'call_a1',
      toolName: 'web_fetch',
      content: [{ type: 'text', text: 'Starter $12/mo · Team $39/mo · Enterprise: contact sales' }],
      isError: false,
      timestamp: NOW - 2 * MIN - 50_000,
      __openclaw: { id: 'e_01J8ZK3', seq: 3 },
    },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Found 3 tiers: Starter $12, Team $39, Enterprise.' },
        { type: 'toolCall', id: 'call_a2', name: 'web_fetch', arguments: { url: 'https://globex.io/plans' } },
      ],
      timestamp: NOW - 2 * MIN - 40_000,
      __openclaw: { id: 'e_01J8ZK4', seq: 4 },
    },
  ],
  nextCursor: 'WyJxVjl3...binding...IiwiNTAiXQ',
}
/** Older page (via nextCursor) — ends the history. */
export const HISTORY_PAGE_OLDER: TasksHistoryResult = {
  messages: [
    { role: 'system', content: 'Subagent context: researcher', timestamp: NOW - 3 * MIN - 12_000, __openclaw: { id: 'e_01J8ZK0', seq: 0 } },
  ],
}
/** Head refresh overlapping the previous head (merge must dedupe by __openclaw.id). */
export const HISTORY_PAGE_HEAD_REFRESH: TasksHistoryResult = {
  messages: [
    ...HISTORY_PAGE_HEAD.messages.slice(2),
    {
      role: 'toolResult', toolCallId: 'call_a2', toolName: 'web_fetch',
      content: [{ type: 'text', text: 'Free · Pro $29 · Business $79' }], isError: false,
      timestamp: NOW - 2 * MIN, __openclaw: { id: 'e_01J8ZK5', seq: 5 },
    },
  ],
  nextCursor: 'WyJxVjl3...binding...IiwiNTIiXQ',
}
export const HISTORY_EMPTY: TasksHistoryResult = { messages: [] }
/** R2: harness-backed history (no session transcript) — shape is harness-defined, may be unknown to toChatMessages. */
export const HISTORY_HARNESS_UNKNOWN_SHAPE: TasksHistoryResult = {
  messages: [{ kind: 'codex.item', item: { type: 'reasoning', summary: 'Planning refactor' } }],
}

// ── tasks.cancel ──────────────────────────────────────────────────────────────

export const CANCEL_PARAMS: TasksCancelParams = { taskId: TASK_SUBAGENT_RUNNING.id }
export const CANCEL_OK: TasksCancelResult = {
  found: true,
  cancelled: true,
  task: { ...TASK_SUBAGENT_RUNNING, status: 'cancelled', endedAt: NOW, updatedAt: NOW, terminalSummary: 'Cancelled by operator.' },
}
/** task-registry-BgL80S2s.mjs:2018 */
export const CANCEL_ALREADY_TERMINAL: TasksCancelResult = {
  found: true, cancelled: false, reason: 'Task is already terminal.', task: TASK_SUBAGENT_DONE,
}
/** task-registry-BgL80S2s.mjs:2054 */
export const CANCEL_NO_HANDLE: TasksCancelResult = {
  found: true, cancelled: false, reason: 'Background command has no active cancellation handle.', task: { ...TASK_EXEC_QUEUED, status: 'running' },
}
/** task-registry-BgL80S2s.mjs:2002-2004 */
export const CANCEL_NOT_FOUND: TasksCancelResult = { found: false, cancelled: false, reason: 'Task not found.' }
/** Write-access denied by session sharing: NO reason (tasks-D9hXEMUl.mjs:310-320). UI needs a fallback text. */
export const CANCEL_DENIED_NO_REASON: TasksCancelResult = { found: false, cancelled: false }

// ── tasks.retry / tasks.dismiss ───────────────────────────────────────────────

export const RECOVERY_PARAMS: TasksRecoveryParams = { taskIds: [TASK_NEEDS_YOU.id] }
/** Suspended delivery re-driven: ok + duplicateRisk + task back to delivery pending/succeeded (subagent-completion-delivery-D_jYLxNd.mjs:22-34, :199-203). */
export const RETRY_OK: TasksRecoveryResult = {
  results: [{
    taskId: TASK_NEEDS_YOU.id,
    ok: true,
    duplicateRisk: true,
    task: {
      ...GET_RESULT_NEEDS_YOU.task,
      updatedAt: NOW,
      deliveryStatus: 'pending',
      terminalOutcome: 'succeeded',
      terminalSummary: undefined,
      error: undefined,
    },
  }],
}
/** In-progress delivery re-scheduled: ok WITHOUT duplicateRisk (subagent-completion-delivery-D_jYLxNd.mjs:157-163). */
export const RETRY_OK_NO_DUP_FLAG: TasksRecoveryResult = {
  results: [{ taskId: TASK_NEEDS_YOU.id, ok: true, task: { ...GET_RESULT_NEEDS_YOU.task, deliveryStatus: 'pending' } }],
}
export const RETRY_NOT_BLOCKED: TasksRecoveryResult = {
  results: [{ taskId: TASK_NEEDS_YOU.id, ok: false, reason: 'completion delivery is not blocked' }],
}
export const RETRY_LIMIT: TasksRecoveryResult = {
  results: [{ taskId: TASK_NEEDS_YOU.id, ok: false, reason: 'completion delivery redrive limit reached' }],
}
export const RETRY_NO_RECOVERABLE: TasksRecoveryResult = {
  results: [{ taskId: TASK_IMAGE_FAILED.id, ok: false, reason: 'task has no recoverable subagent completion' }],
}
/** Access-denied item (tasks-D9hXEMUl.mjs:346-350). */
export const RETRY_DENIED: TasksRecoveryResult = {
  results: [{ taskId: TASK_NEEDS_YOU.id, ok: false, reason: 'task not found' }],
}
/** Dismiss: deliveryStatus → dismissed, terminalOutcome STAYS blocked (subagent-completion-delivery-D_jYLxNd.mjs:212-221). */
export const DISMISS_OK: TasksRecoveryResult = {
  results: [{
    taskId: TASK_NEEDS_YOU.id,
    ok: true,
    task: {
      ...GET_RESULT_NEEDS_YOU.task,
      updatedAt: NOW,
      deliveryStatus: 'dismissed',
      terminalOutcome: 'blocked',
      terminalSummary: 'Task completed; result delivery was dismissed by the operator.',
    },
  }],
}
export const DISMISS_NOT_BLOCKED: TasksRecoveryResult = {
  results: [{ taskId: TASK_NEEDS_YOU.id, ok: false, reason: 'completion delivery is not blocked' }],
}

// ── `task` event ──────────────────────────────────────────────────────────────

export const EVT_UPSERT_COMPLETED: TaskEventPayload = {
  action: 'upserted',
  task: {
    ...TASK_SUBAGENT_RUNNING,
    status: 'completed',
    updatedAt: NOW + 5_000,
    endedAt: NOW + 5_000,
    toolUseCount: 17,
    lastToolName: 'write',
    deliveryStatus: 'delivered',
    terminalOutcome: 'succeeded',
  },
}
/** Running progress tick (snapshot, not a delta — every field present again). */
export const EVT_UPSERT_PROGRESS: TaskEventPayload = {
  action: 'upserted',
  task: { ...TASK_SUBAGENT_RUNNING, updatedAt: NOW + 2_000, toolUseCount: 15, lastToolName: 'web_search' },
}
/** A new task matched to an open chat only through childSessionKey. */
export const EVT_UPSERT_NEW_CHILD_MATCH: TaskEventPayload = {
  action: 'upserted',
  task: {
    ...TASK_SUBAGENT_RUNNING,
    id: 'd1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6',
    taskId: 'd1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6',
    title: 'Nested helper',
    sessionKey: SUBAGENT_CHILD_KEY,
    ownerKey: SUBAGENT_CHILD_KEY,
    childSessionKey: CHAT_KEY,
    parentTaskId: TASK_SUBAGENT_RUNNING.id,
    status: 'queued',
    startedAt: undefined,
    toolUseCount: undefined,
    lastToolName: undefined,
  },
}
/** Failed → also triggers the background-task-failed Web Push. */
export const EVT_UPSERT_FAILED: TaskEventPayload = {
  action: 'upserted',
  task: { ...TASK_SUBAGENT_RUNNING, status: 'failed', updatedAt: NOW + 9_000, endedAt: NOW + 9_000, error: 'Model provider returned 529 overloaded.', deliveryStatus: 'delivered' },
}
export const EVT_UPSERT_NEEDS_YOU: TaskEventPayload = { action: 'upserted', task: TASK_NEEDS_YOU }
export const EVT_DELETED: TaskEventPayload = { action: 'deleted', taskId: TASK_TIMED_OUT_OLD.id }
export const EVT_RESTORED: TaskEventPayload = { action: 'restored' }

// ── taskSuggestions.* / task.suggestion (03-e: held, out of sprint) ───────────

export const SUGGESTION: TaskSuggestion = {
  id: 'sug_2f7c1a9e4b',
  title: 'Add retry to the export job',
  prompt: 'The nightly export fails on transient 503s. Add exponential backoff (3 attempts) around the upload step in scripts/export.ts and a test.',
  tldr: 'Retry transient 503s in the nightly export.',
  cwd: '/home/joaxap/repos/warehouse',
  sessionKey: CHAT_KEY,
  agentId: 'main',
  createdAt: NOW - 90_000,
}
export const SUGGESTION_NO_AGENT: TaskSuggestion = {
  id: 'sug_9b0d3e6f21', title: 'Pin the Node version', prompt: 'Add an .nvmrc with Node 24.', tldr: 'Pin Node 24.',
  cwd: '/home/joaxap/repos/warehouse', sessionKey: MAIN_KEY, createdAt: NOW - 30_000,
}
export const SUGGESTIONS_LIST: TaskSuggestionsListResult = { suggestions: [SUGGESTION, SUGGESTION_NO_AGENT] }
export const SUGGESTIONS_EMPTY: TaskSuggestionsListResult = { suggestions: [] }
/** "Start in a new chat" = mode local (the Control UI sends exactly this). */
export const SUGGESTION_ACCEPT_PARAMS: TaskSuggestionsAcceptParams = { taskId: SUGGESTION.id, mode: 'local' }
export const SUGGESTION_ACCEPT_RESULT: TaskSuggestionsAcceptResult = {
  taskId: SUGGESTION.id, key: 'agent:main:dashboard:0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b',
}
export const SUGGESTION_DISMISS_PARAMS: TaskSuggestionsDismissParams = { taskId: SUGGESTION.id }
export const SUGGESTION_DISMISS_RESULT: TaskSuggestionsDismissResult = { taskId: SUGGESTION.id, dismissed: true }
/** Not visible / already gone: still ok:true (task-suggestions-BfEdNAaD.mjs:571-576). */
export const SUGGESTION_DISMISS_NOOP: TaskSuggestionsDismissResult = { taskId: SUGGESTION.id, dismissed: false }
export const EVT_SUGGESTION_CREATED: TaskSuggestionEventPayload = { action: 'created', suggestion: SUGGESTION }
export const EVT_SUGGESTION_RESOLVED: TaskSuggestionEventPayload = { action: 'resolved', taskId: SUGGESTION.id, resolution: 'accepted' }
export const EVT_SUGGESTION_EXPIRED: TaskSuggestionEventPayload = { action: 'resolved', taskId: SUGGESTION_NO_AGENT.id, resolution: 'expired' }

// ── Error frames (as `res.error`; the app rejects with Error{message: JSON, gatewayError}) ──

/** tasks-D9hXEMUl.mjs:177-179 */
export const ERR_LIST_CURSOR_EXPIRED: GatewayErrorShape = {
  code: 'INVALID_REQUEST', message: 'invalid or expired tasks.list cursor; restart pagination without a cursor',
}
/** tasks-D9hXEMUl.mjs:283-286 */
export const ERR_LIST_UNSTABLE: GatewayErrorShape = {
  code: 'UNAVAILABLE', message: 'Task activity did not stabilize. Wait a moment, then refresh Tasks.', retryable: true, retryAfterMs: 250,
}
/** 2026.6.5 non-numeric cursor (tasks-45-fMvsF.js:103). */
export const ERR_LIST_CURSOR_2026_6_5: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'invalid tasks.list cursor' }
/** validation-Cn7ErDZ-.mjs:8 — e.g. sortBy sent to a 2026.7 gateway, or limit 501. */
export const ERR_LIST_INVALID_PARAMS: GatewayErrorShape = {
  code: 'INVALID_REQUEST', message: 'invalid tasks.list params: at /limit: must be <= 500',
}
/** session-request-agent-Cfk3LJ1t.mjs:46-51 */
export const ERR_LIST_UNKNOWN_AGENT: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'Unknown agent id "ghost"' }
/** tasks.get (tasks-D9hXEMUl.mjs:297) — lowercase + id. */
export const ERR_GET_NOT_FOUND: GatewayErrorShape = {
  code: 'INVALID_REQUEST', message: `task not found: ${TASK_TIMED_OUT_OLD.id}`,
}
/** tasks.history (tasks-D9hXEMUl.mjs:51) — capitalised, no id. */
export const ERR_HISTORY_NOT_FOUND: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'Task not found.' }
/** tasks-D9hXEMUl.mjs:59 / :83 */
export const ERR_HISTORY_BAD_CURSOR: GatewayErrorShape = {
  code: 'INVALID_REQUEST', message: 'Invalid task history cursor. Refresh the task.',
}
/** tasks-D9hXEMUl.mjs:119 → d.noTranscript */
export const ERR_HISTORY_NO_TRANSCRIPT: GatewayErrorShape = {
  code: 'UNAVAILABLE', message: 'This task has no readable transcript.',
}
/** tasks-D9hXEMUl.mjs:121 — any throw incl. >4 MiB page or access change mid-read. NOT a "no transcript" case. */
export const ERR_HISTORY_UNAVAILABLE: GatewayErrorShape = {
  code: 'UNAVAILABLE', message: "Unable to load this task's transcript. Refresh the task and try again.",
}
/** error-codes-C3Z5XSDw.mjs:82-85 — e.g. read-only token calling tasks.cancel. */
export const ERR_MISSING_WRITE: GatewayErrorShape = {
  code: 'FORBIDDEN',
  message: 'missing scope: operator.write',
  details: { code: 'MISSING_SCOPE', missingScope: 'operator.write', requiredScopes: ['operator.write'] },
}
export const ERR_MISSING_ADMIN_ACCEPT: GatewayErrorShape = {
  code: 'FORBIDDEN',
  message: 'missing scope: operator.admin',
  details: { code: 'MISSING_SCOPE', missingScope: 'operator.admin', requiredScopes: ['operator.admin'] },
}
/** server-methods-v1T0byyX.mjs:396 — tasks.history on 2026.8, tasks.retry on 2026.6.5, etc. */
export const ERR_UNKNOWN_HISTORY: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'unknown method: tasks.history' }
export const ERR_UNKNOWN_RETRY: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'unknown method: tasks.retry' }
/** task-suggestions-BfEdNAaD.mjs:169, :527 */
export const ERR_SUGGESTION_NOT_FOUND: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'task suggestion was not found' }
export const ERR_SUGGESTION_NOT_ACCEPTABLE: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'task suggestion cannot be accepted: dismissed' }
/** joaxclaw-fs plugin (plugins/joaxclaw-fs/index.js:1330) */
export const ERR_JOB_UNKNOWN: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'unknown jobId' }

// ── Web Push (background-task-failed) ─────────────────────────────────────────

/** Requester session known, no public origin configured → bare relative path. */
export const PUSH_TASK_FAILED: GatewayWebPushPayload = {
  title: 'OpenClaw background task failed',
  body: 'Research competitor pricing needs attention.',
  tag: `openclaw-task-failed-${TASK_SUBAGENT_RUNNING.id}`,
  renotify: false,
  url: 'chat/main/dashboard/4f1c2b3a-9d8e-4a71-b2c6-0e5f7d9a1c33',
}
/** Public origin configured → `#gatewayUrl=` fragment appended (control-ui-shared-DqFhbHR8.mjs:11-17). */
export const PUSH_TASK_FAILED_WITH_ORIGIN: GatewayWebPushPayload = {
  ...PUSH_TASK_FAILED,
  url: 'chat/main/dashboard/4f1c2b3a-9d8e-4a71-b2c6-0e5f7d9a1c33#gatewayUrl=wss%3A%2F%2Fgw.example.com%2Fui',
}
/** Requester is the agent's main session → `chat/<agentId>` only. */
export const PUSH_TASK_FAILED_MAIN: GatewayWebPushPayload = {
  ...PUSH_TASK_FAILED, title: 'OpenClaw background task failed', body: 'researcher: A background task needs attention.', url: 'chat/researcher',
}
/** Single short-hex or reserved segment → `~key/` form (session-key-PQkfotIJ.mjs:85-88). agent:main:4f1c2b3a */
export const PUSH_TASK_FAILED_TILDE_KEY: GatewayWebPushPayload = { ...PUSH_TASK_FAILED, url: 'chat/main/~key/4f1c2b3a' }
/** Encoded segments: "." → %2E, leading "~" doubled (session-key-PQkfotIJ.mjs:66-71). agent:main:telegram:group:~ops.team */
export const PUSH_TASK_FAILED_ENCODED: GatewayWebPushPayload = { ...PUSH_TASK_FAILED, url: 'chat/main/telegram/group/~~ops%2Eteam' }
/** No requester session → fallback path "tasks" (server-start-DzfvczE1.mjs:2101). */
export const PUSH_TASK_FAILED_NO_SESSION: GatewayWebPushPayload = {
  ...PUSH_TASK_FAILED, body: 'A background task needs attention.', url: 'tasks',
}
/** detailLevel "private" + no id → tag fallback "failed" (server-start-DzfvczE1.mjs:2037). */
export const PUSH_TASK_FAILED_NO_ID: GatewayWebPushPayload = {
  ...PUSH_TASK_FAILED, body: 'A background task needs attention.', tag: 'openclaw-task-failed-failed', url: 'tasks',
}
/** Cron failures are a DIFFERENT category/tag — must not open a task drawer. */
export const PUSH_CRON_FAILED: GatewayWebPushPayload = {
  title: 'OpenClaw scheduled task failed', body: 'Morning brief needs attention.', tag: 'openclaw-cron-failed-morning-brief', renotify: false,
  url: 'automations?job=morning-brief&run=morning-brief%3A1789739700000',
}
export const PUSH_QUESTION: GatewayWebPushPayload = {
  title: 'OpenClaw needs an answer', body: 'An agent has a question for you.', tag: 'openclaw-question-q_81f2', renotify: false, url: 'ask/q_81f2',
}

/** Expected pushToNavigate outcomes (PRD §5.9 + source). */
export const PUSH_NAV_EXPECTATIONS: ReadonlyArray<{ input: { url?: string; tag?: string }; expected: { section: string; sessionKey?: string; taskId?: string } | undefined }> = [
  { input: { url: PUSH_TASK_FAILED.url, tag: PUSH_TASK_FAILED.tag }, expected: { section: 'chat', sessionKey: CHAT_KEY, taskId: TASK_SUBAGENT_RUNNING.id } },
  { input: { url: PUSH_TASK_FAILED_WITH_ORIGIN.url, tag: PUSH_TASK_FAILED.tag }, expected: { section: 'chat', sessionKey: CHAT_KEY, taskId: TASK_SUBAGENT_RUNNING.id } },
  { input: { url: 'chat/main' }, expected: { section: 'chat', sessionKey: 'agent:main:main' } },
  { input: { url: 'chat/main/dashboard/4f1c' }, expected: { section: 'chat', sessionKey: 'agent:main:dashboard:4f1c' } },
  { input: { url: PUSH_TASK_FAILED_TILDE_KEY.url }, expected: { section: 'chat', sessionKey: 'agent:main:4f1c2b3a' } },
  { input: { url: PUSH_TASK_FAILED_ENCODED.url }, expected: { section: 'chat', sessionKey: 'agent:main:telegram:group:~ops.team' } },
  { input: { tag: 'openclaw-task-failed-abc' }, expected: { section: 'chat', taskId: 'abc' } },
  { input: { url: 'tasks', tag: 'openclaw-task-failed-abc' }, expected: { section: 'chat', taskId: 'abc' } },
  { input: { url: PUSH_CRON_FAILED.url, tag: PUSH_CRON_FAILED.tag }, expected: { section: 'crons' } },
  { input: { url: PUSH_QUESTION.url, tag: PUSH_QUESTION.tag }, expected: { section: 'chat' } },
  { input: { url: 'approve/abc123', tag: 'openclaw-approval-abc123' }, expected: undefined },
]

// ── Script jobs (joaxclaw-fs jobs.*; plugins/joaxclaw-fs/index.js:755-771) ───

export const JOB_RUNNING_PERCENT: ScriptJob = {
  id: '3f9a1c2e-5b7d-4e80-9a12-b3c4d5e6f708', command: 'npm run build', cwd: '/home/joaxap/repos/site',
  running: true, done: false, exitCode: null, error: null, percent: 41,
  startedAt: NOW - 41_000, finishedAt: null, elapsedMs: 41_000, sessionKey: CHAT_KEY,
}
export const JOB_DONE_OK: ScriptJob = {
  id: '4a0b2d3f-6c8e-4f91-8b23-c4d5e6f70819', command: 'pytest -q', cwd: '/home/joaxap/repos/api',
  running: false, done: true, exitCode: 0, error: null, percent: null,
  startedAt: NOW - 3 * MIN, finishedAt: NOW - 2 * MIN, elapsedMs: 60_000, sessionKey: CHAT_KEY,
  output: '........................ 24 passed in 58.1s\n', outputTruncated: false,
}
export const JOB_DONE_FAIL: ScriptJob = {
  id: '5b1c3e40-7d9f-4a02-9c34-d5e6f708192a', command: 'make deploy', cwd: '/home/joaxap/repos/api',
  running: false, done: true, exitCode: 2, error: null, percent: null,
  startedAt: NOW - 6 * MIN, finishedAt: NOW - 5 * MIN, elapsedMs: 61_000, sessionKey: CHAT_KEY,
}
/** Job from another chat — must not appear in CHAT_KEY's strip. */
export const JOB_OTHER_SESSION: ScriptJob = { ...JOB_RUNNING_PERCENT, id: '6c2d4f51-8e0a-4b13-8d45-e6f708192a3b', sessionKey: OTHER_CHAT_KEY, percent: null }
/** Pre-0.11.5 plugin: no sessionKey. */
export const JOB_NO_SESSION: ScriptJob = { ...JOB_DONE_OK, id: '7d3e5062-9f1b-4c24-9e56-f708192a3b4c', sessionKey: undefined }
/** jobs.list result (no output fields). */
export const JOBS_LIST: { jobs: ScriptJob[] } = {
  jobs: [JOB_RUNNING_PERCENT, JOB_DONE_OK, JOB_DONE_FAIL, JOB_OTHER_SESSION].map(({ output: _o, outputTruncated: _t, ...rest }) => rest),
}
