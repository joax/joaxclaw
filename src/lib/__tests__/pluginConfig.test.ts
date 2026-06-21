import { describe, it, expect } from 'vitest'
import { pluginConfigSpec, apiKeyPath, readPath, nestedPatch, mergeDeep, pluginKeyStatus } from '../pluginConfig'

describe('pluginConfigSpec / apiKeyPath', () => {
  it('routes model providers to models.providers.<id>.apiKey', () => {
    const spec = pluginConfigSpec('openai')
    expect(spec?.apiKey).toBe('provider')
    expect(spec?.providerBaseUrl).toBe(true)
    expect(apiKeyPath('openai', 'provider')).toBe('models.providers.openai.apiKey')
  })
  it('routes TTS providers to messages.tts.providers.<id>.apiKey', () => {
    expect(pluginConfigSpec('elevenlabs')?.apiKey).toBe('tts')
    expect(apiKeyPath('elevenlabs', 'tts')).toBe('messages.tts.providers.elevenlabs.apiKey')
  })
  it('routes web-search plugins to the shared tools.web.search.apiKey', () => {
    expect(pluginConfigSpec('exa')?.apiKey).toBe('webSearch')
    expect(apiKeyPath('exa', 'webSearch')).toBe('tools.web.search.apiKey')
  })
  it('returns null for plugins with no curated key', () => {
    expect(pluginConfigSpec('joaxclaw-fs')).toBeNull()
    expect(pluginConfigSpec('browser')).toBeNull()
  })
})

describe('nestedPatch / readPath / mergeDeep', () => {
  it('builds nested patches from dotted paths', () => {
    expect(nestedPatch('models.providers.openai.apiKey', 'sk'))
      .toEqual({ models: { providers: { openai: { apiKey: 'sk' } } } })
  })
  it('reads dotted paths', () => {
    const cfg = { models: { providers: { openai: { apiKey: 'sk' } } } }
    expect(readPath(cfg, 'models.providers.openai.apiKey')).toBe('sk')
    expect(readPath(cfg, 'models.providers.missing.apiKey')).toBeUndefined()
    expect(readPath(undefined, 'a.b')).toBeUndefined()
  })
  it('merges two patches deeply without clobbering siblings', () => {
    const a = nestedPatch('tools.web.search.apiKey', 'k')
    mergeDeep(a, nestedPatch('tools.web.search.provider', 'exa'))
    expect(a).toEqual({ tools: { web: { search: { apiKey: 'k', provider: 'exa' } } } })
  })
})

describe('pluginKeyStatus', () => {
  it('is "set" for a literal or SecretRef key', () => {
    expect(pluginKeyStatus({ models: { providers: { openai: { apiKey: 'sk-x' } } } }, 'openai')).toBe('set')
    expect(pluginKeyStatus({ models: { providers: { openai: { apiKey: { source: 'env', id: 'OPENAI_KEY' } } } } }, 'openai')).toBe('set')
    expect(pluginKeyStatus({ messages: { tts: { providers: { elevenlabs: { apiKey: 'k' } } } } }, 'elevenlabs')).toBe('set')
  })
  it('is "missing" when a key-needing plugin has no key', () => {
    expect(pluginKeyStatus({}, 'openai')).toBe('missing')
    expect(pluginKeyStatus({ models: { providers: { openai: { apiKey: '  ' } } } }, 'openai')).toBe('missing')
  })
  it('is "n/a" for plugins that take no curated key', () => {
    expect(pluginKeyStatus({}, 'joaxclaw-fs')).toBe('n/a')
    expect(pluginKeyStatus({}, 'browser')).toBe('n/a')
  })
})
