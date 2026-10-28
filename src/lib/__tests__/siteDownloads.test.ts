import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PLATFORMS, isPlatform, pickAsset, describeRelease,
  latestRelease, forgetRelease, signedAssetUrl,
} from '../../../api/_lib/releases.mjs'

// Public downloads for a private repo. The repo went private, which made every
// `browser_download_url` 404 for visitors and took the site's download buttons — and the
// app's updater — down with it. These cover the replacement: fixed /download/<platform>
// paths, resolved server-side to GitHub's short-lived signed asset url.

const release = {
  tag_name: 'v0.27.2',
  published_at: '2026-10-10T12:00:00Z',
  body: '### Fixed\n- Billing opens again.',
  assets: [
    { id: 11, name: 'JoaxClaw-0.27.2-universal.dmg', size: 248001333 },
    { id: 22, name: 'joaxclaw_0.27.2_amd64.deb', size: 123588648 },
    { id: 33, name: 'latest-mac.yml', size: 400 },
  ],
}

describe('platforms', () => {
  it('knows only the two platforms that are actually built', () => {
    expect(Object.keys(PLATFORMS)).toEqual(['mac', 'linux'])
    expect(isPlatform('mac')).toBe(true)
    expect(isPlatform('linux')).toBe(true)
    // Windows is matched by the app's updater but no .exe is ever published.
    expect(isPlatform('windows')).toBe(false)
    expect(isPlatform(undefined)).toBe(false)
    // Not inherited from Object.prototype — `isPlatform('constructor')` must be false.
    expect(isPlatform('constructor')).toBe(false)
  })
})

describe('pickAsset', () => {
  it('matches on extension, ignoring the metadata files beside it', () => {
    expect(pickAsset(release, 'mac').id).toBe(11)
    expect(pickAsset(release, 'linux').id).toBe(22)
  })

  it('is null rather than throwing when there is nothing to match', () => {
    expect(pickAsset({ assets: [] }, 'mac')).toBeNull()
    expect(pickAsset({}, 'mac')).toBeNull()
    expect(pickAsset(release, 'windows')).toBeNull()
    expect(pickAsset({ assets: [{ size: 1 }] }, 'mac')).toBeNull()   // asset with no name
  })
})

describe('describeRelease', () => {
  it('advertises the fixed download paths, never a GitHub url', () => {
    const d = describeRelease(release)
    expect(d.version).toBe('0.27.2')
    expect(d.assets.mac).toEqual({ name: 'JoaxClaw-0.27.2-universal.dmg', size: 248001333, url: '/download/mac' })
    expect(d.assets.linux.url).toBe('/download/linux')
    // The release page is private now; the site's changelog is the public history.
    expect(d.htmlUrl).toBe('/changelog.html')
    expect(JSON.stringify(d)).not.toMatch(/github\.com/)
  })

  it('carries the notes, so the app can show what changed', () => {
    expect(describeRelease(release).notes).toContain('Billing opens again')
    expect(describeRelease({ ...release, body: null }).notes).toBe('')
  })

  it('reports a missing build as null instead of a broken link', () => {
    const d = describeRelease({ tag_name: 'v9.9.9', assets: [{ id: 1, name: 'only.deb', size: 1 }] })
    expect(d.assets.mac).toBeNull()
    expect(d.assets.linux.url).toBe('/download/linux')
  })

  it('survives a shapeless answer', () => {
    expect(describeRelease({}).version).toBeNull()
    expect(describeRelease({}).assets).toEqual({ mac: null, linux: null })
  })
})

describe('signedAssetUrl', () => {
  // The whole design rests on this: GitHub answers the asset endpoint with a 302 to a
  // credential-free url, so the site redirects instead of proxying 236MB.
  it('reads the redirect target rather than following it', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toMatch(/\/releases\/assets\/22$/)
      expect(init.headers.accept).toBe('application/octet-stream')
      expect(init.redirect).toBe('manual')          // following it downloads the file here
      expect(init.headers.authorization).toBe('Bearer t0ken')
      return { status: 302, headers: new Headers({ location: 'https://release-assets.githubusercontent.com/x?sig=1' }) }
    })
    await expect(signedAssetUrl(22, 't0ken', { fetchImpl }))
      .resolves.toBe('https://release-assets.githubusercontent.com/x?sig=1')
  })

  it('fails loudly when GitHub answers without a redirect', async () => {
    const fetchImpl = async () => ({ status: 404, headers: new Headers() })
    await expect(signedAssetUrl(22, 't0ken', { fetchImpl })).rejects.toThrow(/did not redirect/)
  })
})

describe('latestRelease', () => {
  beforeEach(() => forgetRelease())

  it('sends the token and unwraps the release', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers.authorization).toBe('Bearer t0ken')
      return { ok: true, json: async () => release }
    })
    await expect(latestRelease('t0ken', { fetchImpl })).resolves.toBe(release)
  })

  it('memoises within the TTL and refetches after it', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => release }))
    await latestRelease('t', { now: 1_000, fetchImpl })
    await latestRelease('t', { now: 30_000, fetchImpl })   // inside the 60s window
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await latestRelease('t', { now: 90_000, fetchImpl })   // past it
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('carries the status through on failure, and caches nothing', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }))
    await expect(latestRelease('t', { fetchImpl })).rejects.toMatchObject({ status: 404 })
    await expect(latestRelease('t', { fetchImpl })).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
