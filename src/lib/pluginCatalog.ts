// Installing, removing and enabling gateway plugins.
//
// The Extensions page could list plugins and toggle them, and that was all: installing
// meant leaving the app for a shell. The gateway has had the rest of the surface for a
// while — `plugins.search` over ClawHub, `plugins.install`, `plugins.uninstall`, and a
// first-class `plugins.setEnabled`.
//
// The toggle matters on its own. Enabling used to be a `config.patch` writing
// `plugins.entries.<id>.enabled` — a whole-config write guarded by a base hash, which
// cannot tell you the one thing you want to know afterwards: whether the gateway needs a
// restart for it to take effect. `plugins.setEnabled` answers with `restartRequired` and
// any `warnings`.
//
// ── Consent ────────────────────────────────────────────────────────────────────
//
// A plugin declares a surface: channels it serves, tools it registers, MCP servers it
// starts, CLI commands it adds, and "dangerous" config flags it wants. Install and
// enable REFUSE until that surface has been acknowledged, answering:
//
//   details.capabilityConsentCode === "PLUGIN_CAPABILITY_CONSENT_REQUIRED"
//   details.reviewToken            — echo this back to acknowledge
//   details.widened                — what grew since the last acceptance
//   details.acceptedAt             — when that acceptance was
//
// So the flow is try → refused-with-token → SHOW THE USER what is being asked for →
// retry with `acknowledgeCapabilities: { reviewToken }`. The token must never be echoed
// back automatically: it is the record that a person saw the surface and agreed to it,
// and `widened` exists precisely so a plugin cannot quietly grow its reach across an
// update on a consent given for something smaller.

export interface PluginSearchPackage {
  name: string
  displayName: string
  family: 'code-plugin' | 'bundle-plugin'
  channel: 'official' | 'community' | 'private'
  isOfficial: boolean
  summary?: string
  latestVersion?: string
  runtimeId?: string
  downloads?: number
  verificationTier?: string
}

export interface PluginSearchHit {
  score: number
  package: PluginSearchPackage
}

/** Everything a plugin declares it will do. Every field is a list of identifiers. */
export interface DeclaredSurface {
  channels?: string[]
  providers?: string[]
  tools?: string[]
  contracts?: string[]
  hooks?: string[]
  mcpServers?: string[]
  cliCommands?: string[]
  cliBackends?: string[]
  skills?: string[]
  /** Dot paths the plugin's own manifest marks as dangerous. */
  dangerousConfigFlags?: string[]
}

export interface PluginInspect {
  ok: true
  plugin: { id: string; name: string; version?: string; description?: string; origin?: string; installed: boolean; enabled: boolean }
  source?: { kind?: string; spec?: string; packageName?: string }
  declared?: DeclaredSurface
  reviewToken?: string
}

export interface ConsentRequired {
  pluginId: string
  reviewToken: string
  widened?: DeclaredSurface
  acceptedAt?: string
}

/**
 * The consent challenge inside a refusal, or null if this wasn't one.
 *
 * Read from `details` rather than the message: the token is the whole point, and a
 * message match could not carry it.
 */
export function readConsentRequired(error: unknown): ConsentRequired | null {
  const details = asRecord(asRecord(error)?.details)
  if (!details || details.capabilityConsentCode !== 'PLUGIN_CAPABILITY_CONSENT_REQUIRED') return null
  const pluginId = details.pluginId
  const reviewToken = details.reviewToken
  if (typeof pluginId !== 'string' || typeof reviewToken !== 'string') return null
  return {
    pluginId,
    reviewToken,
    ...(isRecord(details.widened) ? { widened: details.widened as DeclaredSurface } : {}),
    ...(typeof details.acceptedAt === 'string' ? { acceptedAt: details.acceptedAt } : {}),
  }
}

