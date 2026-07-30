// Drops the session cookie. Accepts GET so it can be a plain link, and there's nothing
// destructive behind it — worst case someone signs you out.

import { clearedSessionCookie } from '../_lib/session.mjs'

export default function handler(req, res) {
  res.setHeader('Set-Cookie', clearedSessionCookie())
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'POST') {
    res.status(200).json({ ok: true })
    return
  }
  res.redirect(302, '/account.html')
}
