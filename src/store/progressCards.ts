import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { parseProgressCard, isSameSession, type ProgressCard } from '../lib/progressCard'

// Progress cards for the sessions the app is showing, keyed by the local session key.
//
// This follows the questions store's two-source approach. `progressCard.get` runs when
// a chat opens, and again on reconnect to pick up anything that changed while the app was
// away. The `progressCard.changed` broadcast then keeps it live. The broadcast carries
// only the new revision, so the card itself is fetched. It is not a subscription-gated
// event: the gateway delivers it to any client with operator.read that can see the
// session, so nothing needs subscribing first.

interface ProgressCardsState {
  /** null means the session has no card, or this gateway can't serve one. */
  cards: Record<string, ProgressCard | null>
  /** Subscribe to the broadcast (idempotent), then re-read every card already on screen. */
  start: () => void
  load: (sessionKey: string) => Promise<void>
  ingest: (payload: unknown) => void
}

let subscribed = false
// The latest request for each session, so a slow response can't overwrite a newer one.
const latest = new Map<string, number>()
let seq = 0

export const useProgressCardsStore = create<ProgressCardsState>((set, get) => {
  const subscribe = () => {
    if (subscribed) return
    subscribed = true
    gatewayClient.on(frame => {
      if (frame.event === 'progressCard.changed') get().ingest(frame.payload)
    })
  }

  return {
    cards: {},

    start() {
      subscribe()
      for (const key of Object.keys(get().cards)) void get().load(key)
    },

    async load(sessionKey) {
      // Subscribing here as well as in start(): a popped-out chat window never runs
      // App's connect effect.
      subscribe()
      const id = ++seq
      latest.set(sessionKey, id)
      let card: ProgressCard | null = null
      try {
        const res = await gatewayClient.request<{ card?: unknown }>('progressCard.get', { sessionKey })
        card = parseProgressCard(res?.card)
      } catch {
        // Gateways before 2026.8 don't have the method (the client caches that and fails
        // fast from then on), and a token without operator.read can't read it. Either
        // way there's nothing to show, and it isn't worth a banner.
      }
      if (latest.get(sessionKey) !== id) return
      set(s => ({ cards: { ...s.cards, [sessionKey]: card } }))
    },

    ingest(payload) {
      const p = payload as { sessionKey?: unknown; revision?: unknown } | undefined
      if (typeof p?.sessionKey !== 'string') return
      const revision = typeof p.revision === 'number' ? p.revision : null
      // Only sessions already loaded: a chat that isn't open reads its card when it opens.
      for (const [key, card] of Object.entries(get().cards)) {
        if (!isSameSession(p.sessionKey, key)) continue
        if (revision === null) {
          latest.set(key, ++seq)   // a read still in flight must not bring the card back
          set(s => ({ cards: { ...s.cards, [key]: null } }))
        } else if (!card || card.revision < revision) {
          void get().load(key)
        }
      }
    },
  }
})
