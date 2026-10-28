// Public installer downloads for a private repository.
//
// The repo is private, so a release asset's `browser_download_url` needs credentials and
// answers 404 to everyone else — which broke every download link on the site the moment
// the repo flipped. GitHub's *asset* endpoint behaves differently: asked for
// `application/octet-stream`, it answers 302 with a short-lived SIGNED url on
// objects.githubusercontent.com that needs no credentials at all.
//
// So the site hands the visitor that redirect instead of the bytes. A 236MB .dmg comes
// straight from GitHub's CDN, the token never leaves the server, and nothing has to be
// copied, mirrored or paid for. The cost is that the signed url expires in minutes,
// which is why `/api/download` must never be cached.

/** The repo releases are read from. Overridable so a fork or a staging deploy can point elsewhere. */
export const REPO = process.env.RELEASES_REPO || process.env.GITHUB_REPOSITORY || 'joax/joaxclaw'

/**
 * The server-side credential. `RELEASES_TOKEN` is preferred — on a private repo this only
 * needs `contents:read`, so it should NOT be the same broad token used elsewhere.
 * `GITHUB_TOKEN` is accepted as a fallback because CI already defines it.
 */
export const releasesToken = () => process.env.RELEASES_TOKEN || process.env.GITHUB_TOKEN || null

/** Which installer belongs to which platform, by file extension. */
export const PLATFORMS = { mac: '.dmg', linux: '.deb' }

export const isPlatform = (p) => Object.hasOwn(PLATFORMS, String(p ?? ''))

const API = 'https://api.github.com'
const headers = (token, accept) => ({
  accept,
  'user-agent': 'joaxclaw-site',
  'x-github-api-version': '2022-11-28',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})

/** The release's asset for `platform`, or null when that build is missing. */
export function pickAsset(release, platform) {
  const ext = PLATFORMS[platform]
  if (!ext || !Array.isArray(release?.assets)) return null
  return release.assets.find(a => String(a?.name ?? '').toLowerCase().endsWith(ext)) ?? null
}

/**
 * The shape the site and the app's updater both read: version, release notes, and
 * per-platform name/size plus the path to download it from. Deliberately NOT the GitHub
 * urls — those are useless to anyone without repo access now, and `/download/<platform>`
 * stays correct across releases without a redeploy.
 *
 * The notes are the release body, which is the CHANGELOG section for that version; the
 * app shows them in its update banner, so dropping them here would leave an installed
 * copy offering a blank update.
 */
export function describeRelease(release) {
  const assets = {}
  for (const platform of Object.keys(PLATFORMS)) {
    const asset = pickAsset(release, platform)
    assets[platform] = asset
      ? { name: asset.name, size: asset.size, url: `/download/${platform}` }
      : null
  }
  return {
    version: String(release?.tag_name ?? '').replace(/^v/, '') || null,
    publishedAt: release?.published_at ?? null,
    notes: String(release?.body ?? ''),
    // Where to read more. The GitHub release page is private; the site's changelog isn't.
    htmlUrl: '/changelog.html',
    assets,
  }
}

// The newest published release, memoised briefly. A lambda instance is reused across
// requests, and every visitor to the landing page asks for this — without the memo a
// burst of traffic spends the hourly API budget on one answer that does not change.
const TTL_MS = 60_000
let memo = null

export async function latestRelease(token = releasesToken(), { now = Date.now(), fetchImpl = fetch } = {}) {
  if (memo && now - memo.at < TTL_MS) return memo.release
  const res = await fetchImpl(`${API}/repos/${REPO}/releases/latest`, {
    headers: headers(token, 'application/vnd.github+json'),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw Object.assign(new Error(`GitHub releases/latest HTTP ${res.status}`), { status: res.status })
  const release = await res.json()
  memo = { at: now, release }
  return release
}

/** Drops the memo. For tests, and for a deploy that wants a cold read. */
export const forgetRelease = () => { memo = null }

/**
 * The signed, credential-free url for an asset — GitHub's 302 `location`, read rather
 * than followed. `redirect: 'manual'` is what keeps the bytes out of this process; let
 * fetch follow it and the function downloads 236MB into a lambda instead.
 */
export async function signedAssetUrl(assetId, token = releasesToken(), { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}/repos/${REPO}/releases/assets/${assetId}`, {
    headers: headers(token, 'application/octet-stream'),
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  })
  const location = res.headers?.get?.('location')
  if (!location) {
    throw Object.assign(new Error(`GitHub asset ${assetId} did not redirect (HTTP ${res.status})`), { status: 502 })
  }
  return location
}
