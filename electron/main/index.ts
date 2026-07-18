import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, session } from 'electron'
import { join, dirname } from 'path'
import { readFile, writeFile, mkdir, readdir, unlink, rm } from 'fs/promises'
import { existsSync, statSync, createReadStream, watch, type FSWatcher } from 'fs'
import { homedir } from 'os'
import { exec, spawn } from 'child_process'
import { createHash } from 'crypto'
import si from 'systeminformation'
import WebSocket from 'ws'
import { registerUpdater } from './updater'
import { registerThemeIpc } from './themes'
import { buildDeviceConnectBlock, loadOrCreateDeviceIdentity, type DeviceConnectInput } from './deviceIdentity'

let mainWindow: BrowserWindow | null = null
let aboutWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// Backstop: keep an unexpected async error (e.g. a stray socket 'error' during
// teardown) from triggering Electron's fatal "JavaScript error in the main
// process" dialog. Log it and forward to the renderer's connection log instead.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
  mainWindow?.webContents.send('ws:log', 'info', `Internal error: ${err?.message ?? String(err)}`)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

function getTrayIcon(): Electron.NativeImage {
  // resources/ sits two levels above out/main/ in both dev and prod. The tray uses
  // the app logo (the same colored mark as the app icon).
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icons/tray/tray.png'))
  if (icon.isEmpty()) {
    // Fallback: 1×1 transparent PNG so the tray doesn't crash
    return nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    )
  }
  return icon.resize({ width: 22, height: 22 })
}

// Live run counts surfaced in the tray. Pushed from the renderer (which sees the
// gateway stream) via the tray:update IPC.
let trayCounts = { agents: 0, teams: 0 }

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function showMainWindow(): void {
  if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  else createWindow()
}

function buildTrayMenu(): Menu {
  const { agents, teams } = trayCounts
  return Menu.buildFromTemplate([
    { label: 'JoaxClaw', enabled: false },
    { type: 'separator' },
    {
      label: agents > 0 ? `🤖  ${plural(agents, 'agent')} running` : '🤖  No agents running',
      enabled: agents > 0,
      click: () => { showMainWindow(); mainWindow?.webContents.send('app:navigate', 'chat') },
    },
    {
      label: teams > 0 ? `👥  ${plural(teams, 'team')} running` : '👥  No teams running',
      enabled: teams > 0,
      click: () => { showMainWindow(); mainWindow?.webContents.send('app:navigate', 'teams') },
    },
    { type: 'separator' },
    { label: 'Open JoaxClaw', click: () => showMainWindow() },
    { label: 'About JoaxClaw', click: () => createAboutWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ])
}

function refreshTray(): void {
  if (!tray) return
  tray.setImage(getTrayIcon())
  const { agents, teams } = trayCounts
  const parts: string[] = []
  if (agents > 0) parts.push(plural(agents, 'agent'))
  if (teams > 0) parts.push(plural(teams, 'team'))
  tray.setToolTip(parts.length ? `JoaxClaw — ${parts.join(', ')} running` : 'JoaxClaw')
  tray.setContextMenu(buildTrayMenu())
}

function createTray(): void {
  tray = new Tray(getTrayIcon())
  refreshTray()

  // Left-click / double-click shows the window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.focus()
      else mainWindow.show()
    }
  })
  tray.on('double-click', () => showMainWindow())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // Fully custom title bar (see components/layout/TitleBar): its own themed window
    // buttons + a continuous bottom border. We deliberately do NOT use titleBarOverlay —
    // Electron 43's native Window-Controls-Overlay on Linux/Wayland draws its own opaque
    // control region that duplicates our buttons and cuts the title bar's bottom border.
    frame: false,
    // Opaque so the compositor draws a native drop shadow. roundedCorners is native on
    // macOS / Windows 11 / Linux-Wayland (Electron 43+); X11 falls back to square
    // corners. Transparent windows get no native shadow, so we no longer clip in CSS.
    transparent: false,
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    },
    backgroundColor: '#0f1117',
    show: false
  })
  wireMaximizeEvents(mainWindow)

  // Closing the window hides it to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(mainWindow)
  mainWindow.webContents.on('destroyed', () => cleanupSocket(mainWindow!.webContents.id))
}

// Loads the bundled renderer, optionally with a query string (used to deep-link a
// pop-out window to a single chat: ?popout=chat&session=<key>).
function loadRenderer(win: BrowserWindow, query = ''): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), query ? { search: query.replace(/^\?/, '') } : undefined)
  }
}

function cleanupSocket(wcId: number): void {
  destroySocket(sockets.get(wcId))
  sockets.delete(wcId)
}

// Tell a window's renderer when it's maximized / full-screen so it can flatten the
// rounded corners — a maximized window should sit square against the screen edges.
function wireMaximizeEvents(win: BrowserWindow): void {
  const push = () => wcSend(win.webContents, 'window:maximized', win.isMaximized() || win.isFullScreen())
  win.on('maximize', push)
  win.on('unmaximize', push)
  win.on('enter-full-screen', push)
  win.on('leave-full-screen', push)
  win.webContents.on('did-finish-load', push)
}

// ── Pop-out chat windows ──────────────────────────────────────────────────────
// A chat can be "moved" into its own window. Each pop-out is a normal BrowserWindow
// running the same renderer deep-linked to one session; it connects to the gateway
// independently (per-window socket above). The main window hides moved chats and
// restores them when the pop-out closes — so a chat is never lost.

const chatWindows = new Map<string, BrowserWindow>()

// Tell every window which sessions are currently popped out, so the main window can
// hide them from its list (and show them again when a pop-out closes).
function broadcastPoppedOut(): void {
  const keys = [...chatWindows.keys()]
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('chat:poppedOut', keys)
  }
}

