import { describe, it, expect } from 'vitest'
import {
  extractToolCalls, toolResultUpdate, applyToolResults, mergeFinalToolCalls, historyMessageId,
} from '../historyMessages'
import type { ChatMessage, ToolCall } from '../types'

// Reopening a chat lost every tool call. The gateway's history carries them as
// `toolCall` blocks with `arguments`, and each result as its own `toolResult` message.
// The loader read only `tool_use` + `input` and dropped the results.

const assistant = (content: unknown[], id = 'a1') => ({ role: 'assistant', id, content })

describe('extractToolCalls', () => {
  it("reads the gateway's toolCall blocks", () => {
    const calls = extractToolCalls(assistant([
      { type: 'text', text: 'Checking.' },
      { type: 'toolCall', id: 'call_1', name: 'web_fetch', arguments: { url: 'https://example.com' } },
    ]))
    expect(calls).toEqual([{ id: 'call_1', name: 'web_fetch', args: '{"url":"https://example.com"}', status: 'done' }])
  })

  it("still reads Anthropic's tool_use + input spelling", () => {
    expect(extractToolCalls(assistant([{ type: 'tool_use', id: 't1', name: 'exec', input: { command: 'ls' } }])))
      .toEqual([{ id: 't1', name: 'exec', args: '{"command":"ls"}', status: 'done' }])
  })

  it('keeps string arguments as they are, and gives a missing id one', () => {
    const [c] = extractToolCalls(assistant([{ type: 'toolCall', name: 'x', arguments: '{"a":1}' }]))
    expect(c.args).toBe('{"a":1}')
    expect(c.id).toBeTruthy()
  })

  it('tags the plugin a tool belongs to, as the live view does', () => {
    const [c] = extractToolCalls(assistant([{ type: 'toolCall', id: 'c', name: 'teams_list', arguments: {} }]),
      n => (n === 'teams_list' ? 'joaxclaw-fs' : undefined))
    expect(c.pluginId).toBe('joaxclaw-fs')
  })

  it('ignores text and thinking, and messages without block content', () => {
    expect(extractToolCalls(assistant([{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'hi' }]))).toEqual([])
    expect(extractToolCalls({ role: 'assistant', content: 'plain' })).toEqual([])
    expect(extractToolCalls(null)).toEqual([])
  })
})

describe('toolResultUpdate', () => {
  it('turns a result message into the same patch the live path makes', () => {
    expect(toolResultUpdate({ role: 'toolResult', toolCallId: 'call_1', toolName: 'web_fetch', content: [{ type: 'text', text: '<html>…' }], isError: false }))
      .toEqual({ callId: 'call_1', patch: { status: 'done', result: '<html>…' } })
  })

  it('an error result sets status error with its text', () => {
    expect(toolResultUpdate({ role: 'toolResult', toolCallId: 'c', content: [{ type: 'text', text: 'ENOENT' }], isError: true }))
      .toEqual({ callId: 'c', patch: { status: 'error', error: 'ENOENT' } })
    expect(toolResultUpdate({ role: 'toolResult', toolCallId: 'c', content: [], isError: true }))
      .toEqual({ callId: 'c', patch: { status: 'error', error: 'Tool returned an error' } })
  })

  it('accepts string content, and a result with no text', () => {
    expect(toolResultUpdate({ role: 'toolResult', toolCallId: 'c', content: 'ok' })?.patch).toEqual({ status: 'done', result: 'ok' })
    expect(toolResultUpdate({ role: 'toolResult', toolCallId: 'c', content: [] })?.patch).toEqual({ status: 'done' })
  })

  it('is null for anything else', () => {
    expect(toolResultUpdate(assistant([]))).toBeNull()
    expect(toolResultUpdate({ role: 'toolResult', content: [] })).toBeNull()
    expect(toolResultUpdate(undefined)).toBeNull()
  })
})

describe('applyToolResults', () => {
  const msg = (id: string, toolCalls?: ToolCall[]) =>
    ({ id, sessionId: 's', role: 'assistant', content: '', createdAt: '', ...(toolCalls ? { toolCalls } : {}) } as ChatMessage)
  const call = (id: string): ToolCall => ({ id, name: 'exec', status: 'done' })

  it('attaches each result to its call, even in an earlier message', () => {
    const out = applyToolResults([msg('m1', [call('a'), call('b')]), msg('m2', [call('c')])], [
      { callId: 'b', patch: { status: 'error', error: 'boom' } },
      { callId: 'c', patch: { status: 'done', result: '42' } },
    ])
    expect(out[0].toolCalls).toEqual([call('a'), { ...call('b'), status: 'error', error: 'boom' }])
    expect(out[1].toolCalls).toEqual([{ ...call('c'), result: '42' }])
  })

  it('ignores results for calls it has not seen, and leaves other messages untouched', () => {
    const input = [msg('m1', [call('a')]), msg('m2')]
    const out = applyToolResults(input, [{ callId: 'zzz', patch: { status: 'done', result: 'x' } }])
    expect(out[0]).toBe(input[0])
    expect(out[1]).toBe(input[1])
  })

  it('returns the same list when there are no results', () => {
    const input = [msg('m1', [call('a')])]
    expect(applyToolResults(input, [])).toBe(input)
  })
})

describe('mergeFinalToolCalls', () => {
  const live: ToolCall[] = [{ id: 'a', name: 'exec', status: 'done', result: 'out', pluginId: 'p' }]

  it("keeps the live calls exactly, results included; the final frame can't wipe them", () => {
    const final: ToolCall[] = [{ id: 'a', name: 'exec', status: 'done', args: '{}' }]
    expect(mergeFinalToolCalls(live, final)).toBe(live)
  })

  it('adds calls the stream never reported', () => {
    const final: ToolCall[] = [{ id: 'a', name: 'exec', status: 'done' }, { id: 'b', name: 'read', status: 'done' }]
    expect(mergeFinalToolCalls(live, final)).toEqual([...live, { id: 'b', name: 'read', status: 'done' }])
    expect(mergeFinalToolCalls(undefined, [{ id: 'b', name: 'read', status: 'done' }])).toEqual([{ id: 'b', name: 'read', status: 'done' }])
  })

  it('leaves spawns out, since the live view shows them as threads', () => {
    expect(mergeFinalToolCalls(live, [{ id: 's', name: 'sessions_spawn', status: 'done' }])).toBe(live)
  })
})

describe('historyMessageId', () => {
  it("uses the message id, else the gateway's transcript id", () => {
    expect(historyMessageId({ id: 'm1' })).toBe('m1')
    expect(historyMessageId({ __openclaw: { id: 'tx-9', seq: 3 } })).toBe('tx-9')
    expect(historyMessageId({ role: 'user' })).toBeUndefined()
  })
})
