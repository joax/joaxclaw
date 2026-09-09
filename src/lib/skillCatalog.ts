// Finding, installing and updating skills from ClawHub.
//
// The Extensions page could list the skills already configured and toggle them, and the
// app installs its own bundled ones (ask-user, script-runner, …). Discovering somebody
// else's skill, or refreshing one already installed, meant a shell.
//
// ── The one detail that must not be got wrong ───────────────────────────────────
//
// A search result carries BOTH `slug` and `installRef`, and they are different:
//
//   slug:       "alibabacloud-quickbi-smartq"
//   installRef: "@sdk-team/alibabacloud-quickbi-smartq"
//
// The schema is explicit that `installRef` is what goes in `skills.install`'s `slug`
// field, because "several publishers can share one slug". Sending the bare slug would
// at best fail and at worst install a DIFFERENT publisher's skill under the name you
// searched for — so `installRef` is the only identifier this module will hand over.

export interface SkillPublisher {
  displayName?: string
  handle?: string
  image?: string
}

export interface SkillTrust {
  clawHubVerdict?: string | null
  installability?: string | null
  sourceFreshness?: string | null
  upstreamScanners?: unknown
}

export interface SkillSearchResult {
  score: number
  slug: string
  /** Publisher-qualified. This — not `slug` — is what install takes. */
  installRef: string
  /** Set when ClawHub serves this install-only, so `skills.detail` will not answer. */
  installOnly?: true | null
  displayName?: string
  summary?: string
  official?: boolean
  publisher?: SkillPublisher
  ownerHandle?: string
  version?: string | null
  downloads?: number
  trust?: SkillTrust
}

export interface SkillInstallParams {
  source: 'clawhub'
  slug: string
  agentId?: string
  version?: string
  force?: boolean
}

/**
 * Install params for a search result.
 *
 * Always `installRef`, never `slug` — see the note at the top of this file. `version` is
 * only sent when the result actually names one; ClawHub returns `null` for plenty of
 * skills and a null version is not the same as "latest".
 */
export function skillInstallParams(
  result: Pick<SkillSearchResult, 'installRef' | 'version'>,
  opts: { agentId?: string; force?: boolean } = {},
): SkillInstallParams {
  return {
    source: 'clawhub',
    slug: result.installRef,
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
    ...(result.version ? { version: result.version } : {}),
    ...(opts.force ? { force: true } : {}),
  }
}

/** Params for refreshing ClawHub-installed skills — one tracked slug, or all of them. */
export function skillUpdateParams(
  target: { slug?: string; all?: boolean },
  opts: { agentId?: string; force?: boolean } = {},
): Record<string, unknown> {
  return {
    source: 'clawhub',
    ...(target.slug ? { slug: target.slug } : {}),
    ...(target.all ? { all: true } : {}),
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
    ...(opts.force ? { force: true } : {}),
  }
}

export interface SkillUpdateOutcome {
  slug?: string
  ok?: boolean
  code?: string
  message?: string
}

/**
 * Skills the update refused because their files no longer match the recorded install
 * digests — i.e. somebody edited them in place.
 *
 * The gateway reports this per skill as `code: "force_required"` rather than failing the
 * whole call, and retrying with `force: true` overwrites those local edits. That is a
 * question for the user, not something to retry automatically.
 */
export function needsForce(results: readonly SkillUpdateOutcome[] | undefined): string[] {
  return (results ?? [])
    .filter(r => r?.code === 'force_required')
    .map(r => r.slug)
    .filter((s): s is string => !!s)
}

/** Per-skill outcomes from an update response, wherever the gateway nested them. */
export function updateOutcomes(response: unknown): SkillUpdateOutcome[] {
  const rec = response && typeof response === 'object' ? (response as Record<string, unknown>) : null
  const direct = rec?.results
  if (Array.isArray(direct)) return direct as SkillUpdateOutcome[]
  const details = rec?.details && typeof rec.details === 'object' ? (rec.details as Record<string, unknown>) : null
  return Array.isArray(details?.results) ? (details.results as SkillUpdateOutcome[]) : []
}

/** How much to trust a result at a glance. */
export function skillTrustLabel(result: SkillSearchResult): string {
  if (result.official) return 'Official'
  const verdict = result.trust?.clawHubVerdict
  if (typeof verdict === 'string' && verdict) return verdict
  return result.publisher?.handle ?? result.ownerHandle ?? 'Community'
}

/** False when ClawHub says this result cannot currently be installed. */
export function isInstallable(result: SkillSearchResult): boolean {
  const state = result.trust?.installability
  return typeof state !== 'string' || state === 'installable'
}
