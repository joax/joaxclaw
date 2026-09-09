import { describe, it, expect, vi } from 'vitest'
import { selectBackend } from '../localStore'

// Which backend the store picks decides whether a write lands anywhere at all. Before
// the IndexedDB backend existed the browser build silently had none: every write to the
// profile and to saved connections was a no-op, on the surface (a phone) where losing
// them is most likely.

const bridge = () => ({
  read: vi.fn(async () => ({ ok: true, data: { welcomeSeen: true } })),
  write: vi.fn(async () => ({ ok: true })),
})

describe('selectBackend', () => {
  it('uses the Electron bridge when it exists', async () => {
    const b = bridge()
    const store = selectBackend(b, true)
    expect(await store?.read()).toEqual({ welcomeSeen: true })
    expect(b.read).toHaveBeenCalled()
  })

  it('prefers the bridge over IndexedDB even when both are available', async () => {
    // Under Electron the file is shared between the packaged app (file://) and a dev
    // build (http://localhost:5173). Those are separate origins and therefore separate
    // IndexedDB databases, so falling back here would quietly reintroduce the
    // cross-origin split the file was added to close.
    const b = bridge()
    await selectBackend(b, true)?.write({ welcomeSeen: true })
    expect(b.write).toHaveBeenCalledOnce()
  })

  it('falls back to IndexedDB in the browser build', () => {
    expect(selectBackend(null, true)).not.toBeNull()
  })

  it('is null when neither exists, so callers no-op instead of throwing', () => {
    // Firefox private browsing throws on indexedDB access; a caller must still work.
    expect(selectBackend(null, false)).toBeNull()
  })

  it('unwraps the bridge envelope rather than storing it', async () => {
    // The IPC bridge answers { ok, data }; IndexedDB answers the value itself. Leaking
    // the envelope through would make every field read as undefined.
    const store = selectBackend(bridge(), false)
    expect(await store?.read()).not.toHaveProperty('ok')
  })
})
