import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Target, PauseCircle, AlertTriangle, Gauge, CheckCircle2, Play, X, Pencil, Check, Loader2, RotateCcw, type LucideIcon } from 'lucide-react'
import { Popover, MenuRow, triggerStyle } from '../ui/Popover'
import { Pill } from '../ui/Pill'
import { Btn } from '../ui/Btn'
import { Textarea } from '../ui/Input'
import { toneColor, toneTint } from '../../lib/stateTone'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { useGatewaySupport } from '../../lib/useGatewaySupport'
import {
  GOAL_START_CAPABILITY, OBJECTIVE_COUNTER_FROM, OBJECTIVE_MAX, availableActions, eligibleSessionKey,
  formatElapsed, goalView, parseGoal, resumeActionFor, type GoalAction, type GoalIcon, type SessionGoal,
} from '../../lib/goals'
import { useChatStore } from '../../store/chat'
import { useSessionsStore } from '../../store/sessions'
import { useConnectionStore } from '../../store/connection'
import { useGoalsStore, type GoalError } from '../../store/goals'
import { useSessionRunning } from './useSessionRunning'

// The chat's goal, in the header next to the model and thinking level (PRD 04). With no
// goal it's a "Set goal" button; with one, a chip coloured by its state. The popover
// holds the start form, the goal's details and every action. The goal itself comes from
// the session row (useSessionsStore); store/goals only tracks the operation in flight.

const ICONS: Record<GoalIcon, LucideIcon> = { target: Target, pause: PauseCircle, alert: AlertTriangle, gauge: Gauge, check: CheckCircle2 }

const HINT = {
  busyReply: 'Wait for the reply to finish.',
  pending: 'Wait for the pending goal action.',
  offline: 'Reconnect to manage the goal.',
  readOnly: "This connection can't change goals.",
}

function errorText(e: GoalError): string {
  switch (e.cls) {
    case 'busy': return 'The chat is still working. Try again when the reply finishes.'
    case 'ineligible': return 'Goals need an idle chat whose history the gateway can recover. Start a new chat to set a goal.'
    case 'rebound': return "The goal changed somewhere else. Here's the latest."
    default: return `Couldn't update the goal: ${e.message}`
  }
}

/** Re-render once a minute, for the Pursuing timer. */
function useMinuteTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [on])
  return now
}

export function GoalControl({ convId }: { convId: string }) {
  const narrow = useIsNarrow()
  const sessionKey = useChatStore(s => s.conversations.find(c => c.id === convId)?.sessionKey ?? '')
  const streaming = useChatStore(s => !!s.conversations.find(c => c.id === convId)?.messages.some(m => m.streaming))
  const running = useSessionRunning(sessionKey || undefined)
  const rawGoal = useSessionsStore(s => sessionKey ? s.sessions.find(x => x.key === sessionKey)?.goal : undefined)
  const goal = parseGoal(rawGoal)
  const online = useConnectionStore(s => s.status === 'connected')
  const scopes = useConnectionStore(s => s.grantedScopes)
  const canWrite = scopes.includes('operator.write') || scopes.includes('operator.admin')
  const { supported } = useGatewaySupport({ capabilities: [GOAL_START_CAPABILITY], methods: ['sessions.goal.update', 'sessions.goal.clear'] })
  const inflight = useGoalsStore(s => s.inflight[convId])
  const error = useGoalsStore(s => s.errors[convId])

  // Offline, useGatewaySupport can't tell; the chip keeps its last known state rather
  // than vanishing and reappearing across a reconnect.
  const [knownSupported, setKnownSupported] = useState(supported)
  useEffect(() => { if (online) setKnownSupported(supported) }, [online, supported])

  const [open, setOpen] = useState(false)
  const now = useMinuteTick(goal?.status === 'active')

  if (!(online ? supported : knownSupported) || !eligibleSessionKey(sessionKey)) return null

  const view = goalView(goal, now)
  const Icon = ICONS[view.icon]
  const tinted = !!goal
  const idle = !running && !streaming

  return (
    <Popover
      open={open}
      onOpenChange={o => { setOpen(o); if (!o) useGoalsStore.getState().clearError(convId) }}
      align="right"
      title="Goal"
      sheetOnNarrow
      trigger={props => (
        <button
          {...props}
          aria-haspopup="dialog"
          aria-label={goal ? `Goal: ${view.statusLabel}` : 'Set goal'}
          title={goal ? `Goal: ${goal.objective}` : 'Set a goal for this chat'}
          style={{
            ...triggerStyle,
            ...(tinted ? { color: toneColor(view.tone), background: toneTint(view.tone, 12) } : {}),
          }}
        >
          <Icon size={11} style={{ flexShrink: 0 }} />
          <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{view.label}</span>
          {/* Announces a state change (e.g. the agent marking it blocked) once. */}
          <span className="sr-only" aria-live="polite">{goal ? view.statusLabel : ''}</span>
        </button>
      )}
    >
      <div style={{ width: narrow ? 'auto' : 320, padding: narrow ? '0 16px 8px' : '8px 12px', fontSize: 13 }}>
        {goal && sessionKey
          ? <GoalDetails convId={convId} sessionKey={sessionKey} goal={goal} now={now} idle={idle} online={online} canWrite={canWrite}
              inflight={inflight} error={error} narrow={narrow} onDone={() => setOpen(false)} />
          : <StartForm convId={convId} idle={idle} online={online} canWrite={canWrite} inflight={inflight} error={error}
              narrow={narrow} onStarted={() => setOpen(false)} />}
      </div>
    </Popover>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Hint({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  return (
    <p role={tone ? 'alert' : undefined} style={{ fontSize: 12, marginTop: 6, color: tone ? 'var(--danger)' : 'var(--text-secondary)' }}>
      {children}
    </p>
  )
}

/**
 * Focus a field (the first textarea inside `ref`, else `ref` itself) once it shows. The
 * popover focuses its own panel on open, so this waits a frame to come after it.
 */
function useFocusWhen<T extends HTMLElement>(on: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!on) return
    const id = requestAnimationFrame(() => (ref.current?.querySelector('textarea') ?? ref.current)?.focus())
    return () => cancelAnimationFrame(id)
  }, [on])
  return ref
}

