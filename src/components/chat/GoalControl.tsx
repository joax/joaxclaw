import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Target, PauseCircle, AlertTriangle, Gauge, CheckCircle2, Play, X, type LucideIcon } from 'lucide-react'
import { Popover, MenuRow, MenuDivider, triggerStyle } from '../ui/Popover'
import { Pill } from '../ui/Pill'
import { Btn } from '../ui/Btn'
import { Textarea } from '../ui/Input'
import { toneColor, toneTint } from '../../lib/stateTone'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { useGatewaySupport } from '../../lib/useGatewaySupport'
import {
  GOAL_START_CAPABILITY, OBJECTIVE_COUNTER_FROM, OBJECTIVE_MAX, availableActions, eligibleSessionKey,
  formatElapsed, goalErrorCopy, goalView, noteIsOurs, parseGoal, resumeActionFor, type GoalIcon, type SessionGoal,
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

const errorText = (e: GoalError) => goalErrorCopy(e)

// The last answer while connected. useGatewaySupport can't tell while offline, and the
// chip should keep showing its last known state then (and on a chat opened meanwhile)
// rather than vanish until the reconnect.
let lastKnownSupport = false

/** Goals are on this gateway: the capability and both goal methods. */
export function useGoalsSupported(): boolean {
  const online = useConnectionStore(s => s.status === 'connected')
  const { supported } = useGatewaySupport({ capabilities: [GOAL_START_CAPABILITY], methods: ['sessions.goal.update', 'sessions.goal.clear'] })
  if (online) lastKnownSupport = supported
  return online ? supported : lastKnownSupport
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
  // The gateway grants operator.admin every method, so admin counts as write.
  const canWrite = scopes.includes('operator.write') || scopes.includes('operator.admin')
  const supported = useGoalsSupported()
  const inflight = useGoalsStore(s => s.inflight[convId])
  const error = useGoalsStore(s => s.errors[convId])

  const [open, setOpen] = useState(false)
  const now = useMinuteTick(goal?.status === 'active')

  if (!supported || !eligibleSessionKey(sessionKey)) return null

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
      role="dialog"
      sheetOnNarrow
      trigger={props => (
        <button
          {...props}
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
      {error && <Hint tone="danger">{errorText(error)}</Hint>}
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

function GoalDetails({ convId, sessionKey, goal, now, idle, online, canWrite, inflight, error, narrow, onDone }: {
  convId: string; sessionKey: string; goal: SessionGoal; now: number; idle: boolean; online: boolean; canWrite: boolean
  inflight?: string; error?: GoalError; narrow: boolean; onDone: () => void
}) {
  const view = goalView(goal, now)
  const [mode, setMode] = useState<'view' | 'resume' | 'confirmClear'>('view')
  const [note, setNote] = useState('')
  const heading = useFocusWhen<HTMLParagraphElement>(mode === 'view')
  const noteBox = useFocusWhen<HTMLDivElement>(mode === 'resume')

  const actions = availableActions(goal, { idle, canWrite, online })
  const resumeAction = resumeActionFor(goal)
  const pending = !!inflight
  const act = useGoalsStore.getState().act
  // The gateway keeps the operator's Resume note in the same field as the agent's reasons.
  const ownNote = noteIsOurs(goal, useGoalsStore(s => s.sentNotes[sessionKey]))

  const pause = () => act(convId, sessionKey, goal, 'pause')
  const resume = async () => {
    if (!resumeAction) return
    if (await act(convId, sessionKey, goal, resumeAction, { note })) { setNote(''); setMode('view'); onDone() }
  }
  const clear = async () => {
    if (await act(convId, sessionKey, goal, 'clear')) onDone()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <p ref={heading} tabIndex={-1} style={{ fontWeight: 600, color: 'var(--text-primary)', outline: 'none', flex: 1 }}>Goal</p>
        <Pill tone={view.tone}>{view.statusLabel}</Pill>
      </div>
      <p style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 160, overflowY: 'auto', lineHeight: 1.45 }}>
        {goal.objective}
      </p>

      <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0 6px' }} />
      <Stat label="Time">{formatElapsed(now - goal.createdAt)}</Stat>
      <Stat label="Tokens used">
        {goal.tokenBudget !== undefined
          ? `${goal.tokensUsed.toLocaleString()} of ${goal.tokenBudget.toLocaleString()}`
          : goal.tokensUsed.toLocaleString()}
      </Stat>
      {goal.lastStatusNote && <Stat label={ownNote ? 'Your note' : "Agent's note"}>{goal.lastStatusNote}</Stat>}

      {mode === 'resume' && (
        <div style={{ marginTop: 8 }} onKeyDown={submitOnModEnter(resume)}>
          <div ref={noteBox}>
            <Textarea value={note} onChange={setNote} rows={2} placeholder="Add a note for the agent (optional)" style={{ fontSize: narrow ? 16 : 13 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <Btn size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Btn>
            <Btn size="sm" onClick={resume} disabled={pending || !idle} loading={inflight === resumeAction}>Resume</Btn>
          </div>
        </div>
      )}

      {mode === 'confirmClear' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>Clear this goal?</span>
          <Btn size="sm" variant="danger" onClick={clear} loading={inflight === 'clear'} disabled={pending}>Clear</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Btn>
        </div>
      )}

      {mode === 'view' && actions.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', margin: '8px -12px 2px' }} />
          <div style={{ margin: '0 -12px' }} title={pending ? HINT.pending : undefined}>
            {resumeAction === 'resume' && (
              // Shown but disabled while a reply runs: it would start a second turn.
              <MenuRow icon={<Play size={13} />} disabled={pending || !actions.includes('resume')} onClick={() => setMode('resume')}>Resume</MenuRow>
            )}
            {actions.includes('pause') && (
              <MenuRow icon={<PauseCircle size={13} />} disabled={pending} onClick={pause}>Pause</MenuRow>
            )}
            {actions.includes('clear') && (
              <>
                <MenuDivider />
                <MenuRow danger icon={<X size={13} />} disabled={pending} onClick={() => setMode('confirmClear')}>Clear goal</MenuRow>
              </>
            )}
          </div>
        </>
      )}

      {!online && <Hint>{HINT.offline}</Hint>}
      {online && !canWrite && <Hint>{HINT.readOnly}</Hint>}
      {online && canWrite && pending && <Hint>{HINT.pending}</Hint>}
      {online && canWrite && !pending && !idle && resumeAction && <Hint>{HINT.busyReply}</Hint>}
      {error && <Hint tone="danger">{errorText(error)}</Hint>}
    </div>
  )
}
