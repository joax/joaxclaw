import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import {
  installParamsFor, readConsentRequired,
  type ConsentRequired, type DeclaredSurface, type PluginInspect, type PluginSearchHit, type PluginSearchPackage,
} from '../lib/pluginCatalog'

// Finding and installing plugins from ClawHub.
//
// Separate from the extensions store on purpose: that one is a local edit buffer over
// `config.patch` — change things, then Save. Installing is not a config edit and cannot
// be batched behind a save button; it runs on the gateway, takes time, and may need
// consent partway through.

/** A consent challenge waiting on the user, with what the plugin declares. */
export interface PendingConsent {
  challenge: ConsentRequired
  pkg: PluginSearchPackage
  /** From plugins.inspect — what the plugin declares in full. */
  declared?: DeclaredSurface
}

interface PluginCatalogState {
  query: string
  results: PluginSearchHit[]
  searching: boolean
  searched: boolean
  /** pluginId or package name currently installing/removing. */
  busy: string | null
  error: string | null
  /** Set when the gateway refuses until the declared surface is acknowledged. */
  consent: PendingConsent | null
  /** Plugin ids installed this session, so the row can say so before a reload. */
  justInstalled: string[]
  restartRequired: boolean

  search: (query: string) => Promise<void>
  install: (pkg: PluginSearchPackage) => Promise<void>
  /** Retry the pending install, acknowledging the declared surface. */
  acceptConsent: () => Promise<void>
  dismissConsent: () => void
  uninstall: (pluginId: string) => Promise<boolean>
  clearError: () => void
  reset: () => void
}

const errText = (e: unknown): string => {
  const s = e instanceof Error ? e.message : String(e)
  try { const p = JSON.parse(s) as { message?: string }; if (p?.message) return p.message } catch { /* not JSON */ }
  return s
}

/** The structured error object, which the client attaches alongside the message. */
const structured = (e: unknown): unknown => (e as { gatewayError?: unknown })?.gatewayError ?? e

export const usePluginCatalogStore = create<PluginCatalogState>((set, get) => ({
  query: '',
  results: [],
  searching: false,
  searched: false,
  busy: null,
  error: null,
  consent: null,
  justInstalled: [],
  restartRequired: false,

  async search(query) {
    const q = query.trim()
    if (!q) { set({ results: [], searched: false, query: '' }); return }
    set({ searching: true, error: null, query: q })
    try {
      const res = await gatewayClient.request<{ results?: PluginSearchHit[] }>('plugins.search', { query: q, limit: 25 })
      set({ results: res.results ?? [], searching: false, searched: true })
    } catch (e) {
      set({ searching: false, searched: true, results: [], error: errText(e) })
    }
  },

  async install(pkg) {
    set({ busy: pkg.name, error: null })
    try {
      const res = await gatewayClient.request<{ ok?: true; restartRequired?: boolean }>(
        'plugins.install', installParamsFor(pkg) as unknown as Record<string, unknown>,
      )
      set(s => ({
        busy: null,
        justInstalled: [...s.justInstalled, pkg.runtimeId ?? pkg.name],
        restartRequired: s.restartRequired || res?.restartRequired === true,
      }))
    } catch (e) {
      // Not a failure: the gateway is asking whether this plugin may do what it
      // declares. The token in the challenge is what acknowledges it — but only after
      // a person has actually seen the surface, so this parks in `consent` rather than
      // retrying itself.
      const challenge = readConsentRequired(structured(e))
      if (!challenge) { set({ busy: null, error: errText(e) }); return }
      const declared = await gatewayClient
        .request<PluginInspect>('plugins.inspect', { pluginId: challenge.pluginId })
        .then(r => r.declared)
        .catch(() => undefined)
      set({ busy: null, consent: { challenge, pkg, ...(declared ? { declared } : {}) } })
    }
  },

  async acceptConsent() {
    const pending = get().consent
    if (!pending) return
    set({ busy: pending.pkg.name, consent: null, error: null })
    try {
      const res = await gatewayClient.request<{ ok?: true; restartRequired?: boolean }>(
        'plugins.install',
        installParamsFor(pending.pkg, pending.challenge.reviewToken) as unknown as Record<string, unknown>,
      )
      set(s => ({
        busy: null,
        justInstalled: [...s.justInstalled, pending.pkg.runtimeId ?? pending.pkg.name],
        restartRequired: s.restartRequired || res?.restartRequired === true,
      }))
    } catch (e) {
      set({ busy: null, error: errText(e) })
    }
  },

  dismissConsent() { set({ consent: null }) },

  async uninstall(pluginId) {
    set({ busy: pluginId, error: null })
    try {
      const res = await gatewayClient.request<{ restartRequired?: boolean }>('plugins.uninstall', { pluginId })
      set(s => ({
        busy: null,
        // Uninstall always requires a restart, per the method's own result schema.
        restartRequired: s.restartRequired || res?.restartRequired !== false,
        justInstalled: s.justInstalled.filter(id => id !== pluginId),
      }))
      return true
    } catch (e) {
      set({ busy: null, error: errText(e) })
      return false
    }
  },

  clearError() { set({ error: null }) },
  reset() { set({ query: '', results: [], searched: false, error: null, consent: null, busy: null }) },
}))
