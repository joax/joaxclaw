// IndexedDB backing for the web/PWA build — the browser equivalent of
// `~/.joaxclaw/store.json`.
//
// The desktop app writes that file through an Electron IPC bridge. The browser has no
// such bridge, so before this the PWA kept the profile and saved connections in
// `localStorage` alone, with no backup at all — on the one surface where losing them is
// most likely. Mobile browsers evict `localStorage` under storage pressure, and iOS
// Safari clears it outright after seven days without a visit to a site that isn't
// installed to the Home Screen.
//
// IndexedDB is not automatically safer than localStorage; what makes it safer is that it
// is the storage `navigator.storage.persist()` protects. The two go together — see
// requestPersistentStorage below.
//
// Deliberately dependency-free and tiny: one database, one object store, one row.

const DB_NAME = 'joaxclaw'
const DB_VERSION = 1
const STORE = 'kv'
const KEY = 'localStore'

function idb(): IDBFactory | null {
  try {
    return typeof indexedDB !== 'undefined' ? indexedDB : null
  } catch {
    // Firefox throws on access in private browsing rather than returning undefined.
    return null
  }
}

export function idbAvailable(): boolean {
  return idb() !== null
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = idb()
    if (!factory) return reject(new Error('IndexedDB unavailable'))
    const req = factory.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    // A second tab holding an older version blocks the upgrade indefinitely; fail rather
    // than hang the caller, which would stall app start behind an await.
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
    t.oncomplete = () => db.close()
    t.onabort = () => { db.close(); reject(t.error ?? new Error('IndexedDB transaction aborted')) }
  }))
}

export async function idbRead(): Promise<unknown> {
  return tx('readonly', s => s.get(KEY) as IDBRequest<unknown>)
}

export async function idbWrite(data: unknown): Promise<void> {
  // Structured-clone the value through JSON first: the store holds plain settings data,
  // and a stray non-cloneable value (a function on a rehydrated object, say) would
  // otherwise abort the whole transaction and lose the write silently.
  const plain = JSON.parse(JSON.stringify(data ?? {}))
  await tx('readwrite', s => s.put(plain, KEY) as IDBRequest<IDBValidKey>)
}

/**
 * Ask the browser to make this origin's storage persistent.
 *
 * Without it, everything the app stores is "best-effort": evictable under storage
 * pressure and subject to Safari's seven-day clear. With it, storage is only removed by
 * a deliberate user action. Chrome grants it automatically to an installed PWA; Safari
 * weights it by engagement; a denial is normal and not worth surfacing.
 *
 * Returns whether storage is persistent afterwards — including when it already was, in
 * which case no prompt or heuristic runs.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
