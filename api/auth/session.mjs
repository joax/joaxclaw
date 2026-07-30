// What the account page reads to render its state. Never 401s: "not signed in" is a
// normal answer, not an error.

import { readSession, readCookie, COOKIE } from '../_lib/session.mjs'
import { MAINTAINER, minMonthlyDollars } from '../_lib/github.mjs'

export default async function handler(req, res) {
  const secret = process.env.SESSION_SECRET
  const configured = !!(process.env.GITHUB_CLIENT_ID && secret)
  const session = configured ? await readSession(readCookie(req.headers.cookie, COOKIE), secret) : null

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    configured,
    maintainer: MAINTAINER,
    minDollars: minMonthlyDollars(),
    signedIn: !!session,
    login: session?.login ?? null,
    avatarUrl: session?.avatarUrl ?? null,
    sponsor: !!session?.sponsor,
    via: session?.via ?? null,
    oneTime: !!session?.oneTime,
    monthlyDollars: session?.monthlyDollars ?? null,
    // When the verdict is next refreshed from GitHub (the session's own expiry).
    expiresAt: session?.exp ? session.exp * 1000 : null,
  })
}