function createChatWindow(sessionKey: string): void {
  const existing = chatWindows.get(sessionKey)
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return }

  const win = new BrowserWindow({
    // Sized so the chat content (header controls + message composer) fits without
    // overflowing; minWidth keeps it from being shrunk past where the header wraps.
    width: 820,
    height: 860,
    minWidth: 560,
    minHeight: 460,
    frame: false, // custom title bar (see main window) — no native titleBarOverlay
    transparent: false,
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f1117',
    show: false,
  })
  chatWindows.set(sessionKey, win)
  wireMaximizeEvents(win)

  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  win.on('ready-to-show', () => win.show())
  win.webContents.on('destroyed', () => cleanupSocket(win.webContents.id))
  win.on('closed', () => {
    if (chatWindows.get(sessionKey) === win) chatWindows.delete(sessionKey)
    // Closing a pop-out returns its chat to the main window's list (un-hidden).
    broadcastPoppedOut()
  })

  loadRenderer(win, `?popout=chat&session=${encodeURIComponent(sessionKey)}`)
  broadcastPoppedOut()
}

// ── About window ──────────────────────────────────────────────────────────────
function createAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) { aboutWindow.show(); aboutWindow.focus(); return }

  aboutWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false, // custom title bar (see main window) — no native titleBarOverlay
    transparent: false,
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f1117',
    show: false,
  })
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  aboutWindow.on('ready-to-show', () => aboutWindow?.show())
  aboutWindow.on('closed', () => { aboutWindow = null })
  loadRenderer(aboutWindow, '?popout=about')
}

app.whenReady().then(() => {
  // Trust self-signed certificates from loopback addresses (needed for Obsidian Local REST API HTTPS)
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === 'localhost' || request.hostname === '127.0.0.1' || request.hostname === '::1') {
      callback(0)  // OK
    } else {
      callback(-3) // use default Chromium verification
    }
  })

  registerThemeIpc()
  createTray()
  createWindow()
  app.on('activate', () => {
    // macOS: clicking dock icon while window is hidden should show it
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

// Never quit when all windows are closed — we live in the tray
app.on('window-all-closed', () => { /* noop */ })

app.on('before-quit', () => {
  isQuitting = true
})

// ── IPC: App info ─────────────────────────────────────────────────────────────
ipcMain.handle('app:version', () => app.getVersion())

// Open an external URL (repo, sponsors, …) in the user's default browser.
ipcMain.handle('app:openExternal', (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url)
  return { ok: true }
})

// ── IPC: Auto-updater (GitHub Releases) ──────────────────────────────────────
registerUpdater(
  () => mainWindow,
  () => { isQuitting = true; app.quit() },
)

// ── IPC: Window controls ──────────────────────────────────────────────────────
// Operate on the window that made the call, so a pop-out window's title-bar buttons
// control the pop-out (not the main window).
ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.handle('window:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (w?.isMaximized()) w.unmaximize()
  else w?.maximize()
})
ipcMain.handle('window:close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  // The main window lives in the tray (hide); a pop-out genuinely closes.
  if (w === mainWindow) w?.hide()
  else w?.close()
})

// Recolour the native window-control overlay (min/max/close) so it tracks the app
// theme — otherwise the OS-drawn buttons keep the dark colours baked in at creation.
ipcMain.handle('window:setTitleBarOverlay', (e, color: string, symbolColor: string) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || typeof w.setTitleBarOverlay !== 'function') return
  try {
    w.setTitleBarOverlay({ color, symbolColor, height: 36 })
  } catch {
    // titleBarOverlay isn't supported on every platform/WM — ignore there.
  }
})

// ── IPC: Pop-out chat windows ─────────────────────────────────────────────────
ipcMain.handle('chat:popOut', (_e, sessionKey: string) => {
  if (sessionKey) createChatWindow(String(sessionKey))
  return { ok: true }
})
// Bring a popped-out chat back: focus the main window, tell it to open that chat,
// then close the pop-out (its 'closed' handler un-hides the chat in the list).
ipcMain.handle('chat:returnToMain', (_e, sessionKey: string) => {
  const key = String(sessionKey)
  mainWindow?.show()
  mainWindow?.focus()
  sendToRenderer('chat:focusSession', key)
  const w = chatWindows.get(key)
  if (w && !w.isDestroyed()) w.close()
  return { ok: true }
})
// A pop-out window asks for its bootstrap info (the active gateway connection).
ipcMain.handle('chat:popoutInfo', () => ({ connection: lastConnection }))
// The main window asks which chats are currently popped out (on (re)load).
ipcMain.handle('chat:listPoppedOut', () => [...chatWindows.keys()])

// ── IPC: Tray run counts ──────────────────────────────────────────────────────
// The renderer pushes live counts (it sees the gateway stream); the tray reflects
// them in its menu + tooltip.
ipcMain.handle('tray:update', (_e, counts: { agents?: number; teams?: number }) => {
  trayCounts = { agents: Math.max(0, counts?.agents ?? 0), teams: Math.max(0, counts?.teams ?? 0) }
  refreshTray()
  return { ok: true }
})

// ── IPC: Config file ─────────────────────────────────────────────────────────
const configPath = join(homedir(), '.openclaw', 'openclaw.json')

