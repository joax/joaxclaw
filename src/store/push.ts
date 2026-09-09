import { create } from 'zustand'
import {
  currentSubscription, defaultPushPrefs, readPushPrefs, sendPushTest,
  subscribeToPush, unsubscribeFromPush, webPushSupported, writePushPrefs,
  type PushCategoryKey, type PushDetailLevel, type PushPrefs,
} from '../lib/webPush'

// Background push (Tier 2). The browser's own subscription is the source of truth for
// "am I subscribed" — not a local flag, which would drift the moment the user clears
// site data or the push service rotates the endpoint. Preferences live on the gateway,
// against the durable user profile, so they follow you to another device.

interface PushState {
  supported: boolean
  endpoint: string | null      // non-null == subscribed
  prefs: PushPrefs | null
  busy: boolean
  error: string | null

  refresh: () => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  test: () => Promise<void>
  setCategory: (key: PushCategoryKey, on: boolean) => Promise<void>
  setDetailLevel: (level: PushDetailLevel) => Promise<void>
}

export const usePushStore = create<PushState>((set, get) => ({
  supported: webPushSupported(),
  endpoint: null,
  prefs: null,
  busy: false,
  error: null,

  // Reconcile with reality: what the browser holds, and what the gateway has stored for
  // it. Safe to call on every connect — the gateway treats a repeat subscribe as an
  // update, which is also how a rotated endpoint gets re-registered.
  async refresh() {
    if (!get().supported) return
    const sub = await currentSubscription()
    if (!sub) { set({ endpoint: null, prefs: null }); return }
    set({ endpoint: sub.endpoint })
    set({ prefs: (await readPushPrefs(sub.endpoint)) ?? defaultPushPrefs() })
  },

  async enable() {
    set({ busy: true, error: null })
    try {
      const sub = await subscribeToPush()
      // A brand-new subscription starts on the gateway's defaults, which enable
      // approvals and nothing else. Replace them with the categories this app can
      // actually act on; an existing subscription keeps whatever the user chose.
      const existing = await readPushPrefs(sub.endpoint)
      const prefs = existing ?? defaultPushPrefs()
      if (!existing) await writePushPrefs(sub.endpoint, prefs)
      set({ endpoint: sub.endpoint, prefs })
    } catch (e) {
      set({ error: cleanErr(e) })
    } finally {
      set({ busy: false })
    }
  },

  async disable() {
    set({ busy: true, error: null })
    try {
      await unsubscribeFromPush()
      set({ endpoint: null, prefs: null })
    } catch (e) {
      set({ error: cleanErr(e) })
    } finally {
      set({ busy: false })
    }
  },

  async test() {
    set({ error: null })
    try { await sendPushTest() } catch (e) { set({ error: cleanErr(e) }) }
  },

  async setCategory(key, on) {
    const { endpoint, prefs } = get()
    if (!endpoint || !prefs) return
    const next = { ...prefs, categories: { ...prefs.categories, [key]: on } }
    set({ prefs: next })                       // optimistic; reverted below on failure
    try { await writePushPrefs(endpoint, next) }
    catch (e) { set({ prefs, error: cleanErr(e) }) }
  },

  async setDetailLevel(level) {
    const { endpoint, prefs } = get()
    if (!endpoint || !prefs) return
    const next = { ...prefs, detailLevel: level }
    set({ prefs: next })
    try { await writePushPrefs(endpoint, next) }
    catch (e) { set({ prefs, error: cleanErr(e) }) }
  },
}))

function cleanErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
