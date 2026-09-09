// App-local persistence for data that can't go to the gateway.
//
// Two backends, same shape and same callers:
//   Electron -> ~/.joaxclaw/store.json via the preload IPC bridge
//   browser  -> IndexedDB (see lib/idbStore.ts)
//
// The browser backend exists because there was previously NO backup in the web/PWA
// build: `ipcBridge()` returns null there, so every write silently did nothing and the
// profile and saved connections lived in localStorage alone — the storage mobile
// browsers evict first. Everything above this module is unchanged by the split.
//
// All data is namespaced under top-level keys to avoid collisions between features.

import type { GatewayConnection, UserProfile } from './types'
import { idbAvailable, idbRead, idbWrite } from './idbStore'

export interface LocalStore {
  modelPricing?: Record<string, Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>>
  // Durable backup of saved gateway connections — a file copy of the zustand
  // localStorage state, so a localStorage reset can't lose them. See store/connection.ts.
  savedConnections?: GatewayConnection[]
  // Durable backup of "About You" and whether the first-run welcome has been answered,
  // for the same reason — and because the packaged app (file://) and `npm run dev`
  // (http://localhost:5173) are separate localStorage origins, so a profile entered in
  // one is invisible to the other. This file is shared by both. See store/settings.ts.
  userProfile?: UserProfile
  shareProfile?: boolean
  useNameAsIdentity?: boolean
  welcomeSeen?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ipcBridge = (): { read: () => Promise<{ ok: boolean; data: unknown; error?: string }>; write: (data: unknown) => Promise<{ ok: boolean; error?: string }> } | null => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any)?.api?.localstore ?? null
}

/** A place to keep the store. Injectable so the selection logic can be tested. */
export interface StoreBackend {
  read: () => Promise<unknown>
  write: (data: unknown) => Promise<void>
}

/**
 * Which backend to use.
 *
 * The Electron bridge wins whenever it exists: the file is shared between the packaged
 * app (file://) and a dev build (http://localhost:5173), which are separate origins and
 * therefore separate IndexedDB databases. Falling back to IndexedDB under Electron would
 * quietly reintroduce the cross-origin split the file was added to close.
 */
export function selectBackend(
  bridge: ReturnType<typeof ipcBridge>,
  hasIdb: boolean,
): StoreBackend | null {
  if (bridge) {
    return {
      read: async () => (await bridge.read()).data,
      write: async (data) => { await bridge.write(data) },
    }
  }
  if (hasIdb) return { read: idbRead, write: idbWrite }
  return null
}

function backend(): StoreBackend | null {
  return selectBackend(ipcBridge(), idbAvailable())
}

let _cache: LocalStore | null = null

export async function readLocalStore(): Promise<LocalStore> {
  if (_cache) return _cache
  const store = backend()
  if (!store) return {}
  try {
    _cache = ((await store.read()) ?? {}) as LocalStore
    return _cache
  } catch {
    return {}
  }
}

export async function writeLocalStore(data: LocalStore): Promise<void> {
  // Cache first: a failed or absent backend must not lose the value for this session.
  _cache = data
  const store = backend()
  if (!store) return
  try { await store.write(data) } catch { /* best-effort */ }
}

export async function patchLocalStore(patch: Partial<LocalStore>): Promise<LocalStore> {
  const current = await readLocalStore()
  const next = { ...current, ...patch }
  await writeLocalStore(next)
  return next
}
