import { useId, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useMeetingsStore } from '../../store/meetings'
import { useAgentsStore } from '../../store/agents'
import { usePluginCatalogStore } from '../../store/pluginCatalog'
import { useConnectionStore } from '../../store/connection'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { gatewayClient } from '../../lib/gateway'
import { officialTarget } from '../../lib/pluginInstall'
import { detectPlatform, PLATFORMS, type JoinMode, type PlatformId } from '../../lib/meetings'
import { toneColor, toneTint } from '../../lib/stateTone'
import { Overlay } from '../ui/Overlay'
import { BottomSheet } from '../ui/BottomSheet'
import { Btn } from '../ui/Btn'
import { InstallStatus } from '../extensions/InstallStatus'
import { useChromeHost, useMeetingsSetup } from './SetupChecklist'

// Record a meeting: paste a link, pick an agent, and send it in to take notes.
//
// The plugins join silently: nothing in the call announces the notetaker. So the consent
// box is always in view, and Join stays off until "I'll tell participants" is ticked, on
// every join (not remembered): at the moment of joining is when it matters.

export function RecordDialog({ initialUrl = '', onClose }: { initialUrl?: string; onClose: () => void }) {
  const narrow = useIsNarrow()
  const setup = useMeetingsSetup()
  const host = useChromeHost()
  const record = useMeetingsStore(s => s.record)
  const guestNames = useMeetingsStore(s => s.guestNames)
  const defaultAgent = useAgentsStore(s => s.defaultId)
  const agents = useAgentsStore(s => s.agents)
  const canWrite = useConnectionStore(s => s.grantedScopes.includes('operator.write') || s.grantedScopes.includes('operator.admin'))
  const [url, setUrl] = useState(initialUrl)
  const [agentId, setAgentId] = useState(defaultAgent ?? agents[0]?.id ?? '')
  const [mode, setMode] = useState<JoinMode>('transcribe')
  const [consent, setConsent] = useState(false)
  const consentId = useId()

  const platformId = detectPlatform(url)
  const platform = platformId ? PLATFORMS[platformId] : null
  const pluginReady = platformId ? setup.readiness[platformId] === 'ready' : false
  const canJoin = !!platform && pluginReady && !!agentId && consent && setup.captureOn && canWrite

  const join = () => {
    if (!canJoin || !platformId) return
    record({ platform: platformId, url, mode, agentId })
    onClose()
  }

  const body = (
    <div className="flex flex-col gap-3 px-5 py-4 text-sm" style={{ color: 'var(--text-primary)' }}
      onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'url') join() }}>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Meeting link</span>
        <input type="url" value={url} autoFocus onChange={e => setUrl(e.target.value)} placeholder="https://zoom.us/j/…"
          style={{ width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }} />
        {url.trim() && <PlatformLine platformId={platformId} ready={pluginReady} />}
      </label>

      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: 'var(--text-secondary)', width: 48 }}>Agent</span>
        {/* A native select: the Dashboard's agent menu is a fixed dropdown that would
            open underneath this dialog. */}
        <select value={agentId} onChange={e => setAgentId(e.target.value)} aria-label="Agent"
          style={{ flex: 1, fontSize: 13, padding: '5px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
          {agents.map(a => <option key={a.id} value={a.id}>{a.identity?.emoji ? `${a.identity.emoji} ` : ''}{a.identity?.name ?? a.name ?? a.id}</option>)}
        </select>
      </div>

      <fieldset className="flex flex-col gap-1.5" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>What should it do?</legend>
        <ModeOption checked={mode === 'transcribe'} onChange={() => setMode('transcribe')} label="Take notes only" hint="Listens and keeps notes. Nothing is said in the call." />
        <ModeOption checked={mode === 'agent'} onChange={() => setMode('agent')} label="Take part" hint="The agent can speak. Needs virtual audio on the Chrome host." />
      </fieldset>

      {platform && (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {platformId === 'meet'
            ? `Joins as the Google account signed in to Chrome on the gateway host, or as “${guestNames.meet ?? 'OpenClaw Agent'}” when Chrome isn't signed in.`
            : `Joins as “${guestNames[platformId as PlatformId] ?? 'OpenClaw Agent'}”`}
        </p>
      )}

      <div className="flex flex-col gap-2 px-3 py-2.5 rounded text-xs" style={{ background: toneTint('needsYou', 10), border: `1px solid ${toneTint('needsYou', 35)}`, lineHeight: 1.5 }}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={13} style={{ color: toneColor('needsYou'), flexShrink: 0, marginTop: 1 }} />
          <span>The agent joins as a participant without announcing itself. Tell everyone in the call that it&apos;s taking notes.</span>
        </div>
        <label htmlFor={consentId} className="flex items-center gap-2" style={{ cursor: 'pointer', paddingLeft: 21 }}>
          <input id={consentId} type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          <span>I&apos;ll tell participants</span>
        </label>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {host ? `Chrome runs on ${host}, not on this computer.` : "Chrome runs on this computer's gateway."}
      </p>
      {!setup.captureOn && <p className="text-xs" style={{ color: toneColor('needsYou') }}>Turn on meeting notes first (see Setup).</p>}
      {!canWrite && <p className="text-xs" style={{ color: toneColor('needsYou') }}>This connection can&apos;t send messages to agents.</p>}
    </div>
  )

  const footer = (
    <div className="flex items-center justify-end gap-2 px-5 py-3.5" style={{ borderTop: '1px solid var(--border)' }}>
      {!narrow && <Btn variant="outline" size="sm" onClick={onClose}>Cancel</Btn>}
      <Btn size="sm" disabled={!canJoin} onClick={join} style={narrow ? { width: '100%' } : undefined}>
        {mode === 'agent' ? 'Join and take part' : 'Join and take notes'}
      </Btn>
    </div>
  )

  return narrow
    ? <BottomSheet title="Record a meeting" onClose={onClose} maxHeight="92vh">{body}{footer}</BottomSheet>
    : <Overlay title="Record a meeting" width={520} onClose={onClose} footer={footer}><div style={{ overflowY: 'auto' }}>{body}</div></Overlay>
}