/** Ctrl/Cmd+Enter submits; Enter alone is a newline, since objectives can be long. */
const submitOnModEnter = (submit: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
}

function StartForm({ convId, idle, online, canWrite, inflight, error, narrow, onStarted }: {
  convId: string; idle: boolean; online: boolean; canWrite: boolean
  inflight?: string; error?: GoalError; narrow: boolean; onStarted: () => void
}) {
  // The draft survives a failed start (and closing the popover), per chat.
  const [draft, setDraft] = useDraft(convId)
  const box = useFocusWhen<HTMLDivElement>(true)
  const len = draft.trim().length
  const tooLong = draft.length > OBJECTIVE_MAX
  const blocker = !online ? HINT.offline : !canWrite ? HINT.readOnly : inflight ? HINT.pending : !idle ? HINT.busyReply : null
  const canStart = len > 0 && !tooLong && !blocker

  const submit = async () => {
    if (!canStart) return
    if (await useGoalsStore.getState().start(convId, draft)) { setDraft(''); onStarted() }
  }

  return (
    <div>
      <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Set a goal</p>
      <div ref={box} onKeyDown={submitOnModEnter(submit)}>
        <Textarea
          value={draft}
          onChange={setDraft}
          rows={3}
          placeholder="What should the agent keep working toward?"
          style={{ fontSize: narrow ? 16 : 13 }}
        />
      </div>
      {draft.length > OBJECTIVE_COUNTER_FROM && (
        <p style={{ fontSize: 11, marginTop: 4, textAlign: 'right', fontFamily: 'monospace', color: tooLong ? 'var(--danger)' : 'var(--text-secondary)' }}>
          {draft.length.toLocaleString()} / {OBJECTIVE_MAX.toLocaleString()}
        </p>
      )}
      {tooLong && <Hint tone="danger">Keep the goal under 16,000 characters.</Hint>}
      <p style={{ fontSize: 12, marginTop: 8, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
        The agent sees the goal on every turn and keeps going until it's done or blocked. /new clears it.
      </p>
      {blocker && <Hint>{blocker}</Hint>}
      {error && <ErrorLine convId={convId} error={error} />}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <Btn size="sm" onClick={submit} disabled={!canStart} loading={inflight === 'start'} style={narrow ? { minHeight: 40 } : undefined}>
          Start goal
        </Btn>
      </div>
    </div>
  )
}

// Start-form drafts per chat, kept outside React so they outlive the popover.
const drafts = new Map<string, string>()
function useDraft(convId: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => drafts.get(convId) ?? '')
  return [value, (v: string) => { drafts.set(convId, v); setValue(v) }]
}


function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 12, padding: '2px 0' }}>
      <span style={{ width: 88, flexShrink: 0, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

/** A failed action: what went wrong, and Retry when resending the same request makes sense. */
function ErrorLine({ convId, error }: { convId: string; error: GoalError }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6, fontSize: 12, color: error.cls === 'rebound' ? 'var(--text-secondary)' : 'var(--danger)' }}>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{errorText(error)}</span>
      {error.retryable && (
        <button
          onClick={() => void useGoalsStore.getState().retry(convId)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 12, flexShrink: 0 }}
        >
          <RotateCcw size={11} /> Retry
        </button>
      )}
    </div>
  )
}

