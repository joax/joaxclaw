import { create } from 'zustand'
import { nanoid } from '../lib/nanoid'
import { gatewayClient } from '../lib/gateway'
import type { Session } from '../lib/types'
import {
  actionRunsTurn, buildClearParams, buildUpdateParams, eligibleSessionKey, goalErrorMessage, goalErrorPolicy, goalRefreshNeeded, parseGoal,
  shouldApplyGoal, validateObjective, type GoalAction, type GoalErrorClass, type SessionGoal,
} from '../lib/goals'
import { useSessionsStore } from './sessions'
import { useChatStore } from './chat'

// Goal operations in flight, and their errors (PRD 04). The goal itself lives on the
// session row in useSessionsStore, which is its only source of truth: this store never
// keeps a copy, it writes each result's goal onto the row.
//
// Every operation carries an operationId and issuedAtMs, built once per user intent. The
// gateway keeps receipts for 24 h, so resending the same pair after a dropped reply
// returns the original result (`replayed: true`) instead of starting a second turn or
// applying an action twice. Everything is keyed by conversation id: a new chat has no
// session key until its goal starts.

export type GoalOpAction = GoalAction | 'start'

interface GoalOp {
  action: GoalOpAction
  /** The operation, exactly as sent, so a retry resends it unchanged. */
  opId: string
  issuedAtMs: number
  sessionKey?: string
  method?: 'sessions.goal.update' | 'sessions.goal.clear'
  params?: Record<string, unknown>
  /** Start only: the normalised objective. */
  objective?: string
}

export interface GoalError {
  cls: GoalErrorClass
  message: string
  /** The failed operation can be resent unchanged (Retry). */
  retryable: boolean
}

interface GoalsState {
  /** The operation waiting for the gateway, per conversation. Only one at a time. */
  inflight: Record<string, GoalOpAction>
  /** The last operation that failed without an answer, kept so Retry resends it as is. */
  failed: Record<string, GoalOp>
  errors: Record<string, GoalError>
  /**
   * Notes this app sent with Resume/Continue, per session. The gateway stores them in the
   * same `lastStatusNote` the agent writes its reasons to, so this is how the popover
   * tells "Your note" from the agent's.
   */
  sentNotes: Record<string, string[]>
  start: (convId: string, objective: string) => Promise<boolean>
  act: (convId: string, sessionKey: string, goal: SessionGoal, action: Exclude<GoalAction, 'startNew'>, extra?: { note?: string; objective?: string }) => Promise<boolean>
  retry: (convId: string) => Promise<boolean>
  clearError: (convId: string) => void
}

// A goal ack or update result, as far as the store needs it.
interface GoalResult { goal?: unknown; replayed?: boolean; status?: string }

/**
 * Write a goal (or none) onto its session row, unless the row already has something
 * newer. A start always writes: the gateway only starts a goal when there is none, so
 * whatever the row still shows is stale.
 */
function writeRowGoal(sessionKey: string, goal: SessionGoal | null, isStart = false) {
  useSessionsStore.setState(s => {
    const row = s.sessions.find(x => x.key === sessionKey)
    if (!row) return { sessions: [{ key: sessionKey, goal } as Session, ...s.sessions] }
    if (goal && !isStart && !shouldApplyGoal(parseGoal(row.goal), goal)) return {}
    return { sessions: s.sessions.map(x => x.key === sessionKey ? { ...x, goal } : x) }
  })
}

/**
 * Re-read recently active session rows and merge them. Used when the row may be stale:
 * a replayed result (the answer is historical), a goal changed elsewhere, and after a
 * run ends (an agent's update_goal isn't confirmed to broadcast straight away).
 */
export async function refreshGoalRows(): Promise<void> {
  const res = await gatewayClient.request<{ sessions?: Session[] }>('sessions.list', { activeMinutes: 10, limit: 50 }).catch(() => null)
  const rows = res?.sessions
  if (!Array.isArray(rows) || rows.length === 0) return
  const byKey = new Map(rows.filter(r => r?.key).map(r => [r.key, r]))
  useSessionsStore.setState(s => ({
    sessions: s.sessions.map(x => {
      const row = byKey.get(x.key)
      // `goal` is absent on a row without one, so it's set explicitly or a cleared goal lingers.
      return row ? { ...x, ...row, goal: row.goal ?? null } : x
    }),
  }))
}

const RETRY_ADMITTING_MS = 500

