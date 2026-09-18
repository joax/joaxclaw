import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as F from './fixtures/sprint/meetings'

// The meetings store against a mocked gateway: which calls it makes, with which params,
// and when it polls. The gateway, the agent hand-off and the chat store are stubbed.

type Handler = (params: Record<string, unknown>) => unknown
const handlers: Record<string, Handler> = {}
const calls: { method: string; params: Record<string, unknown> }[] = []
let methods = new Set<string>()
const sent: { prompt: string; opts: unknown }[] = []

vi.mock('../gateway', () => ({
  gatewayClient: {
    connected: true,
    hasMethod: (m: string) => methods.has(m),
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params })
      const h = handlers[method]
      if (!h) throw new Error(`unexpected ${method}`)
      return h(params)
    },
  },
}))
vi.mock('../agentPrompt', () => ({
  sendViaAgent: (prompt: string, _open: unknown, opts: unknown) => { sent.push({ prompt, opts }); return 'conv-1' },
}))
vi.mock('../../store/chat', () => ({ useChatStore: { getState: () => ({ selectConversation: () => {} }) } }))

const { useMeetingsStore } = await import('../../store/meetings')

const gwError = (e: { code: string; message: string; details?: unknown }) =>
  Object.assign(new Error(JSON.stringify(e)), { gatewayError: e })
const ALL = ['transcripts.list', 'transcripts.get', 'transcripts.export', 'transcripts.status']
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  for (const k of Object.keys(handlers)) delete handlers[k]
  calls.length = 0
  sent.length = 0
  methods = new Set(ALL)
  useMeetingsStore.getState().setVisible(false)
  useMeetingsStore.setState({ sessions: [], status: null, query: '', provider: null, selected: null, detail: null, summarizing: null, nextCursor: null })
  handlers['transcripts.status'] = () => F.STATUS_FRESH
  handlers['transcripts.list'] = p => (p.cursor ? F.LIST_RESULT_LAST_PAGE : F.LIST_RESULT_PAGE1)
})
afterEach(() => { useMeetingsStore.getState().setVisible(false); vi.useRealTimers() })

const listCalls = () => calls.filter(c => c.method === 'transcripts.list').map(c => c.params)

describe('library', () => {
  it('asks for the first page with exactly { limit: 50 }', async () => {
    await useMeetingsStore.getState().load()
    expect(listCalls()).toEqual([F.LIST_PARAMS_FIRST_PAGE])
    expect(useMeetingsStore.getState().nextCursor).toBe(F.LIST_NEXT_CURSOR)
  })
  it('Load more keeps the filters and appends', async () => {
    useMeetingsStore.setState({ query: 'pricing' })
    await useMeetingsStore.getState().load()
    await useMeetingsStore.getState().loadMore()
    expect(listCalls()[1]).toEqual({ limit: 50, query: 'pricing', cursor: F.LIST_NEXT_CURSOR })
    expect(useMeetingsStore.getState().sessions).toHaveLength(F.LIST_RESULT_PAGE1.sessions.length + 1)
    expect(useMeetingsStore.getState().nextCursor).toBeNull()
  })
  it('a provider filter sends the canonical id and starts again from page 1', async () => {
    useMeetingsStore.getState().setProvider('zoom')
    await flush()
    expect(listCalls().at(-1)).toEqual(F.LIST_PARAMS_PROVIDER)
  })
  it('reloads from page 1 on a stale cursor', async () => {
    await useMeetingsStore.getState().load()
    handlers['transcripts.list'] = p => { if (p.cursor) throw gwError(F.ERR_INVALID_CURSOR); return F.LIST_RESULT_PAGE1 }
    await useMeetingsStore.getState().loadMore()
    await flush()
    expect(listCalls().at(-1)).toEqual(F.LIST_PARAMS_FIRST_PAGE)
  })
  it('shows the archive as restricted on a role denial', async () => {
    handlers['transcripts.list'] = () => { throw gwError(F.ERR_ARCHIVE_FORBIDDEN) }
    await useMeetingsStore.getState().load()
    expect(useMeetingsStore.getState().listError?.kind).toBe('forbidden')
  })
  it('on 2026.8 (no status) never calls transcripts.status', async () => {
    methods = new Set(['transcripts.list', 'transcripts.get'])
    await useMeetingsStore.getState().load()
    useMeetingsStore.getState().setVisible(true)
    vi.advanceTimersByTime(30_000)
    await flush()
    expect(calls.some(c => c.method === 'transcripts.status')).toBe(false)
  })
})

