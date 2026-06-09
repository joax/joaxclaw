import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, session } from 'electron'
import { join, dirname } from 'path'
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
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
  const iconPath = join(__dirname, '../../resources/icons/joaxclaw-logo-dark.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    // Fallback: 1×1 transparent PNG so the tray doesn't crash
    return nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    )
  }
  return icon.resize({ width: 22, height: 22 })
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
  // Trust self-signed certificates from loopback addresses (needed for Obsidian Local REST API HTTPS)
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === 'localhost' || request.hostname === '127.0.0.1' || request.hostname === '::1') {
      callback(0)  // OK
    } else {
      callback(-3) // use default Chromium verification
    }
  })

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

// ── IPC: Local file read/write ───────────────────────────────────────────────
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
    await mkdir(dirPath, { recursive: true })
    const entries = await readdir(dirPath, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile() && (!ext || e.name.endsWith(ext)))
      .map(e => ({ name: e.name, path: `${dirPath}/${e.name}` }))
    return { ok: true, files }
  } catch (e: unknown) {
    return { ok: false, error: String(e), files: [] }
  }
})

// ── IPC: Delete a file ───────────────────────────────────────────────────────
ipcMain.handle('file:delete', async (_event, filePath: string) => {
  try {
    await unlink(filePath)
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Write a file ─────────────────────────────────────────────────────────
ipcMain.handle('file:write', async (_event, filePath: string, text: string) => {
  try {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, text, 'utf8')
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

ipcMain.handle('obsidian:writeSkill', async (_event, vaults: Array<{ name: string; url: string; apiKey: string }>) => {
  try {
    const skillDir = join(homedir(), '.openclaw', 'skills', 'obsidian-memory')
    await mkdir(skillDir, { recursive: true })

    const vaultSections = vaults.map((v, i) =>
      `### ${v.name}${i === 0 ? ' (primary)' : ''}\n- **URL**: ${v.url}\n- **API Key**: \`${v.apiKey}\``
    ).join('\n\n')

    const content = [
      '---',
      'name: obsidian-memory',
      'description: "Use when the user asks about their notes, knowledge base, vault, or memories.',
      '  Provides access to Obsidian vaults via the Local REST API.',
      '  You can list notes, read note content, search, and write notes."',
      '---',
      '',
      '# Obsidian Memory Vaults',
      '',
      'Access Obsidian vaults using the Local REST API plugin.',
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
      '| List all files | `GET {url}/vault/` |',
      '| Read a note | `GET {url}/vault/{path}` |',
      '| Write/overwrite note | `PUT {url}/vault/{path}` (plain text body) |',
      '| Append to note | `POST {url}/vault/{path}` (`Content-Type: text/markdown`) |',
      '| Full-text search | `POST {url}/search/simple/?query={q}&contextLength=100` |',
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
