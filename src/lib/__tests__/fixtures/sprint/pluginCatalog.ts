// Real plugin-catalog / install / restart payload shapes, from the OpenClaw 2026.9.4 gateway
// source (QA, sprint 2026.9, PRD 06). Paths are relative to the npm package `dist/`.
//
//  - Protocol schemas: dist/sessions-rlbLHLas.mjs:12-524 (region packages/gateway-protocol/src/schema/plugins.ts).
//    Every object is closed (additionalProperties: false) — extra params are rejected.
//  - Read handlers:    dist/plugins-Bseu8N34.mjs (plugins.list / search / inspect / catalog.*).
//  - Entry joining:    dist/catalog-discovery-DVpbiIEc.mjs (ids, `local` facts, detail projection).
//  - ClawHub parsing:  dist/management-service-a9oXcryo.mjs:31-425 (what is actually filled in).
//  - Install handler:  dist/plugins-mutations-pdGQVwQb.mjs:19-44; error details dist/src-7tzZ8j12.mjs:28-106.
//  - Restart handler:  dist/restart-B99ImsD6.mjs:21-76 -> dist/restart-coordinator-9EVX5NoM.mjs:34-49
//    -> dist/restart-PDAKwQWW.mjs:744-862.
//  - Error envelope:   errorShape() dist/error-codes-C3Z5XSDw.mjs:65; codes dist/gateway-error-details-Brpdn9L1.mjs:6.
//
// Timestamps are ms near 2026-09-18 (1789700000000 = 2026-09-18T02:53:20Z). Discovery ids are the
// real encoding: "ch_" + base64url(packageName) or "local_" + base64url(pluginId).

// ── Error envelope ─────────────────────────────────────────────────────────────

/** `res.error` of a failed request. errorShape(code, message, opts) = { code, message, ...opts } — dist/error-codes-C3Z5XSDw.mjs:65. */
export interface GatewayErrorShape {
  code: 'INVALID_REQUEST' | 'FORBIDDEN' | 'UNAVAILABLE' | 'NOT_PAIRED' | 'APPROVAL_NOT_FOUND'
  message: string
  details?: unknown
  retryable?: boolean
  retryAfterMs?: number
}

/** A full response frame, as the app's socket receives it. */
export interface GatewayResFrame<T = unknown> {
  type: 'res'
  id: string
  ok: boolean
  payload?: T
  error?: GatewayErrorShape
}

// ── Discovery shapes (plugins.catalog.*) ───────────────────────────────────────

export type CatalogIntent = 'all' | 'bundled' | 'trending' | 'official' | 'featured'
export type LocalPluginState = 'enabled' | 'disabled' | 'needs-setup' | 'not-installed' | 'error'

/** PluginCatalogInstallActionSchema — dist/sessions-rlbLHLas.mjs:104-113. */
export type CatalogInstallAction =
  | { source: 'clawhub'; packageName: string }
  | { source: 'official'; pluginId: string }

/** PluginDiscoveryCategorySchema — dist/sessions-rlbLHLas.mjs:292-298. `icon` is normalised to one of 12 keys, else "package" (management-service-a9oXcryo.mjs:35-48,315). */
export interface CatalogCategory {
  slug: string
  label: string
  description: string
  icon: string
  order: number
}

