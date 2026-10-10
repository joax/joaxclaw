// GET /download/mac, /download/linux  (rewritten to /api/download?platform=…)
//
// Answers a redirect to GitHub's signed asset url. See api/_lib/releases.mjs for why
// that is a redirect and not a proxy.

import { isPlatform, latestRelease, pickAsset, signedAssetUrl, releasesToken } from './_lib/releases.mjs'

const fail = (res, status, message) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).send(`${message}\n`)
}

export default async function handler(req, res) {
  const platform = String(req.query?.platform ?? '')
  if (!isPlatform(platform)) {
    return fail(res, 400, 'Unknown platform. Try /download/mac or /download/linux.')
  }
  if (!releasesToken()) {
    return fail(res, 503, 'Downloads are not configured on this deployment.')
  }

  try {
    const release = await latestRelease()
    const asset = pickAsset(release, platform)
    if (!asset) return fail(res, 404, `No ${platform} build in the latest release.`)

    const url = await signedAssetUrl(asset.id)

    // Never cache this hop: the signed url expires in minutes, so a CDN copy would hand
    // later visitors a link that is already dead.
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Location', url)
    res.status(302).end()
  } catch (err) {
    console.error('download failed', err)
    fail(res, 502, 'The download could not be prepared. Please try again shortly.')
  }
}
