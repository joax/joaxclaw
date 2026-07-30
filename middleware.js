// Vercel Edge middleware: the gate in front of the hosted PWA.
//
// Everything under /app/ is served only to a signed-in sponsor. This is a convenience
// gate, not DRM — the app is MIT and anyone can build and host it themselves (which the
// account page says out loud). It exists so hosting is a supporter benefit, not a secret.

import { readSession, readCookie, COOKIE } from './api/_lib/session.mjs'
import { isPublicAppAsset } from './api/_lib/gate.mjs'

export const config = {
  // Only the app bundle. The marketing pages, the API routes, and the assets they use
  // stay public.
  matcher: '/app/:path*',
}

export default async function middleware(request) {
  const url = new URL(request.url)

  // The manifest, service worker, and icons must stay reachable or the app can't be
  // installed at all — see api/_lib/gate.mjs for why gating them is self-defeating.
  if (isPublicAppAsset(url.pathname)) return

  const secret = process.env.SESSION_SECRET

  const session = secret ? await readSession(readCookie(request.headers.get('cookie'), COOKIE), secret) : null
  if (session?.sponsor) return   // let it through

  // Not entitled: send them to the account page, remembering where they were headed so
  // signing in lands them back here.
  const target = new URL('/account.html', url.origin)
  target.searchParams.set('next', url.pathname + url.search)
  if (!session) target.searchParams.set('reason', 'signin')
  else target.searchParams.set('reason', 'sponsor')
  return Response.redirect(target, 302)
}