/** PluginDiscoveryCatalogFactsSchema — dist/sessions-rlbLHLas.mjs:299-314. NB `author` is a plain handle string here. */
export interface DiscoveryCatalogFacts {
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

/** PluginDiscoveryLocalFactsSchema — dist/sessions-rlbLHLas.mjs:315-334; projected by projectLocalFacts, dist/catalog-discovery-DVpbiIEc.mjs:19-36. */
export interface DiscoveryLocalFacts {
  present: boolean
  installed: boolean
  enabled: boolean
  state: LocalPluginState
  pluginId?: string
  /** Only for a PRESENT, not-installed local plugin with an install record. Never on a ClawHub-only entry. */
  install?: CatalogInstallAction
  action: 'install' | 'manage' | 'unavailable'
}

/** PluginDiscoveryEntrySchema — dist/sessions-rlbLHLas.mjs:335-343. id matches ^[A-Za-z0-9_-]+$, ≤512. */
export interface DiscoveryEntry {
  id: string
  catalog: DiscoveryCatalogFacts
  local: DiscoveryLocalFacts
}

/** PluginsCatalogBrowseParamsSchema — dist/sessions-rlbLHLas.mjs:344-360. */
export interface CatalogBrowseParams {
  query?: string
  intent?: CatalogIntent
  category?: string
  cursor?: string
  pageSize?: number
}

/** PluginsCatalogBrowseResultSchema — dist/sessions-rlbLHLas.mjs:361-368. */
export interface CatalogBrowseResult {
  items: DiscoveryEntry[]
  nextCursor?: string
  remoteError?: string
}

/** PluginsCatalogCategoriesResultSchema — dist/sessions-rlbLHLas.mjs:370. Categories come ONLY from ClawHub. */
export interface CatalogCategoriesResult {
  categories: CatalogCategory[]
}

/** PluginsCatalogGetParamsSchema — dist/sessions-rlbLHLas.mjs:371-378. */
export interface CatalogGetParams {
  id: string
  version?: string
}

/** PluginDiscoveryDetailSchema — dist/sessions-rlbLHLas.mjs:397-437. */
export interface DiscoveryDetail {
  origin: 'clawhub' | 'local'
  packageName?: string
  /** An OBJECT here (the entry's catalog.author is a string). */
  author?: { handle?: string; displayName?: string; imageUrl?: string }
  topics: string[]
  createdAt?: number
  updatedAt?: number
  /** ≤ 524288 chars. */
  readme?: string
  compatibility?: { pluginApiRange?: string; builtWithOpenClawVersion?: string; pluginSdkVersion?: string; minGatewayVersion?: string }
  configuration: { name: string; description?: string; required: boolean; sensitive: boolean }[]
  mcpServers: string[]
  /** Objects, not strings. */
  skills: { name: string; description?: string }[]
  /** ≤ 10, newest first as ClawHub returns them. createdAt is ms. */
  versions: { version: string; createdAt: number; changelog: string; tags: string[] }[]
  verification?: { tier: string; summary?: string; sourceRepo?: string; sourceCommit?: string; sourcePath?: string; scanStatus?: string }
  /**
   * The handler only ever fills status / auditUrl / summary (projectSecurity,
   * dist/management-service-a9oXcryo.mjs:173-181). `verdict`, `guidance`, `checkedAt` exist in the
   * schema but are never set in 2026.9.4. status ∈ blocked | pending | stale | <moderationState> |
   * <scanStatus e.g. clean, suspicious> | unknown.
   */
  security?: { status: string; auditUrl?: string; verdict?: string; summary?: string; guidance?: string; checkedAt?: number }
}

/** PluginsCatalogGetResultSchema — dist/sessions-rlbLHLas.mjs:438-441. */
export interface CatalogGetResult {
  plugin: DiscoveryEntry
  detail: DiscoveryDetail
}

// ── plugins.list / inspect / install ───────────────────────────────────────────

/** PluginCatalogEntrySchema (the plugins.list row, also plugins.install's `plugin`) — dist/sessions-rlbLHLas.mjs:116-155. */
export interface PluginListEntry {
  id: string
  name: string
  packageName?: string
  clawhubPackage?: string
  /** Added by the plugins.list handler when clawhubPackage is known (dist/plugins-Bseu8N34.mjs:34). */
  catalogId?: string
  description?: string
  version?: string
  kind?: string[]
  origin?: string
  installed: boolean
  enabled: boolean
  state: LocalPluginState
  featured?: boolean
  featuredAt?: number
  order?: number
  hasIcon?: boolean
  install?: CatalogInstallAction
  error?: string
  categories?: string[]
  category?: string
  removable?: boolean
}

/** PluginsListResultSchema — dist/sessions-rlbLHLas.mjs:158-162. mutationAllowed = !resolveIsConfigReadOnly (management-service-a9oXcryo.mjs:833). */
export interface PluginsListResult {
  plugins: PluginListEntry[]
  diagnostics: unknown[]
  mutationAllowed: boolean
}

/** PluginsInstallParamsSchema — dist/sessions-rlbLHLas.mjs:474-486. `version` exists ONLY on the clawhub branch. */
export type PluginsInstallParams =
  | { source: 'clawhub'; packageName: string; version?: string; acknowledgeInstallPolicyWarning?: true; acknowledgeCapabilities?: { reviewToken: string } }
  | { source: 'official'; pluginId: string; acknowledgeInstallPolicyWarning?: true; acknowledgeCapabilities?: { reviewToken: string } }

/** PluginsInstallResultSchema — dist/sessions-rlbLHLas.mjs:488-493. */
export interface PluginsInstallResult {
  ok: true
  plugin: PluginListEntry
  restartRequired: true
  warnings?: string[]
}

/** CapabilityConsentErrorDetailsSchema — dist/sessions-rlbLHLas.mjs:236-242. */
export interface CapabilityConsentDetails {
  capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED'
  pluginId: string
  reviewToken: string
  widened?: Record<string, string[]>
  acceptedAt?: string
}

/** readInstallPolicyWarningErrorDetails — dist/src-7tzZ8j12.mjs:80-106 (gateway drops the WHOLE block if any finding is malformed). */
export interface InstallPolicyWarningDetails {
  installPolicyCode: 'install_policy_warning_acknowledgement_required'
  targetName: string
  targetType: 'skill' | 'plugin'
  requestMode: 'install' | 'update'
  reason: string
  findings?: { ruleId: string; severity: 'info' | 'warn' | 'critical'; message: string; file?: string; line?: number; evidence?: string }[]
}

/** buildClawHubTrustErrorDetails — dist/src-7tzZ8j12.mjs:37-44. Every field optional. */
export interface ClawHubTrustDetails {
  clawhubTrustCode?: 'clawhub_security_unavailable' | 'clawhub_download_blocked'
  version?: string
  warning?: string
}

// ── gateway.restart.request ────────────────────────────────────────────────────

/** No typebox schema; handler reads these loosely — dist/restart-B99ImsD6.mjs:21-76. reason is trimmed and cut to 200. */
export interface RestartRequestParams {
  reason?: string
  skipDeferral?: boolean
  /** Only for targeted restarts (not used by JoaxClaw). */
  target?: unknown
  safe?: boolean
  restartIntent?: unknown
}

/** createSafeGatewayRestartPreflight — dist/restart-coordinator-9EVX5NoM.mjs:4-32. */
export interface RestartPreflight {
  safe: boolean
  counts: { queueSize: number; pendingReplies: number; embeddedRuns: number; cronRuns: number; backgroundExecSessions: number; rootRequests: number; activeTasks: number; totalActive: number }
  blockers: { kind: string; count?: number; message: string }[]
  summary: string
}

/** scheduleSafeGatewayRestart — dist/restart-coordinator-9EVX5NoM.mjs:34-49 + scheduleGatewaySigusr1Restart dist/restart-PDAKwQWW.mjs:744-862. */
export interface RestartRequestResult {
  ok: true
  status: 'scheduled' | 'deferred' | 'coalesced'
  preflight: RestartPreflight
  restart: {
    ok: true
    pid: number
    signal: 'SIGUSR1'
    reason?: string
    mode: 'emit' | 'supervisor' | 'signal'
    /** 30 s cooldown after the previous restart (RESTART_COOLDOWN_MS, restart-PDAKwQWW.mjs:137). */
    cooldownMsApplied: number
    delayMs: number
    coalesced: boolean
    emitHooksQueued: boolean
  }
}

/** `shutdown` event broadcast before the socket closes — resolveGatewayShutdownNotice, dist/server-shutdown-BZGs1V6W.mjs:21-27. */
export interface ShutdownEventPayload {
  reason: string
  restartExpectedMs?: number
}

/** The hello-ok fields that matter for restart detection — HelloOkSchema dist/sessions-rlbLHLas.mjs:1331-1350. */
export interface HelloOkServerSlice {
  server: { version: string; buildId?: string; bootId?: string; controlUiBuildSource?: 'bundled' | 'configured'; connId: string }
  features: { methods: string[]; events: string[]; capabilities?: string[] }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Samples
// ═══════════════════════════════════════════════════════════════════════════════

export const IDS = {
  issueTracker: 'ch_QGV4YW1wbGUtcHVibGlzaGVyL2lzc3VlLXRyYWNrZXI', // @example-publisher/issue-tracker
  vaultNotes: 'ch_dmF1bHQtbm90ZXM', // vault-notes
  homeControl: 'ch_QGFjbWUvaG9tZS1jb250cm9s', // @acme/home-control
  voiceCall: 'ch_QG9wZW5jbGF3L3ZvaWNlLWNhbGw', // @openclaw/voice-call
  postinstallDemo: 'ch_QHNoYWR5L3Bvc3RpbnN0YWxsLWRlbW8', // @shady/postinstall-demo
  localMemoryCore: 'local_bWVtb3J5LWNvcmU', // memory-core
  localBrowser: 'local_YnJvd3Nlcg', // browser
  localJoaxclawFs: 'local_am9heGNsYXctZnM', // joaxclaw-fs
} as const

// ── categories ──

export const CATEGORIES_OK: CatalogCategoriesResult = {
  categories: [
    { slug: 'channels', label: 'Channels', description: 'Connect messaging apps.', icon: 'message-circle', order: 0 },
    { slug: 'memory', label: 'Memory', description: 'Long-term recall and notes.', icon: 'brain', order: 1 },
    { slug: 'developer', label: 'Developer', description: 'Code, repos and CI.', icon: 'git-branch', order: 2 },
    { slug: 'voice', label: 'Voice', description: 'Speech in and out.', icon: 'activity', order: 3 },
    // Unknown icon keys from ClawHub are normalised to "package".
    { slug: 'productivity', label: 'Productivity', description: 'Calendars, tasks and docs.', icon: 'package', order: 4 },
  ],
}

export const CATEGORIES_EMPTY: CatalogCategoriesResult = { categories: [] }

/** ClawHub down — dist/plugins-Bseu8N34.mjs:149. The PRD hides the chips row. */
export const CATEGORIES_UNAVAILABLE: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'Plugin categories are unavailable: fetch failed. Retry to reconnect to ClawHub.',
}

// ── entries ──

/** ClawHub-only, not installed, config writable: action install, NO local.install (catalog-discovery-DVpbiIEc.mjs:20-26). */
export const ENTRY_REMOTE_INSTALLABLE: DiscoveryEntry = {
  id: IDS.issueTracker,
  catalog: {
    name: 'Issue Tracker',
    packageName: '@example-publisher/issue-tracker',
    summary: 'Search, create and update issues.',
    family: 'code-plugin',
    author: 'example-publisher',
    official: true,
    categories: ['developer', 'productivity'],
    imageUrl: 'https://clawhub.ai/api/v1/packages/%40example-publisher%2Fissue-tracker/icon',
    latestVersion: '1.4.2',
    downloads: 48210,
    installs: 12400,
    verificationTier: 'verified',
    publishedToClawHub: true,
  },
  local: { present: false, installed: false, enabled: false, state: 'not-installed', action: 'install' },
}

/** Same entry on a read-only config (mutationAllowed false): action unavailable, no install. */
export const ENTRY_REMOTE_READ_ONLY: DiscoveryEntry = {
  ...ENTRY_REMOTE_INSTALLABLE,
  local: { present: false, installed: false, enabled: false, state: 'not-installed', action: 'unavailable' },
}

/** Minimal ClawHub entry: optional fields absent (no summary/author/imageUrl/stats). */
export const ENTRY_REMOTE_MINIMAL: DiscoveryEntry = {
  id: IDS.postinstallDemo,
  catalog: {
    name: 'Postinstall Demo',
    packageName: '@shady/postinstall-demo',
    family: 'bundle-plugin',
    official: false,
    categories: [],
    publishedToClawHub: true,
  },
  local: { present: false, installed: false, enabled: false, state: 'not-installed', action: 'install' },
}

/** Installed + enabled ClawHub plugin: action manage, pluginId present, install omitted because installed. */
export const ENTRY_INSTALLED_ENABLED: DiscoveryEntry = {
  id: IDS.vaultNotes,
  catalog: {
    name: 'Vault Notes',
    packageName: 'vault-notes',
    summary: 'Read and search a notes vault.',
    family: 'code-plugin',
    author: 'obsidian-tools',
    official: false,
    categories: ['memory'],
    latestVersion: '0.9.0',
    downloads: 9120,
    installs: 3100,
    publishedToClawHub: true,
  },
  local: { present: true, installed: true, enabled: true, state: 'enabled', pluginId: 'vault-notes', action: 'manage' },
}

export const ENTRY_INSTALLED_NEEDS_SETUP: DiscoveryEntry = {
  id: IDS.homeControl,
  catalog: {
    name: 'Home Control',
    packageName: '@acme/home-control',
    summary: 'Lights, climate and scenes.',
    family: 'code-plugin',
    author: 'acme',
    official: false,
    categories: ['productivity'],
    latestVersion: '2.1.0',
    downloads: 1502,
    installs: 640,
    publishedToClawHub: true,
  },
  local: { present: true, installed: true, enabled: false, state: 'needs-setup', pluginId: 'home-control', action: 'manage' },
}

export const ENTRY_INSTALLED_DISABLED: DiscoveryEntry = {
  ...ENTRY_INSTALLED_NEEDS_SETUP,
  local: { present: true, installed: true, enabled: false, state: 'disabled', pluginId: 'home-control', action: 'manage' },
}

export const ENTRY_INSTALLED_ERROR: DiscoveryEntry = {
  ...ENTRY_INSTALLED_NEEDS_SETUP,
  local: { present: true, installed: true, enabled: true, state: 'error', pluginId: 'home-control', action: 'manage' },
}

/**
 * Local-only bundled plugin, not installed, no install record → unavailable even on a writable
 * config (remoteInstallable=false, catalog-discovery-DVpbiIEc.mjs:34,136). Local entries are
 * ALWAYS official:false and carry no stats/author/imageUrl (:121-138).
 */
export const ENTRY_LOCAL_UNAVAILABLE: DiscoveryEntry = {
  id: IDS.localBrowser,
  catalog: {
    name: 'Browser',
    summary: 'Headless browser tools for agents.',
    official: false,
    categories: ['developer'],
    publishedToClawHub: false,
    latestVersion: '2026.9.4',
  },
  local: { present: true, installed: false, enabled: false, state: 'not-installed', pluginId: 'browser', action: 'unavailable' },
}

/** Present, not installed, with an official install action: the one case where local.install is set. */
export const ENTRY_LOCAL_OFFICIAL_INSTALLABLE: DiscoveryEntry = {
  id: IDS.localMemoryCore,
  catalog: {
    name: 'Memory (Core)',
    summary: 'File-backed memory search.',
    official: false,
    categories: ['memory'],
    publishedToClawHub: false,
  },
  local: {
    present: true,
    installed: false,
    enabled: false,
    state: 'not-installed',
    pluginId: 'memory-core',
    install: { source: 'official', pluginId: 'memory-core' },
    action: 'install',
  },
}

/** Installed local-only plugin (e.g. JoaxClaw's own), no ClawHub identity: `publishedToClawHub` omitted when unverified. */
export const ENTRY_LOCAL_INSTALLED: DiscoveryEntry = {
  id: IDS.localJoaxclawFs,
  catalog: {
    name: 'JoaxClaw FS',
    packageName: 'openclaw-joaxclaw-fs',
    summary: 'Host file access for JoaxClaw.',
    official: false,
    categories: [],
    latestVersion: '1.6.0',
  },
  local: { present: true, installed: true, enabled: true, state: 'enabled', pluginId: 'joaxclaw-fs', action: 'manage' },
}

// ── browse results ──

export const BROWSE_FEATURED_PAGE_1: CatalogBrowseResult = {
  items: [ENTRY_REMOTE_INSTALLABLE, ENTRY_INSTALLED_ENABLED, ENTRY_INSTALLED_NEEDS_SETUP],
  nextCursor: 'eyJvIjoyNCwicyI6ImZlYXR1cmVkIn0',
}

export const BROWSE_LAST_PAGE: CatalogBrowseResult = {
  items: [ENTRY_REMOTE_MINIMAL],
}

export const BROWSE_EMPTY: CatalogBrowseResult = { items: [] }

/** Search (query set): ClawHub search never returns a cursor (parseCatalogSearch, management-service-a9oXcryo.mjs:93-99). */
export const BROWSE_SEARCH_RESULT: CatalogBrowseResult = {
  items: [ENTRY_LOCAL_INSTALLED, ENTRY_REMOTE_INSTALLABLE],
}

/**
 * intent "all", no query, ClawHub list call failed: installed local plugins only, and the
 * remoteError suffix is " Installed plugins remain available." — dist/plugins-Bseu8N34.mjs:124-138.
 */
export const BROWSE_ALL_CLAWHUB_DOWN: CatalogBrowseResult = {
  items: [ENTRY_LOCAL_INSTALLED],
  remoteError: 'ClawHub is unavailable: fetch failed. Installed plugins remain available.',
}

/** intent "featured"/"trending"/"official", ClawHub down: NO local items and no suffix at all. */
export const BROWSE_FEATURED_CLAWHUB_DOWN: CatalogBrowseResult = {
  items: [],
  remoteError: 'ClawHub is unavailable: fetch failed.',
}

/**
 * intent "bundled", ClawHub down: the official-publication fetch fails, so bundled-only entries
 * are NOT included (canIncludeBundledOnly false) and the list is EMPTY — plugins-Bseu8N34.mjs:94-99,
 * catalog-discovery-DVpbiIEc.mjs:90.
 */
export const BROWSE_BUNDLED_CLAWHUB_DOWN: CatalogBrowseResult = {
  items: [],
  remoteError: 'ClawHub is unavailable: fetch failed. Bundled publication status could not be verified.',
}

/** intent "all" + query, publication list OK but search failed: " Bundled plugins remain available." */
export const BROWSE_SEARCH_PARTIAL: CatalogBrowseResult = {
  items: [ENTRY_LOCAL_UNAVAILABLE],
  remoteError: 'ClawHub is unavailable: request timed out after 10000ms. Bundled plugins remain available.',
}

/** intent "all" + query, both ClawHub calls failed: two sentences joined with a space. */
export const BROWSE_SEARCH_BOTH_DOWN: CatalogBrowseResult = {
  items: [ENTRY_LOCAL_INSTALLED],
  remoteError:
    'ClawHub is unavailable: fetch failed. Bundled publication status could not be verified. ClawHub is unavailable: fetch failed. Installed plugins remain available.',
}

/**
 * A cursor page when ClawHub fails: the handler ECHOES the request cursor back as nextCursor
 * (plugins-Bseu8N34.mjs:136). A naive "Load more" loops on the same cursor forever.
 */
export const BROWSE_CURSOR_PAGE_CLAWHUB_DOWN_REQUEST: CatalogBrowseParams = {
  intent: 'trending',
  cursor: 'eyJvIjoyNCwicyI6InRyZW5kaW5nIn0',
  pageSize: 24,
}
export const BROWSE_CURSOR_PAGE_CLAWHUB_DOWN: CatalogBrowseResult = {
  items: [],
  nextCursor: 'eyJvIjoyNCwicyI6InRyZW5kaW5nIn0',
  remoteError: 'ClawHub is unavailable: fetch failed.',
}

/** base64url without padding, as encodeDiscoveryId does (catalog-discovery-DVpbiIEc.mjs:38-42). ASCII input only. */
function base64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Oversize page: pageSize max is 100. */
export const BROWSE_OVERSIZE_PAGE: CatalogBrowseResult = {
  items: Array.from({ length: 100 }, (_, i) => ({
    ...ENTRY_REMOTE_MINIMAL,
    id: `ch_${base64url(`@bulk/plugin-${i}`)}`,
    catalog: { ...ENTRY_REMOTE_MINIMAL.catalog, name: `Bulk Plugin ${i}`, packageName: `@bulk/plugin-${i}`, downloads: 1000 - i },
  })),
  nextCursor: 'eyJvIjoxMDB9',
}

// browse requests
export const BROWSE_PARAMS_FEATURED: CatalogBrowseParams = { intent: 'featured', pageSize: 24 }
export const BROWSE_PARAMS_CATEGORY: CatalogBrowseParams = { intent: 'trending', category: 'developer', pageSize: 24 }
export const BROWSE_PARAMS_NEXT_PAGE: CatalogBrowseParams = { intent: 'featured', cursor: 'eyJvIjoyNCwicyI6ImZlYXR1cmVkIn0', pageSize: 24 }
export const BROWSE_PARAMS_SEARCH: CatalogBrowseParams = { query: 'calendar', intent: 'all' }

// browse errors
/** dist/plugins-Bseu8N34.mjs:84 */
export const BROWSE_ERR_SEARCH_WITH_CURSOR: GatewayErrorShape = {
  code: 'INVALID_REQUEST',
  message: 'Plugin search does not accept a browse cursor.',
}
/** Only when the LOCAL inventory (listManagedPlugins) throws — not when ClawHub is down. dist/plugins-Bseu8N34.mjs:141 */
export const BROWSE_ERR_DISCOVERY_DOWN: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'Plugin discovery is unavailable: EACCES: permission denied, open \'/home/op/.openclaw/plugins/index.json\'. Retry to reconnect to ClawHub.',
}
/** Schema failure (e.g. pageSize 200, category "Dev"). Format: assertValidParams, dist/validation-Cn7ErDZ-.mjs. */
export const BROWSE_ERR_INVALID_PARAMS: GatewayErrorShape = {
  code: 'INVALID_REQUEST',
  message: 'invalid plugins.catalog.browse params: at /pageSize: must be <= 100',
}
/** Official install with a `version` (closed union schema) — formatValidationErrors, dist/src-7tzZ8j12.mjs:987-1016. Exact text depends on the union's error list. */
export const INSTALL_ERR_OFFICIAL_WITH_VERSION: GatewayErrorShape = {
  code: 'INVALID_REQUEST',
  message: "invalid plugins.install params: at root: unexpected property 'version'; must match a schema in anyOf",
}

