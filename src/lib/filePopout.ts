// Opening a file in its own window.
//
// Reuses the chat pop-out mechanism: a secondary window loads the SAME renderer with a
// `?popout=…` query, and main.tsx mounts a different root from it (see main.tsx). The
// path is the whole state, so the window survives a reload and can be re-opened later
// from nothing but its URL.
//
// In the browser/PWA there are no Electron windows — the same URL opens as a tab.

import { isElectron } from './platform'

interface WindowApi {
  popOutFile?: (path: string, name?: string) => Promise<{ ok: boolean }>
}

const windowApi = (): WindowApi | undefined =>
  (window as unknown as { api?: { window?: WindowApi } }).api?.window

export function filePopoutQuery(path: string, name?: string): string {
  const params = new URLSearchParams({ popout: 'file', path })
  if (name) params.set('name', name)
  return `?${params.toString()}`
}

export function popOutFile(path: string, name?: string): void {
  // Gate on the shell, not on the method's presence: the browser shim stubs unavailable
  // window methods as no-ops, so a presence check would silently do nothing in the PWA.
  const native = isElectron() ? windowApi()?.popOutFile : undefined
  if (native) { void native(path, name); return }
  window.open(filePopoutQuery(path, name), '_blank', 'noopener')
}
