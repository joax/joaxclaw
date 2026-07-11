import { describe, it, expect } from 'vitest'
import { collectArrayPaths } from '../../store/models'

// The gateway's config.patch rejects array shrink unless every array path (including
// arrays nested inside array elements) is named in replacePaths, using `[]` for
// element traversal. These cover the notation the save path depends on.
function paths(obj: unknown): string[] {
  const out: string[] = []
  collectArrayPaths(obj, '', out)
  return [...new Set(out)]
}

describe('collectArrayPaths', () => {
  it('names a top-level array', () => {
    expect(paths({ bindings: [1, 2] })).toEqual(['bindings'])
  })

  it('names arrays nested inside array elements with [] notation', () => {
    const patch = {
      models: { providers: { google: { models: [
        { id: 'gemini-1', input: ['text', 'image'], output: ['text'] },
        { id: 'gemini-2', input: ['text'], output: ['text'] },
      ] } } },
    }
    expect(paths(patch)).toEqual([
      'models.providers.google.models',
      'models.providers.google.models[].input',
      'models.providers.google.models[].output',
    ])
  })

  it('de-duplicates identical paths across array elements', () => {
    const patch = { models: { providers: { p: { models: [
      { id: 'a', input: ['x'] },
      { id: 'b', input: ['y'] },
      { id: 'c', input: ['z'] },
    ] } } } }
    expect(paths(patch)).toEqual([
      'models.providers.p.models',
      'models.providers.p.models[].input',
    ])
  })

  it('returns nothing when there are no arrays', () => {
    expect(paths({ models: { providers: { p: { api: 'openai', apiKey: 'k' } } } })).toEqual([])
  })

  it('handles arrays of scalars without descending into non-objects', () => {
    // string elements shouldn't produce spurious child paths
    expect(paths({ tags: ['a', 'b', 'c'] })).toEqual(['tags'])
  })
})
