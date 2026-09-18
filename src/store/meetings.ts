import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { sendViaAgent } from '../lib/agentPrompt'
import { useChatStore } from './chat'
import {
  base64ToBytes, buildDiscussMessage, buildSummarizePrompt, meetingTitle, readTranscriptError,
  type StoredSummary, type TranscriptErrorKind, type TranscriptSession, type TranscriptStatus, type Utterance,
} from '../lib/meetings'

// The gateway's meeting notes: the transcript library (`transcripts.list` / `get` /
// `export`) and its live state (`transcripts.status`).
//
// There are no transcript events (GATEWAY_EVENTS has none), so this polls, and only when
// it matters: while the Meetings view is on screen, or while a meeting is being noted.
// Each tick reads `status` only; the list is re-read when the set of live meetings
// changes, or once a minute while the view is open.

const LIST_PAGE = 50
// An explicit limit, always: without one, `get` falls back to the legacy mode that
// returns up to 2000 utterances in one frame.
const UTTERANCE_PAGE = 50
const POLL_MS = 10_000
const POLL_MS_NARROW = 15_000
const LIST_REFRESH_MS = 60_000
const SUMMARY_POLL_MS = 5_000
const SUMMARY_WAIT_MS = 2 * 60_000

export type ReaderTab = 'summary' | 'transcript'

export type DownloadState =
  | { state: 'preparing' }
  | { state: 'saved'; path: string }
  | { state: 'downloaded'; filename: string }
  | { state: 'tooLarge' }
  | { state: 'failed' }

interface Detail {
  session: TranscriptSession
  summary?: StoredSummary
}

interface MeetingsState {
  status: TranscriptStatus | null
  sessions: TranscriptSession[]
  nextCursor: string | null
  listState: 'idle' | 'loading' | 'ready' | 'error'
  /** Why the list failed: `forbidden` shows the access-restricted state. */
  listError: { kind: TranscriptErrorKind; message: string } | null
  loadingMore: boolean
  query: string
  /** Canonical provider id, or null for All. */
  provider: string | null

  selected: string | null
  detail: Detail | null
  detailState: 'idle' | 'loading' | 'ready' | 'error'
  detailError: string | null
  tab: ReaderTab
  utterances: Utterance[]
  utteranceCursor: string | null
  utteranceQuery: string
  utteranceState: 'idle' | 'loading' | 'ready' | 'error'
  download: DownloadState | null
  /** A Summarize asked of an agent, waiting for the summary to be written. */
  summarizing: { selector: string; convId: string; startedAt: number; slow: boolean } | null

  /** Start/stop the view's polling. Called by the Meetings view on mount/unmount. */
  setVisible: (visible: boolean, narrow?: boolean) => void
  /** Everything, from the top: status, then the first page of the list. */
  load: () => Promise<void>
  loadStatus: () => Promise<void>
  loadMore: () => Promise<void>
  setQuery: (q: string) => void
  setProvider: (id: string | null) => void
  open: (selector: string) => Promise<void>
  close: () => void
  setTab: (tab: ReaderTab) => void
  loadUtterances: (more?: boolean) => Promise<void>
  setUtteranceQuery: (q: string) => void
  downloadAs: (format: 'markdown' | 'jsonl', opts?: { narrow?: boolean }) => Promise<void>
  summarize: () => void
  /** Open a new chat about the selected meeting. Returns its conversation id. */
  discuss: (agentId?: string) => string | null
}

const errText = (e: unknown): string => {
  const s = e instanceof Error ? e.message : String(e)
  try { const p = JSON.parse(s) as { message?: string }; if (p?.message) return p.message } catch { /* not JSON */ }
  return s
}
const structured = (e: unknown): unknown => (e as { gatewayError?: unknown })?.gatewayError ?? e