// ── detail ──

export const DETAIL_CLAWHUB_FULL: CatalogGetResult = {
  plugin: ENTRY_REMOTE_INSTALLABLE,
  detail: {
    origin: 'clawhub',
    packageName: '@example-publisher/issue-tracker',
    author: { handle: 'example-publisher', displayName: 'Example Publisher', imageUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
    topics: ['issues', 'tickets'],
    createdAt: 1780000000000,
    updatedAt: 1789440000000,
    readme: '# Issue Tracker\n\nConnects agents to your issue tracker.\n\n<details><summary>Setup</summary>Set `ISSUE_TOKEN`.</details>\n',
    compatibility: { pluginApiRange: '>=2026.7.0', builtWithOpenClawVersion: '2026.9.2', minGatewayVersion: '2026.9.0' },
    configuration: [
      { name: 'ISSUE_TOKEN', description: 'API token for the tracker.', required: true, sensitive: true },
      { name: 'baseUrl', description: 'Tracker URL.', required: false, sensitive: false },
    ],
    mcpServers: [],
    skills: [{ name: 'triage', description: 'Label and route new issues.' }],
    versions: [
      { version: '1.4.2', createdAt: 1789440000000, changelog: 'Fix pagination.', tags: ['latest'] },
      { version: '1.5.0-beta.1', createdAt: 1789500000000, changelog: '', tags: ['beta'] },
      { version: '1.4.1', createdAt: 1788800000000, changelog: 'Initial public release.', tags: [] },
    ],
    verification: { tier: 'verified', summary: 'Source matches the published artifact.', sourceRepo: 'github.com/example-publisher/issue-tracker', sourceCommit: '3f2c9e1', scanStatus: 'clean' },
    security: { status: 'clean', auditUrl: 'https://clawhub.ai/example-publisher/plugins/issue-tracker/security-audit', summary: 'No findings.' },
  },
}

/** Detail with a minimum-gateway requirement above the connected version and a non-clean scan. */
export const DETAIL_CLAWHUB_NEEDS_NEWER_GATEWAY: CatalogGetResult = {
  plugin: ENTRY_REMOTE_MINIMAL,
  detail: {
    origin: 'clawhub',
    packageName: '@shady/postinstall-demo',
    topics: [],
    compatibility: { minGatewayVersion: '2026.10.0' },
    configuration: [
      { name: 'endpoint', required: true, sensitive: false },
      { name: 'region', required: true, sensitive: false },
    ],
    mcpServers: ['demo-mcp'],
    skills: [],
    versions: [{ version: '0.0.3', createdAt: 1789600000000, changelog: '', tags: ['latest'] }],
    security: { status: 'suspicious', auditUrl: 'https://clawhub.ai/shady/plugins/postinstall-demo/security-audit', summary: 'Runs a postinstall script.' },
  },
}

/** ClawHub blocked release — projectSecurity returns status "blocked". */
export const DETAIL_CLAWHUB_BLOCKED: CatalogGetResult = {
  ...DETAIL_CLAWHUB_NEEDS_NEWER_GATEWAY,
  detail: { ...DETAIL_CLAWHUB_NEEDS_NEWER_GATEWAY.detail, security: { status: 'blocked', auditUrl: 'https://clawhub.ai/shady/plugins/postinstall-demo/security-audit', summary: 'Malicious payload detected.' } },
}

/**
 * Local detail (joinLocalPluginDetail, catalog-discovery-DVpbiIEc.mjs:146-161): configuration,
 * topics and versions are ALWAYS empty, no readme/security/compatibility; skills come from the
 * installed components as {name}. "Nothing to configure" would be wrong here.
 */
export const DETAIL_LOCAL: CatalogGetResult = {
  plugin: ENTRY_LOCAL_INSTALLED,
  detail: {
    origin: 'local',
    packageName: 'openclaw-joaxclaw-fs',
    topics: [],
    configuration: [],
    mcpServers: [],
    skills: [{ name: 'joaxclaw-files' }],
    versions: [],
  },
}

/** Oversize README (schema max 524288); PRD renders the first 64 KiB. */
export const DETAIL_OVERSIZE_README: CatalogGetResult = {
  plugin: ENTRY_REMOTE_INSTALLABLE,
  detail: { ...DETAIL_CLAWHUB_FULL.detail, readme: `# Big\n\n${'lorem ipsum '.repeat(43690)}` },
}

export const GET_PARAMS: CatalogGetParams = { id: IDS.issueTracker }
export const GET_PARAMS_VERSION: CatalogGetParams = { id: IDS.issueTracker, version: '1.4.1' }

/** dist/plugins-Bseu8N34.mjs:156 (bad prefix / non-canonical base64url). */
export const GET_ERR_UNKNOWN_ID: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'Unknown plugin discovery identity.' }
/** dist/plugins-Bseu8N34.mjs:164 */
export const GET_ERR_UNKNOWN_LOCAL: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'Unknown local plugin discovery identity.' }
/** dist/plugins-Bseu8N34.mjs:202 (ClawHub failed and no local fallback). */
export const GET_ERR_UNAVAILABLE: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'Plugin details are unavailable: ClawHub request failed (404 Not Found). Retry to reconnect to ClawHub.',
}

