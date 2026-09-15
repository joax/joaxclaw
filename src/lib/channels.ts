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
// SecretRef is defined canonically in ./types and re-exported here.
import type { SecretRef } from './types'
export type { SecretRef }
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
  // Modes this field belongs to (see ChannelDef.modes). Omitted means every mode.
  modes?: string[]
  // The shape a typed value must have, and what to say when it doesn't. Catches a token
  // pasted into the wrong field here, instead of as a connection failure later.
  pattern?: RegExp
  patternHint?: string
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
  // The plugin that provides this channel. On OpenClaw 2026.9 nearly every channel ships
  // as its own plugin (Telegram is the exception); older gateways bundled most of them.
  // The form checks plugins.list and offers to install the plugin when it's missing.
  plugin?: ChannelPlugin
  // Connection modes that need different credentials (Slack: Socket Mode or HTTP). The
  // chosen mode is saved as the channel's `mode`, and only its fields are shown and required.
  modes?: ChannelMode[]
}

export interface ChannelPlugin {
  /** Runtime plugin id, as plugins.list and plugins.install know it. */
  id: string
  /** npm package to install, when known. */
  spec?: string
  /** An official OpenClaw plugin, which plugins.install can add in one step. */
  official: boolean
}

export interface ChannelMode { id: string; label: string; help: string }

const ref = (id: string, label: string, kind: CredField['kind'], placeholder: string, help?: string, required = true): CredField =>
  ({ key: id, label, kind, placeholder, help, required })

// Official OpenClaw channel plugins install as `@openclaw/<id>` (the gateway's own
// catalog, checked on 2026.9.4).
const official = (id: string): ChannelPlugin => ({ id, spec: `@openclaw/${id}`, official: true })