// Timers and bookkeeping, not UI state.
let visible = false
let pollMs = POLL_MS
let pollTimer: ReturnType<typeof setTimeout> | null = null
let lastListAt = 0
let summaryTimer: ReturnType<typeof setTimeout> | null = null
// Bumped by every list request, so a slow answer for filters the user has changed is dropped.
let listSeq = 0

const activeKey = (s: TranscriptStatus | null) => (s?.active ?? []).map(a => a.selector).sort().join('|')

export const useMeetingsStore = create<MeetingsState>((set, get) => {
  /** Poll while the view is open or a meeting is live; otherwise stay quiet. */
  function schedulePoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    const live = (get().status?.active.length ?? 0) > 0
    if (!visible && !live) return
    pollTimer = setTimeout(() => { pollTimer = null; void tick() }, pollMs)
  }

  async function tick() {
    if (!gatewayClient.connected) { schedulePoll(); return }
    const before = activeKey(get().status)
    await get().loadStatus()
    const changed = activeKey(get().status) !== before
    if (visible && (changed || Date.now() - lastListAt > LIST_REFRESH_MS)) void refreshList()
    // The open meeting is live: keep its header and transcript current.
    const sel = get().selected
    const d = get().detail
    if (sel && d && (d.session.active || changed)) {
      void refreshDetail(sel)
      if (get().tab === 'transcript') void get().loadUtterances()
    }
    schedulePoll()
  }

  /** Re-read the first page without clearing what's shown. */
  async function refreshList() {
    const seq = ++listSeq
    const { query, provider } = get()
    try {
      const res = await gatewayClient.request<{ sessions?: TranscriptSession[]; nextCursor?: string | null }>(
        'transcripts.list', listParams(query, provider))
      if (seq !== listSeq) return
      lastListAt = Date.now()
      set({ sessions: res?.sessions ?? [], nextCursor: res?.nextCursor ?? null, listState: 'ready', listError: null })
    } catch { /* keep showing what we have */ }
  }

  async function refreshDetail(selector: string) {
    try {
      const res = await gatewayClient.request<Detail>('transcripts.get', { selector })
      if (get().selected !== selector) return
      set({ detail: { session: res.session, ...(res.summary ? { summary: res.summary } : {}) } })
    } catch { /* keep showing what we have */ }
  }

  return {
    status: null,
    sessions: [],
    nextCursor: null,
    listState: 'idle',
    listError: null,
    loadingMore: false,
    query: '',
    provider: null,
    selected: null,
    detail: null,
    detailState: 'idle',
    detailError: null,
    tab: 'summary',
    utterances: [],
    utteranceCursor: null,
    utteranceQuery: '',
    utteranceState: 'idle',
    download: null,
    summarizing: null,

    setVisible(v, narrow) {
      visible = v
      pollMs = narrow ? POLL_MS_NARROW : POLL_MS
      schedulePoll()
    },

    async load() {
      await Promise.all([get().loadStatus(), (async () => {
        const seq = ++listSeq
        const { query, provider } = get()
        set({ listState: 'loading', listError: null, nextCursor: null })
        try {
          const res = await gatewayClient.request<{ sessions?: TranscriptSession[]; nextCursor?: string | null }>(
            'transcripts.list', listParams(query, provider))
          if (seq !== listSeq) return
          lastListAt = Date.now()
          set({ sessions: res?.sessions ?? [], nextCursor: res?.nextCursor ?? null, listState: 'ready' })
        } catch (e) {
          if (seq !== listSeq) return
          set({ sessions: [], listState: 'error', listError: { kind: readTranscriptError(structured(e)), message: errText(e) } })
        }
      })()])
      const sel = get().selected
      if (sel) void refreshDetail(sel)
      schedulePoll()
    },

    async loadStatus() {
      // 2026.8 has the library but not `status`; the view falls back without it.
      if (!gatewayClient.hasMethod('transcripts.status')) { set({ status: null }); return }
      try {
        const res = await gatewayClient.request<TranscriptStatus>('transcripts.status', {})
        set({ status: res })
      } catch { /* keep the last status */ }
    },

    async loadMore() {
      const { nextCursor, loadingMore, query, provider } = get()
      if (!nextCursor || loadingMore) return
      const seq = listSeq
      set({ loadingMore: true })
      try {
        const res = await gatewayClient.request<{ sessions?: TranscriptSession[]; nextCursor?: string | null }>(
          'transcripts.list', { ...listParams(query, provider), cursor: nextCursor })
        if (seq !== listSeq) return
        const seen = new Set(get().sessions.map(s => s.selector))
        set(s => ({
          sessions: [...s.sessions, ...(res?.sessions ?? []).filter(x => !seen.has(x.selector))],
          nextCursor: res?.nextCursor ?? null, loadingMore: false,
        }))
      } catch (e) {
        if (seq !== listSeq) return
        set({ loadingMore: false })
        // The cursor went stale (the library changed under it): start again from page 1.
        if (readTranscriptError(structured(e)) === 'invalidCursor') void get().load()
      }
    },

    setQuery(q) {
      if (q === get().query) return
      set({ query: q })
      void get().load()
    },

    setProvider(id) {
      if (id === get().provider) return
      set({ provider: id })
      void get().load()
    },

    async open(selector) {
      set({
        selected: selector, detail: null, detailState: 'loading', detailError: null, tab: 'summary',
        utterances: [], utteranceCursor: null, utteranceQuery: '', utteranceState: 'idle', download: null,
      })
      try {
        const res = await gatewayClient.request<Detail>('transcripts.get', { selector })
        if (get().selected !== selector) return
        set({ detail: { session: res.session, ...(res.summary ? { summary: res.summary } : {}) }, detailState: 'ready' })
      } catch (e) {
        if (get().selected !== selector) return
        const kind = readTranscriptError(structured(e))
        set({
          detailState: 'error',
          detailError: kind === 'notFound' ? 'This meeting is no longer in the library.' : errText(e),
        })
        // Gone from the library (or its selector changed): the list is stale too.
        if (kind === 'notFound') void refreshList()
      }
    },

    close() {
      set({ selected: null, detail: null, detailState: 'idle', utterances: [], download: null })
    },

    setTab(tab) {
      set({ tab })
      if (tab === 'transcript' && get().utteranceState === 'idle') void get().loadUtterances()
    },

    async loadUtterances(more) {
      const selector = get().selected
      if (!selector) return
      const { utteranceCursor, utteranceQuery, utterances } = get()
      if (more && !utteranceCursor) return
      // A live refresh re-reads everything loaded so far (up to the 100 cap) in one go.
      const limit = more ? UTTERANCE_PAGE : Math.min(100, Math.max(UTTERANCE_PAGE, utterances.length))
      if (!more && utterances.length === 0) set({ utteranceState: 'loading' })
      try {
        const res = await gatewayClient.request<{ utterances?: Utterance[]; nextCursor?: string | null }>('transcripts.get', {
          selector, includeUtterances: true, limit,
          ...(utteranceQuery.trim() ? { query: utteranceQuery.trim() } : {}),
          ...(more && utteranceCursor ? { cursor: utteranceCursor } : {}),
        })
        if (get().selected !== selector) return
        const page = res?.utterances ?? []
        set(s => ({
          utterances: more ? [...s.utterances, ...page] : page,
          utteranceCursor: res?.nextCursor ?? null,
          utteranceState: 'ready',
        }))
      } catch (e) {
        if (get().selected !== selector) return
        if (readTranscriptError(structured(e)) === 'invalidCursor') { set({ utteranceCursor: null }); void get().loadUtterances(); return }
        set({ utteranceState: 'error' })
      }
    },

    setUtteranceQuery(q) {
      set({ utteranceQuery: q, utterances: [], utteranceCursor: null })
      void get().loadUtterances()
    },

    async downloadAs(format, opts) {
      const selector = get().selected
      if (!selector) return
      set({ download: { state: 'preparing' } })
      try {
        const res = await gatewayClient.request<{ filename: string; mimeType: string; data: string }>('transcripts.export', { selector, format })
        const saved = await saveExport(res.filename, res.data, res.mimeType, !!opts?.narrow)
        if (get().selected !== selector) return
        set({ download: saved })
      } catch (e) {
        if (get().selected !== selector) return
        set({ download: readTranscriptError(structured(e)) === 'exportTooLarge' ? { state: 'tooLarge' } : { state: 'failed' } })
      }
    },

    summarize() {
      const d = get().detail
      if (!d || get().summarizing) return
      const selector = d.session.selector
      // The transcripts tool only lets the agent that owns a session summarize it; any
      // other agent is told the session doesn't exist.
      const convId = sendViaAgent(buildSummarizePrompt(selector), undefined, {
        navigate: false, title: `Summary: ${meetingTitle(d.session)}`,
        ...(d.session.agentId ? { agentId: d.session.agentId } : {}),
      })
      set({ summarizing: { selector, convId, startedAt: Date.now(), slow: false } })
      const poll = async () => {
        summaryTimer = null
        const s = get().summarizing
        if (!s) return
        try {
          const res = await gatewayClient.request<Detail>('transcripts.get', { selector: s.selector })
          if (res.summary) {
            set(st => ({
              summarizing: null,
              ...(st.selected === s.selector ? { detail: { session: res.session, summary: res.summary } } : {}),
              sessions: st.sessions.map(x => (x.selector === s.selector ? res.session : x)),
            }))
            return
          }
        } catch { /* try again */ }
        if (Date.now() - s.startedAt >= SUMMARY_WAIT_MS) { set({ summarizing: { ...s, slow: true } }); return }
        summaryTimer = setTimeout(() => void poll(), SUMMARY_POLL_MS)
      }
      if (summaryTimer) clearTimeout(summaryTimer)
      summaryTimer = setTimeout(() => void poll(), SUMMARY_POLL_MS)
    },

    discuss(agentId) {
      const d = get().detail
      if (!d) return null
      return sendViaAgent(buildDiscussMessage(d.session, d.summary?.markdown), undefined, {
        ...(agentId ? { agentId } : {}), title: `About: ${meetingTitle(d.session)}`,
      })
    },
  }
})

