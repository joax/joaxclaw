import { useEffect, useRef } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import type { Conversation } from '../../lib/types'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { useSessionRunning } from './useSessionRunning'
import { useChatStore } from '../../store/chat'

interface Props { conv: Conversation; showTools: boolean; showReasoning: boolean }

// How close to the bottom (px) still counts as "following" the stream.
const PIN_THRESHOLD = 80

export function MessageThread({ conv, showTools, showReasoning }: Props) {
  // The gateway can still be working on a turn that no longer has a local stream
  // (the run outlived it, or the socket dropped mid-turn). Without this the pane
  // looks finished while the chat list still shows a live dot.
  const sessionRunning = useSessionRunning(conv.sessionKey)
  const streamingHere = conv.messages.some(m => m.streaming)
  const runningWithoutStream = sessionRunning && !streamingHere && conv.messages.length > 0

  // Re-attach to the live run, so the notice below is a promise we keep. The event
  // subscription is torn down on final/error/abort and by the reconnect sweep, and
  // nothing re-subscribed for a conversation that was already open — watchSession only
  // ran when opening a running session from the list or in a pop-out window. Without
  // this, output kept flowing on the gateway and never reached this pane.
  // watchSession is a no-op when a stream is already attached.
  const watchSession = useChatStore(s => s.watchSession)
  useEffect(() => {
    if (runningWithoutStream && conv.sessionKey) watchSession(conv.id, conv.sessionKey)
  }, [runningWithoutStream, conv.id, conv.sessionKey, watchSession])

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
    // Also watch the viewport itself: the sticky script dock appearing above the thread
    // shrinks it, which would otherwise slide the newest messages out of view.
    ro.observe(el)
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

        {runningWithoutStream && <StillRunningNotice />}
      </div>
    </div>
  )
}

// The run is live on the gateway but nothing is streaming into this pane — the
// transcript would otherwise read as finished while the chat list shows it active.
function StillRunningNotice() {
  return (
    <div className="flex items-center gap-2 px-1 animate-fade-in">
      <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        Still running on the gateway — new output will appear here.
      </span>
    </div>
  )
}
