import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  helloSnapshotReadNoCampaign, helloSnapshotReadCampaign, helloSnapshotNoRead, helloSnapshot2026_6_5, availableFull, scheduleCountdown,
  evAvailableDetailed, evAvailableCleared, evAvailableClearedLegacy, evAvailableLegacy, evCampaignCountdown,
  runResponseHandoffStarted, runResponseRestartDisabled, runResponseAlreadyCurrent, runResponseHandoffUnavailable, runResponse2026_6_5,
  errMissingAdminForRun, errRateLimitedRun, status2026_6_5, statusIdle, RUN_IDS, type GatewayErrorFrame,
  statusNothing, statusActiveRun, evRunChangedValidating, evRunChangedOtherRunRunning, evRunChangedOtherRunTerminal, evRunChangedSequence,
  runValidating, runSucceeded, runRefusedRestartDisabled, runsGetRunning, runsGetRolledBack, runsGetNull, errRestartDraining, errInvalidRunId,
} from './fixtures/sprint/gatewayUpdates'

// The gateway-update store against the real payload shapes (QA fixtures, OpenClaw
// 2026.9.4 and 2026.6.5). The gateway client is faked: each test says what its methods
// answer, and the calls it received are checked.

const h = vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => mem.clear(),
  }
  type Listener = (frame: { event: string; payload?: unknown }) => void
  const client = {
    listeners: [] as Listener[],
    calls: [] as { method: string; params: unknown; timeoutMs?: number }[],
    handlers: {} as Record<string, (params: unknown) => unknown>,
    helloUpdate: {} as { available?: unknown; schedule?: unknown },
    serverVersion: '2026.9.4' as string | undefined,
    connected: true,
    methods: new Set<string>(),
    hasMethod(m: string) { return client.methods.has(m) },
    hasEvent() { return true },
    supports() { return false },
    on(l: Listener) { client.listeners.push(l); return () => {} },
    async request(method: string, params?: unknown, timeoutMs?: number) {
      client.calls.push({ method, params, timeoutMs })
      const handler = client.handlers[method]
      if (!handler) throw new Error(`unknown method: ${method}`)
      return handler(params)
    },
    emit(event: string, payload: unknown) { client.listeners.forEach(l => l({ event, payload })) },
  }
  return { mem, client, sendViaAgent: vi.fn(), notify: vi.fn(async () => {}) }
})

vi.mock('../gateway', () => ({ gatewayClient: h.client }))
vi.mock('../agentPrompt', () => ({ sendViaAgent: h.sendViaAgent }))
vi.mock('../notifications', () => ({ notify: h.notify }))

const { useGatewayUpdateStore } = await import('../../store/gatewayUpdate')
const { useConnectionStore } = await import('../../store/connection')
const { bannerState, refusalCopy, phaseProgress, parseRun } = await import('../gatewayUpdate')

const ADMIN = ['operator.read', 'operator.write', 'operator.admin']
const realExpectRestart = useConnectionStore.getState().expectRestart
const fail = (frame: GatewayErrorFrame) => () => { throw Object.assign(new Error(JSON.stringify(frame.error)), { gatewayError: frame.error }) }
const updateCalls = () => h.client.calls.filter(c => c.method.startsWith('update.'))

const fresh = {
  available: null, schedule: null, checking: false, checkedAtMs: null, error: null, skipped: null, dismissedKey: null,
  confirmOpen: false, pending: false, followed: null, refusal: null, outcome: null, run: null, seen: [] as string[],
}

function connect(scopes: string[], hello: { updateAvailable?: unknown; updateSchedule?: unknown } = {}) {
  h.client.helloUpdate = { available: hello.updateAvailable, schedule: hello.updateSchedule }
  useConnectionStore.setState({ status: 'connected', grantedScopes: scopes, restartExpectation: null, connection: { url: 'ws://studio:18789', token: 't' } })
}

const view = () => {
  const s = useGatewayUpdateStore.getState()
  return bannerState({
    available: s.available, running: s.pending || s.followed ? { target: s.followed?.target } : null,
    refusal: s.refusal, outcome: s.outcome, skipped: s.skipped, dismissedKey: s.dismissedKey,
  })
}