// The catalog. Channels with `fields` get first-class forms; the rest are
// still fully creatable via the raw credential editor in the panel.
export const CHANNELS: ChannelDef[] = [
  {
    id: 'telegram', label: 'Telegram', color: '#0088cc', setup: 'token', docs: 'telegram',
    blurb: 'Bot API via grammY. Fastest setup — one bot token from @BotFather.',
    fields: [ref('botToken', 'Bot token', 'secret', '123456:ABC-DEF…', 'From @BotFather → /newbot')],
  },
  {
    id: 'discord', label: 'Discord', color: '#5865f2', setup: 'token', docs: 'discord', plugin: official('discord'),
    blurb: 'Discord Bot API + Gateway. Servers, channels, and DMs.',
    fields: [
      ref('token', 'Bot token', 'secret', 'your-bot-token', 'Developer Portal → Bot → Reset Token'),
      ref('applicationId', 'Application ID', 'text', '123456789012345678', 'Optional — skips a startup REST lookup', false),
    ],
  },
  {
    id: 'slack', label: 'Slack', color: '#4a154b', setup: 'token', docs: 'slack', plugin: official('slack'),
    blurb: 'A Slack workspace app: channels, DMs and slash commands.',
    modes: [
      { id: 'socket', label: 'Socket Mode', help: 'Recommended. The gateway connects out to Slack, so it needs no public URL. Uses a bot token and an app-level token.' },
      { id: 'http', label: 'HTTP Request URL', help: 'Slack sends events to your gateway, so it must be reachable from the internet. Uses a bot token and the signing secret.' },
    ],
    fields: [
      { key: 'botToken', label: 'Bot token', kind: 'secret', placeholder: 'xoxb-…', required: true,
        help: 'OAuth & Permissions → Bot User OAuth Token', pattern: /^xoxb-/, patternHint: 'Bot tokens start with xoxb-.' },
      { key: 'appToken', label: 'App-level token', kind: 'secret', placeholder: 'xapp-…', required: true, modes: ['socket'],
        help: 'Basic Information → App-Level Tokens, with the connections:write scope', pattern: /^xapp-/, patternHint: 'App-level tokens start with xapp-.' },
      { key: 'signingSecret', label: 'Signing secret', kind: 'secret', placeholder: '…', required: true, modes: ['http'],
        help: 'Basic Information → App Credentials → Signing Secret' },
      { key: 'webhookPath', label: 'Events path', kind: 'text', placeholder: '/slack/events', required: false, modes: ['http'],
        help: 'Where Slack posts events on your gateway. Leave blank for /slack/events.' },
    ],
  },
  {
    id: 'whatsapp', label: 'WhatsApp', color: '#25d366', setup: 'qr', docs: 'whatsapp', plugin: official('whatsapp'),
    blurb: 'Baileys (WhatsApp Web). Requires QR pairing — no token. State stored on disk.',
    fields: [],
  },
  {
    id: 'feishu', label: 'Feishu / Lark', color: '#00d6b9', setup: 'token', docs: 'feishu', plugin: official('feishu'),
    blurb: 'Feishu/Lark bot via WebSocket.',
    fields: [
      ref('appId', 'App ID', 'text', 'cli_xxx'),
      ref('appSecret', 'App secret', 'secret', '…'),
      ref('encryptKey', 'Encrypt key', 'secret', '…', 'Event encryption key', false),
      ref('verificationToken', 'Verification token', 'secret', '…', '', false),
    ],
  },
  {
    id: 'sms', label: 'SMS (Twilio)', color: '#f22f46', setup: 'token', docs: 'sms', plugin: official('sms'),
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
    // Published by Tencent Connect, not OpenClaw, so it installs from its package name.
    plugin: { id: 'openclaw-qqbot', spec: '@tencent-connect/openclaw-qqbot', official: false },
    blurb: 'QQ Bot API. Private chat, group chat, rich media.',
    fields: [
      ref('appId', 'App ID', 'text', 'YOUR_APP_ID'),
      ref('clientSecret', 'App secret', 'secret', 'YOUR_APP_SECRET'),
    ],
  },
  // ── Advanced (raw-config) channels ──────────────────────────────────────────
  { id: 'signal',          label: 'Signal',          color: '#3a76f0', setup: 'advanced', docs: 'signal',          plugin: official('signal'),          blurb: 'signal-cli. Privacy-focused.', fields: [] },
  { id: 'imessage',        label: 'iMessage',        color: '#34da50', setup: 'advanced', docs: 'imessage',        plugin: official('imessage'),        blurb: 'Native macOS via the imsg bridge on a signed-in Mac.', fields: [] },
  { id: 'matrix',          label: 'Matrix',          color: '#0dbd8b', setup: 'advanced', docs: 'matrix',          plugin: official('matrix'),          blurb: 'Matrix protocol.', fields: [] },
  { id: 'mattermost',      label: 'Mattermost',      color: '#0058cc', setup: 'advanced', docs: 'mattermost',      plugin: official('mattermost'),      blurb: 'Bot API + WebSocket.', fields: [] },
  { id: 'msteams',         label: 'Microsoft Teams', color: '#6264a7', setup: 'advanced', docs: 'msteams',         plugin: official('msteams'),         blurb: 'Bot Framework; enterprise support.', fields: [] },
  { id: 'googlechat',      label: 'Google Chat',     color: '#34a853', setup: 'advanced', docs: 'googlechat',      plugin: official('googlechat'),      blurb: 'Google Chat app via HTTP webhook.', fields: [] },
  { id: 'line',            label: 'LINE',            color: '#06c755', setup: 'advanced', docs: 'line',            plugin: official('line'),            blurb: 'LINE Messaging API bot.', fields: [] },
  { id: 'irc',             label: 'IRC',             color: '#888888', setup: 'advanced', docs: 'irc',             plugin: official('irc'),             blurb: 'Classic IRC servers; channels + DMs.', fields: [] },
  { id: 'nostr',           label: 'Nostr',           color: '#8e44ad', setup: 'advanced', docs: 'nostr',           plugin: official('nostr'),           blurb: 'Decentralized DMs via NIP-04.', fields: [] },
  { id: 'nextcloud-talk',  label: 'Nextcloud Talk',  color: '#0082c9', setup: 'advanced', docs: 'nextcloud-talk',  plugin: official('nextcloud-talk'),  blurb: 'Self-hosted chat via Nextcloud Talk.', fields: [] },
  { id: 'synology-chat',   label: 'Synology Chat',   color: '#b5b5b5', setup: 'advanced', docs: 'synology-chat',   plugin: official('synology-chat'),   blurb: 'Synology NAS Chat via webhooks.', fields: [] },
  { id: 'twitch',          label: 'Twitch',          color: '#9146ff', setup: 'advanced', docs: 'twitch',          plugin: official('twitch'),          blurb: 'Twitch chat via IRC connection.', fields: [] },
  { id: 'tlon',            label: 'Tlon',            color: '#000000', setup: 'advanced', docs: 'tlon',            plugin: official('tlon'),            blurb: 'Urbit-based messenger.', fields: [] },
  { id: 'zalo',            label: 'Zalo',            color: '#0068ff', setup: 'advanced', docs: 'zalo',            plugin: official('zalo'),            blurb: "Zalo Bot API; Vietnam's popular messenger.", fields: [] },
  { id: 'zalouser',        label: 'Zalo Personal',   color: '#0068ff', setup: 'qr',       docs: 'zalouser',        plugin: official('zalouser'),        blurb: 'Zalo personal account via QR login.', fields: [] },
  // Not in OpenClaw's catalog: install per the channel's own docs.
  { id: 'wechat',          label: 'WeChat',          color: '#07c160', setup: 'qr',       docs: 'wechat',          plugin: { id: 'wechat', official: false }, blurb: 'Tencent iLink Bot via QR login; private chats only.', fields: [] },
  { id: 'yuanbao',         label: 'Yuanbao',         color: '#1d6dff', setup: 'advanced', docs: 'yuanbao',         plugin: { id: 'openclaw-plugin-yuanbao', spec: 'openclaw-plugin-yuanbao', official: false }, blurb: 'Tencent Yuanbao bot.', fields: [] },
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

// ── Modes and saving (curated form) ──────────────────────────────────────────

/** The mode an existing channel is in, or the first (recommended) mode for a new one. */
export function initialMode(def: ChannelDef, raw: Record<string, unknown>): string | undefined {
  if (!def.modes?.length) return undefined
  const ids = def.modes.map(m => m.id)
  if (typeof raw.mode === 'string' && ids.includes(raw.mode)) return raw.mode
  // Configured before the form wrote a mode: a signing secret with no app token is HTTP.
  if (raw.signingSecret && !raw.appToken && ids.includes('http')) return 'http'
  return ids[0]
}

/** The fields shown, and checked, for a mode. */
export function fieldsForMode(def: ChannelDef, mode: string | undefined): CredField[] {
  return def.fields.filter(f => !f.modes || !mode || f.modes.includes(mode))
}

/**
 * The settings to save from the curated form, or what's wrong with it. Only the chosen
 * mode's fields are written and required. Fields from another mode are left alone, since
 * config.patch merges. An untouched SecretRef is kept as it is.
 */
export function buildCredentialSettings(
  def: ChannelDef, mode: string | undefined, values: Record<string, string>, raw: Record<string, unknown>,
): { settings: Record<string, unknown> } | { error: string } {
  const fields = fieldsForMode(def, mode)
  const settings: Record<string, unknown> = {}
  for (const f of fields) {
    const v = values[f.key]?.trim() ?? ''
    if (isSecretRef(raw[f.key]) && v === '') { settings[f.key] = raw[f.key]; continue }
    if (v === '') continue
    if (f.pattern && !f.pattern.test(v)) return { error: `${f.label}: ${f.patternHint ?? 'unexpected format.'}` }
    settings[f.key] = v
  }
  const missing = fields.find(f => f.required && !settings[f.key])
  if (missing) {
    const modeLabel = def.modes?.find(m => m.id === mode)?.label
    return { error: `${missing.label} is required${modeLabel ? ` for ${modeLabel}` : ''}.` }
  }
  if (mode && def.modes?.length) settings.mode = mode
  return { settings }
}

// ── Channel plugins ───────────────────────────────────────────────────────────

export type PluginInstallState = 'installed' | 'disabled' | 'missing'

/**
 * Whether a channel's plugin is on the gateway, from a plugins.list result. Newer
 * gateways list uninstalled catalog plugins too (`installed: false`, state
 * `not-installed`), so being in the list isn't enough. Matches by runtime id or package.
 */
export function pluginInstallState(listResult: unknown, plugin: ChannelPlugin): PluginInstallState {
  const list = (listResult as { plugins?: unknown } | null)?.plugins
  const entries = Array.isArray(list) ? list : []
  const hit = entries.find((e): e is Record<string, unknown> =>
    !!e && typeof e === 'object'
    && ((e as Record<string, unknown>).id === plugin.id || (!!plugin.spec && (e as Record<string, unknown>).packageName === plugin.spec)))
  if (!hit || hit.installed === false || hit.state === 'not-installed') return 'missing'
  if (hit.enabled === false || hit.state === 'disabled') return 'disabled'
  return 'installed'
}

/** The command that installs a channel's plugin on the gateway host, when the package is known. */
export function pluginInstallCommand(plugin: ChannelPlugin): string | null {
  return plugin.spec ? `openclaw plugins install ${plugin.spec}` : null
}

// ── Delivery targets ──────────────────────────────────────────────────────────
//
// A scheduled job that announces to a channel needs to know WHERE. Some channels can
// infer it (post back to the last-used conversation); others cannot, and the gateway
// rejects the run: "Delivering to WhatsApp requires target <E.164|group JID|newsletter
// JID>". That rejection used to arrive hours later, on the first scheduled run, because
// the target was presented as optional for every channel.
//
// So the rule lives here, next to the channel it belongs to, and the form asks for what
// the channel actually needs at the moment you pick it.

export interface DeliveryTargetSpec {
  /** The gateway refuses to deliver without one. */
  required: boolean
  label: string
  placeholder: string
  hint: string
  /** Returns an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null
}

// WhatsApp addresses are a phone number in E.164, a group JID, or a newsletter JID —
// which is exactly what the gateway's own error message lists.
const E164 = /^\+[1-9]\d{6,14}$/
const JID = /^[^@\s]+@(g\.us|s\.whatsapp\.net|newsletter|broadcast)$/i

const whatsappTarget: DeliveryTargetSpec = {
  required: true,
  label: 'Deliver to',
  placeholder: '+34600123456  ·  1203…@g.us  ·  120…@newsletter',
  hint: 'WhatsApp needs an explicit recipient: a phone number in E.164 (+ country code), a group JID (…@g.us), or a newsletter JID. Run `openclaw directory` on the gateway host to look up group ids.',
  validate: v => {
    const t = v.trim()
    if (!t) return 'WhatsApp needs a recipient — it can’t infer one.'
    if (E164.test(t) || JID.test(t)) return null
    if (/^\d/.test(t)) return 'Phone numbers need the country code and a leading +, e.g. +34600123456.'
    return 'Expected a phone number (+34600123456), a group JID (…@g.us), or a newsletter JID.'
  },
}

const smsTarget: DeliveryTargetSpec = {
  required: true,
  label: 'Deliver to',
  placeholder: '+34600123456',
  hint: 'SMS needs a phone number in E.164 (+ country code).',
  validate: v => (E164.test(v.trim()) ? null : 'Expected a phone number in E.164, e.g. +34600123456.'),
}

const DELIVERY_TARGETS: Record<string, DeliveryTargetSpec> = {
  whatsapp: whatsappTarget,
  sms: smsTarget,
  telegram: {
    required: false,
    label: 'Deliver to (optional)',
    placeholder: '@username or -1001234567890',
    hint: 'A @username or numeric chat id. Leave blank to reply in the last-used chat.',
  },
  slack: {
    required: false,
    label: 'Deliver to (optional)',
    placeholder: '#general or C0123ABCD',
    hint: 'A channel name or id. Leave blank to reply in the last-used conversation.',
  },
  discord: {
    required: false,
    label: 'Deliver to (optional)',
    placeholder: '123456789012345678',
    hint: 'A channel id. Leave blank to reply in the last-used channel.',
  },
}

const DEFAULT_TARGET: DeliveryTargetSpec = {
  required: false,
  label: 'Deliver to (optional)',
  placeholder: '+1234567890 or @username',
  hint: 'Specific recipient or thread within the channel. Leave blank to reply where the conversation last happened.',
}

/** What this channel needs in the delivery "to" field — and whether it can do without. */
export function deliveryTargetSpec(channelId: string | undefined): DeliveryTargetSpec {
  return DELIVERY_TARGETS[(channelId ?? '').trim().toLowerCase()] ?? DEFAULT_TARGET
}

/** Validation for a delivery pair, used to block a save that could never deliver. */
export function validateDeliveryTarget(channelId: string | undefined, to: string): string | null {
  const spec = deliveryTargetSpec(channelId)
  const value = to.trim()
  if (!value) return spec.required ? spec.validate?.('') ?? `${channelId} needs an explicit recipient.` : null
  return spec.validate?.(value) ?? null
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
