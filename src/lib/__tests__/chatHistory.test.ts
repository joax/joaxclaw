import { describe, it, expect } from 'vitest'
import { toChatMessages, extractText, extractReasoning, extractAttachments, extractModel } from '../chatHistory'

// toChatMessages moved out of store/chat.ts unchanged (PRD 03 §8.1), so the task drawer
// can render tasks.history with it. These pin the behaviour it had there.

const KEY = 'agent:main:main'

describe('toChatMessages', () => {
  it('keeps user and assistant messages and drops system and other roles', () => {
    const out = toChatMessages([
      { role: 'system', content: 'You are…' },
      { role: 'user', content: 'hi', timestamp: 1000 },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }], model: 'qwen3.6' },
      { role: 'tool', content: 'x' },
      null,
      'junk',
    ], KEY)
    expect(out.map(m => [m.role, m.content])).toEqual([['user', 'hi'], ['assistant', 'hello']])
    expect(out[0].sessionId).toBe(KEY)
    expect(out[0].createdAt).toBe(new Date(1000).toISOString())
    expect(out[1].model).toBe('qwen3.6')
  })

  it('extracts tool calls and attaches their results from toolResult rows', () => {
    const out = toChatMessages([
      { role: 'assistant', id: 'a1', content: [
        { type: 'text', text: 'Checking.' },
        { type: 'toolCall', id: 'call_1', name: 'web_fetch', arguments: { url: 'https://example.com' } },
      ] },
      { role: 'toolResult', toolCallId: 'call_1', toolName: 'web_fetch', content: [{ type: 'text', text: '<html>' }] },
    ], KEY, n => (n === 'web_fetch' ? 'core' : undefined))
    expect(out).toHaveLength(1)
    expect(out[0].toolCalls).toEqual([
      { id: 'call_1', name: 'web_fetch', args: '{"url":"https://example.com"}', status: 'done', result: '<html>', pluginId: 'core' },
    ])
  })

  it('drops an assistant message that is only a bare unclosed <think>', () => {
    const out = toChatMessages([
      { role: 'assistant', content: '<think>still going' },
      { role: 'assistant', content: '<think>a plan</think>' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }] },
    ], KEY)
    expect(out.map(m => m.content)).toEqual(['<think>a plan</think>', ''])
    expect(out[1].reasoning).toBe('hm')
  })

  it('keeps an empty user message', () => {
    expect(toChatMessages([{ role: 'user', content: '' }], KEY)).toHaveLength(1)
  })
})

describe('extractors', () => {
  it('reads text from text, string content and text blocks', () => {
    expect(extractText({ text: 'a' })).toBe('a')
    expect(extractText({ content: 'b' })).toBe('b')
    expect(extractText({ content: [{ type: 'text', text: 'c' }, { type: 'image' }, { type: 'text', text: 'd' }] })).toBe('c\nd')
    expect(extractText(null)).toBe('')
  })

  it('reads reasoning from thinking blocks', () => {
    expect(extractReasoning({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'thinking', thinking: 'y' }] })).toBe('x\ny')
    expect(extractReasoning({ content: 'plain' })).toBe('')
  })

  it('finds audio in blocks, channel media paths and bare URLs', () => {
    const atts = extractAttachments({
      content: [{ type: 'audio', url: 'https://x/a.ogg', mediaType: 'audio/ogg' }, { type: 'text', text: 'listen https://x/b.mp3' }],
      MediaPath: '/tmp/v.m4a', MediaType: 'audio/mp4',
    })
    expect(atts.map(a => a.url)).toEqual(['https://x/a.ogg', 'file:///tmp/v.m4a', 'https://x/b.mp3'])
  })

  it('reads the model only when it is a non-empty string', () => {
    expect(extractModel({ model: 'm' })).toBe('m')
    expect(extractModel({ model: '' })).toBeUndefined()
  })
})
