import { useState } from 'react'
import { CheckCircle2, Circle, AlertCircle, ChevronRight, Bot, Loader2 } from 'lucide-react'
import { useMeetingsStore, focusChat } from '../../store/meetings'
import { usePluginCatalogStore } from '../../store/pluginCatalog'
import { useConnectionStore, useIsRemoteGateway } from '../../store/connection'
import { gatewayClient } from '../../lib/gateway'
import { gatewayHost } from '../../lib/ollamaHealth'
import { sendViaAgent } from '../../lib/agentPrompt'
import { officialTarget } from '../../lib/pluginInstall'
import { captureState, checklistState, pluginReadiness, PLATFORM_LIST, type Platform, type PlatformId, type PluginReadiness } from '../../lib/meetings'
import { toneColor } from '../../lib/stateTone'
import { Card } from '../ui/Card'
import { Btn } from '../ui/Btn'
import { Toggle } from '../ui/Toggle'
import { CommandHint } from '../ui/CommandHint'
import { InstallStatus } from '../extensions/InstallStatus'

// What has to be true before an agent can take notes in a call: notes are on, a meeting
// plugin is installed, and Chrome on the gateway host is signed in. The first two are
// read over RPC and fixed in place where this connection may; Chrome can't be checked
// over RPC, so it's a setup check an agent runs on the host and you confirm.

/** Everything the checklist and the Record dialog need to know, derived once. */
export function useMeetingsSetup() {
  const status = useMeetingsStore(s => s.status)
  const plugins = useMeetingsStore(s => s.plugins)
  const statusRead = useMeetingsStore(s => s.statusRead)
  const captureFallback = useMeetingsStore(s => s.captureFallback)
  const setupRead = useMeetingsStore(s => s.setupRead)
  const requested = useMeetingsStore(s => s.captureRequested)
  const connectionSeq = useConnectionStore(s => s.connectionSeq)
  // null while checking: a read from before the last reconnect is never shown.
  const capture = captureState({
    status: status && statusRead ? { value: status.enabled, ...statusRead } : null,
    config: captureFallback !== null && setupRead ? { value: captureFallback, ...setupRead } : null,
    connectionSeq,
    requested,
  })
  const readiness = {} as Record<PlatformId, PluginReadiness>
  const errors = {} as Partial<Record<PlatformId, string>>
  for (const p of PLATFORM_LIST) {
    const r = pluginReadiness(plugins, status?.providers, p)
    readiness[p.id] = r.state
    if (r.error) errors[p.id] = r.error
  }
  return { capture, readiness, errors, ...checklistState(capture, readiness) }
}

/** "gw.example.ts.net", or null for a gateway on this computer. */
export function useChromeHost(): string | null {
  const remote = useIsRemoteGateway()
  const url = useConnectionStore(s => s.connection?.url)
  return remote ? gatewayHost(url) ?? 'the gateway host' : null
}

export function SetupChecklist({ onOpenChat }: { onOpenChat?: () => void }) {
  const setup = useMeetingsSetup()
  const [open, setOpen] = useState(false)
  // Collapsed to one row once complete; that row opens it again.
  if (setup.complete && !open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 text-xs px-3 py-2"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left' }}>
        <CheckCircle2 size={13} style={{ color: toneColor('done') }} />
        <span style={{ flex: 1 }}>Setup ✓</span>
        <ChevronRight size={12} />
      </button>
    )
  }
  return (
    <Card title="Setup" action={setup.complete ? <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}>Hide</button> : undefined}>
      <div className="flex flex-col gap-3 text-xs">
        <CaptureItem capture={setup.capture} />
        {PLATFORM_LIST.map(p => <PluginItem key={p.id} platform={p} state={setup.readiness[p.id]} error={setup.errors[p.id]} onOpenChat={onOpenChat} />)}
        <ChromeItem ready={setup.ready} onOpenChat={onOpenChat} />
      </div>
    </Card>
  )
}

function Tick({ state }: { state: 'done' | 'todo' | 'warn' }) {
  if (state === 'done') return <CheckCircle2 size={14} style={{ color: toneColor('done'), flexShrink: 0, marginTop: 1 }} />
  if (state === 'warn') return <AlertCircle size={14} style={{ color: toneColor('needsYou'), flexShrink: 0, marginTop: 1 }} />
  return <Circle size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: 1 }} />
}

function Item({ state, children }: { state: 'done' | 'todo' | 'warn'; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Tick state={state} />
      <div className="flex flex-col gap-1.5" style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)' }}>{children}</div>
    </div>
  )
}

