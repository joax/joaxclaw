import { Target } from 'lucide-react'
import { Pill } from '../ui/Pill'
import { toneColor } from '../../lib/stateTone'
import { goalView, isOpenGoal, parseGoal } from '../../lib/goals'
import { useSessionsStore } from '../../store/sessions'
import { useGoalsSupported } from './GoalControl'

export { useGoalsSupported }

// Where a chat's goal shows outside the header (PRD 04-c): a Target marker on chat-list
// rows and a Goal column in Sessions. Both only for a goal that isn't done, and only on
// a gateway that has goals, like the header control.

/** The chat-list marker: a Target icon in the goal's tone, for a row whose session has an open goal. */
export function GoalMarker({ sessionKey, size = 11 }: { sessionKey?: string; size?: number }) {
  const supported = useGoalsSupported()
  const raw = useSessionsStore(s => sessionKey ? s.sessions.find(x => x.key === sessionKey)?.goal : undefined)
  const goal = parseGoal(raw)
  if (!supported || !isOpenGoal(goal)) return null
  const view = goalView(goal, Date.now())
  return (
    <span title={`Goal: ${view.statusLabel}`} aria-label={`Goal: ${view.statusLabel}`} style={{ display: 'inline-flex', flexShrink: 0 }}>
      <Target size={size} style={{ color: toneColor(view.tone) }} />
    </span>
  )
}

/** The Sessions table's Goal cell: the state pill and the objective, cut at 40 characters. */
export function GoalCell({ goal: raw }: { goal: unknown }) {
  const goal = parseGoal(raw)
  if (!isOpenGoal(goal)) return null
  const view = goalView(goal, Date.now())
  const objective = goal.objective.length > 40 ? `${goal.objective.slice(0, 40).trimEnd()}…` : goal.objective
  return (
    <div className="flex items-center gap-1.5 min-w-0" title={goal.objective}>
      <Pill tone={view.tone}>{view.statusLabel}</Pill>
      <span className="text-xs truncate" style={{ color: 'var(--text-secondary)', maxWidth: 240 }}>{objective}</span>
    </div>
  )
}
