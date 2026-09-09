import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import {
  APPROVAL_LIST_METHODS, isApprovalPending, parseApprovalEvent, sortApprovals,
  type ApprovalDecision, type ApprovalKind, type ApprovalPresentation, type PendingApproval,
} from '../lib/approvals'

// Pending approvals across all three kinds, kept live.
//
// Both the pending lists and the `*.approval.requested` broadcasts carry only the raw
// request, so each id is followed by `approval.get` to fetch the reviewer-safe
// `presentation` — which is what we are allowed to show and which carries
// `allowedDecisions`. Pending approvals are few (usually zero or one), so the extra
// round-trip per id costs nothing worth optimising away.

interface ApprovalsState {
  approvals: Record<string, PendingApproval>
  /** ids currently being resolved, so a double-tap can't send two decisions. */
  resolving: Record<string, true>
  error: string | null
  _subscribed: boolean

  start: () => void
  fetch: () => Promise<void>
  resolve: (approval: PendingApproval, decision: ApprovalDecision) => Promise<void>
  reset: () => void
}

interface RawPending { id?: string; approvalKind?: string; createdAtMs?: number; expiresAtMs?: number }

async function hydrate(id: string, kind: ApprovalKind): Promise<PendingApproval | null> {
  try {
    const res = await gatewayClient.request<{ approval?: {
      id?: string; status?: string; createdAtMs?: number; expiresAtMs?: number
      presentation?: ApprovalPresentation
    } }>('approval.get', { id, kind })
    const a = res.approval
    // Only pending approvals belong here — `approval.get` also answers for terminal ones,
    // and a resolved record must never render as an actionable prompt.
    if (!a?.presentation || a.status !== 'pending') return null
    return {
      id: a.id ?? id,
      kind,
      createdAtMs: a.createdAtMs ?? Date.now(),
      expiresAtMs: a.expiresAtMs ?? 0,
      presentation: a.presentation,
    }
  } catch {
    return null
  }
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  approvals: {},
  resolving: {},
  error: null,
  _subscribed: false,

  start() {
    if (!get()._subscribed) {
      set({ _subscribed: true })
      gatewayClient.on(frame => {
        const parsed = parseApprovalEvent(frame.event)
        if (!parsed) return
        const raw = (frame.payload ?? {}) as RawPending
        if (!raw.id) return
        if (parsed.phase === 'resolved') {
          set(s => {
            const approvals = { ...s.approvals }; delete approvals[raw.id!]
            const resolving = { ...s.resolving }; delete resolving[raw.id!]
            return { approvals, resolving }
          })
          return
        }
        void hydrate(raw.id, parsed.kind).then(a => {
          if (a && isApprovalPending(a)) set(s => ({ approvals: { ...s.approvals, [a.id]: a } }))
        })
      })
    }
    void get().fetch()
  },

  // Catches anything raised while the app was closed or disconnected.
  async fetch() {
    try {
      const kinds = Object.keys(APPROVAL_LIST_METHODS) as ApprovalKind[]
      const pages = await Promise.all(kinds.map(async kind => {
        // A gateway that withheld operator.approvals rejects these. Degrade per kind
        // rather than losing the others.
        const rows = await gatewayClient.request<RawPending[]>(APPROVAL_LIST_METHODS[kind], {}).catch(() => [])
        return { kind, rows: Array.isArray(rows) ? rows : [] }
      }))
      const hydrated = await Promise.all(
        pages.flatMap(({ kind, rows }) => rows.filter(r => r.id).map(r => hydrate(r.id!, kind))),
      )
      const approvals: Record<string, PendingApproval> = {}
      for (const a of hydrated) if (a && isApprovalPending(a)) approvals[a.id] = a
      set({ approvals, error: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  async resolve(approval, decision) {
    if (get().resolving[approval.id]) return
    set(s => ({ resolving: { ...s.resolving, [approval.id]: true }, error: null }))
    try {
      // `applied: false` means another reviewer (a phone, the Control UI, a channel)
      // answered first. That is a normal outcome, not an error: the approval is settled
      // either way, so drop it and say nothing.
      await gatewayClient.request<{ applied?: boolean }>('approval.resolve', {
        id: approval.id, kind: approval.kind, decision,
      })
      set(s => {
        const approvals = { ...s.approvals }; delete approvals[approval.id]
        const resolving = { ...s.resolving }; delete resolving[approval.id]
        return { approvals, resolving }
      })
    } catch (e) {
      set(s => {
        const resolving = { ...s.resolving }; delete resolving[approval.id]
        return { resolving, error: e instanceof Error ? e.message : String(e) }
      })
    }
  },

  reset() { set({ approvals: {}, resolving: {}, error: null }) },
}))

/** Pending approvals, oldest first, with expired ones dropped. */
export function pendingApprovals(
  approvals: Record<string, PendingApproval>,
  now = Date.now(),
): PendingApproval[] {
  return sortApprovals(Object.values(approvals).filter(a => isApprovalPending(a, now)))
}
