import { describe, it, expect, vi, beforeEach } from 'vitest'

// Saving a model edit against a real 2026.9.4 gateway used to do nothing: a provider the
// Models tab shows but that isn't written in the raw config (anthropic, ollama, anything
// from agents.defaults.models) was dropped from the payload, so `config.patch` carried no
// change, the gateway answered `{ok:true, noop:true, changedPaths:[]}`, and the app said
// "Saved". The edit came back on the next reload.

const h = vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => mem.clear(),
  }
  const client = {
    calls: [] as { method: string; params: unknown }[],
    handlers: {} as Record<string, (params: unknown) => unknown>,
    connected: true,
    hasMethod() { return true },
    hasEvent() { return true },
    supports() { return false },
    on() { return () => {} },
    async request(method: string, params?: unknown) {
      client.calls.push({ method, params })
      const handler = client.handlers[method]
      if (!handler) throw new Error(`unknown method: ${method}`)
      return handler(params)
    },
  }
  return { client, store: { modelPricing: {} as Record<string, unknown> } }
})

vi.mock('../gateway', () => ({ gatewayClient: h.client }))
vi.mock('../localStore', () => ({
  readLocalStore: async () => h.store,
  patchLocalStore: async (p: Record<string, unknown>) => { Object.assign(h.store, p) },
}))

const { useModelsStore } = await import('../../store/models')

// anthropic is NOT in models.providers: it exists only because an agent default names it,
// which is exactly the shape that used to be dropped.
const CONFIG = {
  models: { providers: { acme: { baseUrl: 'https://acme.example.com/v1', models: [{ id: 'acme-one', name: 'acme-one' }] } } },
  agents: { defaults: { models: { 'anthropic/claude-sonnet-4-5': {} } } },
  plugins: { entries: {} },
}

const patchCalls = () => h.client.calls.filter(c => c.method === 'config.patch')
const lastPatch = () => JSON.parse((patchCalls().at(-1)!.params as { raw: string }).raw) as {
  models?: { providers?: Record<string, { baseUrl?: string; models?: { id: string }[] }> }
}

async function loadStore(patchReply: unknown) {
  h.client.calls.length = 0
  h.client.handlers = {
    'config.get': () => ({ parsed: CONFIG, config: CONFIG, hash: 'hmac-sha256:v1:test' }),
    'config.patch': () => patchReply,
  }
  useModelsStore.setState({ providers: {}, selectedId: null, error: null, dirty: false })
  await useModelsStore.getState().load()
}

describe('models save', () => {
  beforeEach(() => { h.store.modelPricing = {} })

  it('sends a provider that only exists via agent defaults once the user edits it', async () => {
    await loadStore({ ok: true, changedPaths: ['models.providers.anthropic.baseUrl'], hash: 'h2' })
    expect(Object.keys(useModelsStore.getState().providers)).toContain('anthropic')

    useModelsStore.getState().updateProviderConfig('anthropic', { baseUrl: 'https://proxy.example.com' })
    await useModelsStore.getState().save()

    expect(lastPatch().models?.providers?.anthropic?.baseUrl).toBe('https://proxy.example.com')
    expect(useModelsStore.getState().error).toBeNull()
  })

  it('sends a model added to such a provider', async () => {
    await loadStore({ ok: true, changedPaths: ['models.providers.anthropic.models'], hash: 'h2' })
    useModelsStore.getState().setModel('anthropic', { id: 'claude-opus-5', name: 'Opus 5' })
    await useModelsStore.getState().save()

    const models = lastPatch().models?.providers?.anthropic?.models ?? []
    expect(models.map(m => m.id)).toContain('claude-opus-5')
  })

  it('leaves an untouched plugin-managed provider out of the payload', async () => {
    await loadStore({ ok: true, changedPaths: ['models.providers.acme.baseUrl'], hash: 'h2' })
    useModelsStore.getState().updateProviderConfig('acme', { baseUrl: 'https://acme.example.com/v2' })
    await useModelsStore.getState().save()

    expect(lastPatch().models?.providers).not.toHaveProperty('anthropic')
    expect(lastPatch().models?.providers).toHaveProperty('acme')
  })

  it('reports the gateway saying it changed nothing, instead of "Saved"', async () => {
    await loadStore({ ok: true, noop: true, changedPaths: [] })
    useModelsStore.getState().updateProviderConfig('acme', { baseUrl: 'https://acme.example.com/v2' })
    await useModelsStore.getState().save()

    expect(useModelsStore.getState().error).toMatch(/no change/i)
    expect(useModelsStore.getState().saving).toBe(false)
  })

  it('names every array path it replaces, so the gateway allows a model removal', async () => {
    await loadStore({ ok: true, changedPaths: ['models.providers.acme.models'], hash: 'h2' })
    useModelsStore.getState().deleteModel('acme', 'acme-one')
    await useModelsStore.getState().save()

    const params = patchCalls().at(-1)!.params as { replacePaths?: string[] }
    expect(params.replacePaths).toContain('models.providers.acme.models')
  })

  it('deletes a provider by sending null (a merge patch keeps what it omits)', async () => {
    await loadStore({ ok: true, changedPaths: ['models.providers.acme'], hash: 'h2' })
    useModelsStore.getState().deleteProvider('acme')
    await useModelsStore.getState().save()

    const raw = JSON.parse((patchCalls().at(-1)!.params as { raw: string }).raw) as { models: { providers: Record<string, unknown> } }
    expect(raw.models.providers.acme).toBeNull()
  })

  it('writes only the plugins the user toggled, not every resolved plugin', async () => {
    await loadStore({ ok: true, changedPaths: ['plugins.entries.acme.enabled'], hash: 'h2' })
    useModelsStore.getState().setProviderEnabled('acme', false)
    await useModelsStore.getState().save()

    const raw = JSON.parse((patchCalls().at(-1)!.params as { raw: string }).raw) as { plugins?: { entries: Record<string, unknown> } }
    expect(raw.plugins?.entries).toEqual({ acme: { enabled: false } })
  })

  it('leaves the plugins section out entirely when nothing was toggled', async () => {
    await loadStore({ ok: true, changedPaths: ['models.providers.acme.baseUrl'], hash: 'h2' })
    useModelsStore.getState().updateProviderConfig('acme', { baseUrl: 'https://acme.example.com/v2' })
    await useModelsStore.getState().save()

    const raw = JSON.parse((patchCalls().at(-1)!.params as { raw: string }).raw) as { plugins?: unknown }
    expect(raw.plugins).toBeUndefined()
  })
})
