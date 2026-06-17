// ── Gateway channels: catalog, types, and config (de)serialization ────────────
//
// Channels are messaging platforms the gateway can talk on. They live in the
// gateway config under two keys (edited via the config.get / config.patch RPCs,
// RFC 7396 merge semantics — same as the agents store):
//
//   channels.<id> = { enabled, <credentials…>, dmPolicy, accounts:{…}, … }
//   bindings      = [{ match: { channel, accountId?, … }, agentId }]
//
// A binding is how a channel is *assigned to an agent*. With no binding the
// channel falls through to the default agent.
//
// The full catalog mirrors openclaw's supported channels. A curated subset has
// first-class credential field definitions; every other channel is still
// creatable/manageable through the raw JSON5 credential editor.

// A credential may be a literal string or a SecretRef indirection
// ({ source: 'env', provider, id }). The curated forms edit literal strings;
// SecretRef values are preserved untouched and surfaced read-only.
export type SecretRef = { source: string; provider?: string; id: string }
export type CredentialValue = string | SecretRef | undefined

export interface ChannelAccountCfg {
  name?: string
  [k: string]: unknown
}

// The materialized per-channel config block as stored under `channels.<id>`.
export interface ChannelConfig {
  id: string
  enabled: boolean
  // Everything else from the config block (credentials, dmPolicy, groups, …)
  // is preserved verbatim so round-tripping never drops unknown keys.
  raw: Record<string, unknown>
  accounts: { id: string; name?: string }[]
  defaultAccount?: string
  boundAgentIds: string[]
}

export interface BindingPeer { kind: string; id: string }

export interface ChannelBinding {
  agentId: string
  match: {
    channel: string
    accountId?: string
    peer?: BindingPeer
    teamId?: string
    guildId?: string
    roles?: string[]
    [k: string]: unknown
  }
}

// ── Binding scopes (routing) ──────────────────────────────────────────────────
// How specific a binding is. The gateway resolves the most specific match first
// (peer > guild+roles > guild > team > account > channel > default).

export type BindingScopeKind = 'channel' | 'account' | 'peer' | 'team' | 'guild'

export interface BindingScopeDef {
  kind: BindingScopeKind
  label: string
  // Placeholder/help for the id input ('channel' needs no id).
  idLabel?: string
  idPlaceholder?: string
  // Channel ids this scope is offered for (undefined = all channels).
  onlyChannels?: string[]
}

export const BINDING_SCOPES: BindingScopeDef[] = [
  { kind: 'channel', label: 'All messages on this channel' },
  { kind: 'account', label: 'A specific account', idLabel: 'Account ID', idPlaceholder: 'work' },
  { kind: 'peer', label: 'A specific group / chat', idLabel: 'Peer (group) ID', idPlaceholder: '-1001234567890' },
  { kind: 'team', label: 'A Slack team', idLabel: 'Team ID', idPlaceholder: 'T0123ABCD', onlyChannels: ['slack'] },
  { kind: 'guild', label: 'A Discord server (guild)', idLabel: 'Guild ID', idPlaceholder: '123456789012345678', onlyChannels: ['discord'] },
]

export function scopesForChannel(channelId: string): BindingScopeDef[] {
  return BINDING_SCOPES.filter(s => !s.onlyChannels || s.onlyChannels.includes(channelId))
}

// Build a binding `match` for a scope + id.
export function buildMatch(channelId: string, kind: BindingScopeKind, id: string): ChannelBinding['match'] {
  const v = id.trim()
  switch (kind) {
    case 'account': return { channel: channelId, accountId: v }
    case 'peer':    return { channel: channelId, peer: { kind: 'group', id: v } }
    case 'team':    return { channel: channelId, teamId: v }
    case 'guild':   return { channel: channelId, guildId: v }
    case 'channel':
    default:        return { channel: channelId }
  }
}