// ── plugins.list ──

export const LIST_ROW_VAULT_NOTES: PluginListEntry = {
  id: 'vault-notes',
  name: 'Vault Notes',
  packageName: 'vault-notes',
  clawhubPackage: 'vault-notes',
  catalogId: IDS.vaultNotes,
  description: 'Read and search a notes vault.',
  version: '0.9.0',
  origin: 'global',
  installed: true,
  enabled: true,
  state: 'enabled',
  hasIcon: false,
  categories: ['memory'],
  category: 'memory',
  removable: true,
}

export const LIST_ROW_ISSUE_TRACKER_INSTALLED: PluginListEntry = {
  id: 'issue-tracker',
  name: 'Issue Tracker',
  packageName: '@example-publisher/issue-tracker',
  clawhubPackage: '@example-publisher/issue-tracker',
  catalogId: IDS.issueTracker,
  version: '1.4.2',
  origin: 'global',
  installed: true,
  enabled: false,
  state: 'needs-setup',
  categories: ['developer', 'productivity'],
  category: 'developer',
  removable: true,
}

export const LIST_ROW_ERROR: PluginListEntry = {
  ...LIST_ROW_ISSUE_TRACKER_INSTALLED,
  enabled: true,
  state: 'error',
  error: 'Cannot find module \'@example-publisher/issue-tracker/dist/index.js\'',
}

