// Model-manager store: drives the "Local models" panel — installed list, running
// state, and live download progress for one engine (Ollama) via lib/modelManager
// (which routes through the joaxclaw-fs engines.* methods, local + remote).

import { create } from 'zustand'
import {
  listInstalled, listRunning, startPull, pullStatus, deleteModel, pullPercent, isUnknownMethod,
  showModel, setKeepAlive,
  type InstalledModel, type ModelDetails,
} from '../lib/modelManager'

export interface DownloadState { model: string; status: string; percent: number | null; done: boolean; error?: string }

interface ModelManagerState {
  installed: InstalledModel[]
  running: Set<string>
  loading: boolean
  error: string | null
  needsPlugin: boolean
  downloads: Record<string, DownloadState>
  details: Record<string, ModelDetails>

  load: (baseUrl: string) => Promise<void>
  pull: (baseUrl: string, model: string) => Promise<void>
  remove: (baseUrl: string, model: string) => Promise<boolean>
  loadDetails: (baseUrl: string, model: string) => Promise<void>
  setLoaded: (baseUrl: string, model: string, loaded: boolean) => Promise<void>
}

// Poll timers live outside the store (not serializable state).
const pollers = new Map<string, ReturnType<typeof setInterval>>()

export const useModelManagerStore = create<ModelManagerState>((set, get) => ({
  installed: [],
  running: new Set(),
  loading: false,
  error: null,
  needsPlugin: false,
  downloads: {},
  details: {},

  async load(baseUrl) {
    set({ loading: true, error: null })
    try {
      const [installed, running] = await Promise.all([listInstalled(baseUrl), listRunning(baseUrl)])
      set({ installed, running, loading: false, needsPlugin: false })
    } catch (e) {
      if (isUnknownMethod(e)) set({ loading: false, needsPlugin: true, installed: [], running: new Set() })
      else set({ loading: false, error: String(e) })
    }
  },

  async pull(baseUrl, model) {
    model = model.trim()
    if (!model || get().downloads[model]) return
    const setDl = (d: DownloadState) => set(s => ({ downloads: { ...s.downloads, [model]: d } }))
    try {
      const pullId = await startPull(baseUrl, model)
      setDl({ model, status: 'starting', percent: null, done: false })
      const poll = async () => {
        try {
          const p = await pullStatus(pullId)
          setDl({ model, status: p.error ? 'error' : (p.status ?? '…'), percent: pullPercent(p), done: !!p.done, error: p.error })
          if (p.done) {
            const t = pollers.get(model); if (t) clearInterval(t); pollers.delete(model)
            if (!p.error) await get().load(baseUrl)
            // Keep a failed entry visible; clear a successful one shortly.
            if (!p.error) setTimeout(() => set(s => { const d = { ...s.downloads }; delete d[model]; return { downloads: d } }), 3500)
          }
        } catch (e) {
          // pullId GC'd or transient — stop polling and surface.
          const t = pollers.get(model); if (t) clearInterval(t); pollers.delete(model)
          setDl({ model, status: 'error', percent: null, done: true, error: String(e) })
        }
      }
      const id = setInterval(poll, 800); pollers.set(model, id); void poll()
    } catch (e) {
      if (isUnknownMethod(e)) { set({ needsPlugin: true }); return }
      setDl({ model, status: 'error', percent: null, done: true, error: String(e) })
    }
  },

  async remove(baseUrl, model) {
    try {
      const ok = await deleteModel(baseUrl, model)
      if (ok) await get().load(baseUrl)
      return ok
    } catch (e) { set({ error: String(e) }); return false }
  },

  async loadDetails(baseUrl, model) {
    if (get().details[model]) return
    try {
      const d = await showModel(baseUrl, model)
      if (d) set(s => ({ details: { ...s.details, [model]: d } }))
    } catch { /* non-critical */ }
  },

  async setLoaded(baseUrl, model, loaded) {
    // Optimistic: reflect the change, then re-check what's actually resident.
    set(s => { const r = new Set(s.running); loaded ? r.add(model) : r.delete(model); return { running: r } })
    try {
      await setKeepAlive(baseUrl, model, loaded ? -1 : 0)
      setTimeout(() => { void get().load(baseUrl) }, 500)
    } catch (e) { set({ error: String(e) }); await get().load(baseUrl) }
  },
}))
