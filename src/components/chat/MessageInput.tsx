import { useState, useRef } from 'react'
import { Send, Square } from 'lucide-react'
import { useChatStore } from '../../store/chat'

interface Props { convId: string }

export function MessageInput({ convId }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const { sendMessage, abortStream, conversations } = useChatStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const conv = conversations.find(c => c.id === convId)
  const isStreaming = conv?.messages.some(m => m.streaming) ?? false

  const handleSend = async () => {
    if (!text.trim() || sending || isStreaming) return
    const msg = text.trim()
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)
    try { await sendMessage(convId, msg) } finally { setSending(false) }
  }

  const handleStop = () => abortStream(convId)

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  return (
    <div
      className="shrink-0 px-4 py-3"
      style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}
    >
      <div
        className="flex items-end gap-2 p-2 rounded"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)' }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKey}
          placeholder="Message…"
          rows={1}
          disabled={isStreaming}
          style={{
            flex: 1,
            resize: 'none',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontSize: 14,
            outline: 'none',
            fontFamily: 'var(--font-family)',
            lineHeight: 1.5,
            padding: '4px 4px',
            minHeight: 28,
            maxHeight: 160,
            overflowY: 'auto'
          }}
        />
        <button
          onClick={isStreaming ? handleStop : handleSend}
          disabled={!isStreaming && !text.trim()}
          title={isStreaming ? 'Stop' : 'Send (Enter)'}
          style={{
            width: 32, height: 32,
            borderRadius: 'calc(var(--radius) / 1.5)',
            border: 'none',
            background: text.trim() || isStreaming ? 'var(--accent)' : 'var(--border)',
            color: 'var(--accent-fg)',
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
            flexShrink: 0
          }}
        >
          {isStreaming ? <Square size={13} /> : <Send size={13} />}
        </button>
      </div>
      <p className="text-center mt-1.5 text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}