/** A curated official entry that isn't installed: install action present. */
export const LIST_ROW_OFFICIAL_NOT_INSTALLED: PluginListEntry = {
  id: 'google-meet',
  name: 'Google Meet',
  packageName: '@openclaw/google-meet',
  origin: 'official',
  installed: false,
  enabled: false,
  state: 'not-installed',
  install: { source: 'official', pluginId: 'google-meet' },
  removable: false,
}

export const LIST_OK: PluginsListResult = {
  plugins: [LIST_ROW_VAULT_NOTES, LIST_ROW_OFFICIAL_NOT_INSTALLED],
  diagnostics: [],
  mutationAllowed: true,
}
export const LIST_AFTER_INSTALL_NEEDS_SETUP: PluginsListResult = {
  plugins: [LIST_ROW_VAULT_NOTES, LIST_ROW_ISSUE_TRACKER_INSTALLED, LIST_ROW_OFFICIAL_NOT_INSTALLED],
  diagnostics: [],
  mutationAllowed: true,
}
export const LIST_AFTER_INSTALL_ERROR: PluginsListResult = {
  plugins: [LIST_ROW_VAULT_NOTES, LIST_ROW_ERROR],
  diagnostics: [{ level: 'error', pluginId: 'issue-tracker', message: 'failed to load plugin' }],
  mutationAllowed: true,
}
/** Installed plugin missing after restart ("installed.missing"). */
export const LIST_AFTER_INSTALL_MISSING: PluginsListResult = LIST_OK
export const LIST_READ_ONLY: PluginsListResult = { plugins: [LIST_ROW_VAULT_NOTES], diagnostics: [], mutationAllowed: false }

