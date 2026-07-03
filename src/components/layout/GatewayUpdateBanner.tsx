import { useEffect, useState } from 'react'
import { Server, X, Loader2, ArrowUpCircle } from 'lucide-react'
import { useConnectionStore } from '../../store/connection'
import { useGatewayUpdateStore } from '../../store/gatewayUpdate'
import { buildGatewayUpdatePrompt } from '../../lib/gatewayUpdate'
import { sendViaAgent } from '../../lib/agentPrompt'
import { Btn } from '../ui/Btn'

// Slim, dismissible banner (mirrors the app + plugin update banners) shown when the
// connected gateway reports a newer OpenClaw version on its update channel. "Update"
// runs the agent-driven `openclaw update` + restart in a chat; Skip suppresses this
// version. Detection uses the gateway's channel-aware update.status (operator.admin).
export function GatewayUpdateBanner({ onOpenChat }: { onOpenChat?: () => void }) {
  const status = useConnectionStore(s => s.status)
  const admin = useConnectionStore(s => s.grantedScopes.includes('operator.admin'))
  const { info, skipped, dismissed, check, skip, dismiss } = useGatewayUpdateStore()
  const [working, setWorking] = useState(false)

  useEffect(() => { if (status === 'connected' && admin) check() }, [status, admin])  // eslint-disable-line react-hooks/exhaustive-deps

  const offer = !!info && !dismissed && skipped !== info.latestVersion
  if (!offer) return null

  const showChannel = info!.channel && !['stable', 'latest', 'release'].includes(info!.channel)
  const update = async () => {
    setWorking(true)
    const built = await buildGatewayUpdatePrompt()
    if (built.ok && built.prompt) sendViaAgent(built.prompt, onOpenChat)
    setWorking(false)
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 26, height: 26, background: 'color-mix(in srgb, var(--accent) 22%, transparent)' }}>
        <Server size={14} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          <b>OpenClaw {info!.latestVersion}</b> is available{showChannel ? <span style={{ color: 'var(--text-secondary)' }}> ({info!.channel})</span> : null}.
          <span style={{ color: 'var(--text-secondary)' }}> The gateway is on {info!.currentVersion}.</span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Btn size="sm" loading={working} icon={working ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpCircle size={12} />} onClick={update}>
          Update via agent
        </Btn>
        <button onClick={skip} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-secondary)', background: 'transparent' }} title={`Skip ${info!.latestVersion} — don't remind me until the next release`}>
          Skip
        </button>
        <button onClick={dismiss} className="flex items-center justify-center rounded" style={{ width: 24, height: 24, color: 'var(--text-secondary)' }} title="Dismiss">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
