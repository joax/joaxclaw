import { create } from 'zustand'
import { useSettingsStore } from './settings'

// Mirrors electron/main/updater.ts UpdateInfo (kept in sync by hand — small surface).
export interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string
  notes: string
  htmlUrl: string
  platform: string
  asset: { name: string; url: string; size: number } | null
  noAssetForPlatform: boolean
}

interface UpdaterApi {
  check: () => Promise<{ ok: true; info: UpdateInfo } | { ok: false; error: string }>
  download: (url: string, name: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  install: (filePath: string) => Promise<{ ok: boolean; action?: string; error?: string }>
  openReleasePage: (url?: string) => Promise<{ ok: boolean }>
  restart: () => Promise<{ ok: boolean }>
  onProgress: (cb: (p: { received: number; total: number; percent: number }) => void) => () => void
}

function api(): UpdaterApi | null {
  return (window as unknown as { api?: { updater?: UpdaterApi } }).api?.updater ?? null
}

export type UpdaterStatus =
  | 'idle' | 'checking' | 'up-to-date' | 'available'
  | 'downloading' | 'downloaded' | 'installing' | 'error'

interface UpdaterState {
  status: UpdaterStatus
  info: UpdateInfo | null
  progress: { received: number; total: number; percent: number } | null
  downloadedPath: string | null
  error: string | null
  lastChecked: number | null
  // The install handoff result action (e.g. 'opened-dmg', 'installed-deb') so the
  // UI can show platform-appropriate "what to do next" guidance.
  installAction: string | null
  dismissed: boolean  // session-only: hide the banner without skipping the version

  check: (opts?: { silent?: boolean }) => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  restart: () => Promise<void>
  openReleasePage: () => void
  skipVersion: () => void
  dismiss: () => void
  reset: () => void
}

let progressUnsub: (() => void) | null = null

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  info: null,
  progress: null,
  downloadedPath: null,
  error: null,
  lastChecked: null,
  installAction: null,
  dismissed: false,

  async check(opts) {
    const u = api()
    if (!u) return // not running under Electron
    if (get().status === 'checking' || get().status === 'downloading' || get().status === 'installing') return
    if (!opts?.silent) set({ status: 'checking', error: null })
    const res = await u.check()
    if (!res.ok) {
      set({ status: 'error', error: res.error, lastChecked: Date.now() })
      return
    }
    const info = res.info
    set({
      info,
      lastChecked: Date.now(),
      error: null,
      // A fresh, newer version clears a previous session dismissal.
      dismissed: info.available ? false : get().dismissed,
      status: info.available ? 'available' : 'up-to-date',
    })
  },

  async download() {
    const u = api()
    const info = get().info
    if (!u || !info?.asset) return
    set({ status: 'downloading', progress: { received: 0, total: info.asset.size, percent: 0 }, error: null })
    progressUnsub?.()
    progressUnsub = u.onProgress(p => set({ progress: p }))
    const res = await u.download(info.asset.url, info.asset.name)
    progressUnsub?.(); progressUnsub = null
    if (!res.ok) {
      set({ status: 'error', error: res.error })
      return
    }
    set({ status: 'downloaded', downloadedPath: res.path })
  },

  async install() {
    const u = api()
    const path = get().downloadedPath
    if (!u || !path) return
    set({ status: 'installing', error: null })
    const res = await u.install(path)
    if (!res.ok) {
      set({ status: 'error', error: res.error ?? 'Install failed' })
      return
    }
    // Win launches the installer + quits; mac/linux hand off — stay on 'downloaded'
    // with an action so the banner can guide the user through the final step.
    set({ status: 'downloaded', installAction: res.action ?? null })
  },

  async restart() {
    await api()?.restart()
  },

  openReleasePage() {
    api()?.openReleasePage(get().info?.htmlUrl)
  },

  skipVersion() {
    const v = get().info?.latestVersion
    if (v) useSettingsStore.getState().setSkippedUpdateVersion(v)
    set({ dismissed: true })
  },

  dismiss() { set({ dismissed: true }) },

  reset() {
    progressUnsub?.(); progressUnsub = null
    set({ status: 'idle', progress: null, downloadedPath: null, error: null, installAction: null })
  },
}))