// ── plugins.install ──

export const INSTALL_PARAMS_CLAWHUB: PluginsInstallParams = { source: 'clawhub', packageName: '@example-publisher/issue-tracker', version: '1.4.2' }
export const INSTALL_PARAMS_CLAWHUB_ACKED: PluginsInstallParams = {
  source: 'clawhub',
  packageName: '@example-publisher/issue-tracker',
  version: '1.4.2',
  acknowledgeInstallPolicyWarning: true,
  acknowledgeCapabilities: { reviewToken: 'rvw_9c1f0d7e2b4a4f7e8a31' }, // secrets:allow (fake fixture token)
}
/** Official branch has NO version field (closed schema rejects it). */
export const INSTALL_PARAMS_OFFICIAL: PluginsInstallParams = { source: 'official', pluginId: 'google-meet' }

export const INSTALL_OK_ENABLED: PluginsInstallResult = {
  ok: true,
  plugin: { ...LIST_ROW_ISSUE_TRACKER_INSTALLED, enabled: true, state: 'enabled' },
  restartRequired: true,
}

/** Installed but left disabled because required config is missing — management-install-DVho0eeC.mjs:268-269. */
export const INSTALL_OK_NEEDS_SETUP: PluginsInstallResult = {
  ok: true,
  plugin: LIST_ROW_ISSUE_TRACKER_INSTALLED,
  restartRequired: true,
  warnings: [
    'Installed plugin "issue-tracker" without enabling it because it requires configuration first. Configure it, then run `openclaw plugins enable issue-tracker`.',
  ],
}

export const INSTALL_ERR_CONSENT: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'Plugin "issue-tracker" requires capability consent; disable and re-enable it or run `openclaw plugins enable issue-tracker --accept-capabilities`.',
  details: {
    capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED',
    pluginId: 'issue-tracker',
    reviewToken: 'rvw_9c1f0d7e2b4a4f7e8a31', // secrets:allow (fake fixture token)
  } satisfies CapabilityConsentDetails,
}

