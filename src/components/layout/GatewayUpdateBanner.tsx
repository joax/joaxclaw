import { useState, type ReactNode } from 'react'
import { Server, X, Loader2, ArrowUpCircle, AlertTriangle, CheckCircle2, Terminal, XCircle, Undo2 } from 'lucide-react'
import { useConnectionStore } from '../../store/connection'
import { useGatewayUpdateStore } from '../../store/gatewayUpdate'
import { bannerState, bannerTone, formatDowntime, phaseProgress, refusalCopy, runTarget, showChannel, type BannerState } from '../../lib/gatewayUpdate'
import { toneColor, toneTint } from '../../lib/stateTone'
import { gatewayClient } from '../../lib/gateway'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { Btn } from '../ui/Btn'
import { CommandHint } from '../ui/CommandHint'
import { UpdateConfirmOverlay } from '../gateway/UpdateConfirmOverlay'
import { PhaseLine } from '../gateway/UpdatePhases'

// The gateway update banner: one place, several short states (lib/gatewayUpdate
// bannerState). "Available" reaches every connection, from the hello-ok snapshot and the
// update.available broadcast. An admin connection updates the gateway directly, after a
// confirm; without admin the way round is an agent on the host (write) or the command
// (read only). While an update runs the banner can't be dismissed: it explains the
// disconnect that's coming.
export function GatewayUpdateBanner({ onOpenChat }: { onOpenChat?: () => void }) {
  const status = useConnectionStore(s => s.status)
  const scopes = useConnectionStore(s => s.grantedScopes)
  // Re-read hasMethod on every new connection.
  useConnectionStore(s => s.connectionSeq)
  const st = useGatewayUpdateStore()
  const narrow = useIsNarrow()
  const [howTo, setHowTo] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)

  const admin = scopes.includes('operator.admin')
  const write = scopes.includes('operator.write')
  const canRun = admin && gatewayClient.hasMethod('update.run')
  const connected = status === 'connected'

  const view = bannerState({
    available: st.available,
    running: st.pending || st.followed
      ? { target: st.followed?.target ?? (st.run ? runTarget(st.run) : undefined), run: st.run, own: st.followed?.own ?? true }
      : null,
    refusal: st.refusal,
    outcome: st.outcome,
    skipped: st.skipped,
    dismissedKey: st.dismissedKey,
  })

  const viaAgent = async () => {
    setAgentBusy(true)
    await st.updateViaAgent(onOpenChat)
    setAgentBusy(false)
  }

  // Offline, the banner keeps its last state but can't act on it.
  const off = connected ? {} : { disabled: true, title: 'Reconnect to update' }
  const tap = narrow ? { minHeight: 40 } : undefined

  let actions: ReactNode = null
  let extra: ReactNode = null
  if (view.kind === 'available') {
    actions = (
      <>
        {canRun ? (
          <Btn size="sm" icon={<ArrowUpCircle size={12} />} onClick={st.openConfirm} style={tap} {...off}>Update gateway</Btn>
        ) : write ? (
          <Btn size="sm" loading={agentBusy} icon={<ArrowUpCircle size={12} />} onClick={viaAgent} style={tap} {...off}>Update via agent</Btn>
        ) : (
          <Btn size="sm" variant="outline" icon={<Terminal size={12} />} onClick={() => setHowTo(v => !v)} style={tap}>How to update</Btn>
        )}
        <button
          onClick={st.skip}
          className="text-xs px-2 py-1 rounded"
          style={{ color: 'var(--text-secondary)', background: 'transparent', ...tap }}
          title={`Skip ${view.available.latestVersion} — don't remind me until the next release`}
        >
          Skip
        </button>
      </>
    )
    if (howTo && !canRun && !write) extra = <CommandHint command="openclaw update" />
  } else if (view.kind === 'refused') {
    const copy = refusalCopy(view.refusal)
    if (copy.action === 'viaAgent' && write) {
      actions = <Btn size="sm" loading={agentBusy} icon={<ArrowUpCircle size={12} />} onClick={viaAgent} style={tap} {...off}>Update via agent</Btn>
    }
    if (copy.action === 'command' && copy.command) extra = <CommandHint command={copy.command} />
  } else if (view.kind === 'running') {
    extra = <PhaseLine progress={phaseProgress(view.run ?? null)} narrow={narrow} />
  }

  const dismissible = view.kind !== 'running' && view.kind !== 'hidden'
  const dismiss = dismissible ? (
    <button
      onClick={() => st.dismiss(view.key)}
      className="flex items-center justify-center rounded"
      style={{ width: narrow ? 40 : 24, height: narrow ? 40 : 24, color: 'var(--text-secondary)' }}
      title="Dismiss"
      aria-label="Dismiss"
    >
      <X size={14} />
    </button>
  ) : null

  const tone = bannerTone(view)
  const color = toneColor(tone)

  return (
    <>
      {view.kind !== 'hidden' && (
        <div
          role="status"
          aria-live="polite"
          className={narrow ? 'flex flex-col gap-1.5 px-4 py-2' : 'flex items-center gap-3 px-4 py-2'}
          style={{ background: toneTint(tone, 12, 'var(--bg-surface)'), borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 26, height: 26, background: toneTint(tone, 22) }}>
              <BannerIcon view={view} color={color} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-1.5" style={{ paddingTop: 3 }}>
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                <BannerMessage view={view} narrow={narrow} />
              </span>
              {extra}
            </div>
          </div>
          {(actions || dismiss) && (
            <div className={`flex items-center gap-1.5 shrink-0 ${narrow ? 'justify-end' : ''}`}>
              {actions}
              {dismiss}
            </div>
          )}
        </div>
      )}
      {st.confirmOpen && <UpdateConfirmOverlay />}
    </>
  )
}

