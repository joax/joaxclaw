// What the app's updater reads, and how it reads it.
//
// The updater used to ask api.github.com for the repo's latest release. That stopped
// working when the repo went private: the API answers 404 to an app with no credentials,
// and the updater's 404 branch meant "no release published yet — you are up to date". So
// every installed copy would have gone quiet instead of reporting a problem.
//
// joaxclaw.ai/api/release now serves the same facts publicly (the site holds the token),
// and its /download/<platform> redirects to a short-lived signed GitHub url, so installers
// still come from GitHub's CDN. This module is the pure half — parsing a feed answer into
// an update decision — kept out of electron/main so it can be tested directly.

export const DEFAULT_SITE = 'https://joaxclaw.ai'

export const feedUrl = (site: string = DEFAULT_SITE): string => `${site}/api/release`
export const releasesPage = (site: string = DEFAULT_SITE): string => `${site}/changelog.html`

export interface UpdateAsset { name: string; url: string; size: number }

export interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string
  notes: string
  htmlUrl: string
  platform: NodeJS.Platform
  asset: UpdateAsset | null
  /** A newer version exists but no installable asset was published for this OS. */
  noAssetForPlatform: boolean
}

export interface FeedAsset { name?: string; size?: number; url?: string }

export interface ReleaseFeed {
  version?: string | null
  notes?: string
  htmlUrl?: string
  assets?: Partial<Record<'mac' | 'linux', FeedAsset | null>>
}

// Parse "1.2.3" / "v1.2.3-beta.1" into comparable parts.
function parseVersion(v: string): { nums: number[]; pre: string } {
  const clean = String(v).replace(/^v/i, '').trim()
  const [core, pre = ''] = clean.split('-')
  const nums = core.split('.').map(n => parseInt(n, 10) || 0)
  return { nums, pre }
}

/**
 * Returns 1 if a > b, -1 if a < b, 0 if equal. A release outranks a prerelease of the
 * same core version (1.2.0 > 1.2.0-rc.1), matching the release workflow.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a), pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  if (pa.pre && !pb.pre) return -1
  if (!pa.pre && pb.pre) return 1
  if (pa.pre === pb.pre) return 0
  return pa.pre < pb.pre ? -1 : 1
}

/**
 * The feed's key for an OS, or null where no installer is published. The release workflow
 * builds a .dmg and a .deb only, so Windows has never had an asset — it reports
 * `noAssetForPlatform`, exactly as it did when this read GitHub directly.
 */
export function feedKeyForPlatform(platform: NodeJS.Platform): 'mac' | 'linux' | null {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return null
  return 'linux'
}

/**
 * The feed gives `/download/mac`; downloading needs an absolute url. Resolving against
 * the site keeps a self-hosted or staging deployment working, and an absolute url in the
 * feed passes through unchanged.
 */
export function resolveAssetUrl(url: string, site: string = DEFAULT_SITE): string | null {
  try {
    return new URL(url, site).toString()
  } catch {
    return null
  }
}

/** Turn a feed answer into the update decision the renderer renders. */
export function infoFromFeed(
  feed: ReleaseFeed,
  currentVersion: string,
  platform: NodeJS.Platform,
  site: string = DEFAULT_SITE,
): UpdateInfo {
  const latest = String(feed?.version ?? '').replace(/^v/i, '')
  const available = !!latest && compareVersions(latest, currentVersion) > 0

  const key = feedKeyForPlatform(platform)
  const hit = key ? feed?.assets?.[key] ?? null : null
  const url = hit?.url ? resolveAssetUrl(hit.url, site) : null
  // An asset we cannot address is no asset: offering an update with a dead url would
  // fail at the download step with nothing useful to say.
  const asset: UpdateAsset | null = hit && url
    ? { name: String(hit.name ?? 'joaxclaw-update'), url, size: Number(hit.size) || 0 }
    : null

  return {
    available,
    currentVersion,
    latestVersion: latest || currentVersion,
    notes: String(feed?.notes ?? ''),
    htmlUrl: feed?.htmlUrl ? resolveAssetUrl(feed.htmlUrl, site) ?? releasesPage(site) : releasesPage(site),
    platform,
    asset,
    noAssetForPlatform: available && !asset,
  }
}