export const useGoalsStore = create<GoalsState>((set, get) => {
  const finish = (convId: string, error?: GoalError, failedOp?: GoalOp) => set(s => {
    const inflight = { ...s.inflight }
    delete inflight[convId]
    const errors = { ...s.errors }
    const failed = { ...s.failed }
    if (error) errors[convId] = error
    else delete errors[convId]
    if (failedOp) failed[convId] = failedOp
    else delete failed[convId]
    return { inflight, errors, failed }
  })

  async function send(convId: string, op: GoalOp): Promise<GoalResult> {
    if (op.action === 'start') {
      return useChatStore.getState().sendGoalStart(convId, { objective: op.objective!, opId: op.opId, issuedAtMs: op.issuedAtMs }) as Promise<GoalResult>
    }
    // Resume runs a turn: attach the stream first so the reply's first frames aren't missed.
    const undoTurn = actionRunsTurn(op.action) ? useChatStore.getState().beginGoalTurn(convId) : () => {}
    try {
      return await gatewayClient.request<GoalResult>(op.method!, op.params!)
    } catch (err) {
      // A gateway refusal means no turn; an unanswered request may still have started one.
      undoTurn(!!(err && typeof err === 'object' && 'gatewayError' in err))
      throw err
    }
  }

  /** Send one operation and apply its result. Handles the two silent retries itself. */
  async function run(convId: string, op: GoalOp, retried = { admitting: false, conflict: false }): Promise<boolean> {
    set(s => ({ inflight: { ...s.inflight, [convId]: op.action } }))
    try {
      const res = await send(convId, op)
      const sessionKey = op.sessionKey ?? useChatStore.getState().conversations.find(c => c.id === convId)?.sessionKey
      if (res?.replayed) {
        // A historical answer: the row may have moved on since, so re-read it rather
        // than trusting the stored goal.
        await refreshGoalRows()
      } else if (sessionKey) {
        writeRowGoal(sessionKey, res?.status === 'cleared' ? null : parseGoal(res?.goal), op.action === 'start')
      }
      const note = typeof op.params?.note === 'string' ? op.params.note : undefined
      if (note && sessionKey) set(s => ({ sentNotes: { ...s.sentNotes, [sessionKey]: [...(s.sentNotes[sessionKey] ?? []), note].slice(-20) } }))
      finish(convId)
      return true
    } catch (err) {
      const policy = goalErrorPolicy(err, retried)
      if (policy.next === 'resend') {
        // The gateway is still admitting this exact request; the same one again resolves it.
        await new Promise(r => setTimeout(r, RETRY_ADMITTING_MS))
        return run(convId, op, { ...retried, admitting: true })
      }
      if (policy.next === 'reissue') return run(convId, reissue(op), { ...retried, conflict: true })
      if (policy.refresh) void refreshGoalRows()
      // Kept only for an unchanged resend: the gateway fingerprints every param, so a
      // Retry must send exactly these bytes to get the receipt instead of a conflict.
      finish(convId, { cls: policy.cls, message: goalErrorMessage(err), retryable: policy.retryable }, policy.retryable ? op : undefined)
      return false
    }
  }

  function reissue(op: GoalOp): GoalOp {
    const opId = nanoid(21)
    const issuedAtMs = Date.now()
    return { ...op, opId, issuedAtMs, ...(op.params ? { params: { ...op.params, operationId: opId, issuedAtMs } } : {}) }
  }

  const busy = (convId: string) => !!get().inflight[convId]

  return {
    inflight: {},
    failed: {},
    errors: {},
    sentNotes: {},

    async start(convId, objective) {
      if (busy(convId)) return false
      const check = validateObjective(objective)
      if (!check.ok) {
        set(s => ({ errors: { ...s.errors, [convId]: { cls: 'generic', message: check.error === 'empty' ? 'The goal is empty.' : 'Keep the goal under 16,000 characters.', retryable: false } } }))
        return false
      }
      return run(convId, { action: 'start', opId: nanoid(21), issuedAtMs: Date.now(), objective: check.value })
    },

    async act(convId, sessionKey, goal, action, extra = {}) {
      if (busy(convId)) return false
      const opId = nanoid(21)
      const issuedAtMs = Date.now()
      let op: GoalOp
      try {
        op = action === 'clear'
          ? { action, opId, issuedAtMs, sessionKey, method: 'sessions.goal.clear', params: buildClearParams(goal, sessionKey, opId, issuedAtMs) }
          : { action, opId, issuedAtMs, sessionKey, method: 'sessions.goal.update', params: buildUpdateParams(goal, sessionKey, action, extra, opId, issuedAtMs) }
      } catch (err) {
        set(s => ({ errors: { ...s.errors, [convId]: { cls: 'generic', message: goalErrorMessage(err), retryable: false } } }))
        return false
      }
      return run(convId, op)
    },

    async retry(convId) {
      const op = get().failed[convId]
      if (!op || busy(convId)) return false
      return run(convId, op)
    },

    clearError(convId) {
      set(s => {
        const errors = { ...s.errors }
        const failed = { ...s.failed }
        delete errors[convId]
        delete failed[convId]
        return { errors, failed }
      })
    },
  }
})

// The run-end fallback (FR-10). The agent's update_goal and create_goal send no
// sessions.changed of their own: the new goal rides on the run-end sessions.changed
// snapshot, which the sessions store merges. If that snapshot hasn't come 2 s after the
// final frame and the row's goal hasn't moved, the recent rows are re-read once, so an
// agent marking a goal done or blocked (or creating one) still reaches the chip.
const GOAL_SETTLE_MS = 2_000
const settling = new Set<string>()
const lastChangedAt = new Map<string, number>()
gatewayClient.on(frame => {
  const p = frame.payload as { sessionKey?: unknown; state?: unknown } | undefined
  const key = typeof p?.sessionKey === 'string' ? p.sessionKey : ''
  if (!key) return
  if (frame.event === 'sessions.changed') { lastChangedAt.set(key, Date.now()); return }
  if (frame.event !== 'chat' || p?.state !== 'final' || settling.has(key)) return
  if (!eligibleSessionKey(key) || !gatewayClient.hasMethod('sessions.goal.update')) return
  const goalOf = () => parseGoal(useSessionsStore.getState().sessions.find(s => s.key === key)?.goal)
  const atFinal = goalOf()
  const finalAt = Date.now()
  settling.add(key)
  setTimeout(() => {
    settling.delete(key)
    if (goalRefreshNeeded(atFinal, goalOf(), (lastChangedAt.get(key) ?? 0) >= finalAt)) void refreshGoalRows()
  }, GOAL_SETTLE_MS)
})
