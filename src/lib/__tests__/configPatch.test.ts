import { describe, it, expect } from 'vitest'
import { buildMergePatch, patchChangedNothing, collectArrayPaths } from '../configPatch'

// The gateway applies an RFC-7396 merge patch: absent keys are kept, null removes. The
// config editor used to send the edited document as the patch, so every DELETION was
// silently dropped and the gateway answered `{ok:true, noop:true}` — which the app
// reported as "Saved". These are the cases that failed against a real 2026.9.4 gateway.

describe('patchChangedNothing', () => {
  it('spots the gateway saying it changed nothing', () => {
    expect(patchChangedNothing({ ok: true, noop: true, changedPaths: [] })).toBe(true)
    expect(patchChangedNothing({ ok: true, changedPaths: [] })).toBe(true)
  })
  it('accepts a real write', () => {
    expect(patchChangedNothing({ ok: true, changedPaths: ['models.providers.acme.baseUrl'], hash: 'h' })).toBe(false)
  })
  it('says nothing about a reply that omits the fields (older gateways)', () => {
    expect(patchChangedNothing({ ok: true })).toBe(false)
    expect(patchChangedNothing(undefined)).toBe(false)
  })
})

describe('buildMergePatch', () => {
  it('is null when nothing changed', () => {
    const cfg = { models: { providers: { acme: { baseUrl: 'u', models: [{ id: 'a' }] } } } }
    expect(buildMergePatch(cfg, structuredClone(cfg)).patch).toBeNull()
  })

  it('sends only what changed', () => {
    const before = { gateway: { port: 1 }, models: { providers: { acme: { baseUrl: 'old' } } } }
    const after = { gateway: { port: 1 }, models: { providers: { acme: { baseUrl: 'new' } } } }
    expect(buildMergePatch(before, after).patch).toEqual({ models: { providers: { acme: { baseUrl: 'new' } } } })
  })

  it('nulls a key removed at any depth (was silently ignored)', () => {
    const before = { models: { providers: { acme: { baseUrl: 'u', api: 'openai-completions' } } } }
    const after = { models: { providers: { acme: { baseUrl: 'u' } } } }
    expect(buildMergePatch(before, after).patch).toEqual({ models: { providers: { acme: { api: null } } } })
  })

  it('nulls a whole provider the user deleted', () => {
    const before = { models: { providers: { acme: { baseUrl: 'u' }, other: { baseUrl: 'v' } } } }
    const after = { models: { providers: { other: { baseUrl: 'v' } } } }
    expect(buildMergePatch(before, after).patch).toEqual({ models: { providers: { acme: null } } })
  })

  it('sends a shrunk array whole and names its path, so the gateway allows the removal', () => {
    const before = { models: { providers: { acme: { models: [{ id: 'a' }, { id: 'b' }] } } } }
    const after = { models: { providers: { acme: { models: [{ id: 'a' }] } } } }
    const { patch, replacePaths } = buildMergePatch(before, after)
    expect(patch).toEqual({ models: { providers: { acme: { models: [{ id: 'a' }] } } } })
    expect(replacePaths).toContain('models.providers.acme.models')
  })

  it('names arrays nested inside array elements too (a parent path is not enough)', () => {
    const before = { models: { providers: { acme: { models: [{ id: 'a', input: ['text', 'image'] }] } } } }
    const after = { models: { providers: { acme: { models: [{ id: 'a', input: ['text'] }] } } } }
    const { replacePaths } = buildMergePatch(before, after)
    expect(replacePaths).toEqual(expect.arrayContaining([
      'models.providers.acme.models',
      'models.providers.acme.models[].input',
    ]))
  })

  it('keeps an addition and a removal in the same edit (the mixed case that half-applied)', () => {
    const before = { models: { providers: { acme: { api: 'x', models: [{ id: 'a' }, { id: 'b' }] } } } }
    const after = { models: { providers: { acme: { models: [{ id: 'a' }, { id: 'c' }] } } } }
    const { patch, replacePaths } = buildMergePatch(before, after)
    expect(patch).toEqual({ models: { providers: { acme: { api: null, models: [{ id: 'a' }, { id: 'c' }] } } } })
    expect(replacePaths).toContain('models.providers.acme.models')
  })

  it('removes a whole top-level section', () => {
    expect(buildMergePatch({ gateway: { port: 1 }, meta: { x: 1 } }, { gateway: { port: 1 } }).patch)
      .toEqual({ meta: null })
  })

  it('treats a scalar replacing an object as a replacement', () => {
    expect(buildMergePatch({ a: { b: 1 } }, { a: 2 }).patch).toEqual({ a: 2 })
  })
})

describe('collectArrayPaths', () => {
  it('uses the gateway dotted notation, with [] inside array elements', () => {
    const out: string[] = []
    collectArrayPaths({ models: { providers: { g: { models: [{ id: 'm', input: ['text'] }] } } } }, '', out)
    expect(out).toEqual(expect.arrayContaining([
      'models.providers.g.models',
      'models.providers.g.models[].input',
    ]))
  })
})