beforeEach(() => {
  h.mem.clear()
  h.client.calls.length = 0
  h.client.handlers = {}
  h.client.methods = new Set(['update.run', 'update.status'])
  h.client.serverVersion = '2026.9.4'
  useGatewayUpdateStore.setState(fresh)
  useConnectionStore.setState({ expectRestart: realExpectRestart })
})

describe('notice for every connection', () => {
  it('a read-only connection sees the hello notice without any update.* call', async () => {
    connect(['operator.read'], helloSnapshotReadNoCampaign)
    await useGatewayUpdateStore.getState().start()
    expect(view()).toMatchObject({ kind: 'available', available: { latestVersion: '2026.9.5' } })
    expect(updateCalls()).toEqual([])
  })

  it('keeps the snapshot schedule, and reads the reduced shape a no-read client gets', () => {
    connect(['operator.read'], helloSnapshotReadCampaign)
    useGatewayUpdateStore.getState().ingestHello()
    expect(useGatewayUpdateStore.getState().schedule?.campaign?.state).toBe('countdown')
    connect([], helloSnapshotNoRead)
    useGatewayUpdateStore.getState().ingestHello()
    expect(useGatewayUpdateStore.getState()).toMatchObject({ available: { currentVersion: '2026.9.4', latestVersion: '2026.9.4', channel: 'dev' }, schedule: null })
  })

  it('subscribes to the update events once, however often it starts', async () => {
    connect(['operator.read'])
    const before = h.client.listeners.length
    await useGatewayUpdateStore.getState().start()
    await useGatewayUpdateStore.getState().start()
    expect(h.client.listeners.length - before).toBeLessThanOrEqual(1)
  })

  it('follows update.available: shows, clears, and keeps a schedule it was not sent', async () => {
    connect(['operator.read'])
    await useGatewayUpdateStore.getState().start()
    h.client.emit('update.available', evAvailableDetailed)
    expect(view().kind).toBe('available')
    h.client.emit('update.available', evCampaignCountdown)
    expect(useGatewayUpdateStore.getState().schedule?.campaign?.id).toBe(scheduleCountdown.campaign!.id)
    // A frame without `schedule` (a connection without read) doesn't clear the known one.
    h.client.emit('update.available', evAvailableLegacy)
    expect(useGatewayUpdateStore.getState().schedule?.campaign?.state).toBe('countdown')
    h.client.emit('update.available', evAvailableCleared)
    expect(view().kind).toBe('hidden')
    h.client.emit('update.available', evAvailableDetailed)
    h.client.emit('update.available', evAvailableClearedLegacy)
    expect(view().kind).toBe('hidden')
  })

  it('a cleared notice leaves a running update or a result alone', () => {
    useGatewayUpdateStore.setState({ available: availableFull, followed: { target: '2026.9.5', startedAtMs: 1 } as never })
    useGatewayUpdateStore.getState().ingestAvailable(evAvailableClearedLegacy)
    expect(view().kind).toBe('running')
    useGatewayUpdateStore.setState({ followed: null, outcome: { kind: 'ok', version: '2026.9.5' } })
    useGatewayUpdateStore.getState().ingestAvailable(evAvailableClearedLegacy)
    expect(view().kind).toBe('result')
  })

  it("2026.6.5's update.status ({sentinel} only) doesn't wipe the snapshot's notice", async () => {
    connect(ADMIN, helloSnapshot2026_6_5)
    h.client.handlers['update.status'] = () => status2026_6_5
    await useGatewayUpdateStore.getState().start()
    await vi.waitFor(() => expect(useGatewayUpdateStore.getState().checking).toBe(false))
    expect(useGatewayUpdateStore.getState().available?.latestVersion).toBe('2026.9.4')
  })

  it('admin on 2026.9 takes update.status as the fresher word', async () => {
    connect(ADMIN, {})
    h.client.handlers['update.status'] = () => statusIdle
    await useGatewayUpdateStore.getState().check(true)
    expect(useGatewayUpdateStore.getState().available?.latestVersion).toBe('2026.9.5')
    expect(h.client.calls.find(c => c.method === 'update.status')?.params).toEqual({})
  })
})

