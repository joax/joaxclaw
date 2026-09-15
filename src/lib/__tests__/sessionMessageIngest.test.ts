import { describe, it, expect } from 'vitest'
import { decideIngest } from '../sessionMessageIngest'
import type { ChatMessage } from '../types'

// Slack and WhatsApp conversations only showed their new messages after a reload. The
// gateway announces each new transcript entry (`session.message`), and this decides
// whether it belongs in the conversation JoaxClaw has open.

const msg = (over: Partial<ChatMessage>): ChatMessage =>
  ({ id: over.id ?? Math.random().toString(36).slice(2), sessionId: 's', role: 'user', content: '', createdAt: '2026-09-15T10:00:00Z', ...over } as ChatMessage)

const open = (messages: ChatMessage[], extra: { loadingHistory?: boolean } = {}) => ({ messages, ...extra })

describe('decideIngest', () => {
  it('appends a message someone wrote in Slack to the open conversation', () => {
    const conv = open([msg({ role: 'user', content: 'hi' }), msg({ role: 'assistant', content: 'Hello!' })])
    expect(decideIngest({ conversation: conv, streamAttached: false, incoming: msg({ id: 'slack-1', content: 'what is on today?' }) }))
      .toEqual({ action: 'append' })
  })

  it("appends the agent's reply when the app isn't streaming that turn", () => {
    const conv = open([msg({ role: 'user', content: 'what is on today?' })])
    expect(decideIngest({ conversation: conv, streamAttached: false, incoming: msg({ role: 'assistant', content: 'Two meetings.' }) }))
      .toEqual({ action: 'append' })
  })

  it('appends an assistant entry that only made a tool call, as a reload would show it', () => {
    const conv = open([msg({ role: 'user', content: 'check the calendar' })])
    const tool = msg({ role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'calendar', status: 'done' }] })
    expect(decideIngest({ conversation: conv, streamAttached: false, incoming: tool })).toEqual({ action: 'append' })
  })

  it("skips a chat that isn't open: it loads its history when opened", () => {
    expect(decideIngest({ conversation: undefined, streamAttached: false, incoming: msg({ content: 'x' }) }))
      .toEqual({ action: 'skip', reason: 'not-open' })
  })

  it('skips while the history is loading, since that will include it', () => {
    expect(decideIngest({ conversation: open([], { loadingHistory: true }), streamAttached: false, incoming: msg({ content: 'x' }) }))
      .toEqual({ action: 'skip', reason: 'loading' })
  })

  it('skips while the app is streaming its own turn in that chat', () => {
    expect(decideIngest({ conversation: open([]), streamAttached: true, incoming: msg({ role: 'assistant', content: 'partial' }) }))
      .toEqual({ action: 'skip', reason: 'own-turn' })
  })

  it('skips an empty entry', () => {
    expect(decideIngest({ conversation: open([]), streamAttached: false, incoming: msg({ role: 'assistant', content: '  ' }) }))
      .toEqual({ action: 'skip', reason: 'empty' })
    expect(decideIngest({ conversation: open([]), streamAttached: false, incoming: undefined }))
      .toEqual({ action: 'skip', reason: 'empty' })
  })

  it('skips a message already shown, by id', () => {
    const conv = open([msg({ id: 'm1', content: 'hi' })])
    expect(decideIngest({ conversation: conv, streamAttached: false, incoming: msg({ id: 'm1', content: 'hi' }) }))
      .toEqual({ action: 'skip', reason: 'duplicate' })
  })

  it('skips a reply the stream just finished showing', () => {
    const conv = open([msg({ role: 'user', content: 'q' }), msg({ role: 'assistant', content: 'The answer.' })])
    expect(decideIngest({ conversation: conv, streamAttached: false, incoming: msg({ role: 'assistant', content: 'The answer.' }) }))
      .toEqual({ action: 'skip', reason: 'duplicate' })
  })

  it('still appends a question that repeats an earlier one', () => {
    const conv = open([msg({ role: 'user', content: 'status?' }), msg({ role: 'assistant', content: 'All good.' })])
    expect(decideIngest({ conversation: conv, streamAttached: false, incoming: msg({ role: 'user', content: 'status?' }) }))
      .toEqual({ action: 'append' })
  })
})
