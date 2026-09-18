import { X } from 'lucide-react'
import { useMeetingsStore, focusChat, type PendingView } from '../../store/meetings'
import { PLATFORMS, type PendingJoin } from '../../lib/meetings'
import { toneColor, toneTint, type StateTone } from '../../lib/stateTone'
import { Btn } from '../ui/Btn'
import { useChromeHost } from './SetupChecklist'

// Joins started from here, from "Joining…" until they turn into a live meeting in the
// list (or fail). The status comes from the joining chat: the meeting tool's result says
// whether the agent got in, is waiting on a person (a lobby, a sign-in), or couldn't.

const PHASE: Record<Exclude<PendingView['phase'], 'done'>, { tone: StateTone; text: string; pulse?: boolean }> = {
  joining: { tone: 'working', text: 'Joining…', pulse: true },
  recording: { tone: 'working', text: 'Recording', pulse: true },
  stopping: { tone: 'working', text: 'Stopping…' },
  manual: { tone: 'needsYou', text: '' },
  noNotes: { tone: 'needsYou', text: 'Joined, but no notes are arriving yet. Captions may be off in the meeting.' },
  failed: { tone: 'failed', text: '' },
  unknown: { tone: 'idle', text: 'Status unknown · open chat' },
}

export function PendingJoins({ onOpenChat, onRetry }: { onOpenChat?: () => void; onRetry: (url: string) => void }) {
  const pending = useMeetingsStore(s => s.pending)
  const views = useMeetingsStore(s => s.pendingViews)
  // A join that became a live session shows as that session's row (with Stop) instead.
  const rows = pending.filter(p => !(views[p.id]?.selector && (views[p.id].phase === 'recording' || views[p.id].phase === 'stopping')))
  if (!rows.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(p => <PendingRow key={p.id} p={p} view={views[p.id] ?? { phase: 'joining' }} onOpenChat={onOpenChat} onRetry={onRetry} />)}
    </div>
  )
}

function PendingRow({ p, view, onOpenChat, onRetry }: { p: PendingJoin; view: PendingView; onOpenChat?: () => void; onRetry: (url: string) => void }) {
  const { stop, dismissPending } = useMeetingsStore()
  const host = useChromeHost()
  if (view.phase === 'done') return null
  const look = PHASE[view.phase]
  const color = toneColor(look.tone)
  const text = view.phase === 'manual' ? view.text ?? ''
    : view.phase === 'failed' ? `Couldn't join: ${view.text ?? 'no reason given'}`
    : look.text
  const openChat = () => { focusChat(p.convId); onOpenChat?.() }
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1 px-3 py-2 text-xs"
      style={{ borderRadius: 'var(--radius)', border: `1px solid ${toneTint(look.tone, 35)}`, background: toneTint(look.tone, 8) }}>
      <div className="flex items-center gap-2">
        <span className={look.pulse ? 'animate-pulse-dot' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', flex: 1 }}>{PLATFORMS[p.platform].label} meeting</span>
        {(view.phase === 'failed' || view.phase === 'unknown') && (
          <button onClick={() => dismissPending(p.id)} aria-label="Dismiss" title="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}>
            <X size={12} />
          </button>
        )}
      </div>
      <span style={{ color: view.phase === 'failed' ? 'var(--danger)' : 'var(--text-primary)', lineHeight: 1.5 }}>{text}</span>
      {view.phase === 'manual' && (
        <span style={{ color: 'var(--text-secondary)' }}>Do this in Chrome on {host ?? 'this computer'}.</span>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <Btn size="sm" variant="ghost" onClick={openChat}>Open chat</Btn>
        {view.phase === 'failed' && <Btn size="sm" variant="outline" onClick={() => { dismissPending(p.id); onRetry(p.url) }}>Try again</Btn>}
        {(view.phase === 'recording' || view.phase === 'noNotes' || view.phase === 'manual' || view.phase === 'joining') && (
          <Btn size="sm" variant="outline" onClick={() => stop({ pendingId: p.id })}>Stop</Btn>
        )}
      </div>
    </div>
  )
}
