import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { sendViaAgent } from '../lib/agentPrompt'
import { useChatStore } from './chat'
import { useConnectionStore } from './connection'
import { notify } from '../lib/notifications'
import {
  base64ToBytes, buildDiscussMessage, buildJoinPrompt, buildLeavePrompt, buildStopPrompt, buildSummarizePrompt, canonicalMeetingUrl,
  captureFromConfig, guestNameFromConfig, meetingTitle, parseMeetingToolResult, pendingPhase, readTranscriptError, toolAction,
  PLATFORMS, PLATFORM_LIST,
  type ChromeCheck, type JoinMode, type JoinOutcome, type PendingJoin, type PendingPhase, type PlatformId,
  type ReadStamp, type StoredSummary, type TranscriptErrorKind, type TranscriptSession, type TranscriptStatus, type Utterance,
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

/** How a pending join shows, recomputed from its chat and the live sessions. */
export interface PendingView { phase: PendingPhase; text?: string; selector?: string }

interface MeetingsState {
  status: TranscriptStatus | null
  /** plugins.list, for the checklist's plugin rows. Null until read (or when it failed). */
  plugins: unknown
  /** When `status` was read, and on which connection: a read from before a reconnect is stale. */
  statusRead: ReadStamp | null
  /** 2026.8 has no status: capture comes from config.get instead. */
  captureFallback: boolean | null
  /** When `captureFallback` (config.get) was read. */
  setupRead: ReadStamp | null
  /** Notes were turned on from here and the change accepted; see captureState. */
  captureRequested: ReadStamp | null
  /** The name each platform joins under (Teams, Zoom, and Meet when signed out). */
  guestNames: Partial<Record<PlatformId, string>>
  captureSaving: boolean
  captureError: string | null
  /** Joins started here, until they resolve. Kept in sessionStorage across a reload. */
  pending: PendingJoin[]
  pendingViews: Record<string, PendingView>
  /** Live sessions JoaxClaw didn't start, with Stop pressed. */
  stopping: string[]
  /** The Chrome setup check for this gateway (localStorage). */
  chromeCheck: ChromeCheck | null
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

  /** plugins.list + config (guest names, and capture on 2026.8). */
  loadSetup: () => Promise<void>
  /** Turn meeting notes on. The change restarts the gateway. */
  setCaptureOn: () => Promise<void>
  /** Send an agent into a call. Returns the chat it's working in. */
  record: (form: { platform: PlatformId; url: string; mode: JoinMode; agentId: string }) => string
  /** Stop a live meeting (by selector) or a pending join (by id). */
  stop: (target: { pendingId?: string; selector?: string }) => void
  dismissPending: (id: string) => void
  /** Run the platform setup checks on the gateway host through an agent. */
  runSetupCheck: (platforms: PlatformId[]) => string
  markChromeOk: () => void
  /** Re-read the pending joins from their chats and the live sessions. */
  evaluatePending: () => void
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
let chatWatch: (() => void) | null = null

const PENDING_KEY = 'joaxclaw.meetings.pending'
function readPending(): PendingJoin[] {
  try { const v = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? '[]'); return Array.isArray(v) ? v as PendingJoin[] : [] } catch { return [] }
}
function writePending(p: PendingJoin[]) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)) } catch { /* storage unavailable: pending rows last until reload */ }
}
// The Chrome check is per gateway, and survives restarts of the app.
const chromeKey = () => `joaxclaw.meetings.chromeCheck:${useConnectionStore.getState().connection?.url ?? ''}`
function readChromeCheck(): ChromeCheck | null {
  try { const v = JSON.parse(localStorage.getItem(chromeKey()) ?? 'null'); return v && typeof v.checkedAt === 'number' ? v as ChromeCheck : null } catch { return null }
}
function writeChromeCheck(c: ChromeCheck) {
  try { localStorage.setItem(chromeKey(), JSON.stringify(c)) } catch { /* storage unavailable */ }
}

/** Stamp a read as it's sent: the connection it goes out on, and when. */
const stamp = (): ReadStamp => ({ seq: gatewayClient.connectionSeq, atMs: Date.now() })
// A drop while the patch is in flight: the gateway may have taken it and be restarting.
const isDrop = (e: unknown) => /Connection closed|Disconnected|Not connected/i.test(errText(e))

const activeKey = (s: TranscriptStatus | null) => (s?.active ?? []).map(a => a.selector).sort().join('|')