// A short human description of a binding's scope, e.g. "group -100123" / "all".
export function bindingScopeLabel(match: ChannelBinding['match']): string {
  if (match.peer) return `${match.peer.kind} ${match.peer.id}`
  if (match.teamId) return `team ${match.teamId}`
  if (match.guildId) return `guild ${match.guildId}`
  if (match.accountId) return `account ${match.accountId}`
  return 'all messages'
}

// Stable key for de-duping / removing a binding (agent + its match shape).
export function bindingKey(b: ChannelBinding): string {
  const m = b.match
  return JSON.stringify([b.agentId, m.channel, m.accountId ?? null, m.peer ?? null, m.teamId ?? null, m.guildId ?? null, m.roles ?? null])
}

// Live runtime status for one channel/account, from the channels.status RPC.
export interface ChannelAccountStatus {
  accountId: string
  name?: string
  status?: string
  running?: boolean
  configured?: boolean
}

// ── Credential field definitions (curated channels) ───────────────────────────

export interface CredField {
  key: string
  label: string
  // 'secret' renders a masked input; 'text' a plain one.
  kind: 'text' | 'secret'
  placeholder?: string
  help?: string
  required?: boolean
}

export type ChannelSetup =
  | 'token'      // paste a token / credentials into the form
  | 'qr'         // QR pairing via the CLI (WhatsApp, Zalo personal, …)
  | 'oauth'      // app-level OAuth dance done outside the app
  | 'advanced'   // no curated form — raw config only

export interface ChannelDef {
  id: string
  label: string
  color: string
  setup: ChannelSetup
  blurb: string
  // Curated credential fields. Empty → the channel uses the raw editor only.
  fields: CredField[]
  // Doc slug under https://docs.openclaw … /channels/<docs>
  docs?: string
  // External/downloadable plugin that must be installed before use.
  needsPlugin?: boolean
}

const ref = (id: string, label: string, kind: CredField['kind'], placeholder: string, help?: string, required = true): CredField =>
  ({ key: id, label, kind, placeholder, help, required })

