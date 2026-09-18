import type { CSSProperties, ReactNode } from 'react'
import {
  GitFork, SquareTerminal, Clock, Image, Music, Clapperboard, Wrench, Bot, Terminal, Layers,
  Square, X, AlertTriangle, Loader2, type LucideIcon,
} from 'lucide-react'
import { Pill } from '../ui/Pill'
import { ProgressTrack } from '../ui/ProgressTrack'
import { toneColor } from '../../lib/stateTone'
import { metaLine, canManageTasks, canRecover, type BackgroundItem, type KindIcon } from '../../lib/tasks'
import { useTasksStore } from '../../store/tasks'
import { useConnectionStore } from '../../store/connection'
import { useGatewaySupport } from '../../lib/useGatewaySupport'
import { useIsNarrow } from '../../lib/useIsNarrow'

// One background item — a gateway task or a script job — as a row, the same in the chat's
// Background strip, the task drawer's list and the Dashboard. Clicking the row opens the
// drawer; the actions beside it are separate buttons: Stop while it runs, Retry delivery
// and Dismiss delivery when its result couldn't be delivered back, × to hide it from this
// chat once it's finished.

export const KIND_ICONS: Record<KindIcon, LucideIcon> = {
  subagent: GitFork,
  command: SquareTerminal,
  automation: Clock,
  image: Image,
  music: Music,
  video: Clapperboard,
  maintenance: Wrench,
  acp: Bot,
  cli: Terminal,
  script: Terminal,
  task: Layers,
}

const OFFLINE_TITLE = 'Reconnect to manage tasks'