describe('polling', () => {
  it('polls status every 10 s while visible, and stops when hidden with nothing live', async () => {
    await useMeetingsStore.getState().load()
    useMeetingsStore.getState().setVisible(true)
    const statusCalls = () => calls.filter(c => c.method === 'transcripts.status').length
    const before = statusCalls()
    vi.advanceTimersByTime(10_000)
    await flush()
    expect(statusCalls()).toBe(before + 1)
    useMeetingsStore.getState().setVisible(false)
    vi.advanceTimersByTime(60_000)
    await flush()
    expect(statusCalls()).toBe(before + 1)
  })
  it('keeps polling while hidden if a meeting is live', async () => {
    handlers['transcripts.status'] = () => F.STATUS_BUSY
    await useMeetingsStore.getState().load()
    useMeetingsStore.getState().setVisible(false)
    const before = calls.filter(c => c.method === 'transcripts.status').length
    vi.advanceTimersByTime(10_000)
    await flush()
    expect(calls.filter(c => c.method === 'transcripts.status').length).toBe(before + 1)
  })
  it('uses 15 s on a phone', async () => {
    await useMeetingsStore.getState().load()
    useMeetingsStore.getState().setVisible(true, true)
    const before = calls.filter(c => c.method === 'transcripts.status').length
    vi.advanceTimersByTime(10_000)
    await flush()
    expect(calls.filter(c => c.method === 'transcripts.status').length).toBe(before)
    vi.advanceTimersByTime(5_000)
    await flush()
    expect(calls.filter(c => c.method === 'transcripts.status').length).toBe(before + 1)
  })
})

describe('reader', () => {
  it('opens with { selector } only, and the transcript always sends a limit', async () => {
    handlers['transcripts.get'] = p => (p.includeUtterances ? F.GET_RESULT_UTTERANCES_PAGE1 : F.GET_RESULT_WITH_SUMMARY)
    await useMeetingsStore.getState().open(F.SESSION_MEET_DONE.selector)
    expect(calls.at(-1)?.params).toEqual(F.GET_PARAMS_SUMMARY)
    useMeetingsStore.getState().setTab('transcript')
    await flush()
    expect(calls.at(-1)?.params).toEqual({ selector: F.SESSION_MEET_DONE.selector, includeUtterances: true, limit: 50 })
    await useMeetingsStore.getState().loadUtterances(true)
    expect(calls.at(-1)?.params).toMatchObject({ limit: 50, cursor: F.GET_NEXT_CURSOR })
  })
  it('maps a too-large export to the host-command state', async () => {
    handlers['transcripts.get'] = () => F.GET_RESULT_WITH_SUMMARY
    handlers['transcripts.export'] = () => { throw gwError(F.ERR_EXPORT_TOO_LARGE) }
    await useMeetingsStore.getState().open(F.SESSION_MEET_DONE.selector)
    await useMeetingsStore.getState().downloadAs('markdown')
    expect(calls.at(-1)).toEqual({ method: 'transcripts.export', params: F.EXPORT_PARAMS_MD })
    expect(useMeetingsStore.getState().download).toEqual({ state: 'tooLarge' })
  })
})

describe('summarize', () => {
  it('asks the owning agent, in the background, then shows the summary when it lands', async () => {
    let n = 0
    handlers['transcripts.get'] = () => (n++ < 2 ? F.GET_RESULT_NO_SUMMARY : F.GET_RESULT_AFTER_SUMMARIZE)
    await useMeetingsStore.getState().open(F.SESSION_IMPORTED_NO_SUMMARY.selector)
    useMeetingsStore.getState().summarize()
    expect(sent[0].prompt).toBe(`Use the transcripts tool with action "summarize" and selector "${F.SESSION_IMPORTED_NO_SUMMARY.selector}". Reply "done" when finished.`)
    expect(sent[0].opts).toMatchObject({ navigate: false, agentId: 'main' })
    vi.advanceTimersByTime(5_000); await flush()
    expect(useMeetingsStore.getState().summarizing).not.toBeNull()
    vi.advanceTimersByTime(5_000); await flush()
    expect(useMeetingsStore.getState().summarizing).toBeNull()
    expect(useMeetingsStore.getState().detail?.summary?.overview).toBe('Board prep: runway, hiring plan.')
  })
  it('says it is slow after 2 minutes', async () => {
    handlers['transcripts.get'] = () => F.GET_RESULT_NO_SUMMARY
    await useMeetingsStore.getState().open(F.SESSION_IMPORTED_NO_SUMMARY.selector)
    useMeetingsStore.getState().summarize()
    for (let i = 0; i < 25; i++) { vi.advanceTimersByTime(5_000); await flush() }
    expect(useMeetingsStore.getState().summarizing?.slow).toBe(true)
  })
})
