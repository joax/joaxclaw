import { useState } from 'react'
import { UsersRound, GitBranch, Wrench, BookOpen, RefreshCw, Loader2 } from 'lucide-react'
import { Btn } from '../ui/Btn'
import { useConnectionStore } from '../../store/connection'
import { useHelpStore } from '../../store/help'
import { gatewayHost } from '../../lib/ollamaHealth'
import { buildPluginInstallPrompt } from '../../lib/joaxclawFsInstall'
import { sendViaAgent } from '../../lib/agentPrompt'

// Shown in place of Teams or Processes on a remote gateway that doesn't have the
// joaxclaw-fs plugin. Those features are files on the gateway host; the plugin's
// teams.* / processes.* RPC makes them reachable over the WS. One install covers
// both — so the same "Install via agent" flow is offered from either screen.
export function RemotePluginNotice({ feature, onRetry, onOpenChat }: {
  feature: 'Teams' | 'Processes'
  onRetry: () => void
  onOpenChat?: () => void
}) {
  const gwHost = useConnectionStore(s => gatewayHost(s.connection?.url))
  const openHelp = useHelpStore(s => s.openHelp)
  const [phase, setPhase] = useState<'idle' | 'working' | 'error'>('idle')
  const [err, setErr] = useState('')

  const lower = feature.toLowerCase()
  const Icon = feature === 'Teams' ? UsersRound : GitBranch

  // Build a self-contained install script (plugin files base64-embedded + install +
  // restart), open a chat with the default agent, and ask it to run it on the host.
  const installViaAgent = async () => {
    setPhase('working'); setErr('')
    const built = await buildPluginInstallPrompt()
    if (!built.ok || !built.prompt) { setPhase('error'); setErr(built.error ?? 'Failed to prepare the install'); return }

    sendViaAgent(built.prompt, onOpenChat)
    setPhase('idle')
  }

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 480, textAlign: 'center', padding: 32, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <Icon size={40} style={{ color: 'var(--text-secondary)', opacity: 0.4, marginBottom: 14 }} />
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px' }}>Install the plugin to manage {lower} remotely</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
          {feature} are stored as files on the gateway host
          {gwHost ? <> (<b style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{gwHost}</b>)</> : null}.
          Install the <b style={{ color: 'var(--text-primary)' }}>joaxclaw-fs</b> gateway plugin once on that host to
          read and edit them — including ones your agents create — over this connection. It covers both Teams and Processes.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <Btn size="sm" icon={phase === 'working' ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />} loading={phase === 'working'} onClick={installViaAgent}>
            Install via agent
          </Btn>
          <Btn size="sm" variant="outline" icon={<BookOpen size={13} />} onClick={() => openHelp('remote-teams')}>Manual steps</Btn>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={onRetry}>Retry</Btn>
        </div>
        {phase === 'error' && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '12px 0 0' }}>{err}</p>}
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', opacity: 0.75, lineHeight: 1.6, margin: '14px 0 0' }}>
          <b style={{ color: 'var(--text-primary)' }}>Install via agent</b> opens a chat and asks an agent on the host to
          run the install (you approve the command). Or follow the manual steps. On a gateway running on this machine,
          {' '}{lower} work without the plugin.
        </p>
      </div>
    </div>
  )
}