const SURFACE_LABELS: [keyof DeclaredSurface, string][] = [
  ['channels', 'Messaging channels'],
  ['providers', 'Model providers'],
  ['tools', 'Agent tools'],
  ['mcpServers', 'MCP servers'],
  ['skills', 'Skills'],
  ['cliCommands', 'CLI commands'],
  ['cliBackends', 'CLI backends'],
  ['hooks', 'Hooks'],
  ['contracts', 'Contracts'],
]

export interface SurfaceLine {
  label: string
  items: string[]
  /** Flags the plugin's own manifest marks dangerous — shown apart, and first. */
  dangerous?: boolean
}

/**
 * The declared surface as readable lines, dangerous flags first and empty groups dropped.
 *
 * A plugin declaring nothing returns an empty list, which a caller should present as
 * "declares nothing" rather than as an empty panel — those look identical and mean very
 * different things.
 */
export function describeSurface(surface: DeclaredSurface | undefined): SurfaceLine[] {
  if (!surface) return []
  const out: SurfaceLine[] = []
  const danger = surface.dangerousConfigFlags ?? []
  if (danger.length) out.push({ label: 'Dangerous config flags', items: [...danger], dangerous: true })
  for (const [key, label] of SURFACE_LABELS) {
    const items = surface[key]
    if (Array.isArray(items) && items.length) out.push({ label, items: [...items] })
  }
  return out
}

/** True when anything in the declared surface is marked dangerous. */
export function surfaceHasDanger(surface: DeclaredSurface | undefined): boolean {
  return (surface?.dangerousConfigFlags?.length ?? 0) > 0
}

export type InstallParams =
  | { source: 'clawhub'; packageName: string; version?: string; acknowledgeCapabilities?: { reviewToken: string } }
  | { source: 'official'; pluginId: string; acknowledgeCapabilities?: { reviewToken: string } }

/**
 * Install params for a search hit.
 *
 * `plugins.install` is a union of two closed shapes, and they take different identifying
 * fields — `packageName` for ClawHub, `pluginId` for official — so sending the wrong one
 * fails the whole call. Official packages are installed by their runtime id when they
 * publish one, since that is the id the rest of the gateway knows them by.
 */
export function installParamsFor(pkg: PluginSearchPackage, reviewToken?: string): InstallParams {
  const ack = reviewToken ? { acknowledgeCapabilities: { reviewToken } } : {}
  if (pkg.isOfficial && pkg.runtimeId) {
    return { source: 'official', pluginId: pkg.runtimeId, ...ack }
  }
  return {
    source: 'clawhub',
    packageName: pkg.name,
    ...(pkg.latestVersion ? { version: pkg.latestVersion } : {}),
    ...ack,
  }
}

/** How much to trust a search result at a glance. */
export function trustLabel(pkg: PluginSearchPackage): string {
  if (pkg.isOfficial || pkg.channel === 'official') return 'Official'
  if (pkg.channel === 'private') return 'Private'
  return 'Community'
}

// ── The catalog (plugins.catalog.*, OpenClaw 2026.9) ─────────────────────────────
//
// Browsing used to be one ClawHub search box. 2026.9 has a real catalog: bundled and
// ClawHub plugins together, featured/trending/official lists, categories, and — the part
// search never had — each entry's state on THIS gateway (`local`), so a card can say
// Installed or Needs setup instead of guessing from the extensions list.
//
// Shapes are from the gateway's protocol schema (packages/gateway-protocol/src/schema/
// plugins.ts). All objects are closed.

export type CatalogIntent = 'featured' | 'trending' | 'official' | 'bundled' | 'all'

export interface CatalogCategory {
  slug: string
  label: string
  description: string
  icon: string
  order: number
}

export type LocalState = 'enabled' | 'disabled' | 'needs-setup' | 'not-installed' | 'error'

export type CatalogInstallAction =
  | { source: 'clawhub'; packageName: string }
  | { source: 'official'; pluginId: string }

