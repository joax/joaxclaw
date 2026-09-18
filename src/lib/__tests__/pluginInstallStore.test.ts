import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The install store's phase machine, against a mocked gateway client and connection
// store. The real ones open sockets and persist to localStorage; what matters here is the
// order of calls and the phases in between.

type Handler = (params: Record<string, unknown>) => unknown
const handlers: Record<string, Handler> = {}
const calls: { method: string; params: Record<string, unknown> }[] = []

vi.mock('../gateway', () => ({
  gatewayClient: {
    bootId: 'boot-1',
    connectionSeq: 1,
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params })
      const h = handlers[method]
      if (!h) throw new Error(`unexpected ${method}`)
      return h(params)
    },
  },
}))

// A minimal stand-in for the connection store: state, setState, subscribe, and the two
// restart-expectation actions the install flow calls.
vi.mock('../../store/connection', async () => {
  const { create } = await import('zustand')
  const store = create<{
    status: string; connectionSeq: number; expectations: unknown[]
    expectRestart: (x: unknown) => void; clearRestartExpectation: () => void
  }>(set => ({
    status: 'connected', connectionSeq: 1, expectations: [],
    expectRestart: x => set(s => ({ expectations: [...s.expectations, x] })),
    clearRestartExpectation: () => set({ expectations: [] }),
  }))
  return { useConnectionStore: store }
})

const { gatewayClient } = await import('../gateway')
const { useConnectionStore } = await import('../../store/connection')
const { usePluginCatalogStore } = await import('../../store/pluginCatalog')
const { officialTarget, clawhubTarget } = await import('../pluginInstall')

const gw = gatewayClient as unknown as { bootId?: string; connectionSeq: number }
const listWith = (state: string) => ({ plugins: [{ id: 'zoom-meetings', name: 'Zoom', installed: true, enabled: state !== 'disabled', state }], diagnostics: [], mutationAllowed: true })
const gwError = (details: Record<string, unknown>, message = 'refused') =>
  Object.assign(new Error(JSON.stringify({ code: 'INVALID_REQUEST', message })), { gatewayError: { code: 'INVALID_REQUEST', message, details } })

/** Simulate the restarted gateway's hello: a new boot id and a new connection. */
function reconnect(bootId = 'boot-2') {
  gw.bootId = bootId
  gw.connectionSeq += 1
  useConnectionStore.setState({ status: 'connected', connectionSeq: gw.connectionSeq })
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  for (const k of Object.keys(handlers)) delete handlers[k]
  calls.length = 0
  gw.bootId = 'boot-1'
  gw.connectionSeq = 1
  useConnectionStore.setState({ status: 'connected', connectionSeq: 1, expectations: [] } as never)
  usePluginCatalogStore.setState({ run: null, consent: null, policy: null, busy: null })
  handlers['gateway.restart.request'] = () => ({ ok: true, status: 'scheduled' })
  handlers['plugins.list'] = () => listWith('enabled')
})
afterEach(() => { vi.useRealTimers() })

