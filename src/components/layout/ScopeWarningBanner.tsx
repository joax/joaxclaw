import { useEffect, useState } from 'react'
import { ShieldAlert, X, Wrench } from 'lucide-react'
import { useConnectionStore } from '../../store/connection'
import { CRITICAL_OPERATOR_SCOPES } from '../../lib/gateway'
import { Btn } from '../ui/Btn'

// Proactively warns when the gateway accepted the connection but granted a token
// that lacks the scopes the app needs to function. This is the "after an OpenClaw
// upgrade, everything fails with `missing scope: operator.read`" case: the token
// was minted by an older gateway before the scope existed, so it connects (the
// scope-free `health` ping works) but every real RPC is rejected. We detect it at
// the handshake by diffing granted vs. required scopes — no need to wait for an
// RPC to fail — and point the user at the fix (re-issue the token).
export function ScopeWarningBanner({ onFix }: { onFix?: () => void }) {
  const status = useConnectionStore(s => s.status)
  const granted = useConnectionStore(s => s.grantedScopes)
  const [dismissed, setDismissed] = useState(false)

  const missing = status === 'connected'
    ? CRITICAL_OPERATOR_SCOPES.filter(s => !granted.includes(s))
    : []
  const key = missing.join(',')

  // Re-show the warning whenever the missing-scope set changes (e.g. after a
  // reconnect with a still-broken token), so a past dismissal doesn't hide a
  // recurring problem.
  useEffect(() => { setDismissed(false) }, [key])

  if (missing.length === 0 || dismissed) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'color-mix(in srgb, var(--danger) 12%, var(--bg-surface))', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 26, height: 26, background: 'color-mix(in srgb, var(--danger) 22%, transparent)' }}>
        <ShieldAlert size={14} style={{ color: 'var(--danger)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          Connected, but your gateway token is missing <b>{missing.join(', ')}</b>
          <span style={{ color: 'var(--text-secondary)' }}>
            {' '}— most actions will fail with a “missing scope” error. This usually happens after an
            OpenClaw upgrade: the token predates the scope. Re-issue the token on the gateway host to fix it.
          </span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Btn size="sm" icon={<Wrench size={12} />} onClick={onFix}>
          How to fix
        </Btn>
        <button onClick={() => setDismissed(true)} className="flex items-center justify-center rounded" style={{ width: 24, height: 24, color: 'var(--text-secondary)' }} title="Dismiss">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
