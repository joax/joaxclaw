import type { StateTone } from './stateTone'

// A chat's goal: one durable objective the gateway keeps per session (OpenClaw 2026.8+).
// While it's active the agent sees it on every turn; the agent can mark it done or
// blocked, and the operator can pause, resume, edit or clear it. The goal lives on the
// session row (`sessions.list`/`sessions.subscribe` rows and `sessions.changed`), so the
// sessions store is its only source of truth. This module is the pure half: reading the
// record, what to show for it, which actions make sense, and the exact request shapes.
// See docs/prd/04-chat-goals.md.

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'usage_limited' | 'budget_limited' | 'complete'

export interface SessionGoal {
  id: string
  objective: string
  /** A GoalStatus, or a status a newer gateway added (shown as a plain "Goal"). */
  status: string
  createdAt: number
  updatedAt: number
  tokensUsed: number
  tokenBudget?: number
  lastStatusNote?: string
  pausedAt?: number
  blockedAt?: number
  completedAt?: number
  budgetLimitedAt?: number
  usageLimitedAt?: number
}

/** The capability hello-ok advertises when chat.send accepts a goal-start intent. */
export const GOAL_START_CAPABILITY = 'session-goal-start-v1'
/** The gateway's objective limit (chat.send intent and sessions.goal.update edit). */
export const OBJECTIVE_MAX = 16_000
/** Past this, the start form shows a character counter. */
export const OBJECTIVE_COUNTER_FROM = 15_000
/** The gateway's limit on an operator note. */
export const NOTE_MAX = 2_000

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // Timestamps have come through as numeric strings from older row projections.
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

/**
 * A goal from the wire, or null when there isn't one. Loose on purpose: the row schema
 * passes `goal` through untyped, so a missing optional field or an unknown status keeps
 * the goal rather than hiding it.
 */
export function parseGoal(raw: unknown): SessionGoal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || typeof r.objective !== 'string' || typeof r.status !== 'string') return null
  const createdAt = num(r.createdAt) ?? 0
  const goal: SessionGoal = {
    id: r.id,
    objective: r.objective,
    status: r.status,
    createdAt,
    updatedAt: num(r.updatedAt) ?? createdAt,
    tokensUsed: num(r.tokensUsed) ?? 0,
  }
  const budget = num(r.tokenBudget)
  if (budget !== undefined) goal.tokenBudget = budget
  if (typeof r.lastStatusNote === 'string' && r.lastStatusNote.trim()) goal.lastStatusNote = r.lastStatusNote
  for (const k of ['pausedAt', 'blockedAt', 'completedAt', 'budgetLimitedAt', 'usageLimitedAt'] as const) {
    const v = num(r[k])
    if (v !== undefined) goal[k] = v
  }
  return goal
}

/** "0m", "24m", "3h 10m". Minutes, rounded down; never negative. */
export function formatElapsed(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000))
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export type GoalIcon = 'target' | 'pause' | 'alert' | 'gauge' | 'check'

export interface GoalView {
  /** The control's label, e.g. "Pursuing · 24m" or "Set goal". */
  label: string
  /** The status alone, for the popover pill, titles and the screen-reader label. */
  statusLabel: string
  tone: StateTone
  icon: GoalIcon
}

const VIEWS: Record<GoalStatus, { statusLabel: string; tone: StateTone; icon: GoalIcon }> = {
  active: { statusLabel: 'Pursuing', tone: 'working', icon: 'target' },
  paused: { statusLabel: 'Goal paused', tone: 'idle', icon: 'pause' },
  blocked: { statusLabel: 'Goal blocked', tone: 'needsYou', icon: 'alert' },
  budget_limited: { statusLabel: 'Budget reached', tone: 'needsYou', icon: 'gauge' },
  usage_limited: { statusLabel: 'Usage limit reached', tone: 'needsYou', icon: 'gauge' },
  complete: { statusLabel: 'Goal done', tone: 'done', icon: 'check' },
}

/** What the header control shows for a goal (or for none). */
export function goalView(goal: SessionGoal | null, now: number): GoalView {
  if (!goal) return { label: 'Set goal', statusLabel: 'Set goal', tone: 'idle', icon: 'target' }
  const v = VIEWS[goal.status as GoalStatus] ?? { statusLabel: 'Goal', tone: 'idle' as const, icon: 'target' as const }
  const label = goal.status === 'active' ? `Pursuing · ${formatElapsed(now - goal.createdAt)}` : v.statusLabel
  return { label, ...v }
}