ipcMain.handle('config:read', async () => {
  try {
    if (!existsSync(configPath)) return { ok: false, error: 'File not found', path: configPath }
    const text = await readFile(configPath, 'utf8')
    return { ok: true, text, path: configPath }
  } catch (e: unknown) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('config:write', async (_event, text: string) => {
  try {
    await writeFile(configPath, text, 'utf8')
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String(e) }
  }
})

// Expand a leading ~ to the user's home dir so config paths like
// "~/.openclaw/workspace/memory" (e.g. a Markdown-memory folder) resolve.
function expandHome(p: string): string {
  return p.replace(/^~(?=\/|$)/, homedir())
}

// ── IPC: Local file read/write ───────────────────────────────────────────────
ipcMain.handle('file:read', async (_event, filePath: string) => {
  try {
    const text = await readFile(expandHome(filePath), 'utf8')
    return { ok: true, text }
  } catch (e: unknown) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Read binary file as base64 data URL (bypasses file:// cross-origin in dev) ──
ipcMain.handle('file:readBinary', async (_event, filePath: string) => {
  try {
    const data = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const mimeTypes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
      avif: 'image/avif',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
      wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
      webm: 'audio/webm'
    }
    const mimeType = mimeTypes[ext] ?? 'image/png'
    return { ok: true, dataUrl: `data:${mimeType};base64,${data.toString('base64')}` }
  } catch (e: unknown) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Resolve a bare filename to an absolute path ─────────────────────────
// Searches ~/.openclaw first (likely output dir), then home with limited depth
ipcMain.handle('file:find', async (_event, filename: string) => {
  const home = homedir()
  const sanitized = filename.replace(/['"\\]/g, '')
  const result = await runCmd(
    `find "${home}/.openclaw" -maxdepth 6 -name "${sanitized}" -type f 2>/dev/null | head -1`
  )
  if (result.ok && result.stdout) return { ok: true, path: result.stdout }
  const result2 = await runCmd(
    `find "${home}" -maxdepth 5 -name "${sanitized}" -type f 2>/dev/null | head -1`
  )
  if (result2.ok && result2.stdout) return { ok: true, path: result2.stdout }
  return { ok: false }
})

// ── IPC: List files in a directory ───────────────────────────────────────────
ipcMain.handle('file:listdir', async (_event, dirPath: string, ext?: string) => {
  try {
    const dir = expandHome(dirPath)
    await mkdir(dir, { recursive: true })
    const entries = await readdir(dir, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile() && (!ext || e.name.endsWith(ext)))
      .map(e => ({ name: e.name, path: join(dir, e.name) }))
    return { ok: true, files }
  } catch (e: unknown) {
    return { ok: false, error: String(e), files: [] }
  }
})

// ── IPC: Delete a file ───────────────────────────────────────────────────────
ipcMain.handle('file:delete', async (_event, filePath: string) => {
  try {
    await unlink(expandHome(filePath))
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Write a file ─────────────────────────────────────────────────────────
ipcMain.handle('file:write', async (_event, filePath: string, text: string) => {
  try {
    const full = expandHome(filePath)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, text, 'utf8')
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Gateway shell commands ───────────────────────────────────────────────
function runCmd(cmd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

ipcMain.handle('gateway:restart', () => runCmd('openclaw gateway restart'))
ipcMain.handle('gateway:restart-safe', () => runCmd('openclaw gateway restart --safe'))
ipcMain.handle('gateway:stop', () => runCmd('openclaw gateway stop'))
ipcMain.handle('gateway:status', () => runCmd('openclaw gateway status --json'))
ipcMain.handle('plugins:list', async () => {
  const result = await runCmd('openclaw plugins list --json')
  if (!result.ok) return { ok: false, error: result.stderr }
  try {
    return { ok: true, plugins: JSON.parse(result.stdout).plugins ?? [] }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Gateway WebSocket proxy (per-window) ─────────────────────────────────
// Connect from the main process so no Origin header is sent (the gateway clears
// scopes for browser-origin connections). Each renderer WINDOW gets its own socket,
// keyed by the calling webContents id, so a popped-out chat window streams from the
// gateway independently of the main window. A socket's frames route back only to the
// window that opened it.

const sockets = new Map<number, WebSocket>()
// Most recent connection credentials, reused to bootstrap a pop-out window onto the
// same gateway without making the user re-enter them.
let lastConnection: { url: string; token: string } | null = null

function sendToRenderer(channel: string, ...args: unknown[]) {
  mainWindow?.webContents.send(channel, ...args)
}
function wcSend(wc: Electron.WebContents, channel: string, ...args: unknown[]) {
  if (!wc.isDestroyed()) wc.send(channel, ...args)
}

// Tears down a socket safely. Calling close() on a still-CONNECTING socket throws
// ("WebSocket was closed before the connection was established"), so we use
// terminate() and swallow any late 'error' the dying socket emits — an unhandled
// 'error' on a ws socket would otherwise crash the whole main process.
function destroySocket(sock: WebSocket | null | undefined) {
  if (!sock) return
  sock.removeAllListeners()
  sock.on('error', () => { /* swallow late errors during teardown */ })
  try { sock.terminate() } catch { /* already closed / never connected */ }
}

// Device identity for the gateway handshake. Crypto lives here in the main process
// (Node), never in the renderer — the private key never crosses IPC. The renderer
// hands us the per-challenge inputs and gets back the signed `device` block to embed
// in its connect params. See electron/main/deviceIdentity.ts.
ipcMain.handle('deviceAuth:buildConnectBlock', (_event, input: DeviceConnectInput) => {
  try {
    return { ok: true, block: buildDeviceConnectBlock(input) }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})
ipcMain.handle('deviceAuth:identity', () => {
  try {
    return { ok: true, deviceId: loadOrCreateDeviceIdentity().deviceId }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('ws:connect', (event, url: string, token: string) => {
  const wc = event.sender
  const id = wc.id
  destroySocket(sockets.get(id))
  sockets.delete(id)
  lastConnection = { url, token }

  wcSend(wc, 'ws:log', 'info', `Connecting to ${url}…`)
  wcSend(wc, 'ws:status', 'connecting')

  // ws package connects without an Origin header — gateway grants full scopes
  let sock: WebSocket
  try {
    sock = new WebSocket(url)
  } catch (e: unknown) {
    // Malformed URL or synchronous construction failure — report, don't crash
    const msg = e instanceof Error ? e.message : String(e)
    wcSend(wc, 'ws:log', 'info', `Invalid gateway URL: ${msg}`)
    wcSend(wc, 'ws:status', 'error', msg)
    return { ok: false, error: msg }
  }
  sockets.set(id, sock)

  // Guard against an unreachable host that never refuses nor accepts (e.g. a down
  // VPN peer): the TCP connect can hang for the full OS timeout with no 'error'.
  // Fail fast with a clear message instead of an indefinite "Connecting…".
  const connectTimer = setTimeout(() => {
    if (sock.readyState === WebSocket.CONNECTING) {
      wcSend(wc, 'ws:log', 'info', 'Connection timed out — no response from gateway')
      wcSend(wc, 'ws:status', 'error', 'Connection timed out — gateway unreachable')
      destroySocket(sock)
      if (sockets.get(id) === sock) sockets.delete(id)
    }
  }, 12000)

  sock.on('open', () => {
    clearTimeout(connectTimer)
    wcSend(wc, 'ws:log', 'info', 'WebSocket open — waiting for server challenge')
  })

  sock.on('message', (data) => {
    wcSend(wc, 'ws:message', data.toString())
  })

  sock.on('error', (err) => {
    // Unreachable host, refused connection, TLS failure, etc. — surface, never throw
    clearTimeout(connectTimer)
    wcSend(wc, 'ws:log', 'info', `Socket error: ${err.message}`)
    wcSend(wc, 'ws:status', 'error', err.message)
  })

  sock.on('close', (code, reason) => {
    clearTimeout(connectTimer)
    const reasonStr = reason?.toString() || codeToReason(code)
    wcSend(wc, 'ws:log', 'info', `Closed — code=${code}${reasonStr ? ` (${reasonStr})` : ''}`)
    wcSend(wc, 'ws:status', 'disconnected', reasonStr || `code ${code}`)
    if (sockets.get(id) === sock) sockets.delete(id)
  })

  return { ok: true }
})

ipcMain.handle('ws:disconnect', (event) => {
  const id = event.sender.id
  destroySocket(sockets.get(id))
  sockets.delete(id)
  wcSend(event.sender, 'ws:status', 'disconnected')
  return { ok: true }
})

ipcMain.handle('ws:send', (event, data: string) => {
  const sock = sockets.get(event.sender.id)
  if (!sock || sock.readyState !== WebSocket.OPEN) return { ok: false, error: 'Not connected' }
  sock.send(data)
  wcSend(event.sender, 'ws:log', 'out', data)
  return { ok: true }
})

function codeToReason(code: number): string {
  const map: Record<number, string> = {
    1000: 'Normal closure', 1001: 'Going away', 1002: 'Protocol error',
    1006: 'Abnormal closure', 1008: 'Policy violation', 1011: 'Internal server error',
    4000: 'Gateway: idle timeout', 4001: 'Gateway: auth rejected',
    4002: 'Gateway: protocol error', 4003: 'Gateway: rate limited'
  }
  return map[code] ?? ''
}

// ── IPC: Obsidian installation detection ─────────────────────────────────────
ipcMain.handle('obsidian:detect', async () => {
  const platform = process.platform
  let installed = false
  if (platform === 'darwin') {
    const r = await runCmd('[ -d "/Applications/Obsidian.app" ] && echo "yes" || echo "no"')
    installed = r.stdout.trim() === 'yes'
  } else if (platform === 'win32') {
    const localApp = process.env['LOCALAPPDATA'] ?? ''
    const r = await runCmd(`[ -f "${localApp}\\Obsidian\\Obsidian.exe" ] && echo "yes" || echo "no"`)
    installed = r.stdout.trim() === 'yes'
  } else {
    const r = await runCmd(
      'which obsidian 2>/dev/null | head -1 || ' +
      'find ~/.local/share/applications /usr/share/applications -name "*bsidian*" -maxdepth 1 2>/dev/null | head -1 || ' +
      'find ~/Applications -name "*bsidian*" -maxdepth 2 2>/dev/null | head -1 || ' +
      'snap list 2>/dev/null | grep -i obsidian | head -1 || ' +
      'flatpak list 2>/dev/null | grep -i obsidian | head -1'
    )
    installed = r.stdout.trim().length > 0
  }
  return { installed, platform }
})

ipcMain.handle('obsidian:writeSkill', async (
  _event,
  vaults: Array<{ name: string; url: string; apiKey: string }>,
  mode: 'read-only' | 'read-write' = 'read-write',
) => {
  try {
    const skillDir = join(homedir(), '.openclaw', 'skills', 'obsidian-memory')
    await mkdir(skillDir, { recursive: true })

    const vaultSections = vaults.map((v, i) =>
      `### ${v.name}${i === 0 ? ' (primary)' : ''}\n- **URL**: ${v.url}\n- **API Key**: \`${v.apiKey}\``
    ).join('\n\n')

    const readWrite = mode === 'read-write'
    // The frontmatter `description` is the skill's "when to use" trigger AND its capability
    // contract — read-only must not advertise writing, or an agent may try (and the table
    // below won't list the endpoints, so it would fail confusingly).
    const description = readWrite
      ? 'Use when the user asks about their notes, knowledge base, vault, or memories.\n' +
        '  Provides access to Obsidian vaults via the Local REST API.\n' +
        '  You can list notes, read note content, search, and write notes.'
      : 'Use when the user asks about their notes, knowledge base, vault, or memories.\n' +
        '  Provides READ-ONLY access to Obsidian vaults via the Local REST API.\n' +
        '  You can list notes, read note content, and search — but NOT modify the vault.'

    const apiRows = [
      '| List all files | `GET {url}/vault/` |',
      '| Read a note | `GET {url}/vault/{path}` |',
      '| Full-text search | `POST {url}/search/simple/?query={q}&contextLength=100` |',
    ]
    if (readWrite) {
      apiRows.splice(2, 0,
        '| Write/overwrite note | `PUT {url}/vault/{path}` (plain text body) |',
        '| Append to note | `POST {url}/vault/{path}` (`Content-Type: text/markdown`) |',
      )
    }

    const content = [
      '---',
      'name: obsidian-memory',
      `description: "${description}"`,
      '---',
      '',
      '# Obsidian Memory Vaults',
      '',
      `Access Obsidian vaults using the Local REST API plugin.${readWrite ? '' : ' This access is **read-only** — do not attempt to create, modify, or delete notes.'}`,
      'Always set `Authorization: Bearer {api_key}` header.',
      '',
      '## Registered Vaults',
      '',
      vaultSections,
      '',
      '## API Reference',
      '',
      '| Operation | Request |',
      '|-----------|---------|',
      ...apiRows,
      '',
      'Note: URL-encode each path segment individually (not the slashes between them).',
      '',
    ].join('\n')

    await writeFile(join(skillDir, 'SKILL.md'), content, 'utf-8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Remove the obsidian-memory skill so gateway agents lose vault access (used when the
// user sets agent access to "Off", or removes the last vault).
ipcMain.handle('obsidian:removeSkill', async () => {
  try {
    const skillDir = join(homedir(), '.openclaw', 'skills', 'obsidian-memory')
    await rm(skillDir, { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Generic memory skill writer ─────────────────────────────────────────
// The provider-neutral path used by the Memory tab: the app builds the full SKILL.md
// (per-provider template in src/lib/memory/providers.ts) and this just writes it to
// ~/.openclaw/skills/<slug>/SKILL.md on the LOCAL host. (Remote gateways / server-side
// management is the P3 gateway-plugin concern — see docs/memory-tab.md.)
// slug is validated to a safe skill-dir name.
const safeSlug = (s: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(s)

ipcMain.handle('memory:writeSkill', async (_event, slug: string, markdown: string) => {
  try {
    if (!safeSlug(slug)) return { ok: false, error: `Invalid skill slug: ${slug}` }
    const skillDir = join(homedir(), '.openclaw', 'skills', slug)
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), markdown, 'utf-8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('memory:removeSkill', async (_event, slug: string) => {
  try {
    if (!safeSlug(slug)) return { ok: false, error: `Invalid skill slug: ${slug}` }
    await rm(join(homedir(), '.openclaw', 'skills', slug), { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Read a single environment variable ──────────────────────────────────
// Backs memory credential "env:VAR" references on a LOCAL gateway (this machine is
// the host). Name-validated; only reads the one requested var, never enumerates.
ipcMain.handle('env:get', (_event, name: string) => {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { ok: false }
  return { ok: true, value: process.env[name] ?? '' }
})

// ── IPC: Install app-native agent skills ─────────────────────────────────────
// Writes SKILL.md files into ~/.openclaw/skills/<slug>/ so the gateway surfaces
// them to agents (the `description` frontmatter is the "when to use" trigger).
// Versioned via a sidecar file so we only rewrite when the bundled version bumps.

// ── Minimal ZIP writer (stored / no compression) ─────────────────────────────
// Skill archives are a few KB of text, so we avoid a zip dependency and emit a
// valid stored-method zip the gateway (yauzl) reads. SKILL.md goes at the root.

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data)
    const size = f.data.length

    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)  // local file header signature
    lfh.writeUInt16LE(20, 4)          // version needed
    lfh.writeUInt16LE(0, 6)           // flags
    lfh.writeUInt16LE(0, 8)           // method 0 = stored
    lfh.writeUInt16LE(0, 10)          // mod time
    lfh.writeUInt16LE(0x21, 12)       // mod date (1980-01-01)
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(size, 18)       // compressed size
    lfh.writeUInt32LE(size, 22)       // uncompressed size
    lfh.writeUInt16LE(name.length, 26)
    lfh.writeUInt16LE(0, 28)          // extra length
    local.push(lfh, name, f.data)

    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)  // central directory header signature
    cdh.writeUInt16LE(20, 4)          // version made by
    cdh.writeUInt16LE(20, 6)          // version needed
    cdh.writeUInt16LE(0, 8)
    cdh.writeUInt16LE(0, 10)
    cdh.writeUInt16LE(0, 12)
    cdh.writeUInt16LE(0x21, 14)
    cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(size, 20)
    cdh.writeUInt32LE(size, 24)
    cdh.writeUInt16LE(name.length, 28)
    cdh.writeUInt16LE(0, 30)          // extra
    cdh.writeUInt16LE(0, 32)          // comment
    cdh.writeUInt16LE(0, 34)          // disk number
    cdh.writeUInt16LE(0, 36)          // internal attrs
    cdh.writeUInt32LE(0, 38)          // external attrs
    cdh.writeUInt32LE(offset, 42)     // local header offset
    central.push(cdh, name)

    offset += lfh.length + name.length + size
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)   // end of central directory signature
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)      // central directory offset
  eocd.writeUInt16LE(0, 20)           // comment length

  return Buffer.concat([...local, centralBuf, eocd])
}

const NATIVE_SKILLS: { slug: string; version: number; lines: string[] }[] = [
  {
    slug: 'ask-user',
    version: 2,
    lines: [
      '---',
      'name: ask-user',
      'description: Use when you need a decision from the user before you can proceed — a choice between options, or a simple yes/no confirmation. Renders as clickable buttons in JoaxClaw so the user answers in one tap instead of typing.',
      '---',
      '',
      '# Ask the User a Structured Question',
      '',
      'When you are genuinely blocked on a decision only the user can make — which of several approaches to take, whether to proceed with something irreversible, or a missing preference you cannot infer — ask with a structured question instead of a paragraph. JoaxClaw renders it as tappable buttons; the user\'s choice comes back as their next message.',
      '',
      '**Asking is just writing text.** To ask, you simply output an `<ask>` block directly in your reply — nothing more. Do NOT call the `skill_workshop` tool, do not try to create, apply, or save a skill, and do not invoke any other tool to ask a question. There is no tool for this; the block itself IS the mechanism. Reaching for a tool here will stall the turn.',
      '',
      'Emit an `<ask>` block whose body is a JSON object. You may write normal prose before it (e.g. a one-line lead-in); the block itself is lifted out of the transcript and shown as an interactive card.',
      '',
      '## Format',
      '',
      '```',
      '<ask>',
      '{',
      '  "question": "Which database should I use?",',
      '  "header": "Database",',
      '  "multiSelect": false,',
      '  "options": [',
      '    { "label": "PostgreSQL", "description": "Relational, robust, great for complex queries" },',
      '    { "label": "SQLite", "description": "Zero-config, file-based, ideal for local apps" }',
      '  ]',
      '}',
      '</ask>',
      '```',
      '',
      '### Fields',
      '- `question` (required) — the question, phrased clearly and ending in a question mark.',
      '- `options` (optional) — the choices. Each is either a string or `{ "label", "description" }`. A short `description` per option helps the user choose. If you omit `options` entirely, the question becomes a simple **Yes / No** confirmation.',
      '- `header` (optional) — a 1–2 word chip labelling the topic (e.g. "Database", "Deploy").',
      '- `multiSelect` (optional) — set `true` to let the user pick several options (checkboxes + a Send button); default is single-choice, which submits the instant the user taps.',
      '',
      '## Simple yes/no',
      '',
      'For a plain confirmation, omit `options`:',
      '',
      '```',
      '<ask>',
      '{ "question": "This will overwrite config.json. Proceed?", "header": "Confirm" }',
      '</ask>',
      '```',
      '',
      '## Rules',
      '- Emit the `<ask>` block inline in your reply — never route it through the `skill_workshop` tool or any other tool. Writing the block is the whole action.',
      '- The body must be valid JSON. A malformed block is dropped silently — the user sees nothing — so double-check quoting.',
      '- Keep options to a handful of meaningful, mutually-distinct choices. The user can always type a different answer instead of tapping.',
      '- Ask only when you are actually blocked. Do not use this for questions you can answer yourself, or to confirm things the user already told you to do.',
      '- After you emit the block, stop and wait — the user\'s selection arrives as their next turn. Do not keep working past a question that gates the work.',
      '- Prefer one question at a time; only emit multiple `<ask>` blocks when the decisions are truly independent.',
      '',
    ],
  },
  {
    slug: 'script-runner',
    version: 2,
    lines: [
      '---',
      'name: script-runner',
      'description: Use when running a shell command/script that is long-running or backgrounded — builds, installs, deploys, test suites, training runs, servers, data jobs — so its progress is tracked live instead of blocking the turn.',
      '---',
      '',
      '# Run Long Scripts as Tracked Background Jobs',
      '',
      'The normal bash/shell tool blocks until the command returns and can\'t be followed once a process backgrounds — so a long build or a server started with `&` shows as "done" while it is really still working, and you end up waiting blindly. Instead, launch anything slow or long-lived with the **`script_start`** tool.',
      '',
      '## How',
      '',
      '1. Call `script_start` with `{ command, cwd? }`. It spawns the script on the host, returns a `jobId` immediately (it does NOT block), and JoaxClaw shows the user a **live progress card** — status, elapsed time, streaming output, and a % bar if the script prints one.',
      '2. **Then just stop — end your turn or move on to other work.** When the script finishes, this session is **automatically woken** with the result (exit status + output tail) delivered as a new turn, so you can process it then. You do NOT need to poll `script_status` or set a reminder to wait — that happens for you.',
      '3. `script_stop({ jobId })` stops a job; `script_status({ jobId })` fetches current status on demand if you ever want to peek before it finishes.',
      '',
      '## When to use which tool',
      '',
      '- **Quick commands** (ls, git status, reading a file, a short one-off): use the normal bash/shell tool — no need for a job.',
      '- **Anything that takes more than a few seconds, streams progress, or runs in the background** (compiling, `npm install`, `docker build`, migrations, long tests, a dev server, a training run): use `script_start`.',
      '',
      '## Tips',
      '- The auto-wake is the intended flow: launch the script, tell the user you\'ll report back when it\'s done, and end your turn. Don\'t burn turns polling.',
      '- For a server/watcher you intend to leave running indefinitely (no meaningful "done"), pass `notifyOnDone: false` so you aren\'t woken.',
      '- Prefer commands that print progress (a percentage, or step-by-step lines) — the card surfaces them live.',
      '- The job lives on the gateway host, so progress and the finish wake-up survive an app reconnect. Report the jobId to the user if they may want to follow or stop it themselves.',
      '',
    ],
  },
  {
    slug: 'teams-blueprint',
    version: 2,
    lines: [
      '---',
      'name: teams-blueprint',
      'description: Use when the user asks to assemble, design, or build a TEAM of agents that collaborate with defined roles, tasks, and handoffs (e.g. "a team that researches, then writes, then reviews"). Produces a runnable JoaxClaw team.',
      '---',
      '',
      '# Teams Blueprint',
      '',
      'Build a JoaxClaw **team**: a controller agent that orchestrates an ordered list of member agents, with optional conditional routing. You author one JSON "blueprint"; JoaxClaw compiles it into an executable workflow graph automatically — you never specify node positions or graph coordinates.',
      '',
      '## How to create a team',
      '',
      '1. Inspect the configured agents and pick a **controller** (the team lead) plus the **member** agents, each with a role and a concrete task. Use only agent ids that already exist.',
      '2. Write the blueprint JSON to: `~/.openclaw/teams/<id>.team.json` where `<id>` is a kebab-case slug equal to the `id` field.',
      '3. Tell the user to open **Teams** in JoaxClaw, review, and run it — the app picks up the file automatically. To run it yourself, see "Running a team" below.',
      '',
      '## Blueprint schema (`<id>.team.json`)',
      '',
      '```json',
      '{',
      '  "schemaVersion": 1,',
      '  "id": "research-write-review",',
      '  "name": "Research, Write, Review",',
      '  "description": "Optional one-line summary",',
      '  "controllerAgentId": "<an existing agent id>",',
      '  "members": [',
      '    { "agentId": "<agent id>", "role": "Researcher", "task": "Gather sources and summarize key findings." },',
      '    { "agentId": "<agent id>", "role": "Writer", "task": "Draft the article from the research." },',
      '    { "agentId": "<agent id>", "role": "Reviewer", "task": "Critique the draft and request fixes." }',
      '  ],',
      '  "routes": [],',
      '  "outputContract": "A finished, reviewed article.",',
      '  "tags": ["content"],',
      '  "createdAt": 0,',
      '  "updatedAt": 0,',
      '  "version": 1',
      '}',
      '```',
      '',
      '### Members',
      'Ordered list. Each member: `agentId` (a real configured agent), `role`, `task`. Optional `soul` (persona/voice) and `reviewBefore: true` (insert a human review gate before that member — not allowed on the first member).',
      '',
      '### Conditional routing (optional)',
      'Add `routes` only for branching; omit it for a straight linear pipeline. Each route fires after a member completes:',
      '',
      '```json',
      '"routes": [',
      '  {',
      '    "afterMemberId": "<agentId of the deciding member>",',
      '    "branches": [',
      '      { "condition": "the draft needs major rework", "nextMemberId": "<writer agentId>", "brief": "Rework these sections..." },',
      '      { "condition": "", "nextMemberId": "__end__" }',
      '    ]',
      '  }',
      ']',
      '```',
      '',
      '- Branches are evaluated in order; the first matching condition wins.',
      '- An empty `condition` ("") is the catch-all default — put it last.',
      '- `nextMemberId` is a member\'s `agentId`, or `"__end__"` to finish.',
      '',
      '## Reusable teams: the per-run task',
      '',
      'A team is a reusable **design**; the concrete goal is supplied per run. Make a team reusable by writing member tasks (and the `outputContract`) as templates that reference `{objective}` — the run\'s task is substituted in. Example task: `"Research {objective} and summarize the top findings."` Teams with fully baked-in tasks still work; `{objective}` is optional.',
      '',
      '## Running a team',
      '',
      'To run a saved team with a concrete task, call the gateway method `teams.run` with `{ id, task, autorun }`:',
      '- `id` — the team id.',
      '- `task` — what the team should do this run (fills `{objective}`).',
      '- `autorun` — `true` launches immediately; `false` (default) just pre-fills the task in the Team tab for the user to review and run.',
      '',
      'The desktop app picks up the request, runs the team (it owns the orchestration), and shows live progress in the Team tab\'s monitor. Prefer `autorun: false` unless the user explicitly asked you to launch it.',
      '',
      '## Rules',
      '- Use only `agentId`s that already exist — inspect the configured agents first.',
      '- `id` must equal the filename slug and be unique.',
      '- Keep each task concrete and self-contained; a member only sees its own task plus handoff context.',
      '- Never hand-author a graph — the app compiles `members` + `routes` into the executable process.',
      '',
    ],
  },
  {
    slug: 'process-builder',
    version: 1,
    lines: [
      '---',
      'name: process-builder',
      'description: Use when the user asks to build or run a multi-agent workflow, process, or pipeline (sequential or branching steps handed off across agents). Produces a runnable JoaxClaw process.',
      '---',
      '',
      '# Process Builder',
      '',
      'JoaxClaw runs multi-agent **processes**: a controller agent orchestrates a graph of agent steps with handoffs and optional conditional routing.',
      '',
      '## Prefer a team blueprint',
      '',
      'For almost every multi-agent workflow, author a **team blueprint** instead of a raw process — see the `teams-blueprint` skill. You describe the controller plus ordered members (and optional routes) as JSON, and JoaxClaw compiles the executable process graph for you. This is the reliable path: you do not hand-write node coordinates.',
      '',
      'So:',
      '1. Map the request to a controller agent + a sequence of member agents (role + task each).',
      '2. Follow the `teams-blueprint` skill to write `~/.openclaw/teams/<id>.team.json`.',
      '3. Tell the user to open **Teams** and run it.',
      '',
      '## Raw process files (advanced)',
      '',
      'A compiled process lives at `~/.openclaw/processes/<id>.md` as YAML frontmatter plus an embedded `<!--graph-data ...-->` block of nodes (with x/y positions) and edges. Authoring this by hand is error-prone and rarely necessary — only do it when you must control exact node layout. Otherwise use a team blueprint, which generates this file automatically.',
      '',
      'When JoaxClaw launches a process it tags the controller session with the label `process:<id>`, which the app uses to link the run back to the process.',
      '',
    ],
  },
]

// Local install: writes the SKILL.md files directly (gateway must be on this host).
ipcMain.handle('skills:installNative', async (_event, force?: boolean) => {
  const results: { slug: string; status: 'installed' | 'up-to-date' | 'error'; error?: string }[] = []
  for (const skill of NATIVE_SKILLS) {
    const dir = join(homedir(), '.openclaw', 'skills', skill.slug)
    const verFile = join(dir, '.joaxclaw-version')
    try {
      let existing = ''
      try { existing = (await readFile(verFile, 'utf8')).trim() } catch { /* not installed yet */ }
      if (!force && existing === String(skill.version)) {
        results.push({ slug: skill.slug, status: 'up-to-date' })
        continue
      }
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), skill.lines.join('\n'), 'utf8')
      await writeFile(verFile, String(skill.version), 'utf8')
      results.push({ slug: skill.slug, status: 'installed' })
    } catch (e) {
      results.push({ slug: skill.slug, status: 'error', error: String(e) })
    }
  }
  return { ok: true, results }
})

// Lists the bundled native skills (slug + version) for the remote-install flow.
ipcMain.handle('skills:listNative', () =>
  NATIVE_SKILLS.map(s => ({ slug: s.slug, version: s.version }))
)

// Builds a zip archive (SKILL.md at root) for one native skill, for upload to a
// remote gateway via skills.upload.*. Returns the archive as base64 + its sha256.
ipcMain.handle('skills:buildArchive', (_event, slug: string) => {
  const skill = NATIVE_SKILLS.find(s => s.slug === slug)
  if (!skill) return { ok: false, error: `unknown skill: ${slug}` }
  const content = Buffer.from(skill.lines.join('\n'), 'utf8')
  const zip = buildZip([{ name: 'SKILL.md', data: content }])
  const sha256 = createHash('sha256').update(zip).digest('hex')
  return { ok: true, slug: skill.slug, version: skill.version, base64: zip.toString('base64'), sha256, sizeBytes: zip.length }
})

// ── IPC: JoaxClaw local store (~/.joaxclaw/store.json) ───────────────────────
const joaxclawDir = join(homedir(), '.joaxclaw')
const joaxclawStorePath = join(joaxclawDir, 'store.json')

ipcMain.handle('localstore:read', async () => {
  try {
    if (!existsSync(joaxclawStorePath)) return { ok: true, data: {} }
    const text = await readFile(joaxclawStorePath, 'utf8')
    return { ok: true, data: JSON.parse(text) }
  } catch (e: unknown) {
    return { ok: false, error: String(e), data: {} }
  }
})

ipcMain.handle('localstore:write', async (_event, data: unknown) => {
  try {
    await mkdir(joaxclawDir, { recursive: true })
    await writeFile(joaxclawStorePath, JSON.stringify(data, null, 2), 'utf8')
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: System metrics ───────────────────────────────────────────────────────

async function getGpuFromNvidiaSmi(): Promise<{ model: string; utilizationGpu: number; memUsed: number; memTotal: number; temperatureGpu: number } | null> {
  try {
    const r = await runCmd(
      'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits'
    )
    if (!r.ok || !r.stdout) return null
    const parts = r.stdout.split(',').map(s => s.trim())
    if (parts.length < 5) return null
    return {
      model:          parts[0],
      utilizationGpu: parseInt(parts[1]) || 0,
      memUsed:        parseInt(parts[2]) || 0,   // MB
      memTotal:       parseInt(parts[3]) || 0,   // MB
      temperatureGpu: parseInt(parts[4]) || 0,
    }
  } catch {
    return null
  }
}

ipcMain.handle('metrics:get', async () => {
  try {
    const [cpu, mem, graphics] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.graphics()
    ])

    let gpuControllers = graphics.controllers.map((c) => ({
      model:          c.model,
      utilizationGpu: c.utilizationGpu ?? 0,
      memUsed:        c.memUsed        ?? 0,
      memTotal:       c.memTotal       ?? 0,
      temperatureGpu: c.temperatureGpu ?? 0,
    }))

    // On Linux, si.graphics() often returns empty or zero utilization/memTotal
    // for NVIDIA GPUs — fall back to nvidia-smi when the data looks incomplete.
    const firstGpu = gpuControllers[0]
    if (!firstGpu || (firstGpu.utilizationGpu === 0 && firstGpu.memTotal === 0)) {
      const nv = await getGpuFromNvidiaSmi()
      if (nv) {
        gpuControllers = firstGpu
          ? [{ ...firstGpu, ...nv }]
          : [nv]
      }
    }

    return {
      ok: true,
      cpu: Math.round(cpu.currentLoad),
      ramUsed: mem.active,
      ramTotal: mem.total,
      gpu: gpuControllers,
    }
  } catch (e: unknown) {
    return { ok: false, error: String(e), cpu: 0, ramUsed: 0, ramTotal: 0, gpu: [] }
  }
})

// ── IPC: Ollama prompt-processing progress (from logs) ───────────────────────
// Ollama's HTTP API exposes no prompt-eval progress — the llama.cpp runner only
// prints it to logs. We tail those logs and forward the `progress` fraction:
//   Linux  → journald  (journalctl -t ollama)
//   macOS  → ~/.ollama/logs/server.log
//   Windows→ %LOCALAPPDATA%\Ollama\server.log
// Example line:
//   slot print_timing: id 0 | task 0 | prompt processing, n_tokens = 19456, progress = 0.83, t = 235.99 s / 82.44 tokens per second

let ollamaWatchStarted = false
let ollamaStop: (() => void) | null = null

const OLLAMA_PROGRESS_RE = /prompt processing.*?n_tokens\s*=\s*(\d+).*?progress\s*=\s*([\d.]+).*?([\d.]+)\s*tokens per second/i

function emitOllamaLine(line: string): void {
  const m = OLLAMA_PROGRESS_RE.exec(line)
  if (!m) return
  const nTokens = parseInt(m[1], 10)
  const progress = parseFloat(m[2])
  const tps = parseFloat(m[3])
  if (Number.isNaN(progress)) return
  sendToRenderer('ollama:progress', { nTokens, progress, tps })
}

// Splits a chunked text stream into complete lines, forwarding each to emitOllamaLine.
function makeLineSplitter(): (chunk: string) => void {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      emitOllamaLine(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 1)
    }
  }
}

// Tails an appended-to log file (macOS/Windows). Handles late creation and rotation.
function tailOllamaFile(filePath: string): () => void {
  let pos = 0
  let watcher: FSWatcher | null = null
  const feed = makeLineSplitter()

  const readNew = () => {
    let size: number
    try { size = statSync(filePath).size } catch { return }
    if (size < pos) pos = 0          // file was rotated/truncated
    if (size <= pos) return
    const stream = createReadStream(filePath, { start: pos, end: size - 1 })
    pos = size
    stream.on('data', d => feed(d.toString()))
    stream.on('error', () => { /* ignore transient read errors */ })
  }

  const begin = () => {
    if (watcher) return
    try { pos = statSync(filePath).size } catch { pos = 0 }
    try { watcher = watch(filePath, { persistent: false }, () => readNew()) } catch { /* ignore */ }
  }

  if (existsSync(filePath)) begin()
  // Poll covers late file creation and platforms where fs.watch misses appends.
  const poll = setInterval(() => { begin(); readNew() }, 1000)

  return () => { watcher?.close(); clearInterval(poll) }
}

// Tails journald for the `ollama` syslog identifier (Linux systemd).
function tailOllamaJournal(): () => void {
  const feed = makeLineSplitter()
  let fallback: (() => void) | null = null
  const proc = spawn('journalctl', ['-t', 'ollama', '-f', '-n', '0', '-o', 'cat'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  proc.stdout?.on('data', d => feed(d.toString()))
  proc.on('error', () => {
    // journalctl missing or access denied — fall back to a log file if one exists
    if (!fallback) fallback = tailOllamaFile(join(homedir(), '.ollama', 'logs', 'server.log'))
  })
  return () => { try { proc.kill() } catch { /* noop */ } ; fallback?.() }
}

function startOllamaWatch(): void {
  if (ollamaWatchStarted) return
  ollamaWatchStarted = true
  try {
    if (process.platform === 'linux') {
      ollamaStop = tailOllamaJournal()
    } else if (process.platform === 'win32') {
      const base = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
      ollamaStop = tailOllamaFile(join(base, 'Ollama', 'server.log'))
    } else {
      ollamaStop = tailOllamaFile(join(homedir(), '.ollama', 'logs', 'server.log'))
    }
  } catch {
    ollamaWatchStarted = false
  }
}

ipcMain.handle('ollama:watch', () => { startOllamaWatch(); return { ok: true } })

// Probe a local LLM engine health URL from the MAIN process. Unlike a renderer
// fetch this is not CORS-bound and can reach remote hosts (e.g. the gateway host
// over a VPN). The caller passes the full health URL (e.g. .../api/tags for Ollama
// or .../v1/models for OpenAI-compatible engines like LM Studio / vLLM).
ipcMain.handle('ollama:probe', async (_event, url: string) => {
  if (typeof url !== 'string' || !url.trim()) return { ok: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)
  try {
    const res = await fetch(url, { signal: controller.signal })
    return { ok: res.ok }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
})

// Like ollama:probe, but returns the response body (capped) — for listing a local
// engine's models (Ollama /api/tags, OpenAI-compatible /models) from the main
// process, where it isn't CORS-bound. The renderer parses the body.
ipcMain.handle('ollama:fetch', async (_event, url: string) => {
  if (typeof url !== 'string' || !url.trim()) return { ok: false, body: '' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    const raw = await res.text()
    const body = raw.length > (1 << 20) ? raw.slice(0, 1 << 20) : raw
    return { ok: res.ok, status: res.status, body }
  } catch {
    return { ok: false, body: '' }
  } finally {
    clearTimeout(timer)
  }
})

app.on('before-quit', () => { ollamaStop?.(); ollamaStop = null })
