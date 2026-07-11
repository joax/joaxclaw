import { useEffect, useRef } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import type { Conversation } from '../../lib/types'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

interface Props { conv: Conversation; showTools: boolean; showReasoning: boolean }

// How close to the bottom (px) still counts as "following" the stream.
const PIN_THRESHOLD = 80

export function MessageThread({ conv, showTools, showReasoning }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Whether the view is glued to the bottom. While true we auto-follow new
  // content; once the user scrolls up to read, we leave them alone.
  const pinnedRef = useRef(true)

  // Recompute pinned state on every user/programmatic scroll. Setting
  // scrollTop below also fires this, which keeps pinnedRef true mid-stream.
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD
  }

  // Follow EVERY content-height change — streamed text, tool calls, reasoning,
  // Basic-mode action steps, images loading, markdown reflow — by watching the
  // content box size rather than enumerating which fields changed. Jump straight
  // to the bottom, instantly (never animated): a smooth scroll restarted on each
  // increment fights itself and makes the view bounce up and down.
  //
  // The scroll container is ALWAYS mounted (the empty state renders inside it), so
  // this observer attaches to the real content node even when the conversation
  // started empty — previously it was skipped and auto-follow silently never ran.
  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  // Reset to the bottom whenever we switch conversations.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = true
    el.scrollTop = el.scrollHeight
  }, [conv.id])

  // When the user sends a message (a new user message appears), force-follow even
  // if they had scrolled up to read — they want to see their message and the reply.
  const lastUserId = (() => {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'user') return conv.messages[i].id
    }
    return undefined
  })()
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !lastUserId) return
    pinnedRef.current = true
    el.scrollTop = el.scrollHeight
  }, [lastUserId])

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto" style={{ userSelect: 'text', overflowAnchor: 'none' }}>
      <div ref={contentRef} className="px-4 py-4 space-y-4">
        {conv.messages.length === 0 && conv.loadingHistory ? (
          <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: '60vh', color: 'var(--text-secondary)' }}>
            <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <p className="text-sm">Loading conversation…</p>
          </div>
        ) : conv.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: '60vh', color: 'var(--text-secondary)' }}>
            <Clock size={32} style={{ opacity: 0.3 }} />
            <p className="text-sm">No messages in this session</p>
            <p className="text-xs" style={{ opacity: 0.6 }}>{conv.sessionKey}</p>
          </div>
        ) : conv.messages.map((msg, i) =>
          msg.role === 'user'
            ? <UserMessage key={msg.id} message={msg} />
            : <AssistantMessage key={msg.id} message={msg} showTools={showTools} showReasoning={showReasoning} convId={conv.id} isLast={i === conv.messages.length - 1} />
        )}
      </div>
    </div>
  )
}
