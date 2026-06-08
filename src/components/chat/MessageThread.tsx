import { useEffect, useRef } from 'react'
import type { Conversation } from '../../lib/types'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

interface Props { conv: Conversation; showTools: boolean; showReasoning: boolean }

export function MessageThread({ conv, showTools, showReasoning }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)

  // On first mount: jump instantly to bottom (no animation)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    mountedRef.current = true
  }, [])

  // After mount: smooth-scroll whenever the last message grows in any way
  // (content text, tool calls added/updated, reasoning, streaming state)
  const last = conv.messages[conv.messages.length - 1]
  const lastMsgKey = last
    ? `${last.id}:${last.content?.length ?? 0}:${last.reasoning?.length ?? 0}:${last.toolCalls?.length ?? 0}:${last.streaming}`
    : ''

  useEffect(() => {
    if (!mountedRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conv.messages.length, lastMsgKey])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ scrollBehavior: 'smooth', userSelect: 'text' }}>
      {conv.messages.map(msg =>
        msg.role === 'user'
          ? <UserMessage key={msg.id} message={msg} />
          : <AssistantMessage key={msg.id} message={msg} showTools={showTools} showReasoning={showReasoning} />
      )}
      <div ref={bottomRef} />
    </div>
  )
}