describe('update.run', () => {
  beforeEach(() => {
    connect(ADMIN, { updateAvailable: availableFull })
    useGatewayUpdateStore.getState().ingestHello()
  })

  it('arms the restart expectation, then calls update.run once with only a note and a 15 min timeout', async () => {
    const order: string[] = []
    const spy = vi.fn(realExpectRestart)
    useConnectionStore.setState({ expectRestart: (input) => { order.push('expect'); spy(input) } })
    h.client.handlers['update.run'] = () => { order.push('run'); return runResponseHandoffStarted }
    const now = Date.now()
    await useGatewayUpdateStore.getState().runUpdate()
    expect(order).toEqual(['expect', 'run'])
    const arg = spy.mock.calls[0][0] as { reason: string; detail: string; windowMs: number; untilMs: number }
    expect(arg).toMatchObject({ reason: 'Gateway is updating', detail: 'Updating to 2026.9.5. JoaxClaw reconnects on its own.', windowMs: 600_000 })
    expect(arg.untilMs - now).toBeGreaterThanOrEqual(900_000 - 50)
    const run = h.client.calls.filter(c => c.method === 'update.run')
    expect(run).toEqual([{ method: 'update.run', params: { note: 'Started from JoaxClaw' }, timeoutMs: 900_000 }])
  })

  it('a started handoff is followed by its runId, persisted, and stays running', async () => {
    h.client.handlers['update.run'] = () => runResponseHandoffStarted
    await useGatewayUpdateStore.getState().runUpdate()
    expect(useGatewayUpdateStore.getState().followed?.runId).toBe(RUN_IDS.ours)
    expect(JSON.parse(h.mem.get('joaxclaw-gateway-update-run')!).runId).toBe(RUN_IDS.ours)
    expect(view().kind).toBe('running')
  })

  it('is single-flight', async () => {
    let release!: (v: unknown) => void
    h.client.handlers['update.run'] = () => new Promise(r => { release = r })
    const first = useGatewayUpdateStore.getState().runUpdate()
    await useGatewayUpdateStore.getState().runUpdate()
    release(runResponseHandoffStarted)
    await first
    await useGatewayUpdateStore.getState().runUpdate()
    expect(h.client.calls.filter(c => c.method === 'update.run')).toHaveLength(1)
  })

  it('a refusal shows its copy and clears the restart expectation', async () => {
    h.client.handlers['update.run'] = () => runResponseRestartDisabled
    await useGatewayUpdateStore.getState().runUpdate()
    const v = view()
    expect(v.kind).toBe('refused')
    expect(refusalCopy((v as { refusal: { reason: string } }).refusal).text).toMatch(/restarts are turned off/)
    expect(useConnectionStore.getState().restartExpectation).toBeNull()
    expect(useGatewayUpdateStore.getState().followed).toBeNull()
  })

  it('an unavailable handoff offers the command the gateway gave', async () => {
    h.client.handlers['update.run'] = () => runResponseHandoffUnavailable
    await useGatewayUpdateStore.getState().runUpdate()
    expect(refusalCopy(useGatewayUpdateStore.getState().refusal!)).toMatchObject({ action: 'command', command: 'openclaw update --yes --json' })
  })

  it('already-current is a result, not a refusal', async () => {
    h.client.handlers['update.run'] = () => runResponseAlreadyCurrent
    await useGatewayUpdateStore.getState().runUpdate()
    expect(view()).toMatchObject({ kind: 'result', outcome: { kind: 'already-current', version: '2026.9.4' } })
    expect(useConnectionStore.getState().restartExpectation).toBeNull()
  })

  it("a failed call shows the gateway's message, not the stringified error", async () => {
    h.client.handlers['update.run'] = fail(errMissingAdminForRun)
    await useGatewayUpdateStore.getState().runUpdate()
    expect(refusalCopy(useGatewayUpdateStore.getState().refusal!).text).toBe('missing scope: operator.admin.')
  })

  it('reads the rate limit', async () => {
    h.client.handlers['update.run'] = fail(errRateLimitedRun)
    await useGatewayUpdateStore.getState().runUpdate()
    expect(refusalCopy(useGatewayUpdateStore.getState().refusal!).text).toBe('The gateway is busy. Try again in 37s.')
  })

  it('a drop before the reply is expected: no refusal, still following', async () => {
    h.client.handlers['update.run'] = () => { throw new Error('Connection closed') }
    await useGatewayUpdateStore.getState().runUpdate()
    const s = useGatewayUpdateStore.getState()
    expect(s.refusal).toBeNull()
    expect(s.pending).toBe(false)
    expect(s.followed).toMatchObject({ target: '2026.9.5' })
    expect(view().kind).toBe('running')
  })

  it('a timeout is an error, and stops expecting a restart', async () => {
    h.client.handlers['update.run'] = () => { throw new Error('Request update.run timed out') }
    await useGatewayUpdateStore.getState().runUpdate()
    expect(useGatewayUpdateStore.getState().refusal).toEqual({ reason: 'rpc-error', message: 'Request update.run timed out' })
    expect(useConnectionStore.getState().restartExpectation).toBeNull()
  })

  it('2026.6.5 sends no runId: it runs until the restart, then the version tells', async () => {
    h.client.handlers['update.run'] = () => runResponse2026_6_5
    await useGatewayUpdateStore.getState().runUpdate()
    expect(useGatewayUpdateStore.getState().followed).toMatchObject({ target: '2026.9.5' })
    expect(useGatewayUpdateStore.getState().followed?.runId).toBeUndefined()
    expect(view().kind).toBe('running')
  })
})

