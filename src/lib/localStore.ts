// ~/.joaxclaw/store.json — app-local persistence for data that can't go to the gateway.
// All data is namespaced under top-level keys to avoid collisions between features.

export interface LocalStore {
  modelPricing?: Record<string, Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ipc = () => (window as any).api.localstore as {
  read: () => Promise<{ ok: boolean; data: unknown; error?: string }>
  write: (data: unknown) => Promise<{ ok: boolean; error?: string }>
}

let _cache: LocalStore | null = null

export async function readLocalStore(): Promise<LocalStore> {
  if (_cache) return _cache
  const result = await ipc().read()
  _cache = (result.data ?? {}) as LocalStore
  return _cache
}

export async function writeLocalStore(data: LocalStore): Promise<void> {
  _cache = data
  await ipc().write(data)
}

export async function patchLocalStore(patch: Partial<LocalStore>): Promise<LocalStore> {
  const current = await readLocalStore()
  const next = { ...current, ...patch }
  await writeLocalStore(next)
  return next
}
