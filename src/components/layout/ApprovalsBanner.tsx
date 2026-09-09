import { useEffect, useState } from 'react'
import { ShieldAlert, Loader2, AlertTriangle } from 'lucide-react'
import { useConnectionStore } from '../../store/connection'
import { useApprovalsStore, pendingApprovals } from '../../store/approvals'
import { decisionLabel, decisionsFor, summarize, type ApprovalDecision } from '../../lib/approvals'
import { Btn } from '../ui/Btn'

// An agent is blocked until someone answers. Deliberately NOT dismissible, unlike the
// update banners this otherwise mirrors: dismissing would leave a run parked with no
// remaining sign of why, which is the exact state the app was in before approvals were
// handled at all.
//
// The oldest pending approval is shown — it has been blocking longest — with a count of
// any others behind it.
export function ApprovalsBanner() {
  const status = useConnectionStore(s => s.status)
  const canApprove = useConnectionStore(s => s.grantedScopes.includes('operator.approvals'))
  const start = useApprovalsStore(s => s.start)
  const resolve = useApprovalsStore(s => s.resolve)
  const resolving = useApprovalsStore(s => s.resolving)
  const error = useApprovalsStore(s => s.error)
  const approvals = useApprovalsStore(s => s.approvals)

  // Re-render as approvals expire, so a dead prompt can't sit there looking answerable.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (status === 'connected' && canApprove) start()
  }, [status, canApprove, start])

  if (!canApprove) return null
  const pending = pendingApprovals(approvals)
  const approval = pending[0]
  if (!approval) return null

  const s = summarize(approval.presentation)
  const busy = resolving[approval.id] === true
  const answer = (d: ApprovalDecision) => { void resolve(approval, d) }

  return (
    <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'color-mix(in srgb, var(--danger) 12%, var(--bg-surface))', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 26, height: 26, background: 'color-mix(in srgb, var(--danger) 22%, transparent)' }}>
        <ShieldAlert size={14} style={{ color: 'var(--danger)' }} />
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          <b>{s.title}</b>
          {s.agentId && <span style={{ color: 'var(--text-secondary)' }}> · {s.agentId}</span>}
          {s.host && <span style={{ color: 'var(--text-secondary)' }}> · {s.host}</span>}
          {pending.length > 1 && (
            <span style={{ color: 'var(--text-secondary)' }}> · {pending.length - 1} more waiting</span>
          )}
        </span>
        {s.subject && (
          <div className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }} title={s.subject}>
            {s.subject}
          </div>
        )}
        {s.description && (
          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }} title={s.description}>
            {s.description}
          </div>
        )}
        {s.warning && (
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--danger)' }}>
            <AlertTriangle size={11} style={{ flexShrink: 0 }} /> {s.warning}
          </div>
        )}
        {error && <div className="text-xs" style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {busy && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />}
        {/* Rendered from the record: allowedDecisions differs per kind, and offering one
            the record disallows would just be rejected on resolve. */}
        {decisionsFor(approval.presentation).map(d => (
          <Btn
            key={d}
            size="sm"
            variant={d === 'deny' ? 'danger' : 'outline'}
            disabled={busy}
            onClick={() => answer(d)}
          >
            {decisionLabel(d)}
          </Btn>
        ))}
      </div>
    </div>
  )
}