describe('the Update button without admin', () => {
  it('write-only hands the update to an agent, unchanged', async () => {
    connect(['operator.read', 'operator.write'], { updateAvailable: availableFull })
    useGatewayUpdateStore.getState().beginUpdate()
    await vi.waitFor(() => expect(h.sendViaAgent).toHaveBeenCalled())
    expect(h.sendViaAgent.mock.calls[0][0]).toContain('openclaw update --yes --no-restart')
    expect(updateCalls()).toEqual([])
  })

  it('admin without update.run advertised also goes via an agent', () => {
    connect(ADMIN)
    h.client.methods = new Set()
    h.sendViaAgent.mockClear()
    useGatewayUpdateStore.getState().beginUpdate()
    expect(useGatewayUpdateStore.getState().confirmOpen).toBe(false)
  })

  it('admin opens the confirm and sends nothing', () => {
    connect(ADMIN)
    useGatewayUpdateStore.getState().beginUpdate()
    expect(useGatewayUpdateStore.getState().confirmOpen).toBe(true)
    useGatewayUpdateStore.getState().closeConfirm()
    expect(updateCalls()).toEqual([])
  })
})

describe('after the restart', () => {
  it('judges an update it could not follow by the version the gateway came back on', async () => {
    connect(['operator.read', 'operator.write'])
    useGatewayUpdateStore.setState({ followed: { target: '2026.9.5', url: 'ws://studio:18789', startedAtMs: 1 } as never })
    h.client.serverVersion = '2026.9.5'
    await useGatewayUpdateStore.getState().start()
    expect(view()).toMatchObject({ kind: 'result', outcome: { kind: 'ok', version: '2026.9.5' } })
    useGatewayUpdateStore.setState({ outcome: null, followed: { target: '2026.9.5', url: 'ws://studio:18789', startedAtMs: 1 } as never })
    h.client.serverVersion = '2026.9.4'
    await useGatewayUpdateStore.getState().start()
    expect(view()).toMatchObject({ kind: 'result', outcome: { kind: 'back-on', version: '2026.9.4' } })
  })

  it('forgets an update started on another gateway', async () => {
    connect(['operator.read'])
    useGatewayUpdateStore.setState({ followed: { target: '2026.9.5', url: 'ws://elsewhere:18789', startedAtMs: 1 } as never })
    await useGatewayUpdateStore.getState().start()
    expect(useGatewayUpdateStore.getState()).toMatchObject({ followed: null, outcome: null })
  })
})

// ── Following a run (02-b) ──────────────────────────────────────────────────────────

