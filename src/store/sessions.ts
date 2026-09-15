import { create } from 'zustand'
import type { Session } from '../lib/types'
import { gatewayClient } from '../lib/gateway'

const CUSTOM_LABELS_KEY = 'joaxclaw-session-labels'
// App-derived friendly names for sessions the gateway only knows by an opaque key —
// notably Team/Process sub-agents (keyed "agent:<id>:subagent:<uuid>"). Populated by
// the processes store when it sees a spawn; persisted so the names survive a reload.
const DERIVED_NAMES_KEY = 'joaxclaw-session-derived-names'

function loadJson(key: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') } catch { return {} }
}

function loadCustomLabels(): Record<string, string> {
  return loadJson(CUSTOM_LABELS_KEY)
}

function saveCustomLabels(labels: Record<string, string>) {
  localStorage.setItem(CUSTOM_LABELS_KEY, JSON.stringify(labels))
}

// A one-line preview of a transcript message, for the chat list row.
function messagePreview(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const c = (message as { content?: unknown }).content
  const text = typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map(b => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join(' ')
      : ''
  const t = text.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 200) : undefined
}

interface SessionsState {
  sessions: Session[]
  customLabels: Record<string, string>
  derivedNames: Record<string, string>
  loading: boolean
  error: string | null
  aborting: Set<string>
  abortError: Record<string, string>
  fetch: () => Promise<void>
  create: (agentId: string) => Promise<Session | null>
  abort: (key: string) => Promise<void>
  delete: (key: string) => Promise<void>
  rename: (key: string, name: string) => void
  // Register an app-derived friendly name for a session key (e.g. a Team sub-agent).
  // `force: false` keeps an existing name, so a richer source can't be overwritten by
  // a weaker one that arrives later.
  setDerivedName: (key: string, name: string, force?: boolean) => void
  _subscribed: boolean
  /** The gateway connection (gatewayClient.connectionSeq) the subscription was made on. */
  _subscribedSeq: number
  _subscribe: () => void
  _startEventTracking: () => void
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  customLabels: loadCustomLabels(),
  derivedNames: loadJson(DERIVED_NAMES_KEY),
  loading: false,
  error: null,
  aborting: new Set(),
  abortError: {},
  _subscribed: false,
  _subscribedSeq: -1,

  _subscribe() {
    const seq = gatewayClient.connectionSeq
    set({ _subscribedSeq: seq })

    // Subscribe AND load the first page in one request. The gateway registers the
    // subscription before projecting the list, so events can arrive while the snapshot
    // is being built. That is why the result is merged rather than assigned. The event
    // listener is attached in _startEventTracking, in the same tick as this request, so
    // no event can arrive before it.
    gatewayClient
      .request<{ subscribed?: boolean; list?: { sessions?: Session[] } }>('sessions.subscribe', {
        limit: 60,
        // Prepends rows owned by this connection's viewer, when the gateway can resolve
        // one. Ignored otherwise, and only applies to the first page.
        ownerFirst: true,
        includeDerivedTitles: true,
        includeLastMessage: true,
      })
      .then(res => {
        const rows = res?.list?.sessions
        if (!Array.isArray(rows) || rows.length === 0) return
        set(s => {
          // Anything an event already added while this was in flight wins — it is newer.
          const known = new Set(s.sessions.map(x => x.key))
          const extra = rows.filter(r => r.key && !known.has(r.key))
          return extra.length ? { sessions: [...s.sessions, ...extra] } : {}
        })
      })
      .catch(() => {
        // Not connected yet, or the request failed: try again on the next fetch.
        if (get()._subscribedSeq === seq) set({ _subscribedSeq: -1 })
      })
  },

