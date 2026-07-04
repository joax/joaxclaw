import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { homedir } from 'os'

contextBridge.exposeInMainWorld('api', {
  // App info
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    // Tray menu asked to jump to a section (e.g. 'chat', 'teams').
    onNavigate: (cb: (section: string) => void) => {
      const listener = (_: Electron.IpcRendererEvent, section: string) => cb(section)
      ipcRenderer.on('app:navigate', listener)
      return () => ipcRenderer.removeListener('app:navigate', listener)
    },
    // Open a URL in the user's default browser (repo, sponsors, etc.).
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url)
  },

  // System tray: live run counts (agents / teams) shown in the tray menu + tooltip.
  tray: {
    update: (counts: { agents: number; teams: number }) => ipcRenderer.invoke('tray:update', counts)
  },

  // Auto-updater (GitHub Releases) — check / download / install per-OS
  updater: {
    check: () => ipcRenderer.invoke('update:check'),
    download: (url: string, name: string) => ipcRenderer.invoke('update:download', url, name),
    install: (filePath: string) => ipcRenderer.invoke('update:install', filePath),
    openReleasePage: (url?: string) => ipcRenderer.invoke('update:openReleasePage', url),
    restart: () => ipcRenderer.invoke('update:restart'),
    onProgress: (cb: (p: { received: number; total: number; percent: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, p: { received: number; total: number; percent: number }) => cb(p)
      ipcRenderer.on('update:progress', listener)
      return () => ipcRenderer.removeListener('update:progress', listener)
    }
  },

  // UI zoom (whole-app font/size scaling). webFrame runs in the renderer's frame,
  // so this scales everything including inline-px styles — no main round-trip.
  zoom: {
    set: (level: number) => webFrame.setZoomLevel(level),
    get: () => webFrame.getZoomLevel()
  },

  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setTitleBarOverlay: (color: string, symbolColor: string) =>
      ipcRenderer.invoke('window:setTitleBarOverlay', color, symbolColor),
    // Pop-out chat windows
    popOutChat: (sessionKey: string) => ipcRenderer.invoke('chat:popOut', sessionKey),
    returnChat: (sessionKey: string) => ipcRenderer.invoke('chat:returnToMain', sessionKey),
    popoutInfo: (): Promise<{ connection: { url: string; token: string } | null }> => ipcRenderer.invoke('chat:popoutInfo'),
    listPoppedOut: (): Promise<string[]> => ipcRenderer.invoke('chat:listPoppedOut'),
    // Main window: which chats are currently popped out (live updates)
    onPoppedOut: (cb: (keys: string[]) => void) => {
      const listener = (_: Electron.IpcRendererEvent, keys: string[]) => cb(keys)
      ipcRenderer.on('chat:poppedOut', listener)
      return () => ipcRenderer.removeListener('chat:poppedOut', listener)
    },
    // Main window: a pop-out asked to bring its chat back — open this session.
    onFocusSession: (cb: (sessionKey: string) => void) => {
      const listener = (_: Electron.IpcRendererEvent, key: string) => cb(key)
      ipcRenderer.on('chat:focusSession', listener)
      return () => ipcRenderer.removeListener('chat:focusSession', listener)
    },
    // Window maximized/full-screen state — used to flatten the rounded corners.
    onMaximized: (cb: (maximized: boolean) => void) => {
      const listener = (_: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized)
      ipcRenderer.on('window:maximized', listener)
      return () => ipcRenderer.removeListener('window:maximized', listener)
    }
  },

  // Config file
  config: {
    read: () => ipcRenderer.invoke('config:read'),
    write: (text: string) => ipcRenderer.invoke('config:write', text)
  },

  // Gateway commands
  gateway: {
    restart: () => ipcRenderer.invoke('gateway:restart'),
    restartSafe: () => ipcRenderer.invoke('gateway:restart-safe'),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    status: () => ipcRenderer.invoke('gateway:status')
  },

  // Local file access
  file: {
    read:    (filePath: string)                   => ipcRenderer.invoke('file:read', filePath),
    write:   (filePath: string, text: string)     => ipcRenderer.invoke('file:write', filePath, text),
    delete:  (filePath: string)                   => ipcRenderer.invoke('file:delete', filePath),
    find:    (filename: string)                   => ipcRenderer.invoke('file:find', filename),
    listdir: (dirPath: string, ext?: string)      => ipcRenderer.invoke('file:listdir', dirPath, ext),
    readBinary: (filePath: string)                => ipcRenderer.invoke('file:readBinary', filePath)
  },

  // Theme packages (.joaxtheme zips) + background-image picking
  theme: {
    import: () => ipcRenderer.invoke('theme:import'),
    export: (manifest: unknown, bgFiles: Record<string, string>) => ipcRenderer.invoke('theme:export', manifest, bgFiles),
    pickImage: (themeId: string, slot: string) => ipcRenderer.invoke('theme:pickImage', themeId, slot),
    deleteAssets: (themeId: string) => ipcRenderer.invoke('theme:deleteAssets', themeId),
  },

  // Plugin metadata (from openclaw plugins list --json)
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list')
  },

  // Obsidian installation detection + skill file management
  obsidian: {
    detect: () => ipcRenderer.invoke('obsidian:detect'),
    writeSkill: (vaults: Array<{ name: string; url: string; apiKey: string }>, mode: 'read-only' | 'read-write' = 'read-write') =>
      ipcRenderer.invoke('obsidian:writeSkill', vaults, mode),
    removeSkill: () => ipcRenderer.invoke('obsidian:removeSkill'),
  },

  // App-native agent skills (process-builder, teams-blueprint)
  skills: {
    installNative: (force?: boolean) => ipcRenderer.invoke('skills:installNative', force),
    listNative: () => ipcRenderer.invoke('skills:listNative'),
    buildArchive: (slug: string) => ipcRenderer.invoke('skills:buildArchive', slug)
  },

  // JoaxClaw local persistent store (~/.joaxclaw/store.json)
  localstore: {
    read: () => ipcRenderer.invoke('localstore:read'),
    write: (data: unknown) => ipcRenderer.invoke('localstore:write', data)
  },

  // System info (resolved at load time in Node context)
  system: {
    homedir: homedir()
  },

  // System metrics
  metrics: {
    get: () => ipcRenderer.invoke('metrics:get')
  },

  // Ollama prompt-processing progress (parsed from Ollama logs in the main process)
  ollama: {
    watch: () => ipcRenderer.invoke('ollama:watch'),
    probe: (baseUrl: string) => ipcRenderer.invoke('ollama:probe', baseUrl),
    fetch: (url: string) => ipcRenderer.invoke('ollama:fetch', url),
    onProgress: (cb: (p: { nTokens: number; progress: number; tps: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, p: { nTokens: number; progress: number; tps: number }) => cb(p)
      ipcRenderer.on('ollama:progress', listener)
      return () => ipcRenderer.removeListener('ollama:progress', listener)
    }
  },

  // WebSocket proxy — connects from main process (no browser Origin header)
  ws: {
    connect: (url: string, token: string) => ipcRenderer.invoke('ws:connect', url, token),
    disconnect: () => ipcRenderer.invoke('ws:disconnect'),
    send: (data: string) => ipcRenderer.invoke('ws:send', data),
    onMessage: (cb: (raw: string) => void) => {
      const listener = (_: Electron.IpcRendererEvent, raw: string) => cb(raw)
      ipcRenderer.on('ws:message', listener)
      return () => ipcRenderer.removeListener('ws:message', listener)
    },
    onStatus: (cb: (status: string, detail?: string) => void) => {
      const listener = (_: Electron.IpcRendererEvent, status: string, detail?: string) => cb(status, detail)
      ipcRenderer.on('ws:status', listener)
      return () => ipcRenderer.removeListener('ws:status', listener)
    },
    onLog: (cb: (dir: string, text: string) => void) => {
      const listener = (_: Electron.IpcRendererEvent, dir: string, text: string) => cb(dir, text)
      ipcRenderer.on('ws:log', listener)
      return () => ipcRenderer.removeListener('ws:log', listener)
    }
  }
})

// Type declarations for renderer
declare global {
  interface Window {
    api: typeof import('./index')['default']
  }
}
