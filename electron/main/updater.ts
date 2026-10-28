// ── Auto-updater (custom, fed by joaxclaw.ai) ─────────────────────────────────
// The app ships unsigned (no Apple cert, Linux .deb), which rules out a fully
// silent Squirrel/electron-updater flow. Instead we drive updates ourselves:
//   1. check  → read the site's release feed, compare semver to this build
//   2. download → stream the OS-appropriate asset (.dmg/.deb) with progress
//   3. install  → hand off to the OS installer (per-platform), then restart
// Everything here runs in the main process so it isn't CORS-bound and can write
// to disk / launch installers. The renderer only sees the IPC surface below.
//
// The feed used to be api.github.com's "latest release". That stopped working when
// the repo went private: the API answers 404 to an app with no credentials, and the
// 404 branch here reads as "no release yet — you are up to date", so every installed
// copy would have gone quiet instead of reporting an error. The site now serves the
// same facts publicly (api/_lib/releases.mjs), and its /download/<platform> redirects
// to a signed GitHub url, so the asset still comes from GitHub's CDN.

import { app, ipcMain, shell, BrowserWindow } from 'electron'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { Readable } from 'stream'

// The pure half — version comparison, platform mapping, feed parsing — lives in
// src/lib/appReleaseFeed.ts so it can be tested without standing up Electron.
import {
  DEFAULT_SITE, feedUrl, releasesPage, infoFromFeed, compareVersions,
  type ReleaseFeed, type UpdateAsset, type UpdateInfo,
} from '../../src/lib/appReleaseFeed'

export { compareVersions }
export type { UpdateAsset, UpdateInfo }

// Overridable so a fork, or a staging deploy, can be pointed at its own site.
const SITE = process.env.JOAXCLAW_SITE_URL || DEFAULT_SITE
const RELEASE_FEED = feedUrl(SITE)
const RELEASES_PAGE = releasesPage(SITE)

async function checkForUpdate(): Promise<{ ok: true; info: UpdateInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(RELEASE_FEED, {
      headers: { Accept: 'application/json', 'User-Agent': `JoaxClaw/${app.getVersion()}` },
    })
    // Unlike the old GitHub call, a non-OK answer is always an error. Nothing here is
    // allowed to read as "up to date" — a silent failure leaves the app stranded on an
    // old version with no sign anything is wrong.
    if (!res.ok) return { ok: false, error: `The update feed responded ${res.status}` }

    const feed = await res.json() as ReleaseFeed
    return { ok: true, info: infoFromFeed(feed, app.getVersion(), process.platform, SITE) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function downloadUpdate(
  win: BrowserWindow | null, url: string, name: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const dir = join(tmpdir(), 'joaxclaw-updates')
    await mkdir(dir, { recursive: true })
    // Sanitize the asset name so a crafted release can't escape the temp dir.
    const safeName = name.replace(/[/\\]/g, '_').replace(/\.\.+/g, '_') || 'joaxclaw-update'
    const dest = join(dir, safeName)

    // `url` is the site's /download/<platform>, which answers 302 to a short-lived
    // signed GitHub url. fetch follows redirects by default, so the bytes still come
    // from GitHub's CDN and never through the site.
    const res = await fetch(url, { headers: { 'User-Agent': `JoaxClaw/${app.getVersion()}` }, redirect: 'follow' })
    if (!res.ok || !res.body) return { ok: false, error: `Download failed (HTTP ${res.status})` }

    const total = Number(res.headers.get('content-length')) || 0
    let received = 0
    let lastSent = 0

    const fileStream = createWriteStream(dest)
    const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      // Throttle progress events (~every 64KB) so we don't flood IPC on fast links.
      if (received - lastSent >= 65536 || (total && received >= total)) {
        lastSent = received
        win?.webContents.send('update:progress', { received, total, percent: total ? received / total : 0 })
      }
    })

    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(fileStream)
      fileStream.on('finish', () => resolve())
      fileStream.on('error', reject)
      nodeStream.on('error', reject)
    })
    win?.webContents.send('update:progress', { received: received || total, total, percent: 1 })
    return { ok: true, path: dest }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Linux: install the .deb via a graphical privilege prompt (pkexec → apt, which
// resolves dependencies). Resolves false if pkexec is missing or the user
// cancels / no polkit agent is running, so the caller can fall back to revealing
// the file for a manual install.
function tryPkexecDebInstall(debPath: string): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
    try {
      const child = spawn('pkexec', ['apt-get', 'install', '-y', debPath], { stdio: 'ignore' })
      child.on('error', () => done(false))      // pkexec not found
      child.on('exit', code => done(code === 0)) // non-zero = cancelled / failed
    } catch {
      done(false)
    }
  })
}

export interface InstallResult { ok: boolean; action?: string; error?: string }

async function installUpdate(filePath: string, quitApp: () => void): Promise<InstallResult> {
  try {
    if (process.platform === 'win32') {
      // Launch the NSIS installer detached so it survives our quit, then exit so
      // it can replace the running binary in place.
      const child = spawn(filePath, [], { detached: true, stdio: 'ignore' })
      child.unref()
      setTimeout(() => quitApp(), 800)
      return { ok: true, action: 'launched-installer' }
    }
    if (process.platform === 'darwin') {
      // Mount the .dmg and reveal it — the user drags JoaxClaw into /Applications.
      // (Unsigned builds can't auto-replace themselves via Squirrel.)
      const err = await shell.openPath(filePath)
      if (err) return { ok: false, error: err }
      return { ok: true, action: 'opened-dmg' }
    }
    // Linux .deb: try a one-click privileged install; otherwise reveal for manual.
    const installed = await tryPkexecDebInstall(filePath)
    if (installed) return { ok: true, action: 'installed-deb' }
    shell.showItemInFolder(filePath)
    return { ok: true, action: 'revealed' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Registers the updater IPC surface. `getWindow` resolves the live main window
// (created lazily after app-ready); `quitApp` performs a real quit (sets the
// quitting flag so the tray "close to tray" guard doesn't intercept it).
export function registerUpdater(getWindow: () => BrowserWindow | null, quitApp: () => void): void {
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:download', (_e, url: string, name: string) => downloadUpdate(getWindow(), url, name))
  ipcMain.handle('update:install', (_e, filePath: string) => installUpdate(filePath, quitApp))
  ipcMain.handle('update:openReleasePage', (_e, url?: string) => {
    shell.openExternal(url || RELEASES_PAGE)
    return { ok: true }
  })
  ipcMain.handle('update:restart', () => {
    app.relaunch()
    quitApp()
    return { ok: true }
  })
}
