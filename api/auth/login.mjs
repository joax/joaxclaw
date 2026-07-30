// Starts the GitHub OAuth flow. Sets a short-lived signed state cookie (CSRF) that the
// callback checks, then redirects to GitHub.

import { authorizeUrl } from '../_lib/github.mjs'
import { signSession, serializeCookie } from '../_lib/session.mjs'

const STATE_COOKIE = 'joax_oauth_state'

export default async function handler(req, res) {
  const clientId = process.env.GITHUB_CLIENT_ID
  const secret = process.env.SESSION_SECRET
  if (!clientId || !secret) {
    res.status(503).json({ error: 'sign-in is not configured on this deployment' })
    return
  }

  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`
  const redirectUri = `${origin}/api/auth/callback`

  // Where to land afterwards — same-origin paths only, so this can't be turned into an
  // open redirect.
  const requested = new URL(req.url, origin).searchParams.get('next') || '/app/'
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/app/'

  const nonce = crypto.randomUUID()
  const state = await signSession({ nonce, next }, secret, { ttl: 600 })

  res.setHeader('Set-Cookie', serializeCookie(STATE_COOKIE, state, { maxAge: 600 }))
  res.setHeader('Cache-Control', 'no-store')
  res.redirect(302, authorizeUrl({ clientId, redirectUri, state }))
}
