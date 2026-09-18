// Chat goals (PRD 04) — real wire shapes from the OpenClaw 2026.9.4 gateway source (QA, sprint 2026.9).
// All `dist/…` paths are relative to the 2026.9.4 package. Values are realistic but invented.
//
// Where the shapes live:
//   SessionGoal / goal RPC params / mutation result ...... dist/sessions-goal-U8Cv3IfC.mjs:398-474
//   chat.send + intent ................................... dist/sessions-rlbLHLas.mjs:1743-1780
//   goal RPC handler (errors, sessions.changed emit) ..... dist/sessions-goal-IoWLbKRI.mjs:14-155
//   goal transitions / receipts / error codes ............ dist/session-accessor-BxcCxteu.mjs:4427-4661
//   goal start/resume through chat.send .................. dist/chat-send-handler-oS9rX200.mjs:3329-3462, 4386-4402, 4800-4940
//   sessions.changed payload (goal: row.goal ?? null) .... dist/session-event-payload-6znNKcu1.mjs:9-92
//   error frame shape .................................... dist/sessions-rlbLHLas.mjs:1412 (ErrorShapeSchema)
//
// 2026.6.5 (globally installed, older): has goals on session rows/events and the /goal command +
// update_goal tool, but NO sessions.goal.* methods, NO `intent` on chat.send and NO
// `session-goal-start-v1` capability.

// ── Constants ────────────────────────────────────────────────────────────────

/** "Now" for these fixtures: 2026-09-18 ≈ 1789700000000 ms. */
export const NOW = 1789700000000
export const SESSION_KEY = 'agent:main:dashboard:4b1f7a2e-93c6-4d0e-a5f1-2c8e9d71b3a4'
export const SESSION_ID = 'c0d7e1f2-58a3-4b9e-8f11-6a2d4e9b7c05'
export const AGENT_ID = 'main'
export const GOAL_ID = '9e4b2c71-0f3a-4d58-b6e2-7a1c5d8f3e90'
/** A different goal id — the "replacement goal" in goal-rebound cases. */
export const OTHER_GOAL_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
/** nanoid(21)-style operation ids (≤128 chars, the schema limit). */
export const OP_START = 'V1StGXR8_Z5jdHi6B-myT'
export const OP_PAUSE = 'Uakgb_J5m9g-0JDMbcJqL'
export const OP_RESUME = 'd3F9kLmN0pQrStUvWxYz1'
export const OP_EDIT = 'a8Hk2LpQ9rSt3UvWx4Yz5'
export const OP_COMPLETE = 'q7Rt5YuI3oP1aS9dF2gH4'
export const OP_CLEAR = 'zX6cV4bN2mL8kJ0hG3fD5'
export const OBJECTIVE = 'Migrate billing to the v2 payments API and get the test suite green.'

// ── Gateway shapes (local, documenting the wire) ─────────────────────────────

/** dist/sessions-goal-U8Cv3IfC.mjs:398 (SessionGoalSchema, closed object). */
export type SessionGoalStatus = 'active' | 'paused' | 'blocked' | 'usage_limited' | 'budget_limited' | 'complete'

/**
 * dist/sessions-goal-U8Cv3IfC.mjs:398-423. Note `tokenStart` is REQUIRED and `tokenStartFresh`
 * optional — both missing from PRD §2.2. Built by buildCreatedSessionGoal
 * (dist/session-accessor-BxcCxteu.mjs:4470). On sessions.list rows it is a read-time projection
 * (accountSessionGoalUsage, :4448) so tokensUsed/status/updatedAt may differ from the stored record.
 */
export interface GwSessionGoal {
  schemaVersion: 1
  id: string
  objective: string
  status: SessionGoalStatus
  createdAt: number
  updatedAt: number
  tokenStart: number
  tokenStartFresh?: boolean
  tokensUsed: number
  tokenBudget?: number
  continuationTurns: number
  lastStatusNote?: string
  pausedAt?: number
  blockedAt?: number
  completedAt?: number
  usageLimitedAt?: number
  budgetLimitedAt?: number
}