  _startEventTracking() {
    // The gateway keeps this subscription per CONNECTION, so it has to be renewed after
    // every reconnect (sleep, a network blip, a gateway restart). It used to be sent once
    // per app run, so after the first reconnect sessions.changed and session.message
    // stopped arriving, and channel conversations only showed up after a reload.
    if (get()._subscribedSeq !== gatewayClient.connectionSeq) get()._subscribe()
    if (get()._subscribed) return
    set({ _subscribed: true })

    gatewayClient.on((frame) => {
      // sessions.changed: update if known, add if new (e.g. created by an agent skill)
      if (frame.event === 'sessions.changed') {
        const p = frame.payload as Partial<Session> & { sessionKey?: string }
        const key = p.sessionKey ?? (p as Session).key
        if (!key) return
        set(s => {
          const exists = s.sessions.some(sess => sess.key === key)
          if (exists) {
            return { sessions: s.sessions.map(sess => sess.key === key ? { ...sess, ...p, key } : sess) }
          }
          // Session created externally — add it so it appears in the UI
          return { sessions: [{ ...p, key } as Session, ...s.sessions] }
        })
        return
      }

      // A new transcript entry (a Slack or WhatsApp message, the agent's reply there).
      // Bump the row so the list shows the conversation moved, and add the session if
      // this is its first message, e.g. a new DM.
      if (frame.event === 'session.message') {
        const p = frame.payload as { sessionKey?: string; message?: unknown } | undefined
        const key = p?.sessionKey
        if (!key) return
        const preview = messagePreview(p?.message)
        const patch: Partial<Session> = { updatedAt: Date.now(), ...(preview ? { lastMessage: preview } : {}) }
        set(s => s.sessions.some(x => x.key === key)
          ? { sessions: s.sessions.map(x => x.key === key ? { ...x, ...patch } : x) }
          : { sessions: [{ key, ...patch } as Session, ...s.sessions] })
        return
      }

      // chat events: infer hasActiveRun from run lifecycle states
      if (frame.event === 'chat') {
        const p = frame.payload as { sessionKey?: string; state?: string }
        const { sessionKey, state } = p
        if (!sessionKey || !state) return

        if (state === 'final' || state === 'aborted' || state === 'error') {
          // Also pick up token/cost data the gateway may include in the final event
          const full = frame.payload as Record<string, unknown>
          const tokenPatch: Partial<Session> = {}
          if (typeof full.inputTokens  === 'number') tokenPatch.inputTokens  = full.inputTokens
          if (typeof full.outputTokens === 'number') tokenPatch.outputTokens = full.outputTokens
          if (typeof full.totalTokens  === 'number') tokenPatch.totalTokens  = full.totalTokens
          if (typeof full.totalTokensFresh === 'boolean') tokenPatch.totalTokensFresh = full.totalTokensFresh
          if (typeof full.contextTokens === 'number') tokenPatch.contextTokens = full.contextTokens
          if (typeof full.estimatedCostUsd === 'number') tokenPatch.estimatedCostUsd = full.estimatedCostUsd
          set(s => ({
            sessions: s.sessions.map(sess =>
              sess.key === sessionKey ? { ...sess, ...tokenPatch, hasActiveRun: false } : sess
            )
          }))
        } else if (state === 'delta' || state === 'thinking_delta') {
          // Pick up any running token counts the gateway may include mid-stream
          const full = frame.payload as Record<string, unknown>
          const mid: Partial<Session> = { hasActiveRun: true }
          if (typeof full.inputTokens  === 'number') mid.inputTokens  = full.inputTokens
          if (typeof full.outputTokens === 'number') mid.outputTokens = full.outputTokens
          if (typeof full.totalTokens  === 'number') mid.totalTokens  = full.totalTokens
          if (typeof full.totalTokensFresh === 'boolean') mid.totalTokensFresh = full.totalTokensFresh
          if (typeof full.contextTokens === 'number') mid.contextTokens = full.contextTokens
          if (typeof full.estimatedCostUsd === 'number') mid.estimatedCostUsd = full.estimatedCostUsd
          set(s => {
            const exists = s.sessions.some(sess => sess.key === sessionKey)
            if (exists) {
              return { sessions: s.sessions.map(sess => sess.key === sessionKey ? { ...sess, ...mid } : sess) }
            }
            return { sessions: [{ key: sessionKey, ...mid } as Session, ...s.sessions] }
          })
        }
      }
    })
  },

  async fetch() {
    set({ loading: true, error: null })
    try {
      // Start event tracking on first fetch so we get real-time updates
      get()._startEventTracking()

      const res = await gatewayClient.request<{ sessions: Session[] }>('sessions.list', {
        includeDerivedTitles: true,
        includeLastMessage: true
      })
      set({ sessions: res.sessions ?? [], loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  async create(agentId) {
    try {
      const res = await gatewayClient.request<{ key: string; sessionId?: string }>('sessions.create', { agentId })
      const session: Session = { key: res.key, sessionId: res.sessionId }
      set(st => ({ sessions: [session, ...st.sessions] }))
      return session
    } catch (e) {
      set({ error: String(e) })
      return null
    }
  },

  async abort(key) {
    set(s => {
      const next = new Set(s.aborting)
      next.add(key)
      const errs = { ...s.abortError }
      delete errs[key]
      return { aborting: next, abortError: errs }
    })
    try {
      await gatewayClient.request('sessions.abort', { key })
      set(s => {
        const next = new Set(s.aborting)
        next.delete(key)
        return {
          aborting: next,
          sessions: s.sessions.map(sess =>
            sess.key === key ? { ...sess, hasActiveRun: false, status: 'done' } : sess
          )
        }
      })
    } catch (e) {
      set(s => {
        const next = new Set(s.aborting)
        next.delete(key)
        return { aborting: next, abortError: { ...s.abortError, [key]: String(e) } }
      })
    }
  },

  async delete(key) {
    set(s => ({ sessions: s.sessions.filter(sess => sess.key !== key) }))
    await gatewayClient.request('sessions.delete', { key }).catch(() => {})
  },

  rename(key, name) {
    const trimmed = name.trim()
    const next = { ...get().customLabels }
    if (trimmed) next[key] = trimmed
    else delete next[key]
    saveCustomLabels(next)
    set({ customLabels: next })
  },

  setDerivedName(key, name, force = true) {
    const trimmed = name.trim()
    if (!key || !trimmed) return
    const existing = get().derivedNames
    if (!force && existing[key]) return
    if (existing[key] === trimmed) return
    const next = { ...existing, [key]: trimmed }
    localStorage.setItem(DERIVED_NAMES_KEY, JSON.stringify(next))
    set({ derivedNames: next })
  }
}))
