import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as F from './fixtures/sprint/meetings'

// The recording side of the meetings store: joining through an agent, following the
// join in its chat, stopping, and turning capture on. Gateway, agent hand-off, chat and
// connection stores are stubbed.

type Handler = (params: Record<string, unknown>) => unknown
const handlers: Record<string, Handler> = {}
const calls: { method: string; params: Record<string, unknown> }[] = []
const sent: { prompt: string; opts: Record<string, unknown> | undefined }[] = []
const chatSends: { convId: string; text: string }[] = []
const expectations: unknown[] = []

vi.mock('../gateway', () => ({
  gatewayClient: {
    connected: true,
    connectionSeq: 1,
    hasMethod: () => true,
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params })
      const h = handlers[method]
      if (!h) throw new Error(`unexpected ${method}`)
      return h(params)
    },
  },
}))
vi.mock('../agentPrompt', () => ({
  sendViaAgent: (prompt: string, _open: unknown, opts?: Record<string, unknown>) => { sent.push({ prompt, opts }); return `conv-${sent.length}` },
}))
vi.mock('../notifications', () => ({ notify: vi.fn(async () => {}) }))
vi.mock('../../store/chat', async () => {
  const { create } = await import('zustand')
  const store = create<{ conversations: unknown[]; sendMessage: (id: string, t: string) => Promise<void>; selectConversation: () => void }>(() => ({
    conversations: [],
    sendMessage: async (convId: string, text: string) => { chatSends.push({ convId, text }) },
    selectConversation: () => {},
  }))
  return { useChatStore: store }
})
vi.mock('../../store/connection', async () => {
  const { create } = await import('zustand')
  return {
    useConnectionStore: create(() => ({
      connection: { url: 'wss://gw.example.ts.net' },
      expectRestart: (x: unknown) => { expectations.push(x) },
      clearRestartExpectation: () => { expectations.length = 0 },
    })),
  }
})

const { useMeetingsStore } = await import('../../store/meetings')
const { useChatStore } = await import('../../store/chat')
const { useConnectionStore } = await import('../../store/connection')
const { gatewayClient } = await import('../gateway')
const { captureState } = await import('../meetings')
const { notify } = await import('../notifications')

const gwError = (message: string) => Object.assign(new Error(JSON.stringify({ code: 'INVALID_REQUEST', message })), { gatewayError: { code: 'INVALID_REQUEST', message } })
const assistant = (toolCalls: unknown[], content = '') => ({ id: 'a', role: 'assistant', content, streaming: false, toolCalls })
const setChat = (convId: string, messages: unknown[]) => useChatStore.setState({ conversations: [{ id: convId, messages }] } as never)

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k]
  calls.length = 0; sent.length = 0; chatSends.length = 0; expectations.length = 0
  useChatStore.setState({ conversations: [] } as never)
  useMeetingsStore.setState({ pending: [], pendingViews: {}, stopping: [], status: F.STATUS_FRESH as never, statusRead: null, captureRequested: null, captureError: null })
  useConnectionStore.setState({ restartExpectation: null } as never)
  ;(gatewayClient as { connectionSeq: number }).connectionSeq = 1
  vi.mocked(notify).mockClear()
})

describe('record', () => {
  it('sends the join to the chosen agent in the background, and adds a pending row', () => {
    const convId = useMeetingsStore.getState().record({ platform: 'zoom', url: 'https://zoom.us/j/81234567890?pwd=AbC123xyz', mode: 'transcribe', agentId: 'ops' })
    expect(sent[0].prompt).toContain('`zoom_meetings` tool with action "join", url "https://zoom.us/j/81234567890?pwd=AbC123xyz", mode "transcribe"')
    expect(sent[0].opts).toMatchObject({ agentId: 'ops', navigate: false })
    expect(String(sent[0].opts?.title)).toMatch(/^Notes: Zoom · /)
    expect(useMeetingsStore.getState().pending[0]).toMatchObject({ convId, platform: 'zoom', agentId: 'ops' })
    expect(useMeetingsStore.getState().pendingViews[convId].phase).toBe('joining')
  })

  it('follows the join in its chat: lobby, then live', () => {
    const convId = useMeetingsStore.getState().record({ platform: 'meet', url: 'https://meet.google.com/xyz-abcd-efg', mode: 'transcribe', agentId: 'main' })
    setChat(convId, [assistant([{ ...F.TOOLCALL_MEET_JOIN_MANUAL, args: JSON.stringify({ action: 'join', url: 'https://meet.google.com/xyz-abcd-efg', mode: 'transcribe' }) }])])
    expect(useMeetingsStore.getState().pendingViews[convId]).toMatchObject({ phase: 'manual' })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Meeting needs you', navigate: { section: 'meetings' } }))
    // Admitted: the tool says OK and the gateway lists a live session on that link.
    useMeetingsStore.setState({ status: { ...F.STATUS_FRESH, active: [F.SESSION_MEET_ACTIVE] } as never })
    setChat(convId, [assistant([F.TOOLCALL_MEET_JOIN_OK])])
    expect(useMeetingsStore.getState().pendingViews[convId]).toEqual({ phase: 'recording', selector: F.SESSION_MEET_ACTIVE.selector })
    expect(useMeetingsStore.getState().pending[0].selector).toBe(F.SESSION_MEET_ACTIVE.selector)
  })

  it('fails when the agent has no meeting tool', () => {
    const convId = useMeetingsStore.getState().record({ platform: 'teams', url: 'https://teams.live.com/meet/9387654321098', mode: 'transcribe', agentId: 'main' })
    setChat(convId, [assistant([], 'MEETING_TOOL_MISSING')])
    expect(useMeetingsStore.getState().pendingViews[convId]).toEqual({ phase: 'failed', text: "The agent doesn't have the meeting tool." })
  })
})

