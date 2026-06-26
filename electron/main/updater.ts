// ── Auto-updater (custom, GitHub Releases) ────────────────────────────────────
// The app ships unsigned (no Apple cert, Linux .deb), which rules out a fully
// silent Squirrel/electron-updater flow. Instead we drive updates ourselves:
//   1. check  → query the GitHub "latest release", compare semver to this build
//   2. download → stream the OS-appropriate asset (.dmg/.deb/.exe) with progress
//   3. install  → hand off to the OS installer (per-platform), then restart
// Everything here runs in the main process so it isn't CORS-bound and can write
// to disk / launch installers. The renderer only sees the IPC surface below.

import { app, ipcMain, shell, BrowserWindow } from 'electron'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { Readable } from 'stream'

const REPO = 'joax/joaxclaw'
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

export interface UpdateAsset { name: string; url: string; size: number }
export interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string
  notes: string
  htmlUrl: string
  platform: NodeJS.Platform
  asset: UpdateAsset | null
  // A newer version exists but no installable asset was published for this OS.
  noAssetForPlatform: boolean
}

// Parse "1.2.3" / "v1.2.3-beta.1" into comparable parts.
function parseVersion(v: string): { nums: number[]; pre: string } {
  const clean = String(v).replace(/^v/i, '').trim()
  const [core, pre = ''] = clean.split('-')
  const nums = core.split('.').map(n => parseInt(n, 10) || 0)
  return { nums, pre }
}

// Returns 1 if a > b, -1 if a < b, 0 if equal. A release outranks a prerelease
// of the same core version (1.2.0 > 1.2.0-rc.1), matching the release workflow.
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a), pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  if (pa.pre && !pb.pre) return -1
  if (!pa.pre && pb.pre) return 1
  if (pa.pre === pb.pre) return 0
  return pa.pre < pb.pre ? -1 : 1
}

// Which release asset matches the current OS (the names electron-builder emits).
function platformAssetMatcher(): (name: string) => boolean {
  if (process.platform === 'darwin') return n => n.toLowerCase().endsWith('.dmg')
  if (process.platform === 'win32') return n => n.toLowerCase().endsWith('.exe')
  return n => n.toLowerCase().endsWith('.deb') // linux
}

function ghHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': `JoaxClaw/${app.getVersion()}`,
  }
}

async function checkForUpdate(): Promise<{ ok: true; info: UpdateInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(LATEST_RELEASE_API, { headers: ghHeaders() })
    if (!res.ok) {
      // 404 = no published (non-prerelease) release yet — treat as up-to-date.
      if (res.status === 404) {
        return {
          ok: true,
          info: {
            available: false, currentVersion: app.getVersion(), latestVersion: app.getVersion(),
            notes: '', htmlUrl: RELEASES_PAGE, platform: process.platform, asset: null, noAssetForPlatform: false,
          },
        }
      }
      return { ok: false, error: `GitHub API responded ${res.status}` }
    }
    const data = await res.json() as {
      tag_name?: string; body?: string; html_url?: string
      assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
    }
    const latest = String(data.tag_name ?? '').replace(/^v/i, '')
    const current = app.getVersion()
    const available = !!latest && compareVersions(latest, current) > 0

    const match = platformAssetMatcher()
    const assets = Array.isArray(data.assets) ? data.assets : []
    const hit = assets.find(a => match(String(a.name ?? '')))
    const asset: UpdateAsset | null = hit
      ? { name: String(hit.name), url: String(hit.browser_download_url), size: Number(hit.size) || 0 }
      : null

    return {
      ok: true,
      info: {
        available,
        currentVersion: current,
        latestVersion: latest || current,
        notes: String(data.body ?? ''),
        htmlUrl: String(data.html_url ?? RELEASES_PAGE),
        platform: process.platform,
        asset,
        noAssetForPlatform: available && !asset,
      },
    }
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

    const res = await fetch(url, { headers: { 'User-Agent': `JoaxClaw/${app.getVersion()}` } })
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
