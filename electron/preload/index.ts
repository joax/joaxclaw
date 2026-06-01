import { contextBridge, ipcRenderer } from 'electron'
import { homedir } from 'os'

contextBridge.exposeInMainWorld('api', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
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
    read: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
    find: (filename: string) => ipcRenderer.invoke('file:find', filename),
    readBinary: (filePath: string) => ipcRenderer.invoke('file:readBinary', filePath)
  },

  // Plugin metadata (from openclaw plugins list --json)
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list')
  },

  // Obsidian installation detection + skill file management
  obsidian: {
    detect: () => ipcRenderer.invoke('obsidian:detect'),
    writeSkill: (vaults: Array<{ name: string; url: string; apiKey: string }>) =>
      ipcRenderer.invoke('obsidian:writeSkill', vaults)
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