interface ActionItem { key: string; label: string; icon: ReactNode; danger?: boolean; disabled?: boolean; loading?: boolean; onClick: () => void }

/**
 * The secondary actions. Menu rows on desktop, like the other header menus; a compact
 * inline row under a primary action (blocked, budget); 40px buttons in two columns on a
 * phone, for tap targets.
 */
function Actions({ items, variant }: { items: ActionItem[]; variant: 'menu' | 'inline' | 'grid' }) {
  if (items.length === 0) return null
  if (variant === 'grid') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        {items.map(a => (
          <Btn key={a.key} variant={a.danger ? 'danger' : 'outline'} icon={a.icon} disabled={a.disabled} loading={a.loading} onClick={a.onClick} style={{ minHeight: 40 }}>
            {a.label}
          </Btn>
        ))}
      </div>
    )
  }
  if (variant === 'inline') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 8, marginLeft: -8 }}>
        {items.map(a => (
          <Btn key={a.key} size="sm" variant="ghost" icon={a.icon} disabled={a.disabled} loading={a.loading} onClick={a.onClick}
            style={a.danger ? { color: 'var(--danger)' } : undefined}>
            {a.label}
          </Btn>
        ))}
      </div>
    )
  }
  return (
    <>
      <div style={{ borderTop: '1px solid var(--border)', margin: '8px -12px 2px' }} />
      <div style={{ margin: '0 -12px' }}>
        {items.map(a => (
          <MenuRow key={a.key} danger={a.danger} disabled={a.disabled} icon={a.loading ? <Loader2 size={13} className="animate-spin" /> : a.icon} onClick={a.onClick}>
            {a.label}
          </MenuRow>
        ))}
      </div>
    </>
  )
}