export const INSTALL_ERR_CONSENT_WIDENED: GatewayErrorShape = {
  ...INSTALL_ERR_CONSENT,
  details: {
    capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED',
    pluginId: 'issue-tracker',
    reviewToken: 'rvw_1a2b3c4d5e6f', // secrets:allow (fake fixture token)
    widened: { tools: ['issue_delete'], mcpServers: ['tracker-mcp'] },
    acceptedAt: '2026-09-01T10:12:00.000Z',
  } satisfies CapabilityConsentDetails,
}

/** `message` is illustrative (the installer's text); read `details`, never the message. */
export const INSTALL_ERR_POLICY: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'Install policy flagged plugin "@shady/postinstall-demo"; acknowledge the warning to continue.',
  details: {
    installPolicyCode: 'install_policy_warning_acknowledgement_required',
    targetName: '@shady/postinstall-demo',
    targetType: 'plugin',
    requestMode: 'install',
    reason: 'Package runs a postinstall script.',
    findings: [
      { ruleId: 'scripts.postinstall', severity: 'warn', message: 'spawns a process', file: 'scripts/postinstall.js', line: 3, evidence: 'child_process.spawn(' },
      { ruleId: 'net.external-host', severity: 'info', message: 'links to an external host', file: 'README.md' },
    ],
  } satisfies InstallPolicyWarningDetails,
}

export const INSTALL_ERR_POLICY_CRITICAL: GatewayErrorShape = {
  ...INSTALL_ERR_POLICY,
  details: {
    installPolicyCode: 'install_policy_warning_acknowledgement_required',
    targetName: '@shady/postinstall-demo',
    targetType: 'plugin',
    requestMode: 'install',
    reason: 'Package contains obfuscated code.',
    findings: [{ ruleId: 'code.obfuscated', severity: 'critical', message: 'eval of a base64 string', file: 'dist/index.js', line: 1 }],
  } satisfies InstallPolicyWarningDetails,
}

/** Policy warning without findings (findings is optional). */
export const INSTALL_ERR_POLICY_NO_FINDINGS: GatewayErrorShape = {
  ...INSTALL_ERR_POLICY,
  details: {
    installPolicyCode: 'install_policy_warning_acknowledgement_required',
    targetName: '@shady/postinstall-demo',
    targetType: 'plugin',
    requestMode: 'install',
    reason: 'Package is not verified.',
  } satisfies InstallPolicyWarningDetails,
}

/** Client-side leniency test only — the GATEWAY never sends this (it drops the block, src-7tzZ8j12.mjs:92-97). */
export const INSTALL_ERR_POLICY_BAD_FINDING: GatewayErrorShape = {
  ...INSTALL_ERR_POLICY,
  details: {
    installPolicyCode: 'install_policy_warning_acknowledgement_required',
    targetName: '@shady/postinstall-demo',
    targetType: 'plugin',
    requestMode: 'install',
    reason: 'Package runs a postinstall script.',
    findings: [
      { ruleId: 'scripts.postinstall', severity: 'warn', message: 'spawns a process' },
      { ruleId: 'x', severity: 'fatal', message: 'bad severity' },
    ],
  },
}

/**
 * clawhub-install-trust-YmHDTV35.mjs:792-797 — `warning` is the multi-line audit text. Code is
 * INVALID_REQUEST: throwInstallFailure maps DOWNLOAD_BLOCKED to kind "invalid-request"
 * (management-mutations-IdXujYee.mjs:61-71, plugins-mutations-pdGQVwQb.mjs:42).
 */
export const INSTALL_ERR_TRUST_BLOCKED: GatewayErrorShape = {
  code: 'INVALID_REQUEST',
  message: 'ClawHub blocked this release; install was not started.',
  details: {
    clawhubTrustCode: 'clawhub_download_blocked',
    version: '0.0.3',
    warning: 'ClawHub security audit for @shady/postinstall-demo@0.0.3\nStatus: blocked\nMalicious payload detected.\nhttps://clawhub.ai/shady/plugins/postinstall-demo/security-audit',
  } satisfies ClawHubTrustDetails,
}

/** clawhub-install-trust-YmHDTV35.mjs:754-760 — the PRD has no copy for this one. */
export const INSTALL_ERR_TRUST_UNAVAILABLE: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'ClawHub release trust check failed for "@example-publisher/issue-tracker@1.4.2": fetch failed',
  details: { clawhubTrustCode: 'clawhub_security_unavailable', version: '1.4.2' } satisfies ClawHubTrustDetails,
}

/** Plain lifecycle failure, no details. */
export const INSTALL_ERR_PLAIN: GatewayErrorShape = {
  code: 'INVALID_REQUEST',
  message: 'plugin "nope" is not in the official catalog',
}

/** Non-admin → FORBIDDEN with structured details — missingScopeErrorShape, dist/error-codes-C3Z5XSDw.mjs:82-85. */
export const INSTALL_ERR_MISSING_ADMIN: GatewayErrorShape = {
  code: 'FORBIDDEN',
  message: 'missing scope: operator.admin',
  details: { code: 'MISSING_SCOPE', missingScope: 'operator.admin', requiredScopes: ['operator.admin'] },
}

/** Control-plane write budget (30 per 60 s on 2026.9.4; "3 per 60s" on 2026.6.5) — server-methods-v1T0byyX.mjs:294-309. */
export const INSTALL_ERR_RATE_LIMITED: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'rate limit exceeded for plugins.install; retry after 12s',
  retryable: true,
  retryAfterMs: 11400,
  details: { method: 'plugins.install', limit: '30 per 60s' },
}

// ── gateway.restart.request ──

export const RESTART_PARAMS: RestartRequestParams = { reason: 'Apply an installed plugin change' }

const PREFLIGHT_IDLE: RestartPreflight = {
  safe: true,
  counts: { queueSize: 0, pendingReplies: 0, embeddedRuns: 0, cronRuns: 0, backgroundExecSessions: 0, rootRequests: 0, activeTasks: 0, totalActive: 0 },
  blockers: [],
  summary: 'safe to restart now',
}

export const RESTART_SCHEDULED: RestartRequestResult = {
  ok: true,
  status: 'scheduled',
  preflight: PREFLIGHT_IDLE,
  restart: { ok: true, pid: 48213, signal: 'SIGUSR1', reason: 'Apply an installed plugin change', mode: 'emit', cooldownMsApplied: 0, delayMs: 0, coalesced: false, emitHooksQueued: false },
}