/** dist/sessions-goal-U8Cv3IfC.mjs:424-434 (GoalOperationIdentity). */
export interface GwGoalOperationIdentity {
  sessionKey: string
  agentId?: string
  sessionId?: string
  goalId: string
  /** 1–128 chars. */
  operationId: string
  /** Integer ≥ 0; > gateway now + 5 min → reason "invalid"; + 24 h ≤ now → reason "expired". */
  issuedAtMs: number
}

/** dist/sessions-goal-U8Cv3IfC.mjs:435-451 (SessionsGoalUpdateParamsSchema, union of two closed objects). */
export type GwSessionsGoalUpdateParams =
  | (GwGoalOperationIdentity & { action: 'edit'; objective: string /* 1–16000 */ })
  | (GwGoalOperationIdentity & { action: 'pause' | 'resume' | 'complete' | 'block'; note?: string /* ≤2000 */ })

/** dist/sessions-goal-U8Cv3IfC.mjs:452 (identity fields only, closed). */
export type GwSessionsGoalClearParams = GwGoalOperationIdentity

/** dist/sessions-goal-U8Cv3IfC.mjs:453-474; status 'started' iff runId (dist/session-accessor-BxcCxteu.mjs:4608). */
export interface GwSessionsGoalMutationResult {
  operationId: string
  action: 'start' | 'edit' | 'pause' | 'resume' | 'complete' | 'block' | 'clear'
  sessionId: string
  goalId: string
  /** Absent after clear. */
  goal?: GwSessionGoal
  runId?: string
  /** Only when the receipt was replayed (dist/sessions-goal-IoWLbKRI.mjs:127-130). */
  replayed?: true
  status: 'started' | 'updated' | 'cleared'
}

/**
 * chat.send / sessions.goal.update(resume) ACK when a turn was admitted:
 * `{...goalResult, runId, status:"started", messageSeq?, interruptedActiveRun?, serverTiming?}`
 * (dist/chat-send-handler-oS9rX200.mjs:4931-4938). Extra fields beyond the closed result schema.
 */
export interface GwGoalTurnAck extends GwSessionsGoalMutationResult {
  runId: string
  messageSeq?: number
  interruptedActiveRun?: true
}

/** dist/sessions-rlbLHLas.mjs:1743 (ChatSendIntentSchema, closed). */
export interface GwChatSendIntent {
  kind: 'session-goal-start'
  version: 1
  issuedAtMs: number
}

/**
 * The goal-start subset of ChatSendParamsSchema (dist/sessions-rlbLHLas.mjs:1749). With `intent`,
 * the handler rejects thinking, fastMode, fastAutoOnSeconds, timeoutMs, deliver:true, toolBindings,
 * queueMode, origin fields and system-input fields; message must be non-blank, ≤16000 UTF-16 units,
 * already NFC and free of disallowed control chars; idempotencyKey ≤128
 * (dist/chat-send-handler-oS9rX200.mjs:4386-4393). idempotencyKey becomes the operationId (:4396-4401).
 */
export interface GwChatSendGoalStartParams {
  sessionKey: string
  agentId?: string
  sessionId?: string
  message: string
  intent: GwChatSendIntent
  idempotencyKey: string
}

/** dist/sessions-rlbLHLas.mjs:1412 (ErrorShapeSchema) + errorShape() dist/error-codes-C3Z5XSDw.mjs:65. */
export interface GwErrorShape {
  code: 'INVALID_REQUEST' | 'FORBIDDEN' | 'UNAVAILABLE' | 'NOT_PAIRED' | 'APPROVAL_NOT_FOUND' | string
  message: string
  details?: unknown
  retryable?: boolean
  retryAfterMs?: number
}

/** A rejected response frame: dist/sessions-rlbLHLas.mjs:1428 (ResponseFrameSchema). */
export interface GwErrorResponseFrame {
  type: 'res'
  id: string
  ok: false
  payload?: unknown
  error: GwErrorShape
}

