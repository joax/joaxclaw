import { create } from 'zustand'

// Emoji reactions the user attaches to individual chat messages. Kept local and
// durable — an append-only JSONL toggle log under ~/.openclaw, reduced on load —
// mirroring the feedback store. Reactions are a personal annotation; the gateway
// emits no reaction events, so nothing is sent upstream (the agent can't see them
// yet). If the gateway ever surfaces chat reactions, this store is where model /
// remote reactions would merge in.

const homedir = (): string => (window as any)?.api?.system?.homedir ?? '~'
const REACTIONS_LOG = () => `${homedir()}/.openclaw/reactions/reactions.jsonl`

const fileApi = () =>
  (window as unknown as {
    api?: { file?: {
      read:  (p: string) => Promise<{ ok: boolean; text?: string }>
      write: (p: string, t: string) => Promise<{ ok: boolean }>
    }}
  }).api?.file

export interface ReactionEntry {
  ts: string
  action: 'add' | 'remove'
  sessionId: string
  messageId: string
  emoji: string
}

interface ReactionState {
  /** messageId → emoji[] in the order they were first added */
  reactions: Record<string, string[]>
  loaded: boolean
  /** Replay the JSONL toggle log into the in-memory map (idempotent) */
  load: () => Promise<void>
  /** Toggle one emoji on a message: update store + append to the log */
  toggle: (params: { sessionId: string; messageId: string; emoji: string }) => Promise<void>
  getReactions: (messageId: string) => string[]
}

async function appendLine(path: string, line: string) {
  const f = fileApi()
  if (!f) return
  const existing = await f.read(path).then(r => (r.ok && r.text) ? r.text.trimEnd() : '').catch(() => '')
  await f.write(path, existing ? existing + '\n' + line + '\n' : line + '\n')
}

export const useReactionsStore = create<ReactionState>((set, get) => ({
  reactions: {},
  loaded: false,

  async load() {
    if (get().loaded) return
    const f = fileApi()
    if (!f) { set({ loaded: true }); return }

    const result = await f.read(REACTIONS_LOG()).catch(() => ({ ok: false as const }))
    const reactions: Record<string, string[]> = {}

    if (result.ok && result.text) {
      for (const line of result.text.split('\n')) {
        if (!line.trim()) continue
        try {
          const e = JSON.parse(line) as ReactionEntry
          if (!e.messageId || !e.emoji) continue
          const cur = reactions[e.messageId] ?? []
          if (e.action === 'remove') {
            reactions[e.messageId] = cur.filter(x => x !== e.emoji)
          } else if (!cur.includes(e.emoji)) {
            reactions[e.messageId] = [...cur, e.emoji]
          }
        } catch { /* malformed line — skip */ }
      }
    }

    set({ reactions, loaded: true })
  },

  async toggle({ sessionId, messageId, emoji }) {
    const cur = get().reactions[messageId] ?? []
    const has = cur.includes(emoji)
    const next = has ? cur.filter(x => x !== emoji) : [...cur, emoji]

    // Reflect immediately, then persist the toggle.
    set(s => ({ reactions: { ...s.reactions, [messageId]: next } }))

    await appendLine(REACTIONS_LOG(), JSON.stringify({
      ts: new Date().toISOString(),
      action: has ? 'remove' : 'add',
      sessionId,
      messageId,
      emoji,
    } satisfies ReactionEntry)).catch(() => {})
  },

  getReactions(messageId) {
    return get().reactions[messageId] ?? []
  },
}))
