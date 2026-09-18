import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { readGatewayError, isTaskGone } from '../lib/tasks'

// The task drawer's Output tab: `tasks.history` (OpenClaw 2026.9), which returns the task's
// transcript as the same objects chat.history does, newest page first. Pages are kept per
// task until the drawer moves on to another task or closes.
//
// Paging, from the gateway source: the cursor is an offset counted from the newest end, so
// a page and the one before it can overlap by a message once new ones have arrived. The
// pages are stitched together and de-duplicated by message id.

const PAGE = 50
const HEAD_MIN_MS = 2000

export type TaskHistoryStatus = 'idle' | 'loading' | 'ready' | 'noTranscript' | 'gone' | 'error'

interface TaskHistoryState {
  taskId: string | null
  /** Pages as fetched: [newest, older, older…], each in chronological order. */
  pages: unknown[][]
  /** Cursor for the page before the oldest one loaded. */
  nextCursor?: string
  status: TaskHistoryStatus
  error?: string
  loadingEarlier: boolean
  load: (taskId: string) => Promise<void>
  loadEarlier: () => Promise<void>
  /** Re-read the newest page while the task runs, at most every 2 s. */
  refreshHead: () => void
  reset: () => void
}

let seq = 0
let lastHeadAt = 0
let headTimer: ReturnType<typeof setTimeout> | undefined

function classify(e: unknown): { status: TaskHistoryStatus; error?: string } {
  const err = readGatewayError(e)
  if (isTaskGone(err)) return { status: 'gone' }
  if (/no readable transcript/i.test(err.message)) return { status: 'noTranscript' }
  return { status: 'error', error: err.message }
}

export const useTaskHistoryStore = create<TaskHistoryState>((set, get) => {
  const fetchPage = (taskId: string, cursor?: string) =>
    gatewayClient.request<{ messages?: unknown[]; nextCursor?: string }>(
      'tasks.history', { taskId, limit: PAGE, ...(cursor ? { cursor } : {}) })

  const headNow = async () => {
    const { taskId, status } = get()
    if (!taskId || status !== 'ready') return
    lastHeadAt = Date.now()
    const id = seq
    try {
      const res = await fetchPage(taskId)
      if (id !== seq || get().taskId !== taskId) return
      set(s => ({ pages: [res.messages ?? [], ...s.pages.slice(1)] }))
    } catch { /* keep what's shown; the next change tries again */ }
  }

  return {
    taskId: null,
    pages: [],
    status: 'idle',
    loadingEarlier: false,

    async load(taskId) {
      const id = ++seq
      if (headTimer) { clearTimeout(headTimer); headTimer = undefined }
      set({ taskId, pages: [], nextCursor: undefined, status: 'loading', error: undefined, loadingEarlier: false })
      try {
        const res = await fetchPage(taskId)
        if (id !== seq) return
        lastHeadAt = Date.now()
        set({ pages: [res.messages ?? []], nextCursor: res.nextCursor, status: 'ready' })
      } catch (e) {
        if (id !== seq) return
        set(classify(e))
      }
    },

    async loadEarlier() {
      const { taskId, nextCursor, loadingEarlier } = get()
      if (!taskId || !nextCursor || loadingEarlier) return
      const id = seq
      set({ loadingEarlier: true })
      try {
        const res = await fetchPage(taskId, nextCursor)
        if (id !== seq) return
        set(s => ({ pages: [...s.pages, res.messages ?? []], nextCursor: res.nextCursor, loadingEarlier: false }))
      } catch (e) {
        if (id !== seq) return
        // "Invalid task history cursor. Refresh the task." — the task changed under us.
        if (/cursor/i.test(readGatewayError(e).message)) { void get().load(taskId); return }
        set({ loadingEarlier: false, error: readGatewayError(e).message })
      }
    },

    refreshHead() {
      if (headTimer) return
      const wait = Math.max(0, lastHeadAt + HEAD_MIN_MS - Date.now())
      headTimer = setTimeout(() => { headTimer = undefined; void headNow() }, wait)
    },

    reset() {
      seq++
      if (headTimer) { clearTimeout(headTimer); headTimer = undefined }
      set({ taskId: null, pages: [], nextCursor: undefined, status: 'idle', error: undefined, loadingEarlier: false })
    },
  }
})
