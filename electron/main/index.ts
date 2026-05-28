import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { exec } from 'child_process'
import si from 'systeminformation'
import WebSocket from 'ws'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function getTrayIcon(): Electron.NativeImage {
  // resources/ sits two levels above out/main/ in both dev and prod
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    // Fallback: 1×1 transparent PNG so the tray doesn't crash
    return nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    )
  }
  return icon
}

function createTray(): void {
  tray = new Tray(getTrayIcon())
  tray.setToolTip('JoaxClaw')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open JoaxClaw',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(menu)

  // Left-click / double-click shows the window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
      }
    }
  })

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1117',
      symbolColor: '#94a3b8',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    },
    backgroundColor: '#0f1117',
    show: false
  })

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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
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

// ── IPC: Window controls ──────────────────────────────────────────────────────
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.hide())

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

// ── IPC: Local file read (for skill MD files) ────────────────────────────────
ipcMain.handle('file:read', async (_event, filePath: string) => {
  try {
    const text = await readFile(filePath, 'utf8')
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
      avif: 'image/avif'
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

// ── IPC: Gateway WebSocket proxy ──────────────────────────────────────────────
// Connect from the main process so no Origin header is sent.
// The gateway clears scopes for browser-origin connections, so this is required.

let gws: WebSocket | null = null

function sendToRenderer(channel: string, ...args: unknown[]) {
  mainWindow?.webContents.send(channel, ...args)
}

ipcMain.handle('ws:connect', (_event, url: string, token: string) => {
  if (gws) {
    gws.removeAllListeners()
    gws.close()
    gws = null
  }

  sendToRenderer('ws:log', 'info', `Connecting to ${url}…`)
  sendToRenderer('ws:status', 'connecting')

  // ws package connects without an Origin header — gateway grants full scopes
  gws = new WebSocket(url)

  gws.on('open', () => {
    sendToRenderer('ws:log', 'info', 'WebSocket open — waiting for server challenge')
  })

  gws.on('message', (data) => {
    const raw = data.toString()
    sendToRenderer('ws:message', raw)
  })

  gws.on('error', (err) => {
    sendToRenderer('ws:log', 'info', `Socket error: ${err.message}`)
    sendToRenderer('ws:status', 'error', err.message)
  })

  gws.on('close', (code, reason) => {
    const reasonStr = reason?.toString() || codeToReason(code)
    sendToRenderer('ws:log', 'info', `Closed — code=${code}${reasonStr ? ` (${reasonStr})` : ''}`)
    sendToRenderer('ws:status', 'disconnected', reasonStr || `code ${code}`)
    gws = null
  })

  return { ok: true }
})

ipcMain.handle('ws:disconnect', () => {
  if (gws) {
    gws.removeAllListeners()
    gws.close()
    gws = null
  }
  sendToRenderer('ws:status', 'disconnected')
  return { ok: true }
})

ipcMain.handle('ws:send', (_event, data: string) => {
  if (!gws || gws.readyState !== WebSocket.OPEN) return { ok: false, error: 'Not connected' }
  gws.send(data)
  sendToRenderer('ws:log', 'out', data)
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

// ── IPC: System metrics ───────────────────────────────────────────────────────
ipcMain.handle('metrics:get', async () => {
  try {
    const [cpu, mem, graphics] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.graphics()
    ])

    const gpuControllers = graphics.controllers.map((c) => ({
      model: c.model,
      utilizationGpu: c.utilizationGpu ?? 0,
      memUsed: c.memUsed ?? 0,
      memTotal: c.memTotal ?? 0,
      temperatureGpu: c.temperatureGpu ?? 0
    }))

    return {
      ok: true,
      cpu: Math.round(cpu.currentLoad),
      ramUsed: mem.active,
      ramTotal: mem.total,
      gpu: gpuControllers
    }
  } catch (e: unknown) {
    return { ok: false, error: String(e), cpu: 0, ramUsed: 0, ramTotal: 0, gpu: [] }
  }
})
