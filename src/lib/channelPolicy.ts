// ── Curated per-channel policy ────────────────────────────────────────────────
//
// Access + action-permission knobs the gateway exposes under `channels.<id>`
// (and the same shape under per-account `channels.<id>.accounts.<accId>` and
// per-group `channels.<id>.groups.<gid>` blocks). Mirrors the curated credential
// forms in channels.ts: a hand-maintained model for the providers we know, drawn
// from the gateway config schema. Channels without a spec edit policy via the raw
// JSON editor. Only fields a provider actually supports are offered, so writes
// always validate.

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'
export type GroupPolicy = 'open' | 'allowlist' | 'disabled'

export const DM_POLICIES: DmPolicy[] = ['pairing', 'allowlist', 'open', 'disabled']
export const GROUP_POLICIES: GroupPolicy[] = ['open', 'allowlist', 'disabled']

export type PolicyFieldType = 'enum' | 'allowlist' | 'boolean'

export interface PolicyField {
  // Dotted path under the channel/account/group block (e.g. 'dmPolicy',
  // 'dm.policy', 'allowFrom', 'allowBots').
  path: string
  label: string
  type: PolicyFieldType
  options?: readonly string[]   // for 'enum'
  help?: string
}

export interface ChannelPolicySpec {
  access: PolicyField[]
  actions: string[]   // action-permission keys under `<block>.actions.<key>`
}

const DM_POLICY_FIELD: PolicyField = { path: 'dmPolicy', label: 'DM policy', type: 'enum', options: DM_POLICIES, help: 'Who may DM the agent directly.' }
const DM_POLICY_NESTED: PolicyField = { path: 'dm.policy', label: 'DM policy', type: 'enum', options: DM_POLICIES, help: 'Who may DM the agent directly.' }
const GROUP_POLICY_FIELD: PolicyField = { path: 'groupPolicy', label: 'Group policy', type: 'enum', options: GROUP_POLICIES, help: 'Behaviour in groups / servers / channels.' }
const ALLOW_FROM_FIELD: PolicyField = { path: 'allowFrom', label: 'DM allowlist', type: 'allowlist', help: 'Sender IDs allowed to DM (used when DM policy = allowlist).' }
const GROUP_ALLOW_FROM_FIELD: PolicyField = { path: 'groupAllowFrom', label: 'Group allowlist', type: 'allowlist', help: 'Sender IDs allowed in groups (used when group policy = allowlist).' }
const ALLOW_BOTS_FIELD: PolicyField = { path: 'allowBots', label: 'Process messages from bots', type: 'boolean', help: 'Off by default — leave off unless a bot should be able to drive the agent.' }

// Action-permission keys per provider (from channels.<id>.actions in the config schema).
const DISCORD_ACTIONS = ['reactions', 'stickers', 'emojiUploads', 'stickerUploads', 'polls', 'permissions', 'messages', 'threads', 'pins', 'search', 'memberInfo', 'roleInfo', 'roles', 'channelInfo', 'voiceStatus', 'events', 'moderation', 'channels', 'presence']
const SLACK_ACTIONS = ['reactions', 'messages', 'pins', 'search', 'permissions', 'memberInfo', 'channelInfo', 'emojiList']
const TELEGRAM_ACTIONS = ['reactions', 'sendMessage', 'poll', 'deleteMessage', 'editMessage', 'sticker', 'createForumTopic', 'editForumTopic']
const MATRIX_ACTIONS = ['reactions', 'messages', 'pins', 'profile', 'memberInfo', 'channelInfo', 'verification']
const WHATSAPP_ACTIONS = ['reactions', 'sendMessage', 'polls']

export const CHANNEL_POLICY: Record<string, ChannelPolicySpec> = {
  telegram: { access: [DM_POLICY_FIELD, GROUP_POLICY_FIELD, ALLOW_FROM_FIELD, GROUP_ALLOW_FROM_FIELD], actions: TELEGRAM_ACTIONS },
  discord:  { access: [DM_POLICY_FIELD, GROUP_POLICY_FIELD, ALLOW_FROM_FIELD, ALLOW_BOTS_FIELD], actions: DISCORD_ACTIONS },
  slack:    { access: [DM_POLICY_FIELD, GROUP_POLICY_FIELD, ALLOW_FROM_FIELD, ALLOW_BOTS_FIELD], actions: SLACK_ACTIONS },
  matrix:   { access: [DM_POLICY_NESTED, GROUP_POLICY_FIELD, GROUP_ALLOW_FROM_FIELD, ALLOW_BOTS_FIELD], actions: MATRIX_ACTIONS },
  whatsapp: { access: [DM_POLICY_FIELD, GROUP_POLICY_FIELD, ALLOW_FROM_FIELD, GROUP_ALLOW_FROM_FIELD], actions: WHATSAPP_ACTIONS },
}

export function channelPolicySpec(channelId: string): ChannelPolicySpec | null {
  return CHANNEL_POLICY[channelId] ?? null
}

// ── Read / write helpers ──────────────────────────────────────────────────────

// Read a dotted path out of a config block (channel / account / group).
export function readPolicyPath(block: Record<string, unknown> | undefined, path: string): unknown {
  if (!block) return undefined
  return path.split('.').reduce<unknown>(
    (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    block,
  )
}

// Build a nested patch object from a dotted path + value, e.g.
// ('dm.policy', 'open') → { dm: { policy: 'open' } }.
export function nestedPatch(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.')
  const root: Record<string, unknown> = {}
  let cur = root
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value
    else { const next: Record<string, unknown> = {}; cur[k] = next; cur = next }
  })
  return root
}

// Read an allowlist field as a clean string[].
export function readAllowlist(block: Record<string, unknown> | undefined, path: string): string[] {
  const v = readPolicyPath(block, path)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Action permissions default to allowed; policy is used to turn specific ones OFF.
// So a key is "blocked" only when it is explicitly `false`.
export function isActionAllowed(block: Record<string, unknown> | undefined, key: string): boolean {
  return readPolicyPath(block, `actions.${key}`) !== false
}
