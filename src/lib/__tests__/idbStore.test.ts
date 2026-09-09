import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestPersistentStorage, idbAvailable } from '../idbStore'

// Persistent storage is what stops the browser evicting the profile and saved
// connections — without it everything this origin stores is best-effort, and Safari
// clears it after seven days away from a site that isn't installed to the Home Screen.
// A denial is a normal outcome, so the one thing that must never happen is a throw.

const withNavigator = (storage: unknown) => {
  vi.stubGlobal('navigator', storage === undefined ? {} : { storage })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('requestPersistentStorage', () => {
  it('does not re-request when storage is already persistent', async () => {
    const persist = vi.fn(async () => true)
    withNavigator({ persisted: async () => true, persist })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('requests persistence when it has not been granted', async () => {
    const persist = vi.fn(async () => true)
    withNavigator({ persisted: async () => false, persist })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('reports a denial without throwing', async () => {
    withNavigator({ persisted: async () => false, persist: async () => false })
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('is false where the Storage API is absent', async () => {
    withNavigator(undefined)
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('swallows a throwing implementation', async () => {
    // Some browsers throw on these in private mode rather than resolving false.
    withNavigator({ persisted: () => { throw new Error('nope') }, persist: async () => true })
    expect(await requestPersistentStorage()).toBe(false)
  })
})

describe('idbAvailable', () => {
  it('is false when indexedDB is missing, rather than throwing', () => {
    // Node has no indexedDB; Firefox private browsing throws on access.
    expect(idbAvailable()).toBe(false)
  })
})
