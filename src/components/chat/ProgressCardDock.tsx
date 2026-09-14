import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronRight, Circle, CircleDot } from 'lucide-react'
import { ProgressTrack } from '../ui/ProgressTrack'
import { MarkdownContent } from './MarkdownContent'
import { useProgressCardsStore } from '../../store/progressCards'
import { summarizeProgressCard, type ProgressStep } from '../../lib/progressCard'

// The session's progress card, pinned under the context bar.
//
// Agents keep it with the gateway's `progress_card` tool: a plan checklist, a short
// note, or both. OpenClaw's own apps show it next to the session. Before this JoaxClaw
// showed nothing, and models took to writing their progress bars into the reply instead.
// Collapsed, the card is one line in the context bar's style: a label, the current step,
// the same bar, and a count. Expanded, it shows the plan and the note.

export function ProgressCardDock({ sessionKey }: { sessionKey?: string }) {
  const card = useProgressCardsStore(s => (sessionKey ? s.cards[sessionKey] : undefined))
  const load = useProgressCardsStore(s => s.load)
  const [open, setOpen] = useState(false)

  useEffect(() => { if (sessionKey) void load(sessionKey) }, [sessionKey, load])

  if (!sessionKey || !card) return null
  const s = summarizeProgressCard(card)
  const color = s.done ? 'var(--success)' : 'var(--accent)'
  const expandable = s.steps.length > 0 || s.note.trim() !== ''

  return (
    <div className="shrink-0 text-xs" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
      <button
        type="button"
        onClick={() => { if (expandable) setOpen(o => !o) }}
        aria-expanded={expandable ? open : undefined}
        title={expandable ? (open ? 'Hide the plan' : 'Show the plan') : undefined}
        className="flex w-full items-center gap-3 px-4 py-2 text-left"
        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: expandable ? 'pointer' : 'default' }}
      >
        <ChevronRight
          size={12}
          aria-hidden
          style={{
            flexShrink: 0, color: 'var(--text-secondary)', transition: 'transform 0.15s',
            transform: open ? 'rotate(90deg)' : undefined, visibility: expandable ? 'visible' : 'hidden',
          }}
        />
        <span style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>Progress</span>
        <span className="truncate" style={{ flex: '1 1 auto', minWidth: 0, color: 'var(--text-primary)' }}>{s.headline}</span>
        {s.track && (
          <span className="flex items-center gap-1.5" style={{ flex: '0 1 160px', minWidth: 80 }}>
            <ProgressTrack pct={s.track.pct} color={color} label={s.headline} />
            {s.count && <span className="font-mono" style={{ color, minWidth: '3ch', textAlign: 'right' }}>{s.count}</span>}
          </span>
        )}
      </button>

      {open && expandable && (
        <div className="px-4 pb-3" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
          {s.steps.length > 0 && (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {s.steps.map((step, i) => <StepRow key={i} step={step} />)}
            </ol>
          )}
          {s.note.trim() && (
            <div className="text-sm" style={{ marginTop: s.steps.length ? 6 : 0 }}>
              <MarkdownContent text={s.note} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_LABEL: Record<ProgressStep['status'], string> = {
  completed: 'Done', in_progress: 'In progress', pending: 'To do',
}

function StepRow({ step }: { step: ProgressStep }) {
  const icon = step.status === 'completed'
    ? <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
    : step.status === 'in_progress'
      ? <CircleDot size={13} className="animate-pulse" style={{ color: 'var(--accent)' }} />
      : <Circle size={13} style={{ color: 'var(--text-secondary)', opacity: 0.6 }} />
  return (
    <li className="flex items-start gap-2" style={{ padding: '3px 0', lineHeight: 1.5 }}>
      <span aria-hidden style={{ flexShrink: 0, marginTop: 2, display: 'flex' }}>{icon}</span>
      <span className="sr-only">{STATUS_LABEL[step.status]}: </span>
      <span style={{
        color: step.status === 'pending' ? 'var(--text-secondary)' : 'var(--text-primary)',
        fontWeight: step.status === 'in_progress' ? 600 : 400,
      }}>
        {step.step}
      </span>
    </li>
  )
}
