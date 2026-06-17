import { Loader2, RefreshCw, Server } from 'lucide-react'
import logoUrl from '../../assets/logo-dark.png'
import { useConnectionStore, RECONNECT_MAX_ATTEMPTS } from '../../store/connection'
import { Btn } from '../ui/Btn'

// Shown (over the main area) while the gateway connection is auto-recovering.
// The gateway briefly drops the control-UI WebSocket whenever it reloads to
// apply a config change — most notably when you add or enable a channel. Rather
// than bounce the user to the manual connect screen, we explain what's happening
// and silently retry.
export function ReconnectOverlay() {
  const { reconnectAttempt, statusDetail, connection, cancelReconnect } = useConnectionStore()

  return (
    <div className="flex flex-1 items-center justify-center min-h-0" style={{ background: 'var(--bg-primary)' }}>
      <div
        className="flex flex-col items-center text-center px-8 py-9"
        style={{
          width: 460, background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        }}
      >
        <div className="relative mb-5">
          <img src={logoUrl} alt="" style={{ width: 56, height: 56, opacity: 0.9 }} />
          <Loader2
            size={84}
            className="animate-spin"
            style={{ position: 'absolute', left: -14, top: -14, color: 'var(--accent)', opacity: 0.55 }}
          />
        </div>

        <h2 className="text-lg font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
          Reconnecting to gateway…
        </h2>

        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          The gateway is reloading to apply your change — this happens after adding or
          enabling a channel. It usually comes back in a few seconds. Hang tight; we'll
          reconnect automatically.
        </p>

        <div
          className="flex items-center gap-2 px-3 py-2 rounded mb-4 w-full justify-center"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <Server size={13} style={{ color: 'var(--text-secondary)' }} />
          <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
            {connection?.url ?? 'gateway'}
          </span>
          <span className="text-xs" style={{ color: 'var(--accent)' }}>
            · attempt {Math.max(1, reconnectAttempt)}/{RECONNECT_MAX_ATTEMPTS}
          </span>
        </div>

        {statusDetail && (
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{statusDetail}</p>
        )}

        <Btn variant="outline" size="sm" icon={<RefreshCw size={12} />} onClick={cancelReconnect}>
          Stop trying & connect manually
        </Btn>
      </div>
    </div>
  )
}
