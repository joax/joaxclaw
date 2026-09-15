import { describe, it, expect } from 'vitest'
import {
  parseModelChoices, splitModelRef, findGatewayModel, isCloudModelRef, isLocalModel,
  supportedThinkingLevels, effectiveModelRef, type GatewayModel,
} from '../gatewayModels'

// The app needs two facts about a model that config can't give it: whether it runs
// locally (local models get Tool Search by default and then write tool calls as text),
// and which thinking levels it accepts (an unaccepted level fails the whole turn).

const MODELS: GatewayModel[] = [
  { id: 'qwen3.6:35b', provider: 'ollama', local: true, thinkingLevels: ['off', 'low', 'medium', 'high', 'max'].map(id => ({ id, label: id })) },
  { id: 'gpt-oss:120b-cloud', provider: 'ollama', local: false },
  { id: 'gemini-3-pro', provider: 'google', thinkingLevels: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] },
  { id: 'meta/llama-3', provider: 'openrouter' },
]

describe('parseModelChoices', () => {
  it('reads the models.list shape, keeping only the fields it uses', () => {
    const parsed = parseModelChoices({
      models: [
        { id: 'qwen3.6:35b', name: 'Qwen', provider: 'ollama', local: true, thinkingLevels: [{ id: 'off', label: 'Off' }], contextWindow: 262144 },
        { id: 'x', provider: 'y' },
        { name: 'no id' },
        null,
      ],
    })
    expect(parsed).toEqual([
      { id: 'qwen3.6:35b', provider: 'ollama', local: true, thinkingLevels: [{ id: 'off', label: 'Off' }] },
      { id: 'x', provider: 'y' },
    ])
  })

  it('is empty for anything else', () => {
    expect(parseModelChoices(null)).toEqual([])
    expect(parseModelChoices({ models: 'nope' })).toEqual([])
  })
})

describe('splitModelRef / findGatewayModel', () => {
  it('splits on the first slash only', () => {
    expect(splitModelRef('ollama/qwen3.6:35b')).toEqual({ provider: 'ollama', id: 'qwen3.6:35b' })
    expect(splitModelRef('qwen3.6:35b', 'ollama')).toEqual({ provider: 'ollama', id: 'qwen3.6:35b' })
    expect(splitModelRef('openrouter/meta/llama-3')).toEqual({ provider: 'openrouter', id: 'meta/llama-3' })
  })

  it('finds a model by provider/id, or by a bare id with the session provider', () => {
    expect(findGatewayModel(MODELS, 'ollama/qwen3.6:35b')?.provider).toBe('ollama')
    expect(findGatewayModel(MODELS, 'qwen3.6:35b', 'ollama')?.id).toBe('qwen3.6:35b')
    expect(findGatewayModel(MODELS, 'Google/Gemini-3-Pro')?.id).toBe('gemini-3-pro')
  })

  it('treats a slashed id under the session provider as a whole id', () => {
    expect(findGatewayModel(MODELS, 'meta/llama-3', 'openrouter')?.provider).toBe('openrouter')
  })

  it('finds nothing without a list or a ref', () => {
    expect(findGatewayModel(null, 'ollama/qwen3.6:35b')).toBeUndefined()
    expect(findGatewayModel(MODELS, undefined)).toBeUndefined()
    expect(findGatewayModel(MODELS, 'ollama/unknown')).toBeUndefined()
  })
})

describe('isCloudModelRef / isLocalModel', () => {
  it('recognises hosted Ollama tags', () => {
    expect(isCloudModelRef('gpt-oss:120b-cloud')).toBe(true)
    expect(isCloudModelRef('kimi-k2:cloud')).toBe(true)
    expect(isCloudModelRef('qwen3.6:35b')).toBe(false)
    expect(isCloudModelRef('llama3')).toBe(false)
  })

  it("believes the gateway's local flag when it gives one", () => {
    expect(isLocalModel(MODELS[0], 'ollama/qwen3.6:35b')).toBe(true)
    expect(isLocalModel(MODELS[1], 'ollama/gpt-oss:120b-cloud')).toBe(false)
  })

  it('otherwise goes by provider, excluding hosted tags', () => {
    expect(isLocalModel(undefined, 'ollama/llama3.2')).toBe(true)
    expect(isLocalModel(undefined, 'lmstudio/qwen2.5-coder')).toBe(true)
    expect(isLocalModel(undefined, 'llama3.2', 'ollama')).toBe(true)
    expect(isLocalModel(undefined, 'ollama/kimi-k2:cloud')).toBe(false)
    expect(isLocalModel(undefined, 'google/gemini-3-pro')).toBe(false)
    expect(isLocalModel(undefined, undefined)).toBe(false)
  })
})

describe('supportedThinkingLevels', () => {
  it("is the model's levels, or null when the gateway didn't say", () => {
    expect([...(supportedThinkingLevels(MODELS[0]) ?? [])]).toEqual(['off', 'low', 'medium', 'high', 'max'])
    expect(supportedThinkingLevels(MODELS[3])).toBeNull()
    expect(supportedThinkingLevels(undefined)).toBeNull()
  })
})

describe('effectiveModelRef', () => {
  it("prefers the chat's override, then the session's model, then the agent default", () => {
    expect(effectiveModelRef({ modelOverride: 'google/gemini-3-pro', sessionModel: 'qwen3.6:35b', sessionProvider: 'ollama' }))
      .toEqual({ ref: 'google/gemini-3-pro' })
    expect(effectiveModelRef({ sessionModel: 'qwen3.6:35b', sessionProvider: 'ollama', agentDefault: 'google/x' }))
      .toEqual({ ref: 'qwen3.6:35b', fallbackProvider: 'ollama' })
    expect(effectiveModelRef({ agentDefault: 'ollama/qwen3.6:35b' })).toEqual({ ref: 'ollama/qwen3.6:35b' })
    expect(effectiveModelRef({})).toEqual({})
  })
})