export interface DiscoveryEntry {
  /** `ch_…` for ClawHub, `local_…` for bundled/installed-only. What `plugins.catalog.get` takes. */
  id: string
  catalog: {
    name: string
    packageName?: string
    summary?: string
    family?: 'code-plugin' | 'bundle-plugin'
    author?: string
    official: boolean
    categories: string[]
    icon?: string
    imageUrl?: string
    latestVersion?: string
    downloads?: number
    installs?: number
    verificationTier?: string
    publishedToClawHub?: boolean
  }
  local: {
    present: boolean
    installed: boolean
    enabled: boolean
    state: LocalState
    pluginId?: string
    install?: CatalogInstallAction
    action: 'install' | 'manage' | 'unavailable'
  }
}

export interface DiscoveryDetail {
  origin: 'clawhub' | 'local'
  packageName?: string
  /** An object here, unlike the entry's plain `catalog.author` string. */
  author?: { handle?: string; displayName?: string; imageUrl?: string }
  topics: string[]
  createdAt?: number
  updatedAt?: number
  readme?: string
  compatibility?: { pluginApiRange?: string; builtWithOpenClawVersion?: string; pluginSdkVersion?: string; minGatewayVersion?: string }
  configuration: { name: string; description?: string; required: boolean; sensitive: boolean }[]
  mcpServers: string[]
  skills: { name: string; description?: string }[]
  versions: { version: string; createdAt: number; changelog: string; tags: string[] }[]
  verification?: { tier: string; summary?: string; scanStatus?: string }
  security?: { status: string; auditUrl?: string; verdict?: string; summary?: string; guidance?: string; checkedAt?: number }
}

export interface BrowseResult {
  items: DiscoveryEntry[]
  nextCursor?: string
  remoteError?: string
}

/** Browse params for a view. A search can't take a cursor (the gateway refuses the pair). */
export function browseParams(v: { intent: CatalogIntent; category?: string | null; query?: string; cursor?: string; pageSize?: number }): Record<string, unknown> {
  const q = v.query?.trim()
  return {
    // A search runs across everything: the tab only shapes the unsearched lists.
    intent: q ? 'all' : v.intent,
    ...(q ? { query: q.slice(0, 200) } : {}),
    ...(v.category ? { category: v.category } : {}),
    ...(!q && v.cursor ? { cursor: v.cursor } : {}),
    pageSize: v.pageSize ?? 24,
  }
}

export type PillTone = 'done' | 'needsYou' | 'failed' | 'neutral'

export interface CardAction {
  /** The one button a card shows, or none. */
  kind: 'install' | 'askAdmin' | 'manage' | 'configure' | 'none'
  label?: string
  /** The state pill, when the plugin is on this gateway. */
  pill?: { tone: PillTone; text: string }
}

/**
 * The card's state pill and its one button, from the entry's state on this gateway.
 * Installed states win over the install action: a plugin that's present is managed,
 * whatever else the catalog says about it.
 */
export function cardAction(entry: DiscoveryEntry, opts: { admin: boolean }): CardAction {
  const l = entry.local
  if (l.installed && l.state !== 'not-installed') {
    switch (l.state) {
      case 'needs-setup': return { kind: 'configure', label: 'Configure', pill: { tone: 'needsYou', text: 'Needs setup' } }
      case 'disabled': return { kind: 'manage', label: 'Manage', pill: { tone: 'neutral', text: 'Off' } }
      case 'error': return { kind: 'manage', label: 'Manage', pill: { tone: 'failed', text: 'Error' } }
      default: return { kind: 'manage', label: 'Manage', pill: { tone: 'done', text: 'Installed' } }
    }
  }
  if (l.action === 'install') return opts.admin ? { kind: 'install', label: 'Install' } : { kind: 'askAdmin', label: 'Ask an admin' }
  if (l.action === 'manage') return { kind: 'manage', label: 'Manage' }
  return { kind: 'none' }
}