/**
 * The goal-relevant slice of a `sessions.changed` payload. Top-level fields come from
 * buildGatewaySessionEventFields (dist/session-event-payload-6znNKcu1.mjs:9-92): `goal` is
 * `row.goal ?? null` — EXCEPT it is omitted entirely for the unscoped `global` row (:11, :92) and
 * for delete/no-row payloads (dist/session-change-event-njg2QdFD.mjs:39-41). Operator goal
 * changes carry reason:"goal" (dist/sessions-goal-IoWLbKRI.mjs:121-125); run lifecycle emits
 * carry phase:"start"|"end" (dist/server-chat-BP_fmUto.mjs:448-456, :1027-1035); a debounce
 * (100 ms / max 500 ms) may replace an earlier payload's reason with a later one (:94-103).
 */
export interface GwSessionsChangedGoalSlice {
  sessionKey?: string
  agentId?: string
  reason?: string
  phase?: string
  runId?: string
  ts: number
  sessionId?: string
  updatedAt?: number
  status?: string
  hasActiveRun?: boolean
  goal?: GwSessionGoal | null
  /** Full row copy when the snapshot was built with includeSession. */
  session?: Record<string, unknown>
}

/** A sessions.list / sessions.subscribe row: the published row schema is open (additionalProperties:true, dist/sessions-row-Dtn8TM28.mjs:231); `goal` is absent (not null) when the session has none (dist/session-utils-list-RGkE30m3.mjs:934-938, :1360). */
export interface GwSessionRowGoalSlice {
  key: string
  sessionId?: string
  status?: string
  updatedAt?: number
  goal?: GwSessionGoal
}

// ── SessionGoal records, every status ────────────────────────────────────────

const CREATED = NOW - 24 * 60_000 // "Pursuing · 24m"

export const goalActive: GwSessionGoal = {
  schemaVersion: 1,
  id: GOAL_ID,
  objective: OBJECTIVE,
  status: 'active',
  createdAt: CREATED,
  updatedAt: CREATED,
  tokenStart: 18_450,
  tokenStartFresh: true,
  tokensUsed: 41_200,
  continuationTurns: 0,
}

/** Minimal valid record: every optional field absent (fresh goal on a session with no token snapshot). */
export const goalMinimal: GwSessionGoal = {
  schemaVersion: 1,
  id: GOAL_ID,
  objective: 'Ship v2',
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
  tokenStart: 0,
  tokensUsed: 0,
  continuationTurns: 0,
}

/** Active, with a note left over from an earlier transition (lastStatusNote is never cleared on resume). */
export const goalActiveWithNote: GwSessionGoal = {
  ...goalActive,
  updatedAt: NOW - 3 * 60_000,
  lastStatusNote: '3 tests left',
}

export const goalPaused: GwSessionGoal = {
  ...goalActive,
  status: 'paused',
  updatedAt: NOW - 60_000,
  pausedAt: NOW - 60_000,
}

/** Agent called update_goal {status:"blocked", note}. */
export const goalBlocked: GwSessionGoal = {
  ...goalActive,
  status: 'blocked',
  updatedAt: NOW - 30_000,
  blockedAt: NOW - 30_000,
  lastStatusNote: 'No STRIPE_V2_KEY in the env.',
}

/** Budget crossed: set automatically when tokensUsed ≥ tokenBudget (dist/session-accessor-BxcCxteu.mjs:4462-4466). Only the model's create_goal can set tokenBudget. */
export const goalBudgetLimited: GwSessionGoal = {
  ...goalActive,
  status: 'budget_limited',
  tokenBudget: 50_000,
  tokensUsed: 50_312,
  updatedAt: NOW - 5_000,
  budgetLimitedAt: NOW - 5_000,
}

/** Reserved status — nothing in 2026.9.4 sets it, but the schema allows it. */
export const goalUsageLimited: GwSessionGoal = {
  ...goalActive,
  status: 'usage_limited',
  updatedAt: NOW - 5_000,
  usageLimitedAt: NOW - 5_000,
}

/** Terminal. "Done after 2h 10m · 188,400 tokens". */
export const goalComplete: GwSessionGoal = {
  ...goalActive,
  status: 'complete',
  createdAt: NOW - (2 * 60 + 10) * 60_000,
  updatedAt: NOW,
  completedAt: NOW,
  tokensUsed: 188_400,
  lastStatusNote: 'All 412 tests pass',
}