export const useMeetingsStore = create<MeetingsState>((set, get) => {
  /** Poll while the view is open or a meeting is live; otherwise stay quiet. */
  function schedulePoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    const live = (get().status?.active.length ?? 0) > 0 || get().pending.length > 0 || get().stopping.length > 0
    if (!visible && !live) return
    pollTimer = setTimeout(() => { pollTimer = null; void tick() }, pollMs)
  }

  async function tick() {
    if (!gatewayClient.connected) { schedulePoll(); return }
    const before = activeKey(get().status)
    await get().loadStatus()
    get().evaluatePending()
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
    statusRead: null,
    plugins: null,
    captureFallback: null,
    setupRead: null,
    captureRequested: null,
    guestNames: {},
    captureSaving: false,
    captureError: null,
    pending: readPending(),
    pendingViews: {},
    stopping: [],
    chromeCheck: null,
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
      set({ chromeCheck: readChromeCheck() })
      if (get().pending.length) ensureChatWatch()
      void get().loadSetup()
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
      get().evaluatePending()
      schedulePoll()
    },

    async loadStatus() {
      // 2026.8 has the library but not `status`; the view falls back without it.
      if (!gatewayClient.hasMethod('transcripts.status')) { set({ status: null, statusRead: null }); return }
      const at = stamp()
      try {
        const res = await gatewayClient.request<TranscriptStatus>('transcripts.status', {})
        set({ status: res, statusRead: at })
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

    async loadSetup() {
      const at = stamp()
      const [list, snap] = await Promise.all([
        gatewayClient.hasMethod('plugins.list') ? gatewayClient.request<unknown>('plugins.list', {}).catch(() => null) : Promise.resolve(null),
        gatewayClient.request<{ parsed?: unknown; config?: unknown }>('config.get', {}).catch(() => null),
      ])
      const config = snap?.parsed ?? snap?.config ?? null
      const guestNames: Partial<Record<PlatformId, string>> = {}
      for (const p of PLATFORM_LIST) guestNames[p.id] = guestNameFromConfig(config, p)
      set({ plugins: list, guestNames, captureFallback: config ? captureFromConfig(config) : null, setupRead: config ? at : null })
    },

    async setCaptureOn() {
      set({ captureSaving: true, captureError: null })
      // A transcripts.* change has no hot-reload rule, so the gateway restarts to apply it.
      // Say so before it goes away; everything reloads on the next connection.
      const expect = () => useConnectionStore.getState().expectRestart({
        reason: 'Turning on meeting notes',
        detail: 'The gateway restarts to apply the change. It usually takes a few seconds. JoaxClaw reconnects on its own.',
      })
      const patch = async () => {
        const snap = await gatewayClient.request<{ hash?: string }>('config.get', {})
        expect()
        await gatewayClient.request('config.patch', {
          raw: JSON.stringify({ transcripts: { enabled: true } }),
          ...(snap?.hash ? { baseHash: snap.hash } : {}),
        })
      }
      try {
        try { await patch() } catch (e) {
          // Someone else changed the config since we read it: read it again, once.
          if (!/config changed since last load/i.test(errText(e))) throw e
          await patch()
        }
        // Not a read: what we asked for. It shows until a read after the restart has the
        // gateway's word (captureState), instead of the old process's "off".
        set({ captureSaving: false, captureRequested: stamp() })
      } catch (e) {
        // The socket went with the patch in flight: likely the restart it causes. Show the
        // intended state; the first read on the new connection settles it either way.
        if (isDrop(e) && useConnectionStore.getState().restartExpectation) {
          set({ captureSaving: false, captureRequested: stamp() })
          return
        }
        useConnectionStore.getState().clearRestartExpectation()
        set({ captureSaving: false, captureError: errText(e) })
      }
    },

    record({ platform, url, mode, agentId }) {
      const label = PLATFORMS[platform].label
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      // The plugin gets the link Google serves, not whatever shape it was pasted in.
      const link = canonicalMeetingUrl(url)
      const convId = sendViaAgent(buildJoinPrompt(platform, link, mode), undefined, {
        agentId, title: `Notes: ${label} · ${time}`, navigate: false,
      })
      const p: PendingJoin = { id: convId, convId, url: link, platform, agentId, startedAt: Date.now() }
      const pending = [p, ...get().pending]
      writePending(pending)
      set({ pending })
      ensureChatWatch()
      get().evaluatePending()
      schedulePoll()
      return convId
    },

    stop({ pendingId, selector }) {
      const p = get().pending.find(x => x.id === pendingId || (selector && x.selector === selector))
      if (p) {
        // Leave in the chat that joined: that agent knows the session it started.
        void useChatStore.getState().sendMessage(p.convId, buildLeavePrompt(p.platform)).catch(() => {})
        const pending = get().pending.map(x => (x.id === p.id ? { ...x, stoppingAt: Date.now() } : x))
        writePending(pending)
        set({ pending })
      } else if (selector) {
        const s = get().status?.active.find(a => a.selector === selector) ?? get().sessions.find(a => a.selector === selector)
        if (!s) return
        // Not started here: ask the session's own agent (the transcripts tool only lets the
        // owner stop a capture), in the background.
        sendViaAgent(buildStopPrompt(s), undefined, {
          navigate: false, title: `Stop: ${meetingTitle(s)}`, ...(s.agentId ? { agentId: s.agentId } : {}),
        })
        set(st => ({ stopping: [...st.stopping.filter(x => x !== selector), selector] }))
      }
      get().evaluatePending()
      schedulePoll()
    },

    dismissPending(id) {
      const pending = get().pending.filter(p => p.id !== id)
      writePending(pending)
      set(s => {
        const pendingViews = { ...s.pendingViews }
        delete pendingViews[id]
        return { pending, pendingViews }
      })
    },

    runSetupCheck(platforms) {
      const commands = platforms.map(id => PLATFORMS[id].setupCommand)
      const convId = sendViaAgent([
        'Run these setup checks on the gateway host (the machine you are running on) and report what they say, including anything that needs fixing:',
        '',
        '```bash',
        ...commands,
        '```',
      ].join('\n'))
      const check: ChromeCheck = { checkedAt: Date.now(), convId }
      writeChromeCheck(check)
      set({ chromeCheck: check })
      return convId
    },

    markChromeOk() {
      const check: ChromeCheck = { ...(get().chromeCheck ?? { checkedAt: Date.now() }), ok: true }
      writeChromeCheck(check)
      set({ chromeCheck: check })
    },

    evaluatePending() {
      const { pending, status, stopping } = get()
      const active = status?.active ?? []
      // Stop pressed on a live session not started here: done once it's no longer live.
      if (stopping.length && status) {
        const still = stopping.filter(sel => active.some(a => a.selector === sel && a.active))
        if (still.length !== stopping.length) set({ stopping: still })
      }
      if (!pending.length) return
      const convs = useChatStore.getState().conversations
      const hasStatus = gatewayClient.hasMethod('transcripts.status')
      const now = Date.now()
      const views: Record<string, PendingView> = {}
      let next = pending
      const done: string[] = []
      for (const p of pending) {
        const conv = convs.find(c => c.id === p.convId)
        const { join, leaveDone, replyText } = readJoinChat(conv, PLATFORMS[p.platform].tool)
        // Remember when the join first reported OK: the "no notes" warning counts from it.
        const withOk = join?.kind === 'ok' && p.okAt === undefined ? { ...p, okAt: now } : p
        const v = pendingPhase(withOk, { join, replyText, chatKnown: !!conv, active, hasStatus, leaveDone, now })
        if (v.phase === 'done') { done.push(p.id); continue }
        const bound = v.selector && v.selector !== p.selector ? { ...withOk, selector: v.selector } : withOk
        if (bound !== p) next = next.map(x => (x.id === p.id ? bound : x))
        views[p.id] = v
        notifyTransition(p, get().pendingViews[p.id], v)
      }
      if (done.length) next = next.filter(p => !done.includes(p.id))
      if (next !== pending) writePending(next)
      set({ pending: next, pendingViews: views })
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

/**
 * The latest join (and leave) in a joining chat, and the agent's finished reply when it
 * answered without calling the tool (no tool, a refusal, or a send error).
 */
function readJoinChat(conv: { messages: { role: string; content: string; streaming?: boolean; toolCalls?: { name: string; args?: string; result?: string; status: string; error?: string }[] }[] } | undefined, tool: string):
  { join: JoinOutcome | null; leaveDone: boolean; replyText: string | null } {
  if (!conv) return { join: null, leaveDone: false, replyText: null }
  let join: JoinOutcome | null = null
  let leaveDone = false
  for (const m of conv.messages) {
    for (const c of m.toolCalls ?? []) {
      if (c.name !== tool) continue
      const action = toolAction(c)
      if (action === 'leave') { if (c.status === 'done') leaveDone = true; continue }
      join = parseMeetingToolResult(c)
    }
  }
  const last = [...conv.messages].reverse().find(m => m.role === 'assistant')
  const replyText = !join && last && !last.streaming && !(last.toolCalls?.length) ? last.content : null
  return { join, leaveDone, replyText }
}

/** Keep the pending rows current as their chats change (tool events arrive there). */
function ensureChatWatch() {
  if (chatWatch) return
  let last = useChatStore.getState().conversations
  chatWatch = useChatStore.subscribe(s => {
    if (s.conversations === last) return
    last = s.conversations
    if (useMeetingsStore.getState().pending.length) useMeetingsStore.getState().evaluatePending()
  })
}

/** A local notification (PWA, app in the background) when a join needs you or starts. */
function notifyTransition(p: PendingJoin, before: PendingView | undefined, now: PendingView) {
  if (before?.phase === now.phase) return
  const title = `${PLATFORMS[p.platform].label} meeting`
  if (now.phase === 'manual') {
    void notify({ title: 'Meeting needs you', body: `${title}: ${now.text ?? ''}`, tag: `meeting-${p.id}`, navigate: { section: 'meetings' } })
  } else if (now.phase === 'recording' && before && before.phase !== 'recording') {
    void notify({ title: `Taking notes in ${title}`, tag: `meeting-${p.id}`, navigate: { section: 'meetings' } })
  }
}

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
