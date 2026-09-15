import type { ChatMessage } from './types'

// Whether a message the gateway reports for a session (the `session.message` event)
// belongs in the conversation JoaxClaw has open for that session.
//
// Channel conversations (Slack, WhatsApp, …) get their messages from outside the app:
// someone writes to the agent in Slack, and the agent replies there. JoaxClaw only
// followed turns it started itself or attached to, so those messages appeared only after
// a reload. The gateway announces every new transcript entry as `session.message`, and
// this decides what to do with each one.

export type IngestDecision =
  | { action: 'append' }
  | { action: 'skip'; reason: 'not-open' | 'loading' | 'own-turn' | 'empty' | 'duplicate' }

export function decideIngest(p: {
  /** The conversation for this session, if the app has one loaded. */
  conversation?: { messages: ChatMessage[]; loadingHistory?: boolean }
  /** The app is streaming a turn in this conversation: its own send, or a run it attached to. */
  streamAttached: boolean
  incoming?: ChatMessage
}): IngestDecision {
  const conv = p.conversation
  // A chat that isn't open reads its full history when it's opened.
  if (!conv) return { action: 'skip', reason: 'not-open' }
  // The history loading right now will include it.
  if (conv.loadingHistory) return { action: 'skip', reason: 'loading' }
  // The live stream already shows this turn: its prompt was added when it was sent, and
  // its reply streams in.
  if (p.streamAttached) return { action: 'skip', reason: 'own-turn' }

  const msg = p.incoming
  if (!msg || (!msg.content.trim() && !msg.toolCalls?.length && !msg.attachments?.length)) {
    return { action: 'skip', reason: 'empty' }
  }
  if (conv.messages.some(m => m.id === msg.id)) return { action: 'skip', reason: 'duplicate' }

  // The same text as the turn just shown, which happens when a stream finished a moment
  // before its transcript event arrived. Only the trailing run of same-role messages is
  // compared, so a repeated question later in the chat still appears.
  const text = msg.content.trim()
  if (text) {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i]
      if (m.role !== msg.role) break
      if (m.content.trim() === text) return { action: 'skip', reason: 'duplicate' }
    }
  }
  return { action: 'append' }
}
