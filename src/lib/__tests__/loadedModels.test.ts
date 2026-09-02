import { describe, it, expect } from 'vitest'
import { loadedModelIds, loadedModels } from '../ollama'
import type { EngineModels } from '../ollama'

// Mirrors the live gateway: two Ollama instances sharing a model store, each with its
// OWN residency. :11434 holds qwen3.6:35b, the isolated :11435 holds qwen3.6:35B-A3B.
const engines: EngineModels[] = [
  {
    key: 'ollama', label: 'Ollama', isCron: false, baseUrl: 'http://127.0.0.1:11434',
    models: [
      { name: 'qwen3.6:35b', size: 27566108834, loaded: true, vramUsed: 27566108834 },
      { name: 'qwen3.6:35B-A3B', size: 26910748834, loaded: false, vramUsed: undefined },
    ],
  },
  {
    key: 'ollama-cron', label: 'Ollama', isCron: true, baseUrl: 'http://127.0.0.1:11435',
    models: [
      { name: 'qwen3.6:35b', size: 27566108834, loaded: false, vramUsed: undefined },
      { name: 'qwen3.6:35B-A3B', size: 26910748834, loaded: true, vramUsed: 26910748834 },
    ],
  },
]

describe('loadedModelIds', () => {
  it('qualifies each residency by its provider, not a hardcoded "ollama/"', () => {
    const ids = loadedModelIds(engines)
    expect(ids.has('ollama/qwen3.6:35b')).toBe(true)
    // The regression: this is the id the cron provider's picker rows look up, and the
    // old hardcoded `ollama/` prefix could never produce it.
    expect(ids.has('ollama-cron/qwen3.6:35B-A3B')).toBe(true)
  })

  it('does not mark a model loaded on the instance that is not holding it', () => {
    const ids = loadedModelIds(engines)
    expect(ids.has('ollama/qwen3.6:35B-A3B')).toBe(false)
    expect(ids.has('ollama-cron/qwen3.6:35b')).toBe(false)
  })

  it('is empty when nothing is resident', () => {
    expect(loadedModelIds([]).size).toBe(0)
  })
})

describe('loadedModels', () => {
  it('reports both residencies, tagged with the instance holding them', () => {
    const loaded = loadedModels(engines)
    expect(loaded.map(m => [m.engineKey, m.name])).toEqual([
      ['ollama', 'qwen3.6:35b'],
      ['ollama-cron', 'qwen3.6:35B-A3B'],
    ])
    expect(loaded.find(m => m.isCron)?.name).toBe('qwen3.6:35B-A3B')
  })

  it('totals VRAM across instances — the cron copy occupies the same GPU', () => {
    const total = loadedModels(engines).reduce((n, m) => n + (m.vramUsed ?? m.size), 0)
    expect(total).toBe(27566108834 + 26910748834)
    // The old interactive-only total missed the cron model entirely.
    expect(total).toBeGreaterThan(27566108834)
  })
})
