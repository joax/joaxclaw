import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { parseChannels, type ChannelConfig, type ChannelBinding, type ChannelAccountStatus } from '../lib/channels'

// ── config.get / config.patch helpers ────────────────────────────────────────
// Channels + bindings live in the gateway config. We read the *parsed* (raw
// JSON5) view when present so credential SecretRefs and literals round-trip
// exactly, and patch with a fresh baseHash each time (mirrors the agents store).

interface ConfigSnapshot {
  hash?: string
  config?: Record<string, unknown>
  parsed?: Record<string, unknown>
}

async function getConfig(): Promise<ConfigSnapshot> {
  return gatewayClient.request<ConfigSnapshot>('config.get')
}

function viewOf(snap: ConfigSnapshot): Record<string, unknown> {
  return (snap.parsed ?? snap.config ?? {}) as Record<string, unknown>
}

// Send a minimal RFC-7396 merge patch and let the gateway hot-reload.
// `replacePaths` is required when a patch SHRINKS an array (e.g. removing a
// binding) — the gateway rejects array-entry removal via plain merge otherwise.
async function patchConfig(patch: Record<string, unknown>, baseHash?: string, replacePaths?: string[]): Promise<void> {
  await gatewayClient.request('config.patch', {
    raw: JSON.stringify(patch),
    ...(baseHash ? { baseHash } : {}),
    ...(replacePaths?.length ? { replacePaths } : {}),
  })
}

// ── live status ───────────────────────────────────────────────────────────────

interface ChannelsStatusSnapshot {
  channelAccounts?: Record<string, ChannelAccountStatus[]>
  [k: string]: unknown
}

// ── store ───────────────────────────────────────────────────────────────────

interface ChannelsState {
  channels: ChannelConfig[]
  bindings: ChannelBinding[]
  status: ChannelsStatusSnapshot | null
  loading: boolean
  busy: string | null      // id of a channel with an in-flight runtime op
  error: string | null

  fetch: () => Promise<void>
  refreshStatus: (probe?: boolean) => Promise<void>

  // CRUD on channels.<id>
  createChannel: (channelId: string, settings: Record<string, unknown>) => Promise<void>
  setEnabled: (channelId: string, enabled: boolean) => Promise<void>
  updateSettings: (channelId: string, patch: Record<string, unknown>) => Promise<void>
  deleteChannel: (channelId: string) => Promise<void>

  // Agent assignment via the bindings array
  bindAgent: (channelId: string, agentId: string, accountId?: string) => Promise<void>
  unbindAgent: (channelId: string, agentId: string, accountId?: string) => Promise<void>

  // Runtime control
  startChannel: (channelId: string, accountId?: string) => Promise<{ ok: boolean; message?: string }>
  stopChannel: (channelId: string, accountId?: string) => Promise<{ ok: boolean; message?: string }>
  logoutChannel: (channelId: string, accountId?: string) => Promise<{ ok: boolean; message?: string }>
}

const sameBinding = (b: ChannelBinding, channelId: string, agentId: string, accountId?: string) =>
  b.agentId === agentId &&
  b.match?.channel === channelId &&
  (accountId ? b.match?.accountId === accountId : !b.match?.accountId)

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channels: [],
  bindings: [],
  status: null,
  loading: false,
  busy: null,
  error: null,

  async fetch() {
    set({ loading: true, error: null })
    try {
      const snap = await getConfig()
      const { channels, bindings } = parseChannels(viewOf(snap))
      set({ channels, bindings, loading: false })
      // Live status is best-effort and must never block the config view.
      void get().refreshStatus(false)
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  async refreshStatus(probe = false) {
    try {
      const status = await gatewayClient.request<ChannelsStatusSnapshot>('channels.status', { probe, timeoutMs: 8000 })
      set({ status })
    } catch {
      // Gateway may not expose status, or a probe timed out — leave prior status.
    }
  },

  async createChannel(channelId, settings) {
    const snap = await getConfig()
    await patchConfig({ channels: { [channelId]: { enabled: true, ...settings } } }, snap.hash)
    await get().fetch()
  },

  async setEnabled(channelId, enabled) {
    // Optimistic flip for snappy toggles.
    set(s => ({ channels: s.channels.map(c => c.id === channelId ? { ...c, enabled } : c) }))
    const snap = await getConfig()
    await patchConfig({ channels: { [channelId]: { enabled } } }, snap.hash)
    await get().fetch()
  },

  async updateSettings(channelId, patch) {
    const snap = await getConfig()
    await patchConfig({ channels: { [channelId]: patch } }, snap.hash)
    await get().fetch()
  },

  async deleteChannel(channelId) {
    const snap = await getConfig()
    // Drop the channel block (null = delete per RFC 7396) and any bindings to it.
    // Removing bindings shrinks the array, so it must go through replacePaths.
    const remaining = get().bindings.filter(b => b.match?.channel !== channelId)
    await patchConfig({ channels: { [channelId]: null }, bindings: remaining }, snap.hash, ['bindings'])
    await get().fetch()
  },

  async bindAgent(channelId, agentId, accountId) {
    const current = get().bindings
    if (current.some(b => sameBinding(b, channelId, agentId, accountId))) return
    const match: ChannelBinding['match'] = { channel: channelId, ...(accountId ? { accountId } : {}) }
    const next = [...current, { agentId, match }]
    const snap = await getConfig()
    // replacePaths so the gateway treats `bindings` as a wholesale replacement
    // (consistent with unbind/delete, which shrink it).
    await patchConfig({ bindings: next }, snap.hash, ['bindings'])
    await get().fetch()
  },

  async unbindAgent(channelId, agentId, accountId) {
    const next = get().bindings.filter(b => !sameBinding(b, channelId, agentId, accountId))
    const snap = await getConfig()
    await patchConfig({ bindings: next }, snap.hash, ['bindings'])
    await get().fetch()
  },

  async startChannel(channelId, accountId) {
    return runtime(set, get, 'channels.start', channelId, accountId)
  },
  async stopChannel(channelId, accountId) {
    return runtime(set, get, 'channels.stop', channelId, accountId)
  },
  async logoutChannel(channelId, accountId) {
    return runtime(set, get, 'channels.logout', channelId, accountId)
  },
}))

// Shared runtime-control caller: marks the channel busy, fires the RPC, refreshes status.
async function runtime(
  set: (partial: Partial<ChannelsState>) => void,
  get: () => ChannelsState,
  method: string,
  channelId: string,
  accountId?: string,
): Promise<{ ok: boolean; message?: string }> {
  set({ busy: channelId, error: null })
  try {
    const res = await gatewayClient.request<{ message?: string; ok?: boolean }>(method, {
      channel: channelId,
      ...(accountId ? { accountId } : {}),
    })
    await get().refreshStatus(false)
    return { ok: res?.ok !== false, message: res?.message }
  } catch (e) {
    return { ok: false, message: String(e) }
  } finally {
    set({ busy: null })
  }
}

// Live status lookup for a channel (across its accounts).
export function statusForChannel(snap: ChannelsStatusSnapshot | null, channelId: string): ChannelAccountStatus[] {
  return snap?.channelAccounts?.[channelId] ?? []
}
