import { useState, useEffect, useRef } from 'react'
import { SmilePlus } from 'lucide-react'
import type { ChatMessage } from '../../lib/types'
import { useReactionsStore } from '../../store/reactions'

// A small, curated palette — enough to be expressive without a full emoji keyboard.
const PALETTE = ['👍', '❤️', '😂', '🎉', '🚀', '👀', '✅', '🔥', '😮', '🙏', '💯', '😅']

interface Props {
  message: ChatMessage
  /** Which side the message sits on — controls picker anchoring and row alignment */
  align?: 'left' | 'right'
}

// A per-message reaction row: the emoji the user has attached (each toggles off on
// click) plus a hover-revealed "＋" that opens a compact emoji picker. Reactions
// persist locally via the reactions store (see store/reactions.ts).
export function MessageReactions({ message, align = 'left' }: Props) {
  const { load, toggle, getReactions } = useReactionsStore()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { load() }, [])

  // Dismiss the picker on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const reactions = getReactions(message.id)
  const react = (emoji: string) => {
    void toggle({ sessionId: message.sessionId, messageId: message.id, emoji })
  }

  const pill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: 22, minWidth: 26, padding: '0 6px',
    fontSize: 13, lineHeight: 1, cursor: 'pointer',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 999, transition: 'border-color 0.12s, background 0.12s',
  }

  return (
    <div
      className={`flex items-center gap-1 mt-1.5 ${align === 'right' ? 'justify-end' : ''}`}
      style={{ position: 'relative' }}
      ref={wrapRef}
    >
      {reactions.map(emoji => (
        <button
          key={emoji}
          title="Remove reaction"
          style={pill}
          onClick={() => react(emoji)}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          {emoji}
        </button>
      ))}

      {/* Add-reaction trigger — hidden until the message is hovered (or the picker is open) */}
      <div style={{ position: 'relative' }}>
        <button
          className="reaction-add"
          data-open={open ? 'true' : undefined}
          title="Add reaction"
          style={{
            ...pill, minWidth: 22, padding: 0,
            color: 'var(--text-secondary)',
          }}
          onClick={() => setOpen(v => !v)}
        >
          <SmilePlus size={13} />
        </button>

        {open && (
          <div
            className="animate-fade-in"
            style={{
              position: 'absolute', bottom: 'calc(100% + 6px)', zIndex: 20,
              ...(align === 'right' ? { right: 0 } : { left: 0 }),
              display: 'flex', flexWrap: 'wrap', gap: 2, width: 196, padding: 6,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
            }}
          >
            {PALETTE.map(emoji => {
              const active = reactions.includes(emoji)
              return (
                <button
                  key={emoji}
                  title={active ? 'Remove reaction' : 'React'}
                  style={{
                    width: 28, height: 28, fontSize: 16, lineHeight: 1, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'none',
                    border: 'none', borderRadius: 6, transition: 'background 0.1s',
                  }}
                  onClick={() => { react(emoji); setOpen(false) }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 14%, transparent)')}
                  onMouseLeave={e => (e.currentTarget.style.background = active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'none')}
                >
                  {emoji}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
