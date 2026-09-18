import { createContext, useContext, useEffect, useId, useMemo, useReducer, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { ProgressTrack } from './ProgressTrack'
import { BottomSheet } from './BottomSheet'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { nextOpenStrip } from '../../lib/stripBar'
import { toneColor, toneTint, type StateTone } from '../../lib/stateTone'

// Strips: the one-line status rows pinned between the chat header and the thread
// (Progress, Background, …), in the progress card's style. A StripBar holds them and
// keeps only one open at a time. On desktop a strip opens in place; on a phone the strips
// become one sideways-scrolling chip row, and a chip opens its strip in a bottom sheet.
// A strip with nothing to show renders nothing, and so does an empty chip row.
// Key the StripBar by conversation, so switching chats closes every strip.

interface StripBarCtx {
  openId: string | null
  toggle: (id: string) => void
  hide: (id: string) => void
  close: () => void
  narrow: boolean
}

const Ctx = createContext<StripBarCtx | null>(null)

export function StripBar({ children }: { children: ReactNode }) {
  const narrow = useIsNarrow()
  const [openId, dispatch] = useReducer(nextOpenStrip, null)
  const ctx = useMemo<StripBarCtx>(() => ({
    openId, narrow,
    toggle: id => dispatch({ type: 'toggle', id }),
    hide: id => dispatch({ type: 'hide', id }),
    close: () => dispatch({ type: 'closeAll' }),
  }), [openId, narrow])
  return (
    <Ctx.Provider value={ctx}>
      {narrow ? (
        // `empty:hidden` drops the row when every strip rendered nothing.
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 shrink-0 overflow-x-auto empty:hidden"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', scrollbarWidth: 'none' }}
        >
          {children}
        </div>
      ) : (
        <div className="flex flex-col shrink-0 empty:hidden">{children}</div>
      )}
    </Ctx.Provider>
  )
}

const noop = () => {}

/**
 * Close whichever strip in the enclosing StripBar is open (a no-op outside one). For a
 * strip whose rows hand off to a full-screen panel: on a phone the body is a bottom
 * sheet, which would otherwise stay open, and keep its Escape and focus trap, under it.
 */
export function useCloseStrips(): () => void {
  return useContext(Ctx)?.close ?? noop
}

export function Strip({ id, visible, label, headline, tone = 'working', track, count, trailing, body, chipLabel }: {
  id: string
  visible: boolean
  label: string
  headline: ReactNode
  tone?: StateTone
  /** A progress bar: `pct` 0–100, or null for indeterminate. */
  track?: { pct: number | null }
  count?: string
  trailing?: ReactNode
  /** What opens: in place on desktop, in a bottom sheet on a phone. */
  body?: ReactNode
  chipLabel?: string
}) {
  const bar = useContext(Ctx)
  const bodyId = useId()
  const open = !!bar && bar.openId === id
  const hide = bar?.hide

  // A strip that goes away while open doesn't stay "open" for when it comes back.
  useEffect(() => { if (!visible && hide) hide(id) }, [visible, hide, id])

  if (!visible) return null
  const color = toneColor(tone)
  const expandable = !!body
  const toggle = () => { if (expandable) bar?.toggle(id) }
  const headlineText = typeof headline === 'string' ? headline : label

  if (bar?.narrow) {
    return (
      <>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expandable ? open : undefined}
          aria-controls={expandable ? bodyId : undefined}
          className="text-xs font-medium shrink-0"
          style={{
            padding: '3px 10px', borderRadius: 999, border: 'none', whiteSpace: 'nowrap',
            cursor: expandable ? 'pointer' : 'default',
            background: toneTint(tone, 15, 'var(--bg-elevated)'), color,
          }}
        >
          {chipLabel ?? label}{count ? ` ${count}` : ''}
        </button>
        {open && body && (
          <BottomSheet title={label} onClose={() => bar.close()}>
            <div id={bodyId} className="px-4 pb-3 text-xs">{body}</div>
          </BottomSheet>
        )}
      </>
    )
  }

  return (
    <div className="shrink-0 text-xs" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? bodyId : undefined}
        title={expandable ? `${open ? 'Hide' : 'Show'} ${label}` : undefined}
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
        <span style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>{label}</span>
        <span className="truncate" style={{ flex: '1 1 auto', minWidth: 0, color: 'var(--text-primary)' }}>{headline}</span>
        {(track || count) && (
          <span className="flex items-center gap-1.5" style={{ flex: '0 1 160px', minWidth: 80 }}>
            {track && <ProgressTrack pct={track.pct} color={color} label={headlineText} />}
            {count && <span className="font-mono" style={{ color, minWidth: '3ch', textAlign: 'right' }}>{count}</span>}
          </span>
        )}
        {trailing}
      </button>

      {open && body && (
        <div id={bodyId} className="px-4 pb-3" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
          {body}
        </div>
      )}
    </div>
  )
}
