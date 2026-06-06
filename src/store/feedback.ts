import { create } from 'zustand'

const homedir = (): string => (window as any)?.api?.system?.homedir ?? '~'
const FEEDBACK_LOG = () => `${homedir()}/.openclaw/feedback/feedback.jsonl`
const MEMORY_FILE  = () => `${homedir()}/.openclaw/workspace/memory/feedback-preferences.md`

const fileApi = () =>
  (window as unknown as {
    api?: { file?: {
      read:  (p: string) => Promise<{ ok: boolean; text?: string }>
      write: (p: string, t: string) => Promise<{ ok: boolean }>
    }}
  }).api?.file

export interface FeedbackEntry {
  ts: string
  rating: 'up' | 'down'
  sessionId: string
  messageId: string
  model?: string
  preview: string
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface FeedbackState {
  /** messageId → rating, loaded from disk */
  ratings: Record<string, 'up' | 'down'>
  loaded: boolean
  /** Load all existing feedback from JSONL (idempotent) */
  load: () => Promise<void>
  /** Submit a new rating: update store + append to JSONL + optionally write memory */
  submit: (entry: FeedbackEntry) => Promise<void>
  getRating: (messageId: string) => 'up' | 'down' | null
}

async function appendLine(path: string, line: string) {
  const f = fileApi()
  if (!f) return
  const existing = await f.read(path).then(r => (r.ok && r.text) ? r.text.trimEnd() : '').catch(() => '')
  await f.write(path, existing ? existing + '\n' + line + '\n' : line + '\n')
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  ratings: {},
  loaded: false,

  async load() {
    if (get().loaded) return
    const f = fileApi()
    if (!f) { set({ loaded: true }); return }

    const result = await f.read(FEEDBACK_LOG()).catch(() => ({ ok: false as const }))
    const ratings: Record<string, 'up' | 'down'> = {}

    if (result.ok && result.text) {
      for (const line of result.text.split('\n')) {
        if (!line.trim()) continue
        try {
          const entry = JSON.parse(line) as FeedbackEntry
          if (entry.messageId && (entry.rating === 'up' || entry.rating === 'down')) {
            ratings[entry.messageId] = entry.rating
          }
        } catch { /* malformed line — skip */ }
      }
    }

    set({ ratings, loaded: true })
  },

  async submit(entry) {
    // Update in-memory store immediately so UI reflects without re-read
    set(s => ({ ratings: { ...s.ratings, [entry.messageId]: entry.rating } }))

    // Append to JSONL log
    await appendLine(FEEDBACK_LOG(), JSON.stringify(entry))

    // Thumbs-down → write a memory note the agent reads on next session
    if (entry.rating === 'down') {
      const f = fileApi()
      if (f) {
        const header = '# Response Feedback\n'
        const existing = await f.read(MEMORY_FILE()).then(r => (r.ok && r.text) ? r.text : header).catch(() => header)
        const note = [
          `\n## ${entry.ts.slice(0, 10)}`,
          `**Disliked** · model: ${entry.model ?? 'unknown'} · session: \`${entry.sessionId.slice(0, 8)}\``,
          `> ${entry.preview}`,
          `_User marked this response negatively. Adjust tone, length, or approach for similar queries._`,
        ].join('\n')
        await f.write(MEMORY_FILE(), existing + note)
      }
    }
  },

  getRating(messageId) {
    return get().ratings[messageId] ?? null
  },
}))