/** Max-length objective (16000 UTF-16 units) — the start/edit limit. */
export const OBJECTIVE_16000 = 'x'.repeat(16_000)
export const OBJECTIVE_16001 = 'x'.repeat(16_001)
/** Decomposed "é" (e + U+0301): must be NFC-normalised before chat.send, or the gateway rejects it. */
export const OBJECTIVE_NFD = 'Résumé the billing work'
export const OBJECTIVE_NFC = OBJECTIVE_NFD.normalize('NFC')
/** Contains U+000B (vertical tab), stripped by the sanitizer → start is rejected (dist/chat-origin-routing-DC1c5gdu.mjs:14-30). Tab/LF/CR are allowed. */
export const OBJECTIVE_WITH_CONTROL_CHAR = 'Ship v2now'

/** Loose-parse inputs: not valid SessionGoal records, for parseGoal edge cases. */
export const looseGoalInputs: Record<string, unknown> = {
  nullValue: null,
  undefinedValue: undefined,
  string: 'active',
  array: [goalActive],
  unknownStatus: { ...goalActive, status: 'archived' },
  numericStringTimestamps: { ...goalActive, createdAt: String(CREATED), updatedAt: String(CREATED) },
  missingId: { ...goalActive, id: undefined },
  futureSchemaVersion: { ...goalActive, schemaVersion: 2, extraField: true },
}

// ── Request params ───────────────────────────────────────────────────────────

/** F1: chat.send goal start. No thinking, no attachments, no timeoutMs field. */
export const startParams: GwChatSendGoalStartParams = {
  sessionKey: SESSION_KEY,
  message: 'Ship v2',
  intent: { kind: 'session-goal-start', version: 1, issuedAtMs: NOW },
  idempotencyKey: OP_START,
}

/** Rejected: carries `thinking` (the app's normal send path adds it). */
export const startParamsWithThinking = { ...startParams, thinking: 'high' }

const identity = (operationId: string, issuedAtMs = NOW): GwGoalOperationIdentity => ({
  sessionKey: SESSION_KEY,
  goalId: GOAL_ID,
  operationId,
  issuedAtMs,
})

export const pauseParams: GwSessionsGoalUpdateParams = { ...identity(OP_PAUSE), action: 'pause' }
export const resumeParams: GwSessionsGoalUpdateParams = { ...identity(OP_RESUME), action: 'resume' }
export const continueParams: GwSessionsGoalUpdateParams = { ...identity(OP_RESUME), action: 'resume', note: 'The key is in the vault now.' }
export const completeParams: GwSessionsGoalUpdateParams = { ...identity(OP_COMPLETE), action: 'complete' }
export const editParams: GwSessionsGoalUpdateParams = {
  ...identity(OP_EDIT),
  action: 'edit',
  objective: 'Migrate billing to the v2 payments API, get the test suite green, and update the docs.',
}
export const clearParams: GwSessionsGoalClearParams = identity(OP_CLEAR)
/** With the optional sessionId pin: a mismatch → "Session changed or was removed; refresh its Goal." */
export const pauseParamsPinned: GwSessionsGoalUpdateParams = { ...identity(OP_PAUSE), sessionId: SESSION_ID, agentId: AGENT_ID, action: 'pause' }
/** Schema-invalid: note over 2000. */
export const pauseParamsNoteTooLong = { ...identity(OP_PAUSE), action: 'pause', note: 'n'.repeat(2001) }
/** Schema-invalid: `note` is not allowed on edit (closed object). */
export const editParamsWithNote = { ...identity(OP_EDIT), action: 'edit', objective: 'x', note: 'why' }

// ── Results ──────────────────────────────────────────────────────────────────

/** chat.send goal-start ACK (turn admitted; the reply then streams as chat/agent events with runId = OP_START). */
export const startAck: GwGoalTurnAck = {
  operationId: OP_START,
  action: 'start',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  goal: { ...goalMinimal, createdAt: NOW, updatedAt: NOW },
  runId: OP_START,
  status: 'started',
  messageSeq: 1,
}

