import { describe, it, expect } from 'vitest'
import { PROVIDER_LOGOS } from '../providerLogos'
import { providerFromModel, logoKeyFor, hasProviderLogo } from '../../components/ui/ProviderLogo'

describe('providerFromModel', () => {
  it('reads the provider prefix from a "<provider>/<model>" string', () => {
    expect(providerFromModel('openai/gpt-4o')).toBe('openai')
    expect(providerFromModel('anthropic/claude-3.7')).toBe('anthropic')
    expect(providerFromModel('Google/gemini-1.5')).toBe('google')
  })
  it('maps a bare Ollama "name:tag" model to ollama', () => {
    expect(providerFromModel('qwen3:8b')).toBe('ollama')
  })
  it('is undefined for a bare model with no provider and no tag', () => {
    expect(providerFromModel('gpt-4o')).toBeUndefined()
    expect(providerFromModel('')).toBeUndefined()
    expect(providerFromModel(undefined)).toBeUndefined()
  })
})

describe('logoKeyFor', () => {
  it('matches known provider ids directly', () => {
    expect(logoKeyFor('openai')).toBe('openai')
    expect(logoKeyFor('Anthropic')).toBe('anthropic')
  })
  it('resolves aliases to a logo key', () => {
    expect(logoKeyFor('x-ai')).toBe('xai')
    expect(logoKeyFor('copilot')).toBe('github-copilot')
    expect(logoKeyFor('z-ai')).toBe('zai')
  })
  it('detects a known provider as a token in a compound id', () => {
    expect(logoKeyFor('ollama-cron')).toBe('ollama')
    expect(logoKeyFor('ollama:11434')).toBe('ollama')
    expect(logoKeyFor('lmstudio-cron')).toBe('lmstudio')
  })
  it('is undefined for providers we have no logo for', () => {
    expect(logoKeyFor('chutes')).toBeUndefined()
    expect(logoKeyFor('sglang')).toBeUndefined()
    expect(logoKeyFor('sglang-cron')).toBeUndefined()
    expect(logoKeyFor(undefined)).toBeUndefined()
  })
})

describe('hasProviderLogo', () => {
  it('is true for covered providers, false otherwise', () => {
    expect(hasProviderLogo('mistral')).toBe(true)
    expect(hasProviderLogo('deepseek')).toBe(true)
    expect(hasProviderLogo('chutes')).toBe(false)
  })
})

describe('PROVIDER_LOGOS data', () => {
  it('has an entry for every common provider and each is renderable SVG markup', () => {
    const must = ['openai', 'anthropic', 'google', 'mistral', 'deepseek', 'groq', 'xai', 'ollama', 'openrouter', 'cohere', 'perplexity']
    for (const id of must) {
      expect(PROVIDER_LOGOS[id], id).toBeTruthy()
      expect(PROVIDER_LOGOS[id]).toContain('<path')
    }
    expect(Object.keys(PROVIDER_LOGOS).length).toBeGreaterThanOrEqual(40)
  })
})