describe('stop', () => {
  it('leaves in the joining chat, and the row goes once the session is no longer live', () => {
    const convId = useMeetingsStore.getState().record({ platform: 'meet', url: 'https://meet.google.com/xyz-abcd-efg', mode: 'transcribe', agentId: 'main' })
    useMeetingsStore.setState({ status: { ...F.STATUS_FRESH, active: [F.SESSION_MEET_ACTIVE] } as never })
    setChat(convId, [assistant([F.TOOLCALL_MEET_JOIN_OK])])
    useMeetingsStore.getState().stop({ selector: F.SESSION_MEET_ACTIVE.selector })
    expect(chatSends).toEqual([{ convId, text: 'Use the `google_meet` tool with action "leave" for this meeting. Reply with the result only.' }])
    expect(useMeetingsStore.getState().pendingViews[convId].phase).toBe('stopping')
    useMeetingsStore.setState({ status: F.STATUS_FRESH as never })
    useMeetingsStore.getState().evaluatePending()
    expect(useMeetingsStore.getState().pending).toEqual([])
  })

  it('asks the owning agent to stop a meeting that was not started here', () => {
    useMeetingsStore.setState({ status: { ...F.STATUS_FRESH, active: [F.SESSION_MEET_ACTIVE] } as never })
    useMeetingsStore.getState().stop({ selector: F.SESSION_MEET_ACTIVE.selector })
    expect(sent[0].prompt).toContain('action "leave" for the meeting at "https://meet.google.com/xyz-abcd-efg"')
    expect(sent[0].opts).toMatchObject({ navigate: false, agentId: 'main' })
    expect(useMeetingsStore.getState().stopping).toEqual([F.SESSION_MEET_ACTIVE.selector])
  })
})

describe('capture', () => {
  it('expects the restart, then patches with a fresh baseHash, retrying once on a stale one', async () => {
    let n = 0
    handlers['config.get'] = () => ({ hash: `h${++n}` })
    let patches = 0
    handlers['config.patch'] = () => { if (++patches === 1) throw gwError('config changed since last load; re-run config.get and retry'); return { ok: true } }
    await useMeetingsStore.getState().setCaptureOn()
    const patchCalls = calls.filter(c => c.method === 'config.patch').map(c => c.params)
    expect(patchCalls).toEqual([
      { raw: JSON.stringify({ transcripts: { enabled: true } }), baseHash: 'h1' },
      { raw: JSON.stringify({ transcripts: { enabled: true } }), baseHash: 'h2' },
    ])
    expect(expectations[0]).toMatchObject({ reason: 'Turning on meeting notes' })
    expect(useMeetingsStore.getState().captureError).toBeNull()
  })
  // QA: ~2 s of "Meeting notes are off" after the restart it causes.
  it('records the request instead of faking a read, and reads after the restart settle it', async () => {
    handlers['config.get'] = () => ({ hash: 'h' })
    handlers['config.patch'] = () => ({ ok: true })
    handlers['transcripts.status'] = () => ({ ...F.STATUS_FRESH, enabled: false })
    await useMeetingsStore.getState().loadStatus()
    await useMeetingsStore.getState().setCaptureOn()
    const cur = () => {
      const s = useMeetingsStore.getState()
      return captureState({
        status: s.status && s.statusRead ? { value: s.status.enabled, ...s.statusRead } : null,
        config: null, connectionSeq: (gatewayClient as { connectionSeq: number }).connectionSeq, requested: s.captureRequested,
      })
    }
    expect(useMeetingsStore.getState().captureRequested).toMatchObject({ seq: 1 })
    expect(cur()).toBe(true)
    // The restart: a new connection, its first status not in yet. The stale "off" stays hidden.
    ;(gatewayClient as { connectionSeq: number }).connectionSeq = 2
    expect(cur()).toBe(true)
    handlers['transcripts.status'] = () => ({ ...F.STATUS_FRESH, enabled: true })
    await useMeetingsStore.getState().loadStatus()
    expect(useMeetingsStore.getState().statusRead).toMatchObject({ seq: 2 })
    expect(cur()).toBe(true)
  })

  it('a drop with the patch in flight is the restart: the intended state, no error', async () => {
    handlers['config.get'] = () => { useConnectionStore.setState({ restartExpectation: { reason: 'x' } } as never); return { hash: 'h' } }
    handlers['config.patch'] = () => { throw new Error('Connection closed') }
    await useMeetingsStore.getState().setCaptureOn()
    expect(useMeetingsStore.getState().captureError).toBeNull()
    expect(useMeetingsStore.getState().captureRequested).not.toBeNull()
    expect(useMeetingsStore.getState().captureSaving).toBe(false)
  })

  it('clears the expectation when the patch fails', async () => {
    handlers['config.get'] = () => ({ hash: 'h' })
    handlers['config.patch'] = () => { throw gwError('missing scope: operator.admin') }
    await useMeetingsStore.getState().setCaptureOn()
    expect(expectations).toEqual([])
    expect(useMeetingsStore.getState().captureError).toBe('missing scope: operator.admin')
  })
})
