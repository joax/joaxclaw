import { describe, it, expect, beforeEach, vi } from 'vitest'

// A minimal in-memory stand-in for window.api.file, so the store's JSONL replay
// and append can be exercised without Electron.
function installFileApi(initial = ''): { file: { read: any; write: any }; contents: () => string } {
  let buf = initial
  const file = {
    read: vi.fn(async (_p: string) => ({ ok: true, text: buf })),
    write: vi.fn(async (_p: string, t: string) => { buf = t; return { ok: true } }),
  }
  ;(globalThis as any).window = { api: { file, system: { homedir: () => '/home/test' } } }
  return { file, contents: () => buf }
}

async function freshStore() {
  vi.resetModules()
  const mod = await import('../../store/reactions')
  return mod.useReactionsStore
}

const line = (o: Record<string, unknown>) => JSON.stringify(o)

describe('reactions store', () => {
  beforeEach(() => { delete (globalThis as any).window })

  it('replays add/remove toggles into the current emoji set', async () => {
    installFileApi([
      line({ ts: '1', action: 'add', sessionId: 's', messageId: 'm1', emoji: '👍' }),
      line({ ts: '2', action: 'add', sessionId: 's', messageId: 'm1', emoji: '🎉' }),
      line({ ts: '3', action: 'add', sessionId: 's', messageId: 'm1', emoji: '👍' }), // dup — ignored
      line({ ts: '4', action: 'remove', sessionId: 's', messageId: 'm1', emoji: '👍' }),
      line({ ts: '5', action: 'add', sessionId: 's', messageId: 'm2', emoji: '❤️' }),
      'not json',                                                                     // skipped
    ].join('\n'))

    const store = await freshStore()
    await store.getState().load()

    expect(store.getState().getReactions('m1')).toEqual(['🎉'])
    expect(store.getState().getReactions('m2')).toEqual(['❤️'])
    expect(store.getState().getReactions('missing')).toEqual([])
  })

  it('toggle adds then removes, updating state and the log', async () => {
    const { contents } = installFileApi('')
    const store = await freshStore()

    await store.getState().toggle({ sessionId: 's', messageId: 'm1', emoji: '🔥' })
    expect(store.getState().getReactions('m1')).toEqual(['🔥'])

    await store.getState().toggle({ sessionId: 's', messageId: 'm1', emoji: '🔥' })
    expect(store.getState().getReactions('m1')).toEqual([])

    const logged = contents().trim().split('\n').map(l => JSON.parse(l))
    expect(logged.map(e => e.action)).toEqual(['add', 'remove'])
    expect(logged.every(e => e.emoji === '🔥')).toBe(true)
  })

  it('load is idempotent (guards against double replay)', async () => {
    installFileApi(line({ ts: '1', action: 'add', sessionId: 's', messageId: 'm1', emoji: '👍' }))
    const store = await freshStore()
    await store.getState().load()
    await store.getState().load()
    expect(store.getState().getReactions('m1')).toEqual(['👍'])
  })
})