/** Active work: the restart waits for it to drain (default cap 300 s, restart-PDAKwQWW.mjs:136). */
export const RESTART_DEFERRED: RestartRequestResult = {
  ok: true,
  status: 'deferred',
  preflight: {
    safe: false,
    counts: { queueSize: 0, pendingReplies: 0, embeddedRuns: 1, cronRuns: 0, backgroundExecSessions: 0, rootRequests: 0, activeTasks: 1, totalActive: 2 },
    blockers: [
      { kind: 'embedded-run', count: 1, message: '1 active embedded run(s)' },
      { kind: 'task', message: '1 active background task run(s)' },
    ],
    summary: 'restart deferred: 1 active embedded run(s); 1 active background task run(s)',
  },
  restart: { ok: true, pid: 48213, signal: 'SIGUSR1', reason: 'Apply an installed plugin change', mode: 'emit', cooldownMsApplied: 0, delayMs: 0, coalesced: false, emitHooksQueued: false },
}

/** Second request inside the 30 s cooldown / while one is pending. */
export const RESTART_COALESCED: RestartRequestResult = {
  ok: true,
  status: 'coalesced',
  preflight: PREFLIGHT_IDLE,
  restart: { ok: true, pid: 48213, signal: 'SIGUSR1', reason: 'Apply an installed plugin change', mode: 'emit', cooldownMsApplied: 21000, delayMs: 21000, coalesced: true, emitHooksQueued: false },
}

/** dist/restart-B99ImsD6.mjs:23 (params not an object). */
export const RESTART_ERR_INVALID: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'invalid gateway.restart.request params' }
export const RESTART_ERR_MISSING_ADMIN: GatewayErrorShape = {
  code: 'FORBIDDEN',
  message: 'missing scope: operator.admin',
  details: { code: 'MISSING_SCOPE', missingScope: 'operator.admin', requiredScopes: ['operator.admin'] },
}
/** Requests arriving while the gateway drains for restart — server-methods-v1T0byyX.mjs:338-349. */
export const ERR_DURING_RESTART: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'plugins.list unavailable during gateway restart',
  retryable: true,
  retryAfterMs: 1000,
  details: { method: 'plugins.list', reason: 'gateway-restarting', phase: 'running' },
}

/** `shutdown` event just before the socket drops. */
export const SHUTDOWN_EVENT_RESTART: ShutdownEventPayload = { reason: 'Apply an installed plugin change', restartExpectedMs: 1500 }
export const SHUTDOWN_EVENT_PLAIN: ShutdownEventPayload = { reason: 'gateway stopping' }

// ── hello-ok slices (restart verification) ──

export const HELLO_BEFORE_RESTART: HelloOkServerSlice = {
  server: { version: '2026.9.4', bootId: '7b0f5b8e-4a61-4c1e-9d7e-2f3a9c1d0e11', controlUiBuildSource: 'bundled', connId: 'conn_01J9ZQ4K2M' },
  features: { methods: ['plugins.list', 'plugins.install', 'plugins.inspect', 'plugins.catalog.browse', 'plugins.catalog.categories', 'plugins.catalog.get', 'gateway.restart.request'], events: ['shutdown', 'tick'] },
}
/** New bootId = restart happened (the Control UI's check, plugins-page-BMxmOsAv.js). */
export const HELLO_AFTER_RESTART: HelloOkServerSlice = {
  ...HELLO_BEFORE_RESTART,
  server: { ...HELLO_BEFORE_RESTART.server, bootId: 'c2d4e6f8-1a3b-4c5d-8e9f-0a1b2c3d4e5f', connId: 'conn_01J9ZQ7P9X' },
}
/** Same bootId = only the socket dropped; the restart has not happened yet. */
export const HELLO_SAME_BOOT: HelloOkServerSlice = {
  ...HELLO_BEFORE_RESTART,
  server: { ...HELLO_BEFORE_RESTART.server, connId: 'conn_01J9ZQ5R3T' },
}
/** 2026.8.x: catalog methods absent → fallback search browser. */
export const HELLO_2026_8: HelloOkServerSlice = {
  server: { version: '2026.8.3', bootId: '0c9e1a2b-3d4e-4f50-8a61-7b8c9d0e1f2a', connId: 'conn_01J9ZQ1A1A' },
  features: { methods: ['plugins.list', 'plugins.search', 'plugins.install', 'plugins.inspect', 'gateway.restart.request'], events: ['shutdown', 'tick'] },
}
/** 2026.6.5: no plugins.* install RPCs at all, no bootId in hello-ok. */
export const HELLO_2026_6_5: HelloOkServerSlice = {
  server: { version: '2026.6.5', connId: 'conn_01J9ZQ0Z0Z' },
  features: { methods: ['plugins.uiDescriptors', 'plugins.sessionAction', 'gateway.restart.request', 'gateway.restart.preflight'], events: ['shutdown', 'tick'] },
}

// ── method-level errors on older gateways ──

/** Admin caller, method not registered — server-methods-v1T0byyX.mjs:403 (also 2026.6.5 server-methods-DpAeYwQD.js:494). */
export const ERR_UNKNOWN_METHOD_BROWSE: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'unknown method: plugins.catalog.browse' }
/**
 * NON-admin caller, method not registered: the scope check runs BEFORE the handler lookup and
 * unclassified methods default to operator.admin (method-scopes-tKV11oMS.mjs:3153), so an old
 * gateway answers FORBIDDEN, not "unknown method".
 */
export const ERR_UNKNOWN_METHOD_BROWSE_NON_ADMIN: GatewayErrorShape = {
  code: 'FORBIDDEN',
  message: 'missing scope: operator.admin',
  details: { code: 'MISSING_SCOPE', missingScope: 'operator.admin', requiredScopes: ['operator.admin'] },
}

export const FRAME_INSTALL_CONSENT: GatewayResFrame = { type: 'res', id: 'req_42', ok: false, error: INSTALL_ERR_CONSENT }
export const FRAME_BROWSE_OK: GatewayResFrame<CatalogBrowseResult> = { type: 'res', id: 'req_7', ok: true, payload: BROWSE_FEATURED_PAGE_1 }