function listParams(query: string, provider: string | null): Record<string, unknown> {
  return {
    limit: LIST_PAGE,
    ...(query.trim() ? { query: query.trim().slice(0, 256) } : {}),
    ...(provider ? { providerId: provider } : {}),
  }
}

/** Open a meeting in Meetings (deep links, the Dashboard). The caller navigates. */
export function openMeeting(selector: string): void {
  void useMeetingsStore.getState().open(selector)
}

/** Open the chat an agent is working in (Summarize, Record). The caller navigates. */
export function focusChat(convId: string): void {
  useChatStore.getState().selectConversation(convId)
}

// Save an export. Under Electron: the native Save dialog. On a phone: the share sheet
// when it takes files (so it can go to Files, Drive, a chat…). Otherwise a download.
async function saveExport(filename: string, base64: string, mimeType: string, narrow: boolean): Promise<DownloadState> {
  const native = (window as unknown as { api?: { file?: { saveAs?: (n: string, b: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean }> } } }).api?.file?.saveAs
  if (native) {
    const res = await native(filename, base64)
    if (res?.ok && res.path) return { state: 'saved', path: res.path }
    if (res?.canceled) return { state: 'failed' }
    return { state: 'failed' }
  }
  const bytes = base64ToBytes(base64)
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const type = mimeType.split(';')[0] || 'application/octet-stream'
  if (narrow && typeof navigator !== 'undefined' && 'canShare' in navigator) {
    try {
      const file = new File([copy.buffer], filename, { type })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        return { state: 'downloaded', filename }
      }
    } catch { /* fall back to a download */ }
  }
  const url = URL.createObjectURL(new Blob([copy.buffer], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { state: 'downloaded', filename }
}