function PlatformLine({ platformId, ready }: { platformId: PlatformId | null; ready: boolean }) {
  const admin = useConnectionStore(s => s.grantedScopes.includes('operator.admin'))
  const installAndRestart = usePluginCatalogStore(s => s.installAndRestart)
  const busy = usePluginCatalogStore(s => s.busy)
  if (!platformId) return <span className="text-xs" style={{ color: toneColor('needsYou') }}>This doesn&apos;t look like a Meet, Teams or Zoom link.</span>
  const p = PLATFORMS[platformId]
  if (ready) return <span className="text-xs" style={{ color: toneColor('done') }}>{p.label} · plugin ready</span>
  const origin = `meetings:${platformId}`
  return (
    <span className="flex flex-col gap-1 text-xs">
      <span className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
        {p.label} · plugin not installed
        {admin && gatewayClient.hasMethod('plugins.install') && (
          <Btn size="sm" variant="outline" disabled={busy !== null} onClick={() => void installAndRestart(officialTarget(p.pluginId, p.pluginName, origin))}>Install</Btn>
        )}
      </span>
      <InstallStatus origin={origin} />
      {!admin && <span style={{ color: 'var(--text-secondary)' }}>Ask an admin to install it (see Setup).</span>}
    </span>
  )
}

function ModeOption({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint: ReactNode }) {
  return (
    <label className="flex items-start gap-2" style={{ cursor: 'pointer' }}>
      <input type="radio" name="meeting-mode" checked={checked} onChange={onChange} style={{ marginTop: 3 }} />
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{hint}</span>
      </span>
    </label>
  )
}