/** Retry of the same start after it was admitted: the historical receipt + replayed (dist/chat-send-handler-oS9rX200.mjs:3829-3832). */
export const startAckReplayed: GwSessionsGoalMutationResult = {
  operationId: OP_START,
  action: 'start',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  goal: { ...goalMinimal, createdAt: NOW, updatedAt: NOW },
  runId: OP_START,
  status: 'started',
  replayed: true,
}

export const pauseResult: GwSessionsGoalMutationResult = {
  operationId: OP_PAUSE,
  action: 'pause',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  goal: { ...goalActive, status: 'paused', updatedAt: NOW, pausedAt: NOW },
  status: 'updated',
}

/** Replay: the HISTORICAL snapshot — may be older than the row's current goal. */
export const pauseResultReplayed: GwSessionsGoalMutationResult = { ...pauseResult, replayed: true }

/** Resume runs a hidden "Continue pursuing the current goal." turn; runId = operationId. */
export const resumeAck: GwGoalTurnAck = {
  operationId: OP_RESUME,
  action: 'resume',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  goal: { ...goalPaused, status: 'active', updatedAt: NOW },
  runId: OP_RESUME,
  status: 'started',
  messageSeq: 14,
}

/** Continue from blocked with a note: the OPERATOR's note becomes lastStatusNote (dist/session-accessor-BxcCxteu.mjs:4500). */
export const continueAck: GwGoalTurnAck = {
  operationId: OP_RESUME,
  action: 'resume',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  goal: { ...goalBlocked, status: 'active', updatedAt: NOW, lastStatusNote: 'The key is in the vault now.' },
  runId: OP_RESUME,
  status: 'started',
  messageSeq: 17,
}

/** Keep going from budget_limited: resets the budget window (tokensUsed 0, budgetLimitedAt deleted; :4494-4512). */
export const keepGoingAck: GwGoalTurnAck = {
  operationId: OP_RESUME,
  action: 'resume',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  goal: (() => {
    const { budgetLimitedAt: _drop, ...rest } = goalBudgetLimited
    return { ...rest, status: 'active' as const, updatedAt: NOW, tokenStart: 68_762, tokenStartFresh: true, tokensUsed: 0 }
  })(),
  runId: OP_RESUME,
  status: 'started',
}

export const editResult: GwSessionsGoalMutationResult = {
  operationId: OP_EDIT,
  action: 'edit',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  goal: { ...goalActive, objective: 'Migrate billing to the v2 payments API, get the test suite green, and update the docs.', updatedAt: NOW },
  status: 'updated',
}

export const completeResult: GwSessionsGoalMutationResult = {
  operationId: OP_COMPLETE,
  action: 'complete',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  goal: { ...goalActive, status: 'complete', updatedAt: NOW, completedAt: NOW },
  status: 'updated',
}

/** Clear: no `goal`; goalId is the cleared goal's id. */
export const clearResult: GwSessionsGoalMutationResult = {
  operationId: OP_CLEAR,
  action: 'clear',
  sessionId: SESSION_ID,
  goalId: GOAL_ID,
  status: 'cleared',
}

// ── Events and rows ──────────────────────────────────────────────────────────

/** After an operator change (not replayed). */
export const sessionsChangedGoalPaused: GwSessionsChangedGoalSlice = {
  sessionKey: SESSION_KEY,
  agentId: AGENT_ID,
  reason: 'goal',
  ts: NOW + 40,
  sessionId: SESSION_ID,
  updatedAt: NOW - 120_000,
  status: 'done',
  goal: pauseResult.goal,
}

/** Agent's update_goal emits NO sessions.changed; the run-end lifecycle emit carries the new goal. */
export const sessionsChangedRunEndBlocked: GwSessionsChangedGoalSlice = {
  sessionKey: SESSION_KEY,
  agentId: AGENT_ID,
  phase: 'end',
  runId: OP_RESUME,
  ts: NOW + 95_000,
  sessionId: SESSION_ID,
  updatedAt: NOW + 94_800,
  status: 'done',
  hasActiveRun: false,
  goal: goalBlocked,
}

/** Clear, /new or /reset: goal is null (not absent). */
export const sessionsChangedGoalCleared: GwSessionsChangedGoalSlice = {
  sessionKey: SESSION_KEY,
  agentId: AGENT_ID,
  reason: 'goal',
  ts: NOW + 50,
  sessionId: SESSION_ID,
  goal: null,
}

