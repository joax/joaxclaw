import { describe, it, expect } from 'vitest'
import {
  pluginConfigSpec, apiKeyPath, readPath, nestedPatch, mergeDeep, pluginKeyStatus,
  curatedFields, fieldsFor, jsonSchemaToFields, type JsonSchema,
} from '../pluginConfig'

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

describe('curatedFields', () => {
  it('builds api-key + base-url fields for a model provider', () => {
    const f = curatedFields('openai')
    expect(f.map(x => x.path)).toEqual(['models.providers.openai.apiKey', 'models.providers.openai.baseUrl'])
    expect(f[0].kind).toBe('secret')
    expect(f[1].kind).toBe('url')
  })
  it('carries the shared web-search provider as writeAlso on the key field', () => {
    const [key] = curatedFields('exa')
    expect(key.path).toBe('tools.web.search.apiKey')
    expect(key.writeAlso).toEqual({ path: 'tools.web.search.provider', value: 'exa' })
  })
  it('offers the LLM group for an uncurated plugin only when it already has an llm block', () => {
    expect(curatedFields('mystery-plugin')).toEqual([])
    const withLlm = curatedFields('mystery-plugin', { plugins: { entries: { 'mystery-plugin': { llm: { allowModelOverride: true } } } } })
    expect(withLlm.map(x => x.path)).toContain('plugins.entries.mystery-plugin.llm.allowModelOverride')
    expect(withLlm.every(x => x.group === 'llm')).toBe(true)
  })
})

describe('jsonSchemaToFields', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      config: {
        type: 'object',
        required: ['personality'],
        properties: {
          personality: { type: 'string', description: 'Tone of voice' },
          mode: { type: 'string', enum: ['fast', 'careful'] },
          maxItems: { type: 'integer', default: 10 },
          apiToken: { type: 'string' },
          endpoint: { type: 'string', format: 'uri' },
          nested: { type: 'object', properties: { deep: { type: 'string' } } },
        },
      },
      llm: { type: 'object', properties: { allowModelOverride: { type: 'boolean' } } },
      topLevel: { type: 'boolean' },
    },
  }

  it('flattens config/llm subtrees to absolute plugins.entries paths with inferred kinds', () => {
    const byPath = Object.fromEntries(jsonSchemaToFields('acme', schema).map(x => [x.path, x]))
    expect(byPath['plugins.entries.acme.config.personality']).toMatchObject({ kind: 'text', group: 'config', required: true, help: 'Tone of voice', label: 'Personality' })
    expect(byPath['plugins.entries.acme.config.mode']).toMatchObject({ kind: 'enum', options: ['fast', 'careful'] })
    expect(byPath['plugins.entries.acme.config.maxItems']).toMatchObject({ kind: 'number', default: 10 })
    expect(byPath['plugins.entries.acme.config.apiToken'].kind).toBe('secret')
    expect(byPath['plugins.entries.acme.config.endpoint'].kind).toBe('url')
    expect(byPath['plugins.entries.acme.llm.allowModelOverride']).toMatchObject({ kind: 'boolean', group: 'llm' })
    expect(byPath['plugins.entries.acme.topLevel']).toMatchObject({ kind: 'boolean', group: 'config' })
  })
  it('skips nested objects and arrays (left to the raw editor)', () => {
    expect(jsonSchemaToFields('acme', schema).some(x => x.path.includes('nested'))).toBe(false)
  })
})

describe('fieldsFor', () => {
  it('prefers the gateway schema over the curated catalog', () => {
    const schema: JsonSchema = { type: 'object', properties: { config: { type: 'object', properties: { foo: { type: 'string' } } } } }
    expect(fieldsFor({ id: 'openai', configSchema: schema }).map(x => x.path)).toEqual(['plugins.entries.openai.config.foo'])
  })
  it('falls back to curated fields when there is no schema', () => {
    expect(fieldsFor({ id: 'openai' })[0].path).toBe('models.providers.openai.apiKey')
  })
})
