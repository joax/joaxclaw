// GitHub OAuth + sponsorship lookup. Entitlement for the hosted PWA is "does this
// GitHub account sponsor the maintainer" — GitHub is the billing system, so there's no
// payment code, no card data, and no subscription table here.

const GRAPHQL = 'https://api.github.com/graphql'

// The maintainer whose sponsors get access. A user account, not an org: the query below
// uses `user(login:)`.
export const MAINTAINER = process.env.SPONSOR_MAINTAINER || 'joax'

// `read:user` is what GitHub requires to read sponsorship fields for the signed-in user
// (verified against the live schema — without it the API returns INSUFFICIENT_SCOPES).
// Read-only, and the narrowest scope that answers the question.
export const OAUTH_SCOPE = 'read:user'

export function authorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPE,
    state,
    allow_signup: 'true',
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(`OAuth exchange failed: ${data.error_description || data.error || `HTTP ${res.status}`}`)
  }
  return data.access_token
}

async function graphql(token, query, variables) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'joaxclaw-hosted-pwa',
    },
    body: JSON.stringify({ query, variables }),
  })
  const data = await res.json().catch(() => ({}))
  if (data.errors?.length) throw new Error(data.errors.map(e => e.message).join('; '))
  if (!res.ok) throw new Error(`GitHub GraphQL HTTP ${res.status}`)
  return data.data
}

const VIEWER_QUERY = `
query($login:String!){
  viewer { login avatarUrl }
  user(login:$login){
    viewerIsSponsoring
    sponsorshipForViewerAsSponsor { isOneTimePayment tier { monthlyPriceInDollars } }
  }
}`

// Who is signed in, and do they sponsor the maintainer? A one-time payment is not a
// subscription, so it doesn't grant ongoing access — it's recorded for the account page
// to explain that ("thanks, but hosting needs a monthly tier").
export async function viewerSponsorship(token, maintainer = MAINTAINER) {
  const data = await graphql(token, VIEWER_QUERY, { login: maintainer })
  const sponsorship = data?.user?.sponsorshipForViewerAsSponsor ?? null
  const oneTime = !!sponsorship?.isOneTimePayment
  return {
    login: data?.viewer?.login ?? null,
    avatarUrl: data?.viewer?.avatarUrl ?? null,
    sponsoring: !!data?.user?.viewerIsSponsoring && !oneTime,
    oneTime,
    monthlyDollars: sponsorship?.tier?.monthlyPriceInDollars ?? null,
  }
}

// Minimum monthly tier that unlocks hosting. Anything at or above it counts, so raising
// the price later doesn't retroactively lock out existing sponsors on a lower tier
// unless this is deliberately raised.
export const minMonthlyDollars = () => Number(process.env.SPONSOR_MIN_DOLLARS ?? 1)

export function entitled({ sponsoring, monthlyDollars }, min = minMonthlyDollars()) {
  if (!sponsoring) return false
  // A sponsorship with no readable tier still counts: the boolean is authoritative, the
  // amount is only for display, and failing closed on a missing field would lock out
  // private sponsors.
  return monthlyDollars == null || monthlyDollars >= min
}

// Logins that get in without sponsoring. The maintainer is always included: GitHub won't
// let an account sponsor itself, so without this the owner is locked out of their own
// hosted app. SPONSOR_ALLOWLIST adds collaborators, testers, or comped access.
//
// This is not a hole in the gate: the login is whatever GitHub's OAuth flow proved, and
// the list is server-side configuration the visitor can't influence.
export function allowlist({ maintainer = MAINTAINER, extra = process.env.SPONSOR_ALLOWLIST } = {}) {
  const listed = String(extra ?? '').split(/[,\s]+/).filter(Boolean)
  return new Set([maintainer, ...listed].filter(Boolean).map(l => l.toLowerCase()))
}

// Access decision + why, so the account page can say "you're in as the maintainer"
// instead of implying a sponsorship that doesn't exist.
export function accessFor(viewer, { min = minMonthlyDollars(), allowed = allowlist() } = {}) {
  const login = String(viewer?.login ?? '').toLowerCase()
  if (login && allowed.has(login)) {
    return { granted: true, via: login === String(MAINTAINER).toLowerCase() ? 'maintainer' : 'allowlist' }
  }
  return { granted: entitled(viewer, min), via: 'sponsor' }
}