function BannerIcon({ view, color }: { view: BannerState; color: string }) {
  const style = { color }
  switch (view.kind) {
    case 'running': return <Loader2 size={14} className="animate-spin" style={style} />
    case 'refused': return <AlertTriangle size={14} style={style} />
    case 'result':
      switch (view.outcome.kind) {
        case 'back-on': return <Server size={14} style={style} />
        case 'failed': return <XCircle size={14} style={style} />
        case 'rolled-back': return <Undo2 size={14} style={style} />
        default: return <CheckCircle2 size={14} style={style} />
      }
    default: return <Server size={14} style={style} />
  }
}

const dim = { color: 'var(--text-secondary)' }

function lcfirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s
}

function BannerMessage({ view, narrow }: { view: BannerState; narrow?: boolean }) {
  switch (view.kind) {
    case 'available': {
      const a = view.available
      return <>
        <b>OpenClaw {a.latestVersion}</b> is available{showChannel(a.channel) ? <span style={dim}> ({a.channel})</span> : null}.
        <span style={dim}> The gateway is on {a.currentVersion}.</span>
      </>
    }
    case 'running': {
      // A phone has room for the target only; the phase is on the line below.
      if (narrow) return view.target ? <>Updating to <b>{view.target}</b></> : <>The gateway is updating</>
      if (view.own === false) {
        return <>The gateway is applying an update{view.target ? <> to <b>{view.target}</b></> : null}.<span style={dim}> JoaxClaw reconnects on its own.</span></>
      }
      const phase = phaseProgress(view.run ?? null).currentLabel
      return view.target
        ? <>Updating to <b>{view.target}</b> · {phase}.<span style={dim}> JoaxClaw reconnects on its own.</span></>
        : <>The gateway is updating · {phase}.<span style={dim}> JoaxClaw reconnects on its own.</span></>
    }
    case 'refused':
      return <>The gateway didn't update: <span style={dim}>{lcfirst(refusalCopy(view.refusal).text)}</span></>
    case 'result': {
      const o = view.outcome
      if (o.kind === 'already-current') return <>The gateway is already on {o.version}.</>
      if (o.kind === 'back-on') return <>The gateway is back on {o.version}.</>
      if (o.kind === 'failed') {
        return <>The update to <b>{o.target}</b> failed.{o.before ? <span style={dim}> The gateway is still on {o.before}.</span> : null}</>
      }
      if (o.kind === 'rolled-back') {
        return <>The update to <b>{o.target}</b> didn't pass its checks and was rolled back{o.before ? <> to {o.before}</> : null}.</>
      }
      {
        const down = formatDowntime(o.downtimeMs)
        return <>Gateway updated to <b>{o.version}</b>{down ? <span style={dim}> · down for {down}</span> : null}.</>
      }
    }
    default:
      return null
  }
}
