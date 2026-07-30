// GitHub OAuth callback: verify state, exchange the code, ask GitHub whether this account
// sponsors the maintainer, and store that verdict in a signed session cookie.
//
// The GitHub access token is deliberately NOT kept — it's used once, here, and dropped.
// The session carries only the login and the entitlement.

import { exchangeCode, viewerSponsorship, entitled, minMonthlyDollars } from '../_lib/github.mjs'
import { signSession, readSession, sessionCookie, serializeCookie, readCookie } from '../_lib/session.mjs'

const STATE_COOKIE = 'joax_oauth_state'

export default async function handler(req, res) {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  const secret = process.env.SESSION_SECRET
  if (!clientId || !clientSecret || !secret) {
    res.status(503).json({ error: 'sign-in is not configured on this deployment' })
    return
  }

  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`
  const url = new URL(req.url, origin)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const expired = () => {
    res.setHeader('Set-Cookie', serializeCookie(STATE_COOKIE, '', { maxAge: 0 }))
    res.redirect(302, '/account.html?error=expired')
  }

  // The state cookie must match the state GitHub echoed back, and still verify.
  const cookieState = readCookie(req.headers.cookie, STATE_COOKIE)
  if (!code || !state || !cookieState || state !== cookieState) return expired()
  const statePayload = await readSession(state, secret)
  if (!statePayload) return expired()

  try {
    const token = await exchangeCode({ code, clientId, clientSecret, redirectUri: `${origin}/api/auth/callback` })
    const viewer = await viewerSponsorship(token)
    const session = await signSession({
      login: viewer.login,
      avatarUrl: viewer.avatarUrl,
      sponsor: entitled(viewer),
      oneTime: viewer.oneTime,
      monthlyDollars: viewer.monthlyDollars,
      minDollars: minMonthlyDollars(),
    }, secret)

    res.setHeader('Set-Cookie', [sessionCookie(session), serializeCookie(STATE_COOKIE, '', { maxAge: 0 })])
    res.setHeader('Cache-Control', 'no-store')
    // Sponsors go where they asked to go; everyone else lands on the account page, which
    // explains what's missing rather than bouncing them off a locked door.
    res.redirect(302, entitled(viewer) ? (statePayload.next || '/app/') : '/account.html')
  } catch (err) {
    console.error('oauth callback failed:', err.message)
    res.setHeader('Set-Cookie', serializeCookie(STATE_COOKIE, '', { maxAge: 0 }))
    res.redirect(302, '/account.html?error=signin')
  }
}
