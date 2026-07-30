import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM helpers shared by the Vercel functions and Edge middleware
import { signSession, readSession, readCookie, sessionCookie, clearedSessionCookie, TTL_SECONDS } from '../../../api/_lib/session.mjs'
// @ts-expect-error — same
import { entitled, allowlist, accessFor, authorizeUrl, OAUTH_SCOPE } from '../../../api/_lib/github.mjs'
// @ts-expect-error — same
import { isPublicAppAsset } from '../../../api/_lib/gate.mjs'

// The session cookie IS the authorisation for the hosted web app, so these cover the ways
// it could be forged or outlive a cancelled sponsorship.

const SECRET = 'test-secret-not-a-real-one'

describe('session cookie', () => {
  it('round-trips a payload', async () => {
    const token = await signSession({ login: 'octocat', sponsor: true }, SECRET)
    const payload = await readSession(token, SECRET)
    expect(payload.login).toBe('octocat')
    expect(payload.sponsor).toBe(true)
    expect(payload.exp - payload.iat).toBe(TTL_SECONDS)
  })

  it('rejects a tampered payload', async () => {
    const token = await signSession({ login: 'octocat', sponsor: false }, SECRET)
    const [body, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ login: 'octocat', sponsor: true, exp: 2 ** 32 }))
      .toString('base64url')
    expect(await readSession(`${forged}.${sig}`, SECRET)).toBeNull()
    expect(await readSession(`${body}.${sig}`, SECRET)).not.toBeNull()
  })

  it('rejects a signature from a different secret', async () => {
    const token = await signSession({ login: 'octocat', sponsor: true }, 'other-secret')
    expect(await readSession(token, SECRET)).toBeNull()
  })

  it('rejects an expired session', async () => {
    const token = await signSession({ login: 'octocat' }, SECRET, { ttl: 60, now: 0 })
    expect(await readSession(token, SECRET, { now: 59_000 })).not.toBeNull()
    expect(await readSession(token, SECRET, { now: 61_000 })).toBeNull()
  })

  it('treats junk as not-signed-in rather than throwing', async () => {
    for (const junk of ['', 'nonsense', 'a.b', '....', null, undefined, 'eyJ9.zzz']) {
      expect(await readSession(junk as string, SECRET)).toBeNull()
    }
  })

  it('sets a hardened cookie, and clears it with Max-Age=0', () => {
    const set = sessionCookie('abc')
    expect(set).toContain('HttpOnly')
    expect(set).toContain('Secure')
    expect(set).toContain('SameSite=Lax')
    expect(set).toContain('Path=/')
    expect(clearedSessionCookie()).toContain('Max-Age=0')
  })

  it('reads one cookie out of a header without matching prefixes', () => {
    const header = 'other=1; joax_session=wanted; joax_session_extra=no'
    expect(readCookie(header, 'joax_session')).toBe('wanted')
    expect(readCookie('', 'joax_session')).toBeNull()
    expect(readCookie(undefined, 'joax_session')).toBeNull()
  })
})

describe('entitlement', () => {
  it('requires an active monthly sponsorship at or above the minimum', () => {
    expect(entitled({ sponsoring: true, monthlyDollars: 1 }, 1)).toBe(true)
    expect(entitled({ sponsoring: true, monthlyDollars: 5 }, 1)).toBe(true)
    expect(entitled({ sponsoring: false, monthlyDollars: 10 }, 1)).toBe(false)
    expect(entitled({ sponsoring: true, monthlyDollars: 1 }, 5)).toBe(false)
  })

  it('admits a sponsor whose tier is hidden (private sponsorship)', () => {
    // The boolean is authoritative; failing closed here would lock out private sponsors.
    expect(entitled({ sponsoring: true, monthlyDollars: null }, 1)).toBe(true)
  })
})

describe('allowlist', () => {
  // GitHub won't let an account sponsor itself, so without this the owner is locked out
  // of their own hosted app.
  it('always includes the maintainer', () => {
    expect(allowlist({ maintainer: 'joax', extra: '' }).has('joax')).toBe(true)
  })

  it('parses comma- or space-separated logins, case-insensitively', () => {
    const list = allowlist({ maintainer: 'joax', extra: 'Alice, bob   carol,,' })
    expect([...list].sort()).toEqual(['alice', 'bob', 'carol', 'joax'])
    expect(list.has('ALICE'.toLowerCase())).toBe(true)
  })

  it('survives an unset variable', () => {
    expect([...allowlist({ maintainer: 'joax', extra: undefined })]).toEqual(['joax'])
  })
})

describe('accessFor', () => {
  const allowed = allowlist({ maintainer: 'joax', extra: 'tester' })

  it('lets the maintainer in without a sponsorship, and says why', () => {
    const access = accessFor({ login: 'joax', sponsoring: false }, { allowed })
    expect(access).toEqual({ granted: true, via: 'maintainer' })
  })

  it('lets an allow-listed login in, labelled separately from sponsors', () => {
    expect(accessFor({ login: 'Tester', sponsoring: false }, { allowed })).toEqual({ granted: true, via: 'allowlist' })
  })

  it('still requires a sponsorship from everyone else', () => {
    expect(accessFor({ login: 'stranger', sponsoring: false }, { allowed }).granted).toBe(false)
    expect(accessFor({ login: 'stranger', sponsoring: true, monthlyDollars: 1 }, { allowed, min: 1 }))
      .toEqual({ granted: true, via: 'sponsor' })
  })

  it('does not admit a missing or empty login', () => {
    expect(accessFor({ login: null, sponsoring: false }, { allowed }).granted).toBe(false)
    expect(accessFor({ login: '', sponsoring: false }, { allowed }).granted).toBe(false)
  })
})

describe('authorize url', () => {
  it('asks only for the read-only scope and echoes state', () => {
    const url = new URL(authorizeUrl({ clientId: 'cid', redirectUri: 'https://x/cb', state: 'st' }))
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe(OAUTH_SCOPE)
    expect(OAUTH_SCOPE).toBe('read:user')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/cb')
  })
})

describe('public app assets', () => {
  // A PWA is only installable if these stay fetchable: the manifest is requested without
  // credentials, and a redirected service-worker script fails registration outright.
  it('lets the PWA infrastructure through the gate', () => {
    for (const p of [
      '/app/manifest.webmanifest',
      '/app/sw.js',
      '/app/apple-touch-icon.png',
      '/app/icons/icon-192.png',
      '/app/icons/maskable-512.png',
    ]) expect(isPublicAppAsset(p)).toBe(true)
  })

  it('keeps the app itself gated', () => {
    for (const p of [
      '/app/',
      '/app/index.html',
      '/app/assets/index-abc123.js',
      '/app/icons/nested/deep.png',   // only the flat icons directory is public
      '/app/sw.js.map',
      '/app/manifest.webmanifest.bak',
      '/account.html',
      '',
    ]) expect(isPublicAppAsset(p)).toBe(false)
  })
})