/** A goal still worth marking in the chat list and Sessions (anything but done). */
export function isOpenGoal(goal: SessionGoal | null): goal is SessionGoal {
  return !!goal && goal.status !== 'complete'
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * What the user can do. Resume, Continue and Keep going all send `resume` (and run a
 * turn); they differ only in how the popover frames them for paused, blocked and
 * budget-limited goals. Start a new goal clears, then opens the start form.
 */
export type GoalAction = 'pause' | 'resume' | 'continue' | 'keepGoing' | 'edit' | 'complete' | 'clear' | 'startNew'

/** The action that resumes the goal from this state (it runs a turn), if any. */
export function resumeActionFor(goal: SessionGoal | null): 'resume' | 'continue' | 'keepGoing' | null {
  switch (goal?.status) {
    case 'paused': return 'resume'
    case 'blocked': return 'continue'
    case 'budget_limited':
    case 'usage_limited': return 'keepGoing'
    default: return null
  }
}

export function actionRunsTurn(action: GoalAction | 'start'): boolean {
  return action === 'start' || action === 'resume' || action === 'continue' || action === 'keepGoing'
}

/**
 * The actions to offer, in display order. Actions that run a turn are left out while a
 * reply is running (the gateway would refuse them as busy); the rest don't start a turn
 * and stay. Done is final, so only Start a new goal and Clear remain. Offline or without
 * write access nothing is offered.
 */
export function availableActions(
  goal: SessionGoal | null,
  { idle, canWrite, online }: { idle: boolean; canWrite: boolean; online: boolean },
): GoalAction[] {
  if (!goal || !online || !canWrite) return []
  if (goal.status === 'complete') return ['startNew', 'clear']
  const resume = resumeActionFor(goal)
  const known = goal.status in VIEWS
  // An unknown status: the gateway may not accept edits or transitions from it, but it
  // can always be cleared.
  if (!known) return ['clear']
  return [
    ...(resume && idle ? [resume] : []),
    ...(goal.status === 'active' ? ['pause' as const] : []),
    'edit', 'complete', 'clear',
  ]
}

// ── Requests ─────────────────────────────────────────────────────────────────

// The gateway strips these C0 controls and DEL from chat input, then requires a goal
// objective to equal its own sanitised, NFC form exactly, so they're removed here first.
const DISALLOWED_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export type ObjectiveCheck = { ok: true; value: string } | { ok: false; error: 'empty' | 'tooLong' }

/** The objective as the gateway will store it: NFC, no control characters, trimmed. */
export function validateObjective(text: string): ObjectiveCheck {
  const value = text.normalize('NFC').replace(DISALLOWED_CONTROL, '').trim()
  if (!value) return { ok: false, error: 'empty' }
  if (value.length > OBJECTIVE_MAX) return { ok: false, error: 'tooLong' }
  return { ok: true, value }
}

/**
 * The chat.send params that start a goal. No `thinking`, attachments, timeout or
 * delivery options: the gateway refuses any per-request override on a goal start, so
 * the chat's thinking level is saved on the session beforehand instead.
 */
export function buildStartParams(sessionKey: string, objective: string, opId: string, issuedAtMs: number): Record<string, unknown> {
  const check = validateObjective(objective)
  if (!check.ok) throw new Error(check.error === 'empty' ? 'The goal is empty.' : 'Keep the goal under 16,000 characters.')
  return {
    sessionKey,
    message: check.value,
    idempotencyKey: opId,
    intent: { kind: 'session-goal-start', version: 1, issuedAtMs },
  }
}

const cleanNote = (note?: string) => {
  const n = note?.trim()
  return n ? n.slice(0, NOTE_MAX) : undefined
}

/** The sessions.goal.update params for an action (Clear and Start a new goal use buildClearParams). */
export function buildUpdateParams(
  goal: SessionGoal,
  sessionKey: string,
  action: Exclude<GoalAction, 'clear' | 'startNew'>,
  extra: { note?: string; objective?: string },
  opId: string,
  issuedAtMs: number,
): Record<string, unknown> {
  const identity = { sessionKey, goalId: goal.id, operationId: opId, issuedAtMs }
  if (action === 'edit') {
    const check = validateObjective(extra.objective ?? '')
    if (!check.ok) throw new Error(check.error === 'empty' ? 'The goal is empty.' : 'Keep the goal under 16,000 characters.')
    return { ...identity, action: 'edit', objective: check.value }
  }
  const wire = action === 'continue' || action === 'keepGoing' ? 'resume' : action
  const note = cleanNote(extra.note)
  return { ...identity, action: wire, ...(note ? { note } : {}) }
}

export function buildClearParams(goal: SessionGoal, sessionKey: string, opId: string, issuedAtMs: number): Record<string, unknown> {
  return { sessionKey, goalId: goal.id, operationId: opId, issuedAtMs }
}

/**
 * Whether a result's goal may replace the row's. A late reply must not overwrite a newer
 * state the row already has from sessions.changed, so it's written only over no goal,
 * or over the same goal at an older or equal revision.
 */
export function shouldApplyGoal(current: SessionGoal | null, incoming: SessionGoal): boolean {
  if (!current) return true
  return current.id === incoming.id && incoming.updatedAt >= current.updatedAt
}

// ── Errors ───────────────────────────────────────────────────────────────────

export type GoalErrorClass =
  | 'busy'        // the session has a run or queued work
  | 'ineligible'  // not an idle local session with recoverable history
  | 'rebound'     // the goal or session changed elsewhere; re-read the row
  | 'conflict'    // the operation id was used for another request; new id, retry once
  | 'admitting'   // the gateway is still admitting this exact request; resend it
  | 'network'     // never answered (disconnect, timeout); resend the same request
  | 'generic'

function gatewayErrorOf(err: unknown): { message?: string; reason?: string } {
  // A rejection from gatewayClient.request carries the gateway's error as `gatewayError`;
  // a bare Error (timeout, disconnect) never reached the gateway.
  const g = (err && typeof err === 'object' && 'gatewayError' in err ? (err as { gatewayError: unknown }).gatewayError
    : err instanceof Error ? undefined : err) as { message?: unknown; details?: unknown } | null | undefined
  if (!g || typeof g !== 'object') return {}
  const details = g.details && typeof g.details === 'object' ? g.details as Record<string, unknown> : {}
  return {
    message: typeof g.message === 'string' ? g.message : undefined,
    reason: typeof details.reason === 'string' ? details.reason : undefined,
  }
}

/** The human part of a goal error, without the gateway's JSON wrapping. */
export function goalErrorMessage(err: unknown): string {
  const { message } = gatewayErrorOf(err)
  if (message) return message
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : 'Unknown error'
}

/**
 * Sorts a goal error into what the UI does about it. Structured `details.reason` first;
 * the gateway rewords messages between releases. The same rejection arrives as
 * `goal-<code>` through chat.send (start, resume) and as a bare `<code>` through
 * sessions.goal.*, so both spellings are matched.
 */
export function classifyGoalError(err: unknown): GoalErrorClass {
  const { message = '', reason = '' } = gatewayErrorOf(err)
  const code = reason.replace(/^goal-(?=session-busy$|operation-conflict$|goal-rebound$|session-rebound$|capacity$|invalid$|expired$)/, '')
  if (code === 'session-busy' || reason === 'goal-session-busy') return 'busy'
  if (code === 'operation-conflict') return 'conflict'
  if (code === 'goal-rebound' || code === 'session-rebound') return 'rebound'
  if (code === 'capacity') return 'generic'
  const text = message || (err instanceof Error ? err.message : typeof err === 'string' ? err : '')
  if (/still has active or queued work/i.test(text)) return 'busy'
  if (/requires an idle local session/i.test(text)) return 'ineligible'
  if (/being admitted; retry the same request/i.test(text)) return 'admitting'
  if (/session changed|goal changed or was cleared|goal already exists|goal is already/i.test(text)) return 'rebound'
  if (!message && /^(Not connected|Disconnected|Connection closed)$|timed out/i.test(text)) return 'network'
  return 'generic'
}

export interface GoalErrorPolicy {
  /** resend: the same request again; reissue: a new operation id; stop: show the error. */
  next: 'resend' | 'reissue' | 'stop'
  /** Re-read the session row: the goal changed somewhere else. */
  refresh: boolean
  /** Offer Retry, which resends the failed request unchanged (same id and time). */
  retryable: boolean
}

/**
 * What to do after a failed goal operation. Two failures retry once on their own: a
 * request still being admitted is resent as is, and an id already used for a different
 * request gets a new one (it's a new intent). A request that may never have reached the
 * gateway keeps its id for Retry, so a replay can't apply it twice; a definite refusal
 * (busy, ineligible, changed elsewhere) drops it.
 */
export function goalErrorPolicy(cls: GoalErrorClass, retried: { admitting: boolean; conflict: boolean }): GoalErrorPolicy {
  if (cls === 'admitting' && !retried.admitting) return { next: 'resend', refresh: false, retryable: true }
  if (cls === 'conflict' && !retried.conflict) return { next: 'reissue', refresh: false, retryable: false }
  return {
    next: 'stop',
    refresh: cls === 'rebound',
    retryable: cls === 'network' || cls === 'generic' || cls === 'admitting',
  }
}

/** Keys the gateway refuses goals on: sub-agents, cron runs, heartbeats, ACP and the global session. */
export function eligibleSessionKey(key: string): boolean {
  if (!key) return true   // a new chat: a session is created on start
  if (key === 'global') return false
  return !/:(subagent|cron|acp):|:heartbeat/.test(key)
}