/** Debounced: a later reason replaced "goal" but the snapshot still carries the goal. */
export const sessionsChangedCoalesced: GwSessionsChangedGoalSlice = {
  sessionKey: SESSION_KEY,
  agentId: AGENT_ID,
  reason: 'chat.dispatch-error',
  ts: NOW + 120,
  sessionId: SESSION_ID,
  goal: goalActive,
}

/** Unscoped global row: no `goal` key at all — must NOT be read as "cleared". */
export const sessionsChangedGlobalNoGoal: GwSessionsChangedGoalSlice = {
  sessionKey: 'global',
  reason: 'patch',
  ts: NOW,
}

/** Delete payload: no snapshot fields. */
export const sessionsChangedDelete: GwSessionsChangedGoalSlice = {
  sessionKey: SESSION_KEY,
  agentId: AGENT_ID,
  reason: 'delete',
  ts: NOW,
}

export const rowWithGoal: GwSessionRowGoalSlice = { key: SESSION_KEY, sessionId: SESSION_ID, status: 'running', updatedAt: NOW, goal: goalActive }
/** No goal: key absent (JSON drops undefined), NOT null. */
export const rowWithoutGoal: GwSessionRowGoalSlice = { key: 'agent:main:dashboard:0d9c8b7a-6f5e-4d3c-2b1a-098765432100', sessionId: 'f1e2d3c4-b5a6-4978-8695-a4b3c2d1e0f9', status: 'done', updatedAt: NOW - 3_600_000 }
export const rowCompleteGoal: GwSessionRowGoalSlice = { key: 'agent:main:dashboard:77aa88bb-99cc-4dd0-8ee1-ff0011223344', sessionId: 'aa11bb22-cc33-4dd4-8ee5-ff66aa77bb88', status: 'done', updatedAt: NOW, goal: goalComplete }
export const rowSubagentWithGoal: GwSessionRowGoalSlice = { key: 'agent:research-worker:subagent:a6d1c3e5-7f90-4b2d-8e4f-1a3c5e7a9b0d', status: 'running', goal: goalActive }
export const rowCronKey: GwSessionRowGoalSlice = { key: 'agent:main:cron:5f4e3d2c-1b0a-4987-a6b5-c4d3e2f1a0b9', status: 'done' }
export const rowHeartbeatKey: GwSessionRowGoalSlice = { key: 'agent:main:main:heartbeat', status: 'done' }
/** Empty list (new install / no sessions). */
export const sessionsListEmpty: { sessions: GwSessionRowGoalSlice[] } = { sessions: [] }
/** 2026.6.5: the same goal shape already rides on rows/events (goal on session events: dist/server-session-events-DxVaAqGM.js:141 in 6.5). */
export const rowWithGoal_2026_6_5: GwSessionRowGoalSlice = { key: SESSION_KEY, sessionId: SESSION_ID, status: 'done', goal: goalPaused }

// ── Error frames (the `error` of a rejected response) ────────────────────────