/**
 * Why an entry can't be installed from here. The gateway sends no reason with
 * `action: "unavailable"`, so it's inferred: a read-only config, or a local-only row with
 * nothing to install from.
 */
export function unavailableReason(entry: DiscoveryEntry, opts: { mutationAllowed: boolean | null }): string {
  if (opts.mutationAllowed === false) return "This gateway doesn't allow plugin changes from apps. Run this on the gateway host:"
  if (!installSource(entry)) return 'Not available from the catalog.'
  return "Can't be installed from here."
}

/**
 * Where an entry installs from. `local.install` is only set for a plugin the gateway
 * already has on disk but hasn't installed; a ClawHub entry never carries one, and
 * installs by its `catalog.packageName`. Whether it CAN be installed is `local.action`.
 */
function installSource(entry: DiscoveryEntry): CatalogInstallAction | null {
  if (entry.local.install) return entry.local.install
  if (entry.catalog.packageName && entry.id.startsWith('ch_')) return { source: 'clawhub', packageName: entry.catalog.packageName }
  return null
}

/** The install target for a catalog entry, at the chosen version (ClawHub only). */
export function installTargetForEntry(entry: DiscoveryEntry, opts: { version?: string; origin?: string } = {}):
  { params: InstallParams; displayName: string; pluginId?: string; origin?: string } | null {
  const install = installSource(entry)
  if (!install || entry.local.action !== 'install') return null
  const base = { displayName: entry.catalog.name, ...(entry.local.pluginId ? { pluginId: entry.local.pluginId } : {}), ...(opts.origin ? { origin: opts.origin } : {}) }
  // The official shape is closed and has no `version`: sending one fails the whole call.
  if (install.source === 'official') return { params: { source: 'official', pluginId: install.pluginId }, ...base }
  return { params: { source: 'clawhub', packageName: install.packageName, ...(opts.version ? { version: opts.version } : {}) }, ...base }
}

/**
 * The command to install an entry on the gateway host, for connections that can't. The
 * CLI takes `clawhub:<package>` for ClawHub and a bare id for official plugins.
 */
export function hostInstallCommand(entry: DiscoveryEntry): string {
  const install = installSource(entry)
  if (install?.source === 'clawhub') return `openclaw plugins install clawhub:${install.packageName}`
  const id = (install?.source === 'official' ? install.pluginId : undefined) ?? entry.local.pluginId ?? entry.catalog.name
  return `openclaw plugins install ${id}`
}

/**
 * "Needs" lines for the detail pane, from the plugin's declared configuration. A local
 * detail never carries configuration (the gateway only reads it from ClawHub), so for
 * one of those an empty list says nothing, and "Nothing to configure" would be a guess.
 *
 * `localState` is the gateway's own verdict for an installed plugin (plugins.list's
 * `state`, which the Extensions list badge reads too). When it says "needs-setup" the pane
 * never says "Nothing to configure", whatever ClawHub's listing declares.
 */
export function needsSummary(detail: Pick<DiscoveryDetail, 'configuration' | 'skills' | 'mcpServers'> & { origin?: DiscoveryDetail['origin'] }, localState?: LocalState): string[] {
  const required = detail.configuration.filter(f => f.required)
  const keys = required.filter(f => f.sensitive)
  const settings = required.filter(f => !f.sensitive)
  const out: string[] = []
  if (keys.length) out.push(`${keys.length} API key${keys.length === 1 ? '' : 's'} (${keys.map(f => f.name).join(', ')})`)
  if (settings.length) out.push(`${settings.length} required setting${settings.length === 1 ? '' : 's'}`)
  if (!out.length && localState === 'needs-setup') out.push('Required settings before it can run')
  else if (!out.length && detail.origin !== 'local') out.push('Nothing to configure')
  if (detail.skills.length) out.push(`Adds skills: ${detail.skills.map(s => s.name).join(', ')}`)
  if (detail.mcpServers.length) out.push(`Starts MCP servers: ${detail.mcpServers.join(', ')}`)
  return out
}

