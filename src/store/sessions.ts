import { create } from 'zustand'
import type { Session } from '../lib/types'
import { gatewayClient } from '../lib/gateway'

const CUSTOM_LABELS_KEY = 'joaxclaw-session-labels'

function loadCustomLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CUSTOM_LABELS_KEY) ?? '{}') } catch { return {} }
}

function saveCustomLabels(labels: Record<string, string>) {
  localStorage.setItem(CUSTOM_LABELS_KEY, JSON.stringify(labels))
}

interface SessionsState {
  sessions: Session[]
  customLabels: Record<string, string>
  loading: boolean
  error: string | null
  aborting: Set<string>
  abortError: Record<string, string>
  fetch: () => Promise<void>
  create: (agentId: string) => Promise<Session | null>
  abort: (key: string) => Promise<void>
  delete: (key: string) => Promise<void>
  rename: (key: string, name: string) => void
  _subscribed: boolean
  _startEventTracking: () => void
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  customLabels: loadCustomLabels(),
  loading: false,
  error: null,
  aborting: new Set(),
  abortError: {},
  _subscribed: false,

  _startEventTracking() {
    if (get()._subscribed) return
    set({ _subscribed: true })

    // Subscribe to sessions.changed events from the gateway
    gatewayClient.request('sessions.subscribe', {}).catch(() => {})

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

      // chat events: infer hasActiveRun from run lifecycle states
      if (frame.event === 'chat') {
        const p = frame.payload as { sessionKey?: string; state?: string }
        const { sessionKey, state } = p
        if (!sessionKey || !state) return

        if (state === 'final' || state === 'aborted' || state === 'error') {
          set(s => ({
            sessions: s.sessions.map(sess =>
              sess.key === sessionKey ? { ...sess, hasActiveRun: false } : sess
            )
          }))
        } else if (state === 'delta' || state === 'thinking_delta') {
          set(s => {
            const exists = s.sessions.some(sess => sess.key === sessionKey)
            if (exists) {
              return { sessions: s.sessions.map(sess => sess.key === sessionKey ? { ...sess, hasActiveRun: true } : sess) }
            }
            // Active run on an unknown session — add it
            return { sessions: [{ key: sessionKey, hasActiveRun: true } as Session, ...s.sessions] }
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
  }
}))
