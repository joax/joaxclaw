import { create } from 'zustand'
import { nanoid } from '../lib/nanoid'
import { gatewayClient } from '../lib/gateway'
import type { Session } from '../lib/types'
import {
  actionRunsTurn, buildClearParams, buildUpdateParams, classifyGoalError, goalErrorMessage, parseGoal,
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
  start: (convId: string, objective: string) => Promise<boolean>
  act: (convId: string, sessionKey: string, goal: SessionGoal, action: Exclude<GoalAction, 'startNew'>, extra?: { note?: string; objective?: string }) => Promise<boolean>
  retry: (convId: string) => Promise<boolean>
  clearError: (convId: string) => void
}

// A goal ack or update result, as far as the store needs it.
interface GoalResult { goal?: unknown; replayed?: boolean; status?: string }

/** Write a goal (or none) onto its session row, unless the row already has something newer. */
function writeRowGoal(sessionKey: string, goal: SessionGoal | null) {
  useSessionsStore.setState(s => {
    const row = s.sessions.find(x => x.key === sessionKey)
    if (!row) return { sessions: [{ key: sessionKey, goal } as Session, ...s.sessions] }
    if (goal && !shouldApplyGoal(parseGoal(row.goal), goal)) return {}
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
      undoTurn()
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
        writeRowGoal(sessionKey, res?.status === 'cleared' ? null : parseGoal(res?.goal))
      }
      finish(convId)
      return true
    } catch (err) {
      const cls = classifyGoalError(err)
      if (cls === 'admitting' && !retried.admitting) {
        // The gateway is still admitting this exact request; the same one again resolves it.
        await new Promise(r => setTimeout(r, RETRY_ADMITTING_MS))
        return run(convId, op, { ...retried, admitting: true })
      }
      if (cls === 'conflict' && !retried.conflict) {
        // The id was already used for a different request (e.g. an edited draft): this
        // is a new intent, so it gets a new id.
        return run(convId, reissue(op), { ...retried, conflict: true })
      }
      if (cls === 'rebound') void refreshGoalRows()
      // Resend-as-is only makes sense when the gateway may not have seen it, or said to retry.
      const retryable = cls === 'network' || cls === 'generic' || cls === 'admitting'
      finish(convId, { cls, message: goalErrorMessage(err), retryable }, retryable ? op : undefined)
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