// The catalog. Channels with `fields` get first-class forms; the rest are
// still fully creatable via the raw credential editor in the panel.
export const CHANNELS: ChannelDef[] = [
  {
    id: 'telegram', label: 'Telegram', color: '#0088cc', setup: 'token', docs: 'telegram',
    blurb: 'Bot API via grammY. Fastest setup — one bot token from @BotFather.',
    fields: [ref('botToken', 'Bot token', 'secret', '123456:ABC-DEF…', 'From @BotFather → /newbot')],
  },
  {
    id: 'discord', label: 'Discord', color: '#5865f2', setup: 'token', docs: 'discord',
    blurb: 'Discord Bot API + Gateway. Servers, channels, and DMs.',
    fields: [
      ref('token', 'Bot token', 'secret', 'your-bot-token', 'Developer Portal → Bot → Reset Token'),
      ref('applicationId', 'Application ID', 'text', '123456789012345678', 'Optional — skips a startup REST lookup', false),
    ],
  },
  {
    id: 'slack', label: 'Slack', color: '#4a154b', setup: 'token', docs: 'slack',
    blurb: 'Bolt SDK workspace app. Socket Mode (app + bot token) or HTTP (signing secret).',
    fields: [
      ref('appToken', 'App-level token', 'secret', 'xapp-…', 'Socket Mode — starts with xapp-'),
      ref('botToken', 'Bot token', 'secret', 'xoxb-…', 'Starts with xoxb-'),
      ref('signingSecret', 'Signing secret', 'secret', '…', 'HTTP mode only', false),
    ],
  },
  {
    id: 'whatsapp', label: 'WhatsApp', color: '#25d366', setup: 'qr', docs: 'whatsapp',
    blurb: 'Baileys (WhatsApp Web). Requires QR pairing — no token. State stored on disk.',
    fields: [],
    needsPlugin: true,
  },
  {
    id: 'feishu', label: 'Feishu / Lark', color: '#00d6b9', setup: 'token', docs: 'feishu',
    blurb: 'Feishu/Lark bot via WebSocket (bundled plugin).',
    fields: [
      ref('appId', 'App ID', 'text', 'cli_xxx'),
      ref('appSecret', 'App secret', 'secret', '…'),
      ref('encryptKey', 'Encrypt key', 'secret', '…', 'Event encryption key', false),
      ref('verificationToken', 'Verification token', 'secret', '…', '', false),
    ],
  },
  {
    id: 'sms', label: 'SMS (Twilio)', color: '#f22f46', setup: 'token', docs: 'sms',
    blurb: 'Twilio-backed SMS through the Gateway webhook.',
    fields: [
      ref('accountSid', 'Account SID', 'text', 'ACxxxxxxxx…'),
      ref('authToken', 'Auth token', 'secret', '…'),
      ref('fromNumber', 'From number', 'text', '+15551234567'),
      ref('publicWebhookUrl', 'Public webhook URL', 'text', 'https://gateway.example.com/webhooks/sms', 'Where Twilio posts inbound SMS', false),
    ],
  },
  {
    id: 'qqbot', label: 'QQ Bot', color: '#12b7f5', setup: 'token', docs: 'qqbot',
    blurb: 'QQ Bot API. Private chat, group chat, rich media (bundled plugin).',
    fields: [
      ref('appId', 'App ID', 'text', 'YOUR_APP_ID'),
      ref('clientSecret', 'App secret', 'secret', 'YOUR_APP_SECRET'),
    ],
  },
  // ── Advanced (raw-config) channels ──────────────────────────────────────────
  { id: 'signal',          label: 'Signal',          color: '#3a76f0', setup: 'advanced', docs: 'signal',          blurb: 'signal-cli. Privacy-focused.', fields: [] },
  { id: 'imessage',        label: 'iMessage',        color: '#34da50', setup: 'advanced', docs: 'imessage',        blurb: 'Native macOS via the imsg bridge on a signed-in Mac.', fields: [] },
  { id: 'matrix',          label: 'Matrix',          color: '#0dbd8b', setup: 'advanced', docs: 'matrix',          blurb: 'Matrix protocol (downloadable plugin).', fields: [], needsPlugin: true },
  { id: 'mattermost',      label: 'Mattermost',      color: '#0058cc', setup: 'advanced', docs: 'mattermost',      blurb: 'Bot API + WebSocket (downloadable plugin).', fields: [], needsPlugin: true },
  { id: 'msteams',         label: 'Microsoft Teams', color: '#6264a7', setup: 'advanced', docs: 'msteams',         blurb: 'Bot Framework; enterprise support (bundled plugin).', fields: [] },
  { id: 'googlechat',      label: 'Google Chat',     color: '#34a853', setup: 'advanced', docs: 'googlechat',      blurb: 'Google Chat app via HTTP webhook (downloadable plugin).', fields: [], needsPlugin: true },
  { id: 'line',            label: 'LINE',            color: '#06c755', setup: 'advanced', docs: 'line',            blurb: 'LINE Messaging API bot (downloadable plugin).', fields: [], needsPlugin: true },
  { id: 'irc',             label: 'IRC',             color: '#888888', setup: 'advanced', docs: 'irc',             blurb: 'Classic IRC servers; channels + DMs.', fields: [] },
  { id: 'nostr',           label: 'Nostr',           color: '#8e44ad', setup: 'advanced', docs: 'nostr',           blurb: 'Decentralized DMs via NIP-04 (bundled plugin).', fields: [] },
  { id: 'nextcloud-talk',  label: 'Nextcloud Talk',  color: '#0082c9', setup: 'advanced', docs: 'nextcloud-talk',  blurb: 'Self-hosted chat via Nextcloud Talk (bundled plugin).', fields: [] },
  { id: 'synology-chat',   label: 'Synology Chat',   color: '#b5b5b5', setup: 'advanced', docs: 'synology-chat',   blurb: 'Synology NAS Chat via webhooks (bundled plugin).', fields: [] },
  { id: 'twitch',          label: 'Twitch',          color: '#9146ff', setup: 'advanced', docs: 'twitch',          blurb: 'Twitch chat via IRC connection (bundled plugin).', fields: [] },
  { id: 'tlon',            label: 'Tlon',            color: '#000000', setup: 'advanced', docs: 'tlon',            blurb: 'Urbit-based messenger (bundled plugin).', fields: [] },
  { id: 'zalo',            label: 'Zalo',            color: '#0068ff', setup: 'advanced', docs: 'zalo',            blurb: "Zalo Bot API; Vietnam's popular messenger (bundled plugin).", fields: [] },
  { id: 'zalouser',        label: 'Zalo Personal',   color: '#0068ff', setup: 'qr',       docs: 'zalouser',        blurb: 'Zalo personal account via QR login (bundled plugin).', fields: [] },
  { id: 'wechat',          label: 'WeChat',          color: '#07c160', setup: 'qr',       docs: 'wechat',          blurb: 'Tencent iLink Bot via QR login; private chats only (external plugin).', fields: [], needsPlugin: true },
  { id: 'yuanbao',         label: 'Yuanbao',         color: '#1d6dff', setup: 'advanced', docs: 'yuanbao',         blurb: 'Tencent Yuanbao bot (external plugin).', fields: [], needsPlugin: true },
]