const OURS = { runId: RUN_IDS.ours, target: '2026.9.5', url: 'ws://studio:18789', startedAtMs: 1, own: true }
const RUN_METHODS = ['update.run', 'update.status', 'update.runs.get']

describe('following a run', () => {
  beforeEach(() => {
    connect(ADMIN, { updateAvailable: availableFull })
    h.client.methods = new Set(RUN_METHODS)
    h.client.handlers['update.status'] = () => statusNothing
    h.notify.mockClear()
  })

  it('moves the phase line with update.run.changed', async () => {
    await useGatewayUpdateStore.getState().start()
    useGatewayUpdateStore.setState({ followed: OURS })
    h.client.emit('update.run.changed', evRunChangedValidating)
    const p = phaseProgress(useGatewayUpdateStore.getState().run)
    expect(p).toMatchObject({ currentLabel: 'Validating', completed: 1, total: 5 })
  })

  it("ignores other runs while following one; follows a running one when it follows nothing", async () => {
    await useGatewayUpdateStore.getState().start()
    useGatewayUpdateStore.setState({ followed: OURS })
    h.client.emit('update.run.changed', evRunChangedOtherRunRunning)
    expect(useGatewayUpdateStore.getState().run).toBeNull()
    useGatewayUpdateStore.setState({ followed: null })
    h.client.emit('update.run.changed', evRunChangedOtherRunTerminal)
    expect(useGatewayUpdateStore.getState().followed).toBeNull()
    h.client.handlers['update.runs.get'] = () => ({ run: null })
    h.client.emit('update.run.changed', evRunChangedOtherRunRunning)
    expect(useGatewayUpdateStore.getState().followed).toMatchObject({ runId: RUN_IDS.cli, own: false })
  })

  it('re-arms the restart expectation when the run activates, once per phase', async () => {
    await useGatewayUpdateStore.getState().start()
    useGatewayUpdateStore.setState({ followed: OURS, run: parseRun(runValidating) })
    const spy = vi.fn(realExpectRestart)
    useConnectionStore.setState({ expectRestart: spy })
    h.client.emit('update.run.changed', evRunChangedSequence[4])
    h.client.emit('update.run.changed', { ...evRunChangedSequence[4], updatedAtMs: evRunChangedSequence[4].updatedAtMs + 1 })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatchObject({ reason: 'Gateway is updating', detail: 'Updating to 2026.9.5 · Activating. Update progress is saved on the gateway.' })
  })

  it('polls update.runs.get every 2 s while running, through the restart drain, and stops at the end', async () => {
    vi.useFakeTimers()
    try {
      await useGatewayUpdateStore.getState().start()
      let answer: () => unknown = () => ({ run: runValidating })
      h.client.handlers['update.runs.get'] = () => answer()
      h.client.handlers['update.run'] = () => runResponseHandoffStarted
      await useGatewayUpdateStore.getState().runUpdate()
      const gets = () => h.client.calls.filter(c => c.method === 'update.runs.get').length
      const n0 = gets()
      await vi.advanceTimersByTimeAsync(2000)
      expect(gets()).toBe(n0 + 1)
      answer = fail(errRestartDraining)
      await vi.advanceTimersByTimeAsync(2000)
      expect(useGatewayUpdateStore.getState().refusal).toBeNull()
      expect(view().kind).toBe('running')
      answer = () => ({ run: runSucceeded })
      await vi.advanceTimersByTimeAsync(2000)
      expect(view()).toMatchObject({ kind: 'result', outcome: { kind: 'ok', version: '2026.9.5', downtimeMs: 38_000 } })
      const after = gets()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(gets()).toBe(after)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the result after the reconnect', () => {
  beforeEach(() => {
    connect(ADMIN)
    h.client.methods = new Set(RUN_METHODS)
    h.client.handlers['update.status'] = () => statusNothing
    h.notify.mockClear()
  })

  it('keeps following a run that is still going', async () => {
    useGatewayUpdateStore.setState({ followed: OURS })
    h.client.handlers['update.runs.get'] = () => runsGetRunning
    await useGatewayUpdateStore.getState().start()
    expect(h.client.calls.find(c => c.method === 'update.runs.get')?.params).toEqual({ runId: RUN_IDS.ours })
    expect(useGatewayUpdateStore.getState().run?.phase).toBe('restarting')
    expect(useGatewayUpdateStore.getState().followed).not.toBeNull()
  })

  it('shows a rollback once, and not again after a reload', async () => {
    const followed = { ...OURS, runId: RUN_IDS.oursRolledBack }
    useGatewayUpdateStore.setState({ followed })
    h.client.handlers['update.runs.get'] = () => runsGetRolledBack
    await useGatewayUpdateStore.getState().start()
    expect(view()).toMatchObject({ kind: 'result', outcome: { kind: 'rolled-back', target: '2026.9.3', before: '2026.9.2' } })
    expect(JSON.parse(h.mem.get('joaxclaw-gateway-update-seen')!)).toContain(RUN_IDS.oursRolledBack)
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Gateway update failed', navigate: { section: 'gateway' } }))
    // A reload: the same followed run, the seen list from storage.
    useGatewayUpdateStore.setState({ ...fresh, followed, seen: JSON.parse(h.mem.get('joaxclaw-gateway-update-seen')!) })
    await useGatewayUpdateStore.getState().start()
    expect(useGatewayUpdateStore.getState().outcome).toBeNull()
  })

  it('run:null falls back to the version, and stops following', async () => {
    useGatewayUpdateStore.setState({ followed: OURS })
    h.client.handlers['update.runs.get'] = () => runsGetNull
    h.client.serverVersion = '2026.9.4'
    await useGatewayUpdateStore.getState().start()
    expect(useGatewayUpdateStore.getState()).toMatchObject({ followed: null, outcome: { kind: 'back-on', version: '2026.9.4' } })
  })

  it('a corrupt stored runId is never sent, and is treated as gone', async () => {
    useGatewayUpdateStore.setState({ followed: { ...OURS, runId: 'not-a-uuid' } })
    h.client.handlers['update.runs.get'] = fail(errInvalidRunId)
    await useGatewayUpdateStore.getState().start()
    expect(h.client.calls.some(c => c.method === 'update.runs.get')).toBe(false)
    expect(useGatewayUpdateStore.getState().followed).toBeNull()
  })

  it('without update.runs.get, reads the run from update.status', async () => {
    h.client.methods = new Set(['update.run', 'update.status'])
    useGatewayUpdateStore.setState({ followed: OURS })
    h.client.handlers['update.status'] = () => ({ ...statusNothing, lastRun: runSucceeded })
    await useGatewayUpdateStore.getState().start()
    expect(view()).toMatchObject({ kind: 'result', outcome: { kind: 'ok', version: '2026.9.5' } })
  })

  it('finds the run whose reply was lost in the drop', async () => {
    useGatewayUpdateStore.setState({ followed: { target: '2026.9.5', url: 'ws://studio:18789', startedAtMs: runValidating.createdAtMs - 1000, own: true } })
    h.client.handlers['update.status'] = () => statusActiveRun
    h.client.handlers['update.runs.get'] = () => runsGetRunning
    await useGatewayUpdateStore.getState().start()
    expect(useGatewayUpdateStore.getState().followed?.runId).toBe(RUN_IDS.ours)
    expect(view().kind).toBe('running')
  })

  it('a run that was refused reads as its refusal', async () => {
    useGatewayUpdateStore.setState({ followed: { ...OURS, runId: RUN_IDS.refused } })
    h.client.handlers['update.runs.get'] = () => ({ run: runRefusedRestartDisabled })
    await useGatewayUpdateStore.getState().start()
    expect(view()).toMatchObject({ kind: 'refused', refusal: { reason: 'restart-disabled' } })
  })

  it('without admin, the version is all there is', async () => {
    connect(['operator.read', 'operator.write'])
    useGatewayUpdateStore.setState({ followed: OURS })
    h.client.serverVersion = '2026.9.5'
    await useGatewayUpdateStore.getState().start()
    expect(updateCalls()).toEqual([])
    expect(view()).toMatchObject({ kind: 'result', outcome: { kind: 'ok', version: '2026.9.5' } })
  })
})