/**
 * The amber line for a ClawHub outage. The gateway's text is long and varies by view,
 * and what's still listed varies too: Featured, Trending and Official come back empty,
 * All keeps the installed plugins, and even Bundled is empty (its publication status
 * can't be checked). So the line says what's actually on screen.
 */
export function summariseRemoteError(msg: string | undefined, itemCount: number): string | null {
  if (!msg?.trim()) return null
  if (/\bClawHub is unavailable\b/i.test(msg)) {
    return itemCount > 0
      ? "ClawHub isn't reachable right now. Showing only what's already on this gateway."
      : "ClawHub isn't reachable right now, so this list is empty. Try again in a moment."
  }
  return msg.trim()
}

/**
 * The plugin's ClawHub page. Built the way the Control UI's "View on ClawHub" link is:
 * `/{scope or author}/plugins/{name}`, or `/plugins/{package}` when neither is known.
 */
export function clawhubUrl(packageName: string | undefined, authorHandle?: string): string | null {
  if (!packageName) return null
  const scope = /^@([^/]+)\//.exec(packageName)?.[1]
  const owner = authorHandle?.replace(/^@+/, '') || scope
  const name = packageName.split('/').at(-1)
  return owner && name
    ? `https://clawhub.ai/${encodeURIComponent(owner)}/plugins/${encodeURIComponent(name)}`
    : `https://clawhub.ai/plugins/${encodeURIComponent(packageName)}`
}

/**
 * ClawHub's security verdict as a pane line. The gateway passes on only `status` (plus an
 * audit link and a summary): no date. A pass is `clean`/`pass`/`safe`, as the Control UI
 * reads it; `blocked` (or a malicious verdict) is a block; anything else (suspicious,
 * pending, stale, unknown) deserves a look.
 */
export function securityLabel(security: DiscoveryDetail['security']): { tone: PillTone; text: string } | null {
  if (!security?.status) return null
  const s = security.status.trim().toLowerCase()
  if (/^(clean|pass|safe)$/.test(s)) return { tone: 'done', text: 'Verified clean' }
  if (s === 'blocked' || s.includes('malicious') || s.includes('malware')) return { tone: 'failed', text: 'Blocked by ClawHub' }
  return { tone: 'needsYou', text: 'Review recommended' }
}

/** Compact counts, as the Control UI shows them: 950, 3.1k, 12.4k, 1.2m. */
export function formatCount(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) { const k = n / 1000; return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k` }
  const m = n / 1_000_000
  return `${m >= 100 ? Math.round(m) : Number(m.toFixed(1))}m`
}

/**
 * Whether the plugin needs a newer gateway than this one. Versions are the gateway's
 * dated scheme ("2026.9.4"); a range prefix such as ">=" is ignored. Unknown → false.
 */
export function needsNewerGateway(minVersion: string | undefined, serverVersion: string | undefined): boolean {
  const a = versionParts(minVersion), b = versionParts(serverVersion)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}
function versionParts(v: string | undefined): number[] | null {
  const m = /(\d+(?:\.\d+)*)/.exec(v ?? '')
  return m ? m[1].split('.').map(Number) : null
}

/** The README, cut to a size that renders quickly. The full text is on ClawHub. */
export const README_RENDER_LIMIT = 64 * 1024
export function readmeForDisplay(readme: string | undefined): { text: string; truncated: boolean } | null {
  if (!readme?.trim()) return null
  return readme.length > README_RENDER_LIMIT
    ? { text: readme.slice(0, README_RENDER_LIMIT), truncated: true }
    : { text: readme, truncated: false }
}

/** "today", "yesterday", "3 days ago", "5 weeks ago", "2 years ago". */
export function updatedAgo(ms: number, now = Date.now()): string {
  const days = Math.floor(Math.max(0, now - ms) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
