import { describe, it, expect } from 'vitest'
import { parseModelIds } from '../localEngines'

describe('parseModelIds', () => {
  it('parses Ollama /api/tags shape', () => {
    const body = JSON.stringify({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5:7b' }] })
    expect(parseModelIds('ollama', body)).toEqual(['llama3.2:3b', 'qwen2.5:7b'])
  })

  it('parses OpenAI-compatible /models shape (data[].id)', () => {
    const body = JSON.stringify({ object: 'list', data: [{ id: 'mistral' }, { id: 'mixtral-8x7b' }] })
    expect(parseModelIds('openai', body)).toEqual(['mistral', 'mixtral-8x7b'])
  })

  it('falls back to a models[] array for OpenAI-ish servers that use it', () => {
    const body = JSON.stringify({ models: [{ id: 'phi-3' }] })
    expect(parseModelIds('openai', body)).toEqual(['phi-3'])
  })

  it('drops entries without a usable id/name', () => {
    const body = JSON.stringify({ models: [{ name: 'ok' }, {}, { name: '' }, { name: 42 }] })
    expect(parseModelIds('ollama', body)).toEqual(['ok'])
  })

  it('returns [] for an empty list', () => {
    expect(parseModelIds('ollama', JSON.stringify({ models: [] }))).toEqual([])
    expect(parseModelIds('openai', JSON.stringify({ data: [] }))).toEqual([])
  })

  it('returns [] for malformed / non-JSON bodies', () => {
    expect(parseModelIds('ollama', 'not json')).toEqual([])
    expect(parseModelIds('openai', '')).toEqual([])
    expect(parseModelIds('ollama', JSON.stringify({ unexpected: true }))).toEqual([])
  })
})
