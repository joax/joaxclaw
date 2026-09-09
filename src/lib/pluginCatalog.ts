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

function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