export const goalErrors = {
  /** chat.send start / resume on a busy session (dist/chat-send-handler-oS9rX200.mjs:3330-3334). */
  busy: {
    code: 'UNAVAILABLE',
    message: 'This session still has active or queued work. Wait for it to finish, then retry the Goal.',
    retryable: true,
    details: { reason: 'goal-session-busy' },
  },
  /** Start/resume on a subagent/cron/ACP/archived/non-restart-safe session (:4001 → :3350, no details). */
  ineligible: {
    code: 'INVALID_REQUEST',
    message: 'Goal start or resume requires an idle local session with recoverable history. Finish current work or start a fresh session, then retry.',
  },
  /** Retry while the first attempt is still being admitted (:3454-3456). Same params, retry later. */
  admitting: {
    code: 'UNAVAILABLE',
    message: 'Goal is being admitted; retry the same request.',
    retryable: true,
  },
  /** chat.send with intent + a disallowed override (:4390-4393). */
  startOverride: {
    code: 'INVALID_REQUEST',
    message: 'Goal start uses the session settings and local delivery; per-request runtime or routing overrides are not supported.',
  },
  /** chat.send with intent: blank / >16000 / non-NFC / control chars / key >128 / queue or system fields (:4386-4389). */
  startInvalid: {
    code: 'INVALID_REQUEST',
    message: 'Goal start requires a nonempty objective of at most 16000 characters, without queue or system-input options.',
  },
  /** sessions.goal.* when the session is gone or `sessionId` no longer matches (dist/sessions-goal-IoWLbKRI.mjs:42-44). No details. */
  sessionRemoved: {
    code: 'INVALID_REQUEST',
    message: 'Session changed or was removed; refresh its Goal.',
  },
  /** Session rotated between resolve and commit (dist/sessions-goal-IoWLbKRI.mjs:54). No details. */
  sessionChangedBeforeUpdate: {
    code: 'INVALID_REQUEST',
    message: 'Session changed before its Goal update; retry.',
  },
  /** sessions.goal.update/clear: goalId not current (dist/session-accessor-BxcCxteu.mjs:4585 → sessions-goal-IoWLbKRI.mjs:133-136). */
  goalRebound: {
    code: 'INVALID_REQUEST',
    message: 'Goal changed or was cleared; refresh before trying again.',
    details: { code: 'GOAL_OPERATION_REJECTED', reason: 'goal-rebound' },
  },
  /** Same operationId, different payload (incl. different issuedAtMs) (:4575). */
  operationConflict: {
    code: 'INVALID_REQUEST',
    message: 'Goal operation ID was already used for a different request.',
    details: { code: 'GOAL_OPERATION_REJECTED', reason: 'operation-conflict' },
  },
  /** Session id rotated (e.g. /new) after the operation (:4565, :4576, :4639). Not in PRD §8.5. */
  sessionRebound: {
    code: 'INVALID_REQUEST',
    message: 'Session changed; refresh before changing its Goal.',
    details: { code: 'GOAL_OPERATION_REJECTED', reason: 'session-rebound' },
  },
  /** issuedAtMs + 24 h ≤ now (:4544). A stale Retry. Not in PRD §8.5. */
  expired: {
    code: 'INVALID_REQUEST',
    message: 'Goal operation expired; review the current Goal before trying again.',
    details: { code: 'GOAL_OPERATION_REJECTED', reason: 'expired' },
  },
  /** issuedAtMs > gateway now + 5 min (clock skew) (:4543). */
  invalidTime: {
    code: 'INVALID_REQUEST',
    message: 'Goal operation time is invalid; refresh and try again.',
    details: { code: 'GOAL_OPERATION_REJECTED', reason: 'invalid' },
  },
  /** Transition refused, e.g. edit/pause/resume a complete goal (:4494, :4521 → :4593). */
  invalidTransition: {
    code: 'INVALID_REQUEST',
    message: 'goal is already complete',
    details: { code: 'GOAL_OPERATION_REJECTED', reason: 'invalid' },
  },
  /** ≥4096 live receipts on the session (:4603). */
  capacity: {
    code: 'INVALID_REQUEST',
    message: 'Too many recent Goal operations; wait for older requests to expire before trying again.',
    details: { code: 'GOAL_OPERATION_REJECTED', reason: 'capacity' },
  },
  /** Unexpected failure in sessions.goal.* (dist/sessions-goal-IoWLbKRI.mjs:137-139). */
  unexpected: {
    code: 'UNAVAILABLE',
    message: 'Unable to update the Goal; retry the request.',
  },
  /**
   * Receipt lookup rejects on the chat.send path (start, and resume which routes through chat.send):
   * the reason is PREFIXED "goal-" and there is no details.code (dist/chat-send-handler-oS9rX200.mjs:3462).
   */
  chatPathOperationConflict: {
    code: 'INVALID_REQUEST',
    message: 'Goal operation ID is already used by another request.',
    details: { reason: 'goal-operation-conflict' },
  },
  chatPathSessionRebound: {
    code: 'INVALID_REQUEST',
    message: 'Session changed after this Goal operation; refresh before trying again.',
    details: { reason: 'goal-session-rebound' },
  },
  /**
   * Resume of a cleared/replaced goal, or start when a goal already exists: the transition error is
   * thrown while persisting the turn and surfaces through handleChatSendSetupError as UNAVAILABLE
   * with `String(error)` and no details (dist/chat-send-handler-oS9rX200.mjs:631-677); the gateway
   * also broadcasts a `chat` error event for runId = operationId.
   */
  resumeGoalReboundViaTurn: {
    code: 'UNAVAILABLE',
    message: 'SessionGoalOperationError: Goal changed or was cleared; refresh before trying again.',
  },
  startGoalAlreadyExists: {
    code: 'UNAVAILABLE',
    message: 'SessionGoalOperationError: goal already exists',
  },
  /**
   * Schema failure (dist/validation-Cn7ErDZ-.mjs:7 + formatValidationErrors dist/src-7tzZ8j12.mjs:987).
   * The text after "at /note: " comes from typebox 1.3.18 (not bundled) — match only the
   * "invalid sessions.goal.update params:" prefix in tests.
   */
  invalidParamsNoteTooLong: {
    code: 'INVALID_REQUEST',
    message: 'invalid sessions.goal.update params: at /note: must NOT have more than 2000 characters',
  },
  /** Token without operator.write (dist/server-methods-v1T0byyX.mjs:196-201, dist/error-codes-C3Z5XSDw.mjs:82-84). */
  missingWriteScope: {
    code: 'FORBIDDEN',
    message: 'missing scope: operator.write',
    details: { code: 'MISSING_SCOPE', missingScope: 'operator.write', requiredScopes: ['operator.write'] },
  },
  /** sessions.patch {key, thinkingLevel} needs operator.admin (thinkingLevel is not in SESSIONS_PATCH_WRITE_SCOPE_MUTATIONS, dist/method-scopes-tKV11oMS.mjs:11-43). */
  thinkingPatchNeedsAdmin: {
    code: 'FORBIDDEN',
    message: 'missing scope: operator.admin',
    details: { code: 'MISSING_SCOPE', missingScope: 'operator.admin', requiredScopes: ['operator.admin'] },
  },
  /** 2026.6.5 (and ≤2026.7): the goal methods do not exist. */
  unknownMethod_2026_6_5: {
    code: 'INVALID_REQUEST',
    message: 'unknown method: sessions.goal.update',
  },
  /** 2026.6.5: chat.send's closed schema has no `intent`. */
  intentUnsupported_2026_6_5: {
    code: 'INVALID_REQUEST',
    message: "invalid chat.send params: at root: unexpected property 'intent'",
  },
} satisfies Record<string, GwErrorShape>

