import { useState, useRef, useEffect } from 'react'
import { Send, Square, RotateCcw } from 'lucide-react'
import { useChatStore } from '../../store/chat'
import { useSettingsStore } from '../../store/settings'

interface Props { convId: string }

export function MessageInput({ convId }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [isStalled, setIsStalled] = useState(false)
  const { sendMessage, abortStream, conversations } = useChatStore()
  const stallTimeoutMs = useSettingsStore(s => s.streamStallTimeout * 1000)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const conv = conversations.find(c => c.id === convId)
  const isStreaming = conv?.messages.some(m => m.streaming) ?? false

  // Track activity on the streaming message to detect stalls
  const streamingMsg = conv?.messages.findLast(m => m.streaming)
  const activityKey = streamingMsg
    ? `${streamingMsg.content.length}:${streamingMsg.reasoning?.length ?? 0}:${streamingMsg.toolCalls?.length ?? 0}:${streamingMsg.toolCalls?.filter(t => t.status === 'running').length ?? 0}:${streamingMsg.waitingForSession ?? ''}`
    : null
  const prevActivityKey = useRef<string | null>(null)

  useEffect(() => {
    if (!isStreaming || !activityKey) { setIsStalled(false); return }
    if (activityKey !== prevActivityKey.current) {
      prevActivityKey.current = activityKey
      setIsStalled(false)
    }
    const t = setTimeout(() => setIsStalled(true), stallTimeoutMs)
    return () => clearTimeout(t)
  }, [isStreaming, activityKey, stallTimeoutMs])

  // When stalled, input is unblocked — send aborts the zombie stream first
  const isBlocked = isStreaming && !isStalled

  const handleSend = async (overrideText?: string) => {
    const msg = (overrideText ?? text).trim()
    if (!msg || sending || isBlocked) return
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)
    try {
      if (isStreaming) await abortStream(convId)
      await sendMessage(convId, msg)
    } finally { setSending(false) }
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
      {isStalled && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-xs" style={{ color: 'var(--danger)', opacity: 0.8 }}>Model stopped responding.</span>
          <button
            onClick={() => handleSend('continue')}
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius)',
              border: '1px solid var(--danger)', background: 'transparent',
              color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
            }}
          >
            <RotateCcw size={10} /> Continue
          </button>
          <button
            onClick={handleStop}
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer'
            }}
          >
            Abort
          </button>
        </div>
      )}
      <div
        className="flex items-end gap-2 p-2 rounded"
        style={{ border: `1px solid ${isStalled ? 'var(--danger)' : 'var(--border)'}`, background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', transition: 'border-color 0.2s' }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKey}
          placeholder={isStalled ? 'Type to continue or use the buttons above…' : 'Message…'}
          rows={1}
          disabled={isBlocked}
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
          onClick={isBlocked ? handleStop : () => handleSend()}
          disabled={!isBlocked && !text.trim()}
          title={isBlocked ? 'Stop' : 'Send (Enter)'}
          style={{
            width: 32, height: 32,
            borderRadius: 'calc(var(--radius) / 1.5)',
            border: 'none',
            background: text.trim() || isBlocked ? 'var(--accent)' : 'var(--border)',
            color: 'var(--accent-fg)',
            cursor: text.trim() || isBlocked ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
            flexShrink: 0
          }}
        >
          {isBlocked ? <Square size={13} /> : <Send size={13} />}
        </button>
      </div>
      <p className="text-center mt-1.5 text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}