export function TaskRow({ item, now, sessionKey, onOpen, stacked }: {
  item: BackgroundItem
  now: number
  /** The chat whose strip shows this row; enables × (hide) for finished items. */
  sessionKey?: string
  onOpen?: () => void
  /**
   * Lay the row out on two lines, for a narrow column (the 380px drawer, the Dashboard's
   * side panel): one line would leave the title no room beside a bar, a pill and Stop.
   * Always the case on a phone.
   */
  stacked?: boolean
}) {
  const narrow = useIsNarrow()
  const stack = narrow || !!stacked
  const pending = useTasksStore(s => s.pending[item.key])
  const error = useTasksStore(s => s.actionError[item.key])
  const { stop, retry, dismiss, hide } = useTasksStore.getState()
  const connected = useConnectionStore(s => s.status === 'connected')
  const canWrite = useConnectionStore(s => canManageTasks(s.grantedScopes))
  const canCancel = useGatewaySupport({ methods: ['tasks.cancel'] }).supported
  const canRetry = useGatewaySupport({ methods: ['tasks.retry'] }).supported
  const canDismiss = useGatewaySupport({ methods: ['tasks.dismiss'] }).supported

  const Icon = KIND_ICONS[item.kind.icon]
  const color = toneColor(item.state.tone)
  // A read-only token gets no actions at all. A dropped connection keeps them, disabled,
  // so the row doesn't jump around while it reconnects.
  const showStop = item.active && canWrite && (item.source === 'script' || canCancel || !connected)
  const recoverable = !!item.task && canRecover(item.task)
  const showRetry = recoverable && canWrite && (canRetry || !connected)
  const showDismiss = recoverable && canWrite && (canDismiss || !connected)
  const showHide = !!sessionKey && !item.active && !item.needsYou
  const offTitle = connected ? undefined : OFFLINE_TITLE

  const track = item.percent != null && (
    <span className="flex items-center gap-1.5" style={stack ? { marginTop: 4, paddingLeft: 21 } : { flex: '0 1 120px', minWidth: 60, marginTop: 5 }}>
      <ProgressTrack pct={item.percent} color={color} label={`${item.title} progress`} />
      <span className="font-mono" style={{ color }}>{item.percent}%</span>
    </span>
  )
  const stopBtn = showStop && (
    <RowAction
      narrow={narrow}
      onClick={() => void stop(item)}
      disabled={!connected || !!pending}
      title={offTitle}
      label={`Stop ${item.title}`}
      color="var(--danger)"
    >
      <Square size={9} aria-hidden /> {pending === 'stop' ? 'Stopping…' : 'Stop'}
    </RowAction>
  )
  const hideBtn = showHide && (
    <button
      type="button"
      onClick={() => hide(sessionKey!, item.key)}
      title="Hide"
      aria-label={`Hide ${item.title}`}
      className="flex items-center justify-center shrink-0"
      style={{
        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', borderRadius: 4,
        width: narrow ? 40 : 20, height: narrow ? 40 : 20, margin: narrow ? '-4px -10px -4px 0' : 0,
      }}
    >
      <X size={12} />
    </button>
  )
  const icon = (
    <Icon
      size={13}
      aria-hidden
      className={item.active ? 'animate-pulse-dot' : undefined}
      style={{ flexShrink: 0, marginTop: 2, color }}
    />
  )
  const openStyle: CSSProperties = {
    minWidth: 0, background: 'none', border: 'none', padding: 0, color: 'inherit',
    cursor: onOpen ? 'pointer' : 'default', minHeight: narrow ? 40 : undefined,
  }

  return (
    <div className="text-xs" style={{ padding: narrow ? '6px 0' : '5px 0', borderTop: '1px solid color-mix(in srgb, var(--border) 60%, transparent)' }}>
      {stack ? (
        // Two lines: the title gets the width, and the pill follows the meta line. On a
        // phone the meta is short (kind · elapsed) and Stop gets a line of its own, so it's
        // an easy 40px target; in a narrow desktop column Stop sits beside the title.
        <>
          <div className="flex items-start gap-2">
            <button type="button" onClick={onOpen} disabled={!onOpen} className="flex flex-1 items-start gap-2 text-left" style={openStyle}>
              {icon}
              <span className="flex flex-col" style={{ minWidth: 0, flex: 1, gap: 2 }}>
                <span className="truncate" style={{ color: 'var(--text-primary)', fontWeight: 500 }} title={item.title}>{item.title}</span>
                <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ color: 'var(--text-secondary)', minWidth: 0 }}>{metaLine(item, now, { compact: narrow })}</span>
                  <Pill tone={item.state.tone}>{item.state.label}</Pill>
                </span>
              </span>
            </button>
            {!narrow && stopBtn}
            {hideBtn}
          </div>
          {track}
          {narrow && stopBtn && <div className="flex justify-end" style={{ marginTop: 4 }}>{stopBtn}</div>}
        </>
      ) : (
        <div className="flex items-start gap-2">
          <button type="button" onClick={onOpen} disabled={!onOpen} className="flex flex-1 items-start gap-2 text-left" style={openStyle}>
            {icon}
            <span className="flex flex-col" style={{ minWidth: 0, flex: 1 }}>
              <span className="truncate" style={{ color: 'var(--text-primary)', fontWeight: 500 }} title={item.title}>{item.title}</span>
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{metaLine(item, now)}</span>
            </span>
          </button>
          {track}
          <span className="flex items-center gap-1.5 shrink-0" style={{ marginTop: 1 }}>
            <Pill tone={item.state.tone}>{item.state.label}</Pill>
            {stopBtn}
            {hideBtn}
          </span>
        </div>
      )}

      {(showRetry || showDismiss) && (
        <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 4, paddingLeft: 21 }}>
          {/* Shown before the button, not in a confirm: the gateway can only say after a retry
              whether it risked a duplicate, so the warning has to come first (Control UI parity). */}
          <span className="flex items-center gap-1" style={{ color: 'var(--warning)', flex: stack ? '1 1 100%' : '1 1 auto' }}>
            <AlertTriangle size={11} aria-hidden style={{ flexShrink: 0 }} />
            {narrow ? 'Retrying may post it twice.' : 'Retrying may post the result twice.'}
          </span>
          {showRetry && (
            <RowAction
              narrow={narrow}
              onClick={() => void retry(item.id)}
              disabled={!connected || !!pending}
              title={offTitle}
              label={`Retry delivery for ${item.title}`}
            >
              {pending === 'retry' && <Loader2 size={10} className="animate-spin" aria-hidden />}
              Retry delivery
            </RowAction>
          )}
          {showDismiss && (
            <RowAction
              narrow={narrow}
              onClick={() => void dismiss(item.id)}
              disabled={!connected || !!pending}
              title={offTitle}
              label={`Dismiss delivery for ${item.title}`}
            >
              {pending === 'dismiss' && <Loader2 size={10} className="animate-spin" aria-hidden />}
              {narrow ? 'Dismiss' : 'Dismiss delivery'}
            </RowAction>
          )}
        </div>
      )}

      {error && (
        <p role="alert" style={{ margin: '4px 0 0', paddingLeft: 21, color: 'var(--danger)' }}>{error}</p>
      )}
    </div>
  )
}

// The row's action buttons: the small outline-button shape, with an accessible name that
// says which task it acts on ("Stop Research competitor pricing"), and a 40px tap target
// on a phone.
function RowAction({ narrow, onClick, disabled, title, label, color = 'var(--text-primary)', children }: {
  narrow: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
  label: string
  color?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className="inline-flex items-center gap-1"
      style={{
        padding: narrow ? '0 12px' : '2px 8px', minHeight: narrow ? 40 : undefined, fontSize: 11, fontWeight: 500,
        borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-surface)',
        color, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}
