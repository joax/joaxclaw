import { useEffect } from 'react'
import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import { Strip } from '../ui/Strip'
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

  useEffect(() => { if (sessionKey) void load(sessionKey) }, [sessionKey, load])

  const s = card ? summarizeProgressCard(card) : null
  const expandable = !!s && (s.steps.length > 0 || s.note.trim() !== '')

  return (
    <Strip
      id="progress"
      visible={!!sessionKey && !!s}
      label="Progress"
      headline={s?.headline ?? ''}
      tone={s?.done ? 'done' : 'working'}
      track={s?.track ?? undefined}
      count={s?.track ? s.count ?? undefined : undefined}
      chipLabel={s?.count ? 'Plan' : 'Progress'}
      body={s && expandable ? (
        <>
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
        </>
      ) : undefined}
    />
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
