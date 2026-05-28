import { useEffect, useRef } from 'react'
import type { Conversation } from '../../lib/types'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

interface Props { conv: Conversation; showTools: boolean; showReasoning: boolean }

export function MessageThread({ conv, showTools, showReasoning }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conv.messages.length, conv.messages[conv.messages.length - 1]?.content])

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
