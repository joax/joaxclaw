import { describe, it, expect } from 'vitest'
import { infoFromFeed, feedKeyForPlatform, resolveAssetUrl, compareVersions } from '../appReleaseFeed'

// The app used to read api.github.com's latest release. On a private repo that answers
// 404 — and the old code read 404 as "no release yet, you're up to date", so an installed
// copy would have gone quiet forever. It now reads the site's feed instead.

const feed = {
  version: '0.27.2',
  notes: '### Fixed\n- Billing opens again.',
  htmlUrl: '/changelog.html',
  assets: {
    mac: { name: 'JoaxClaw-0.27.2-universal.dmg', size: 248001333, url: '/download/mac' },
    linux: { name: 'joaxclaw_0.27.2_amd64.deb', size: 123588648, url: '/download/linux' },
  },
}

describe('feedKeyForPlatform', () => {
  it('maps the platforms that have installers', () => {
    expect(feedKeyForPlatform('darwin')).toBe('mac')
    expect(feedKeyForPlatform('linux')).toBe('linux')
  })

  it('has nothing for Windows, which has never had a published build', () => {
    expect(feedKeyForPlatform('win32')).toBeNull()
  })
})

describe('resolveAssetUrl', () => {
  it('makes the feed relative path absolute against the site', () => {
    expect(resolveAssetUrl('/download/mac')).toBe('https://joaxclaw.ai/download/mac')
  })

  it('leaves an absolute url alone', () => {
    expect(resolveAssetUrl('https://example.test/x.deb')).toBe('https://example.test/x.deb')
  })

  it('honours a different site, so a fork can host its own', () => {
    expect(resolveAssetUrl('/download/linux', 'https://staging.example/api/release'))
      .toBe('https://staging.example/download/linux')
  })

  it('is null on nonsense rather than throwing mid-check', () => {
    expect(resolveAssetUrl('::not a url::', 'also not a url')).toBeNull()
  })
})

describe('infoFromFeed', () => {
  it('offers a newer version with an absolute asset url', () => {
    const info = infoFromFeed(feed, '0.27.1', 'darwin')
    expect(info.available).toBe(true)
    expect(info.latestVersion).toBe('0.27.2')
    expect(info.asset).toEqual({
      name: 'JoaxClaw-0.27.2-universal.dmg',
      url: 'https://joaxclaw.ai/download/mac',
      size: 248001333,
    })
    expect(info.notes).toContain('Billing opens again')
    expect(info.htmlUrl).toBe('https://joaxclaw.ai/changelog.html')
  })

  it('does not offer the version already running, or an older one', () => {
    expect(infoFromFeed(feed, '0.27.2', 'linux').available).toBe(false)
    expect(infoFromFeed(feed, '0.28.0', 'linux').available).toBe(false)
  })

  it('tolerates a v-prefixed version in the feed', () => {
    expect(infoFromFeed({ ...feed, version: 'v0.27.2' }, '0.27.1', 'linux').latestVersion).toBe('0.27.2')
  })

  it('reports a newer version with no build for this OS', () => {
    const info = infoFromFeed(feed, '0.27.1', 'win32')
    expect(info.available).toBe(true)
    expect(info.asset).toBeNull()
    expect(info.noAssetForPlatform).toBe(true)
  })

  it('falls back to the site changelog when the feed names no page', () => {
    expect(infoFromFeed({ ...feed, htmlUrl: undefined }, '0.27.1', 'linux').htmlUrl)
      .toBe('https://joaxclaw.ai/changelog.html')
  })

  it('treats an empty feed as "nothing to offer", never as an update', () => {
    const info = infoFromFeed({}, '0.27.1', 'linux')
    expect(info.available).toBe(false)
    expect(info.latestVersion).toBe('0.27.1')
    expect(info.asset).toBeNull()
    expect(info.noAssetForPlatform).toBe(false)
  })

  it('does not offer an update it has no way to download', () => {
    const broken = { ...feed, assets: { linux: { name: 'x.deb', size: 1, url: '' } } }
    const info = infoFromFeed(broken, '0.27.1', 'linux')
    expect(info.asset).toBeNull()
    expect(info.noAssetForPlatform).toBe(true)
  })
})

describe('compareVersions still orders releases over prereleases', () => {
  it('ranks a final above its own prerelease', () => {
    expect(compareVersions('0.27.2', '0.27.2-rc.1')).toBe(1)
    expect(compareVersions('0.27.2', '0.27.1')).toBe(1)
    expect(compareVersions('0.27.1', '0.27.2')).toBe(-1)
  })
})