function GoalDetails({ convId, sessionKey, goal, now, idle, online, canWrite, inflight, error, narrow, onDone }: {
  convId: string; sessionKey: string; goal: SessionGoal; now: number; idle: boolean; online: boolean; canWrite: boolean
  inflight?: string; error?: GoalError; narrow: boolean; onDone: () => void
}) {
  const view = goalView(goal, now)
  const blocked = goal.status === 'blocked'
  const limited = goal.status === 'budget_limited' || goal.status === 'usage_limited'
  const done = goal.status === 'complete'
  const [mode, setMode] = useState<'view' | 'resume' | 'edit' | 'confirmClear'>('view')
  const [note, setNote] = useState('')
  const [objective, setObjective] = useState(goal.objective)
  const actions = availableActions(goal, { idle, canWrite, online })
  const resumeAction = resumeActionFor(goal)
  const pending = !!inflight
  const act = useGoalsStore.getState().act
  const writable = online && canWrite

  // Blocked leads with Continue and its note field; paused shows the note after Resume.
  const noteOpen = writable && (mode === 'resume' || (mode === 'view' && blocked))
  const heading = useFocusWhen<HTMLParagraphElement>(mode === 'view' && !noteOpen && !narrow)
  const noteBox = useFocusWhen<HTMLDivElement>(noteOpen)
  const editBox = useFocusWhen<HTMLDivElement>(mode === 'edit')

  const resume = async () => {
    if (!resumeAction || pending || !idle) return
    if (await act(convId, sessionKey, goal, resumeAction, { note })) { setNote(''); setMode('view'); onDone() }
  }
  const saveEdit = async () => {
    if (pending) return
    if (await act(convId, sessionKey, goal, 'edit', { objective })) setMode('view')
  }
  const clear = async (startNew?: boolean) => {
    // Start a new goal clears first (a goal can't be started over an existing one); the
    // popover then shows the start form, since the row no longer has a goal.
    if (await act(convId, sessionKey, goal, 'clear') && !startNew) onDone()
  }

  const item = (key: GoalAction, label: string, icon: ReactNode, onClick: () => void, danger?: boolean): ActionItem =>
    ({ key, label, icon, onClick, danger, disabled: pending, loading: inflight === key })
  const secondary: ActionItem[] = []
  if (mode === 'view') {
    // Resume is shown but disabled while a reply runs: it would start a second turn.
    if (resumeAction === 'resume' && writable) secondary.push({ ...item('resume', 'Resume', <Play size={13} />, () => setMode('resume')), disabled: pending || !actions.includes('resume') })
    if (actions.includes('pause')) secondary.push(item('pause', 'Pause', <PauseCircle size={13} />, () => void act(convId, sessionKey, goal, 'pause')))
    if (actions.includes('startNew')) secondary.push(item('startNew', 'Start a new goal', <Target size={13} />, () => void clear(true)))
    if (actions.includes('edit')) secondary.push(item('edit', 'Edit', <Pencil size={13} />, () => { setObjective(goal.objective); setMode('edit') }))
    if (actions.includes('complete')) secondary.push(item('complete', 'Mark done', <Check size={13} />, () => void act(convId, sessionKey, goal, 'complete')))
    if (actions.includes('clear')) secondary.push(item('clear', 'Clear goal', <X size={13} />, () => setMode('confirmClear'), true))
  }
  const variant = narrow ? 'grid' : (blocked || limited) ? 'inline' : 'menu'
  const primaryLabel = resumeAction === 'continue' ? 'Continue' : resumeAction === 'keepGoing' ? 'Keep going' : 'Resume'
  const showPrimary = writable && !!resumeAction && (noteOpen || (mode === 'view' && limited))
  const tokens = goal.tokenBudget !== undefined
    ? `${goal.tokensUsed.toLocaleString()} of ${goal.tokenBudget.toLocaleString()}`
    : goal.tokensUsed.toLocaleString()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {/* On a phone the sheet's own title already says "Goal". */}
        {!narrow && <p ref={heading} tabIndex={-1} style={{ fontWeight: 600, color: 'var(--text-primary)', outline: 'none', flex: 1 }}>Goal</p>}
        <Pill tone={view.tone} icon={done ? <Check size={10} /> : undefined}>{view.statusLabel}</Pill>
      </div>

      {mode === 'edit' ? (
        <div ref={editBox} onKeyDown={submitOnModEnter(saveEdit)}>
          <Textarea value={objective} onChange={setObjective} rows={4} style={{ fontSize: narrow ? 16 : 13 }} />
          {objective.length > OBJECTIVE_MAX && <Hint tone="danger">Keep the goal under 16,000 characters.</Hint>}
          <Hint>Saves without starting a run.</Hint>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <Btn size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Btn>
            <Btn size="sm" onClick={saveEdit} loading={inflight === 'edit'}
              disabled={pending || !objective.trim() || objective.length > OBJECTIVE_MAX || objective.trim() === goal.objective.trim()}>
              Save
            </Btn>
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 160, overflowY: 'auto', lineHeight: 1.45 }}>
          {goal.objective}
        </p>
      )}

      {blocked && (
        // The warning-tinted notice style (TextToolNotice in AssistantMessage).
        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--warning)', background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-surface))', fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warning)', fontWeight: 600 }}>
            <AlertTriangle size={12} /> The agent is blocked:
          </div>
          {goal.lastStatusNote && (
            <p style={{ color: 'var(--text-primary)', marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{goal.lastStatusNote}</p>
          )}
        </div>
      )}

      {goal.status === 'budget_limited' && goal.tokenBudget !== undefined && (
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--warning)' }}>
          The goal used its token budget ({goal.tokensUsed.toLocaleString()} of {goal.tokenBudget.toLocaleString()}).
        </p>
      )}

      <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0 6px' }} />
      {done ? (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
          Done after {formatElapsed((goal.completedAt ?? goal.updatedAt) - goal.createdAt)} · {goal.tokensUsed.toLocaleString()} tokens
        </p>
      ) : (
        <>
          <Stat label="Time">{formatElapsed(now - goal.createdAt)}</Stat>
          <Stat label="Tokens used">{tokens}</Stat>
        </>
      )}
      {goal.lastStatusNote && !blocked && <Stat label="Agent's note">{goal.lastStatusNote}</Stat>}

      {noteOpen && (
        <div ref={noteBox} style={{ marginTop: 8 }} onKeyDown={submitOnModEnter(resume)}>
          <Textarea value={note} onChange={setNote} rows={2} placeholder="Add a note for the agent (optional)" style={{ fontSize: narrow ? 16 : 13 }} />
        </div>
      )}
      {showPrimary && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
          {mode === 'resume' && <Btn size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Btn>}
          <Btn size={narrow ? 'md' : 'sm'} onClick={resume} disabled={pending || !idle} loading={inflight === resumeAction}
            style={narrow ? { minHeight: 40, flex: 1 } : undefined}>
            {primaryLabel}
          </Btn>
        </div>
      )}

      {mode === 'confirmClear' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>Clear this goal?</span>
          <Btn size={narrow ? 'md' : 'sm'} variant="danger" onClick={() => void clear()} loading={inflight === 'clear'} disabled={pending}>Clear</Btn>
          <Btn size={narrow ? 'md' : 'sm'} variant="ghost" onClick={() => setMode('view')}>Cancel</Btn>
        </div>
      )}

      <Actions items={secondary} variant={variant} />

      {!online && <Hint>{HINT.offline}</Hint>}
      {online && !canWrite && <Hint>{HINT.readOnly}</Hint>}
      {writable && pending && <Hint>{HINT.pending}</Hint>}
      {writable && !pending && !idle && resumeAction && <Hint>{HINT.busyReply}</Hint>}
      {error && <ErrorLine convId={convId} error={error} />}
    </div>
  )
}
