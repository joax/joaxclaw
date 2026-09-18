import { AlertTriangle, ArrowUpCircle } from 'lucide-react'
import { Overlay } from '../ui/Overlay'
import { Btn } from '../ui/Btn'
import { useGatewayUpdateStore } from '../../store/gatewayUpdate'
import { useSessionsStore } from '../../store/sessions'
import { useConnectionStore } from '../../store/connection'
import { gatewayClient } from '../../lib/gateway'
import { runningChatsLine } from '../../lib/gatewayUpdate'
import { toneColor, toneTint } from '../../lib/stateTone'

// "Update the gateway?": the one confirm before update.run. Nothing is sent until
// "Update and restart"; Cancel, Escape and the backdrop send nothing. Cancel comes first
// in the footer so it takes the focus: the disruptive action is never the default.
export function UpdateConfirmOverlay() {
  const available = useGatewayUpdateStore(s => s.available)
  const schedule = useGatewayUpdateStore(s => s.schedule)
  const pending = useGatewayUpdateStore(s => s.pending)
  const close = useGatewayUpdateStore(s => s.closeConfirm)
  const run = useGatewayUpdateStore(s => s.runUpdate)
  const connected = useConnectionStore(s => s.status === 'connected')
  // The same count the tray shows.
  const runningChats = useSessionsStore(s => s.sessions.filter(x => x.hasActiveRun).length)

  const latest = schedule?.targetVersion ?? available?.latestVersion
  const installed = available?.currentVersion ?? gatewayClient.serverVersion
  const chats = runningChatsLine(runningChats)
  const commits = available?.commits ?? []

  return (
    <Overlay
      title="Update the gateway?"
      width={440}
      onClose={close}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <Btn variant="outline" onClick={close}>Cancel</Btn>
          <Btn icon={<ArrowUpCircle size={14} />} loading={pending} disabled={!connected} onClick={() => void run()}>Update and restart</Btn>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-5 py-4 text-sm overflow-y-auto" style={{ color: 'var(--text-primary)' }}>
        <p>{latest
          ? <>Installs OpenClaw {latest} on the gateway host and restarts it.</>
          : <>Installs the latest OpenClaw on the gateway host and restarts it.</>}
        </p>
        {(installed || latest) && (
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {[installed && `Installed ${installed}`, latest && `Available ${latest}`].filter(Boolean).join(' · ')}
          </p>
        )}
        {commits.length > 0 && (
          <details className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <summary style={{ cursor: 'pointer' }}>{commits.length === 1 ? '1 commit' : `${commits.length} commits`}</summary>
            <ul className="mt-1.5 flex flex-col gap-1" style={{ listStyle: 'none', padding: 0 }}>
              {commits.map(c => (
                <li key={c.sha} className="flex gap-2 min-w-0">
                  <code className="font-mono shrink-0">{c.sha.slice(0, 7)}</code>
                  <span className="truncate" style={{ color: 'var(--text-primary)' }}>{c.subject}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div
          className="flex items-start gap-2 px-3 py-2 rounded text-xs"
          style={{ background: toneTint('needsYou', 10), border: `1px solid ${toneTint('needsYou', 30)}` }}
        >
          <AlertTriangle size={13} style={{ color: toneColor('needsYou'), flexShrink: 0, marginTop: 1 }} />
          <span>
            Running chats are interrupted and JoaxClaw disconnects until the gateway is back.
            {chats && <><br /><b>{chats}</b></>}
          </span>
        </div>
      </div>
    </Overlay>
  )
}