describe('installAndRestart', () => {
  it('installs, restarts, waits for the new boot and reports the outcome', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings', name: 'Zoom' }, restartRequired: true })
    handlers['plugins.list'] = () => listWith('needs-setup')
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom meetings', 'meetings'))

    expect(usePluginCatalogStore.getState().run?.phase).toBe('restarting')
    expect(calls.map(c => c.method)).toEqual(['plugins.install', 'gateway.restart.request'])
    expect(calls[1].params).toEqual({ reason: 'Apply an installed plugin change' })
    // The overlay was told why the gateway is about to go away.
    expect((useConnectionStore.getState() as unknown as { expectations: { reason: string }[] }).expectations[0].reason)
      .toBe('Restarting to finish installing Zoom meetings')

    reconnect()
    await flush()
    const run = usePluginCatalogStore.getState().run
    expect(run?.phase).toBe('done')
    expect(run?.outcome).toBe('needs-setup')
    expect(usePluginCatalogStore.getState().busy).toBeNull()
  })

  it('does not take a reconnect to the same process for the restart', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings' }, restartRequired: true })
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    reconnect('boot-1')
    await flush()
    expect(usePluginCatalogStore.getState().run?.phase).toBe('restarting')
  })

  it('parks on consent, and the retry carries the review token', async () => {
    let n = 0
    handlers['plugins.install'] = p => {
      n++
      if (n === 1) throw gwError({ capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED', pluginId: 'tracker', reviewToken: 'tok' })
      expect(p.acknowledgeCapabilities).toEqual({ reviewToken: 'tok' })
      return { ok: true, plugin: { id: 'tracker' }, restartRequired: true }
    }
    handlers['plugins.inspect'] = () => ({ ok: true, declared: { tools: ['track'] } })
    await usePluginCatalogStore.getState().installAndRestart(clawhubTarget('@acme/tracker', 'Tracker'))
    expect(usePluginCatalogStore.getState().run?.phase).toBe('consent')
    expect(usePluginCatalogStore.getState().consent?.declared).toEqual({ tools: ['track'] })

    await usePluginCatalogStore.getState().acceptConsent()
    expect(usePluginCatalogStore.getState().run?.phase).toBe('restarting')
  })

  it('asks consent then the policy, and sends both acknowledgements', async () => {
    let n = 0
    handlers['plugins.install'] = p => {
      n++
      if (n === 1) throw gwError({ capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED', pluginId: 'tracker', reviewToken: 'tok' })
      if (n === 2) throw gwError({ installPolicyCode: 'install_policy_warning_acknowledgement_required', targetName: 'tracker', targetType: 'plugin', requestMode: 'install', reason: 'Runs a postinstall script.' })
      expect(p).toMatchObject({ acknowledgeCapabilities: { reviewToken: 'tok' }, acknowledgeInstallPolicyWarning: true })
      return { ok: true, plugin: { id: 'tracker' }, restartRequired: true }
    }
    handlers['plugins.inspect'] = () => ({ ok: true, declared: {} })
    await usePluginCatalogStore.getState().installAndRestart(clawhubTarget('@acme/tracker', 'Tracker'))
    await usePluginCatalogStore.getState().acceptConsent()
    expect(usePluginCatalogStore.getState().run?.phase).toBe('review')
    expect(usePluginCatalogStore.getState().policy?.warning.reason).toBe('Runs a postinstall script.')
    await usePluginCatalogStore.getState().acceptPolicy()
    expect(n).toBe(3)
    expect(usePluginCatalogStore.getState().run?.phase).toBe('restarting')
  })

  it('reports a ClawHub trust block and doesn\'t restart', async () => {
    handlers['plugins.install'] = () => { throw gwError({ clawhubTrustCode: 'clawhub_download_blocked', warning: 'Flagged as malware' }) }
    await usePluginCatalogStore.getState().installAndRestart(clawhubTarget('@evil/pkg', 'Evil'))
    const run = usePluginCatalogStore.getState().run
    expect(run).toMatchObject({ phase: 'failed', failure: 'trust', message: 'Flagged as malware' })
    expect(calls.map(c => c.method)).toEqual(['plugins.install'])
  })

  it('times out when the gateway doesn\'t come back, then resolves if it does later', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings' }, restartRequired: true })
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    vi.advanceTimersByTime(90_000)
    expect(usePluginCatalogStore.getState().run).toMatchObject({ phase: 'failed', failure: 'timeout' })
    reconnect()
    await flush()
    expect(usePluginCatalogStore.getState().run?.phase).toBe('done')
  })

  it('treats a refused restart as a restart failure, not an install failure', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings' }, restartRequired: true })
    handlers['gateway.restart.request'] = () => { throw gwError({}, 'restart disabled') }
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    expect(usePluginCatalogStore.getState().run).toMatchObject({ phase: 'failed', failure: 'restart', message: 'restart disabled' })
  })

  it('keeps waiting when the socket drops before the restart answers', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings' }, restartRequired: true })
    handlers['gateway.restart.request'] = () => { throw new Error('Connection closed') }
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    expect(usePluginCatalogStore.getState().run?.phase).toBe('restarting')
  })

  it('waits longer for a deferred restart (the gateway defers up to 300 s)', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings' }, restartRequired: true })
    handlers['gateway.restart.request'] = () => ({ ok: true, status: 'deferred' })
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    vi.advanceTimersByTime(300_000)
    expect(usePluginCatalogStore.getState().run).toMatchObject({ phase: 'restarting', deferred: true })
    vi.advanceTimersByTime(60_000)
    expect(usePluginCatalogStore.getState().run).toMatchObject({ phase: 'failed', failure: 'timeout' })
  })

  it('reports a plugin missing after the restart', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings' }, restartRequired: true })
    handlers['plugins.list'] = () => ({ plugins: [], diagnostics: [], mutationAllowed: true })
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    reconnect()
    await flush()
    expect(usePluginCatalogStore.getState().run).toMatchObject({ phase: 'failed', failure: 'missing' })
  })

  it('keeps the install warnings for the outcome', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings', state: 'needs-setup' }, restartRequired: true, warnings: ['Installed without enabling it.'] })
    handlers['plugins.list'] = () => listWith('needs-setup')
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    reconnect()
    await flush()
    expect(usePluginCatalogStore.getState().run).toMatchObject({ phase: 'done', outcome: 'needs-setup', warnings: ['Installed without enabling it.'] })
  })

  it('waits for a coalesced restart\'s delay before timing out', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings' }, restartRequired: true })
    handlers['gateway.restart.request'] = () => ({ ok: true, status: 'coalesced', restart: { delayMs: 21_000 } })
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    vi.advanceTimersByTime(90_000)
    expect(usePluginCatalogStore.getState().run?.phase).toBe('restarting')
    vi.advanceTimersByTime(21_000)
    expect(usePluginCatalogStore.getState().run).toMatchObject({ phase: 'failed', failure: 'timeout' })
  })

  it('offers a retry when ClawHub\'s security check is unreachable', async () => {
    handlers['plugins.install'] = () => { throw gwError({ clawhubTrustCode: 'clawhub_security_unavailable', version: '1.4.2' }, 'trust check failed') }
    await usePluginCatalogStore.getState().installAndRestart(clawhubTarget('@acme/tracker', 'Tracker'))
    expect(usePluginCatalogStore.getState().run).toMatchObject({ phase: 'failed', failure: 'trustUnavailable' })
  })

  it('runs one install at a time', async () => {
    handlers['plugins.install'] = () => ({ ok: true, plugin: { id: 'zoom-meetings' }, restartRequired: true })
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('zoom-meetings', 'Zoom'))
    await usePluginCatalogStore.getState().installAndRestart(officialTarget('slack', 'Slack'))
    expect(calls.filter(c => c.method === 'plugins.install')).toHaveLength(1)
    expect(usePluginCatalogStore.getState().run?.target.displayName).toBe('Zoom')
  })
})
