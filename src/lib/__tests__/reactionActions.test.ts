import { describe, it, expect } from 'vitest'
import { parseReactAction } from '../reactionActions'

describe('parseReactAction', () => {
  it('detects a channel message react and extracts the emoji', () => {
    const args = JSON.stringify({ emoji: '👍', messageId: '1746206064299', action: 'react' })
    expect(parseReactAction('message', args)).toEqual({ emoji: '👍', target: undefined })
  })

  it('extracts a target when present', () => {
    const args = JSON.stringify({ emoji: '🎉', action: 'react', target: 'whatsapp:+15551234' })
    expect(parseReactAction('message', args)).toEqual({ emoji: '🎉', target: 'whatsapp:+15551234' })
  })

  it('is case-insensitive on action and matches message-family tool names', () => {
    const args = JSON.stringify({ emoji: '🔥', action: 'REACT' })
    expect(parseReactAction('channel_message', args)).toEqual({ emoji: '🔥', target: undefined })
  })

  it('returns null for non-react message actions', () => {
    expect(parseReactAction('message', JSON.stringify({ action: 'send', text: 'hi' }))).toBeNull()
  })

  it('returns null when the emoji is missing or blank', () => {
    expect(parseReactAction('message', JSON.stringify({ action: 'react', emoji: '  ' }))).toBeNull()
    expect(parseReactAction('message', JSON.stringify({ action: 'react' }))).toBeNull()
  })

  it('returns null for unrelated tools', () => {
    expect(parseReactAction('bash', JSON.stringify({ action: 'react', emoji: '👍' }))).toBeNull()
  })

  it('tolerates malformed args', () => {
    expect(parseReactAction('message', 'not json')).toBeNull()
    expect(parseReactAction('message', undefined)).toBeNull()
  })
})
