// GET /api/release — what the landing page needs to label its download buttons:
// the current version, and each installer's file name and size.
//
// This exists because the repo is private: the page used to read
// api.github.com/…/releases/latest straight from the browser, which now 404s for every
// visitor. The token that can read it stays here, and only the three harmless fields
// cross to the browser.

import { describeRelease, latestRelease, releasesToken } from './_lib/releases.mjs'

export default async function handler(_req, res) {
  if (!releasesToken()) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ configured: false, version: null, assets: {} })
  }
  try {
    const release = await latestRelease()
    // Shared CDN cache: the answer is identical for everyone and changes a few times a
    // year, so serve it stale while revalidating rather than waking a lambda per visit.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400')
    res.status(200).json({ configured: true, ...describeRelease(release) })
  } catch (err) {
    console.error('release lookup failed', err)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ configured: true, version: null, assets: {}, error: 'lookup-failed' })
  }
}