/** A full rejected response frame, as the app's gateway client receives it. */
export const busyResponseFrame: GwErrorResponseFrame = {
  type: 'res',
  id: 'req-4821',
  ok: false,
  error: goalErrors.busy,
}

/**
 * How the app's gateway client surfaces a rejection today (src/lib/gateway.ts:487):
 * `Object.assign(new Error(JSON.stringify(res.error)), { gatewayError: res.error })`.
 * Network failures are plain Errors: 'Not connected', 'Connection closed', 'Disconnected',
 * `Request ${method} timed out`.
 */
export function asAppGatewayError(error: GwErrorShape): Error & { gatewayError: GwErrorShape } {
  return Object.assign(new Error(JSON.stringify(error)), { gatewayError: error })
}
export const APP_NETWORK_ERROR_MESSAGES = [
  'Not connected',
  'Connection closed',
  'Disconnected',
  'Request sessions.goal.update timed out',
] as const

// ── Hello-ok bits ────────────────────────────────────────────────────────────

/** dist/src-7tzZ8j12.mjs:1152; always in hello-ok features.capabilities on 2026.9.4 (dist/message-handler-BBAGn2rf.mjs:2319). */
export const SESSION_GOAL_START_CAPABILITY = 'session-goal-start-v1'
/** Both advertised (no advertise:false) with scope operator.write, since "2026.8" (dist/method-scopes-tKV11oMS.mjs:1404-1415). */
export const GOAL_METHODS = ['sessions.goal.update', 'sessions.goal.clear'] as const