function CaptureItem({ capture }: { capture: boolean | null }) {
  const admin = useConnectionStore(s => s.grantedScopes.includes('operator.admin'))
  const { captureSaving, captureError, setCaptureOn } = useMeetingsStore()
  if (capture) return <Item state="done"><span>Meeting notes are on</span></Item>
  // Neutral until this connection has read it (never the previous connection's answer),
  // and while the change is being saved.
  if (capture === null || captureSaving) {
    return (
      <Item state="todo">
        <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }} role="status">
          <Loader2 size={12} className="animate-spin" /> {captureSaving ? 'Turning on meeting notes…' : 'Checking meeting notes…'}
        </span>
      </Item>
    )
  }
  return (
    <Item state="todo">
      <span>Meeting notes are off</span>
      {admin ? (
        <Toggle label="Turn on meeting notes" value={false} disabled={captureSaving} onChange={v => { if (v) void setCaptureOn() }}
          description="The gateway restarts to apply this." />
      ) : (
        <>
          <span style={{ color: 'var(--text-secondary)' }}>Ask an admin to run:</span>
          <CommandHint command="openclaw config set transcripts.enabled true" lead="" />
        </>
      )}
      {captureError && <span style={{ color: 'var(--danger)' }}>{captureError}</span>}
    </Item>
  )
}

function PluginItem({ platform, state, error, onOpenChat }: { platform: Platform; state: PluginReadiness; error?: string; onOpenChat?: () => void }) {
  const admin = useConnectionStore(s => s.grantedScopes.includes('operator.admin'))
  const busy = usePluginCatalogStore(s => s.busy)
  const installAndRestart = usePluginCatalogStore(s => s.installAndRestart)
  const run = usePluginCatalogStore(s => (s.run?.target.origin === `meetings:${platform.id}` ? s.run : null))
  const plugins = useMeetingsStore(s => s.plugins)
  const mutationAllowed = (plugins as { mutationAllowed?: unknown } | null)?.mutationAllowed !== false
  const origin = `meetings:${platform.id}`
  const command = `openclaw plugins install ${platform.npm}`
  const canInstall = admin && mutationAllowed && gatewayClient.hasMethod('plugins.install')

  if (state === 'ready') return <Item state="done"><span>{platform.pluginName} plugin</span></Item>
  if (state === 'off') {
    return <Item state="warn"><span>{platform.pluginName} plugin is off. Turn it on under Extensions.</span></Item>
  }
  if (state === 'error') {
    return <Item state="warn"><span>{platform.pluginName} plugin failed to load{error ? `: ${error}` : '.'}</span></Item>
  }
  const viaAgent = () => {
    sendViaAgent([
      'Run these commands on the gateway host (the machine you are running on), one after the other, and report their output:',
      '', '```bash', command, 'openclaw gateway restart', '```',
    ].join('\n'), onOpenChat)
  }
  return (
    <Item state="todo">
      <div className="flex items-center gap-2 flex-wrap">
        <span style={{ flex: 1 }}>{platform.pluginName} plugin · not installed</span>
        {canInstall && (!run || run.phase === 'failed') && (
          <Btn size="sm" variant="outline" disabled={busy !== null} title={busy !== null ? 'Another plugin is installing' : undefined}
            onClick={() => void installAndRestart({ ...officialTarget(platform.installId, platform.pluginName, origin), pluginId: platform.pluginId })}>
            Install
          </Btn>
        )}
      </div>
      {run && <InstallStatus origin={origin} />}
      {!canInstall && (
        <>
          <CommandHint command={command} lead={admin && !mutationAllowed ? "This gateway doesn't allow plugin changes from apps. On the gateway host, run" : 'On the gateway host, run'} />
          <div><Btn size="sm" variant="ghost" icon={<Bot size={12} />} onClick={viaAgent}>Install via agent</Btn></div>
        </>
      )}
    </Item>
  )
}

function ChromeItem({ ready, onOpenChat }: { ready: PlatformId[]; onOpenChat?: () => void }) {
  const host = useChromeHost()
  const { chromeCheck, runSetupCheck, markChromeOk } = useMeetingsStore()
  const openChat = (convId?: string) => { if (convId) focusChat(convId); onOpenChat?.() }
  return (
    <Item state={chromeCheck?.ok ? 'done' : 'todo'}>
      <span>Chrome on {host ?? 'this computer'}</span>
      <span style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {host
          ? 'Meetings run in Chrome on the gateway host or a paired node, not on this computer.'
          : "Meetings run in Chrome on this computer's gateway, or on a paired node. Chrome must be signed in here."}
      </span>
      <div className="flex items-center gap-2 flex-wrap">
        {chromeCheck && (
          <button onClick={() => openChat(chromeCheck.convId)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}>
            Checked {new Date(chromeCheck.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · open chat
          </button>
        )}
        <Btn size="sm" variant="outline" disabled={ready.length === 0} title={ready.length === 0 ? 'Install a meeting plugin first' : undefined}
          onClick={() => { const id = runSetupCheck(ready); openChat(id) }}>
          Run setup check
        </Btn>
        {chromeCheck && !chromeCheck.ok && <Btn size="sm" variant="ghost" onClick={markChromeOk}>Looks good</Btn>}
      </div>
    </Item>
  )
}