export const CHANNEL_BY_ID = new Map(CHANNELS.map(c => [c.id, c]))

export function channelDef(id: string): ChannelDef {
  return CHANNEL_BY_ID.get(id) ?? { id, label: id, color: '#888888', setup: 'advanced', blurb: '', fields: [] }
}

// Channels that link through an interactive QR/login CLI flow rather than a token.
export function isQrChannel(id: string): boolean {
  return channelDef(id).setup === 'qr'
}

// True when a value is a SecretRef indirection rather than a literal.
export function isSecretRef(v: unknown): v is SecretRef {
  return !!v && typeof v === 'object' && 'source' in (v as Record<string, unknown>) && 'id' in (v as Record<string, unknown>)
}

// Read a curated field's literal string value (SecretRefs are not literals).
export function fieldLiteral(raw: Record<string, unknown>, key: string): string {
  const v = raw[key]
  return typeof v === 'string' ? v : ''
}

// ── config ↔ store helpers ────────────────────────────────────────────────────

interface RawChannelsCfg {
  channels?: Record<string, { enabled?: boolean; defaultAccount?: string; accounts?: Record<string, ChannelAccountCfg> } & Record<string, unknown>>
  bindings?: ChannelBinding[]
}

// Build the in-memory channel list from a config snapshot.
export function parseChannels(cfg: RawChannelsCfg): { channels: ChannelConfig[]; bindings: ChannelBinding[] } {
  const channelsCfg = cfg.channels ?? {}
  const bindings = Array.isArray(cfg.bindings) ? cfg.bindings : []

  const channels: ChannelConfig[] = []
  for (const [id, block] of Object.entries(channelsCfg)) {
    if (!block || typeof block !== 'object') continue
    const accounts = Object.entries(block.accounts ?? {}).map(([accId, acc]) => ({ id: accId, name: acc?.name }))
    const boundAgentIds = bindings.filter(b => b.match?.channel === id).map(b => b.agentId)
    channels.push({
      id,
      enabled: block.enabled !== false,
      raw: block as Record<string, unknown>,
      accounts,
      defaultAccount: typeof block.defaultAccount === 'string' ? block.defaultAccount : undefined,
      boundAgentIds,
    })
  }
  // Keep configured channels stable & alphabetical for a calm list.
  channels.sort((a, b) => a.id.localeCompare(b.id))
  return { channels, bindings }
}
