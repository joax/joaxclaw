// HMAC-signed session cookie — the whole persistence layer for the hosted PWA.
//
// There is no database on purpose. Entitlement lives in GitHub (an active sponsorship),
// and the session carries the verdict signed so it can't be forged, with a short expiry
// so a cancelled sponsorship stops working on its own. That means we store nothing about
// anyone: no user table, no emails, nothing to leak or to explain in the privacy policy.
//
// Web Crypto only, so the same code runs in a Vercel Node function and in Edge middleware.

const enc = new TextEncoder()
const dec = new TextDecoder()

export const COOKIE = 'joax_session'
export const TTL_SECONDS = 12 * 60 * 60   // re-checks sponsorship at most twice a day

const b64url = bytes =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const unb64url = text =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function hmacKey(secret) {
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

// `payload` gets `iat`/`exp` stamped on; pass ttl to override the default lifetime.
export async function signSession(payload, secret, { ttl = TTL_SECONDS, now = Date.now() } = {}) {
  const issued = Math.floor(now / 1000)
  const body = b64url(enc.encode(JSON.stringify({ ...payload, iat: issued, exp: issued + ttl })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${b64url(sig)}`
}

// Returns the payload, or null for anything untrustworthy: bad shape, bad signature,
// or expired. Callers treat null as "not signed in" — never as an error to surface.
export async function readSession(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body))
    if (!valid) return null
    const payload = JSON.parse(dec.decode(unb64url(body)))
    if (typeof payload?.exp !== 'number' || payload.exp * 1000 <= now) return null
    return payload
  } catch {
    return null   // malformed base64/JSON is just an invalid cookie
  }
}

export function serializeCookie(name, value, { maxAge = TTL_SECONDS, sameSite = 'Lax' } = {}) {
  return [`${name}=${value}`, 'Path=/', 'HttpOnly', 'Secure', `SameSite=${sameSite}`, `Max-Age=${maxAge}`].join('; ')
}

export const sessionCookie = value => serializeCookie(COOKIE, value)
export const clearedSessionCookie = () => serializeCookie(COOKIE, '', { maxAge: 0 })

export function readCookie(header, name) {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}
