import { describe, it, expect } from 'vitest'
import { isEmptyFinishedTurn, dropEmptyFinishedTurns } from '../streamStatus'
import type { ChatMessage } from '../types'

// A turn whose run is over and that showed nothing is dropped instead of rendering as a
// bare "Assistant" bubble (QA: one stayed under the reply after a normal send). Anything
// still streaming, cut off by a dropped connection, or carrying any output is kept.
const turn = (p: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1', sessionId: 's', role: 'assistant', content: '', createdAt: '', ...p,
})

describe('isEmptyFinishedTurn', () => {
  it('is a finished assistant turn with nothing in it', () => {
    expect(isEmptyFinishedTurn(turn({ streaming: false }))).toBe(true)
    expect(isEmptyFinishedTurn(turn({ reasoning: '', toolCalls: [], attachments: [], threads: [] }))).toBe(true)
    expect(isEmptyFinishedTurn(turn({ content: '  \n' }))).toBe(true)
  })

  it('never takes a turn that is still streaming', () => {
    expect(isEmptyFinishedTurn(turn({ streaming: true }))).toBe(false)
  })

  it('keeps an interrupted turn: its reconnect notice is the content', () => {
    expect(isEmptyFinishedTurn(turn({ interrupted: true }))).toBe(false)
  })

  it('keeps a turn with any output', () => {
    expect(isEmptyFinishedTurn(turn({ content: 'an answer' }))).toBe(false)
    expect(isEmptyFinishedTurn(turn({ reasoning: 'thinking' }))).toBe(false)
    expect(isEmptyFinishedTurn(turn({ toolCalls: [{ id: 't', name: 'exec', status: 'done' }] }))).toBe(false)
    expect(isEmptyFinishedTurn(turn({ attachments: [{ type: 'image' } as never] }))).toBe(false)
    expect(isEmptyFinishedTurn(turn({ threads: [{ id: 'th', status: 'spawning', content: '' } as never] }))).toBe(false)
    expect(isEmptyFinishedTurn(turn({ waitingForSession: 'agent:x:sub' }))).toBe(false)
    expect(isEmptyFinishedTurn(turn({ contextOverflow: { error: 'Context overflow' } }))).toBe(false)
  })

  it('never takes the user', () => {
    expect(isEmptyFinishedTurn(turn({ role: 'user' }))).toBe(false)
  })
})

describe('dropEmptyFinishedTurns', () => {
  it('drops the empty turn under a reply, and nothing else', () => {
    const reply = turn({ id: 'reply', content: 'Hello from the QA mock model.' })
    const msgs = [turn({ id: 'u', role: 'user', content: 'hello' }), reply, turn({ id: 'ghost' })]
    expect(dropEmptyFinishedTurns(msgs).map(m => m.id)).toEqual(['u', 'reply'])
  })

  it('returns the same array when there is nothing to drop', () => {
    const msgs = [turn({ content: 'a' }), turn({ id: 'live', streaming: true })]
    expect(dropEmptyFinishedTurns(msgs)).toBe(msgs)
  })
})
