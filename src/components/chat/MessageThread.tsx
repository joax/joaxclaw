import { useEffect, useRef } from 'react'
import { Clock } from 'lucide-react'
import type { Conversation } from '../../lib/types'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

interface Props { conv: Conversation; showTools: boolean; showReasoning: boolean }

// How close to the bottom (px) still counts as "following" the stream.
const PIN_THRESHOLD = 80

export function MessageThread({ conv, showTools, showReasoning }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
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

  // Reset to the bottom whenever we switch conversations.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = true
    el.scrollTop = el.scrollHeight
  }, [conv.id])

  // Follow growth of the last message (text, tools, reasoning, streaming state).
  const last = conv.messages[conv.messages.length - 1]
  const lastMsgKey = last
    ? `${last.id}:${last.content?.length ?? 0}:${last.reasoning?.length ?? 0}:${last.toolCalls?.length ?? 0}:${last.streaming}`
    : ''

  // Jump straight to the bottom — instantly, never animated. A smooth scroll
  // restarted on every streaming token fights itself (and markdown reflow) and
  // makes the view bounce up and down. Only follow if the user is still pinned.
  useEffect(() => {
    if (!pinnedRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conv.messages.length, lastMsgKey])

  if (conv.messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--text-secondary)' }}>
        <Clock size={32} style={{ opacity: 0.3 }} />
        <p className="text-sm">No messages in this session</p>
        <p className="text-xs" style={{ opacity: 0.6 }}>{conv.sessionKey}</p>
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ userSelect: 'text', overflowAnchor: 'none' }}>
      {conv.messages.map(msg =>
        msg.role === 'user'
          ? <UserMessage key={msg.id} message={msg} />
          : <AssistantMessage key={msg.id} message={msg} showTools={showTools} showReasoning={showReasoning} />
      )}
    </div>
  )
}
