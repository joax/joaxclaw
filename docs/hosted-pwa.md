# Hosted web app (sponsors)

The web build, served from joaxclaw.ai and gated behind an active GitHub sponsorship. This
is the operator's guide: what it is, what it deliberately isn't, and how to turn it on.

## What this is

A **convenience tier**, not a licence. The app is MIT-licensed and the web build has no
server component, so anyone can `npm run build:web` and host it themselves for free — the
[account page](../site/account.html) says so plainly and links to the instructions.
Sponsoring pays for the project; hosting is the thank-you.

Two constraints are worth understanding before promoting it, because both live on the
*user's* side and neither can be fixed from here:

1. **The user's gateway must be reachable over `wss://`.** An HTTPS page cannot open a
   plain `ws://` socket, so a bare LAN gateway can't be used from the hosted app at all.
2. **The user must allow this origin** in their own `gateway.controlUi.allowedOrigins`.
   Loopback, RFC1918, `.local`, and `.ts.net` origins auto-accept; a public domain doesn't.

Between them, the addressable audience is people already running a TLS-terminated remote
gateway — who are also the people most able to self-host. Price and promote accordingly.

## Architecture

```
Browser ──► /account.html ──► /api/auth/login ──► GitHub OAuth
                                    │
                                    ▼
                            /api/auth/callback
                        (exchange code, ask GitHub:
                         "does this login sponsor us?")
                                    │
                     signed cookie (login + verdict, 12h)
                                    │
        /app/*  ◄── middleware.js checks the cookie ──► /account.html
```

- **No database.** Entitlement lives in GitHub; the verdict lives in an HMAC-signed cookie.
  There is no user table, so there is nothing to breach, export, or delete on request.
- **No payment code.** GitHub Sponsors is the billing system: no card data, no PCI scope,
  no webhooks, no tax plumbing, and no Stripe fee (which would have taken ~33% of a $1
  subscription).
- **The GitHub access token is discarded** after the single sponsorship query.
- **Sessions last 12 hours** (`TTL_SECONDS`), so a cancelled sponsorship loses access
  within a day without any bookkeeping on our side.

| File | Role |
| --- | --- |
| `api/_lib/session.mjs` | Sign/verify the session cookie (Web Crypto, runs in Node *and* Edge) |
| `api/_lib/github.mjs` | OAuth exchange + the sponsorship GraphQL query + `entitled()` |
| `api/auth/login.mjs` | Starts OAuth; signed state cookie for CSRF; same-origin `next` only |
| `api/auth/callback.mjs` | Verifies state, resolves sponsorship, sets the session |
| `api/auth/session.mjs` | What the account page renders from; never 401s |
| `api/auth/logout.mjs` | Clears the cookie |
| `middleware.js` | Edge gate on `/app/*` |
| `site/account.html`, `site/account.js` | Sign-in, status, and the self-host instructions |

## Turning it on

**1. Create a $1/month sponsorship tier.** The Sponsors listing for the maintainer account
is live, but a monthly tier has to exist for anyone to subscribe — check
`github.com/sponsors/<login>/dashboard/tiers`. Without it, nobody can become entitled.

**2. Create a GitHub OAuth app** (Settings → Developer settings → OAuth Apps):

- Homepage: `https://joaxclaw.ai`
- Authorization callback URL: `https://joaxclaw.ai/api/auth/callback`

**3. Set the Vercel environment variables** (Project → Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | from the OAuth app |
| `GITHUB_CLIENT_SECRET` | from the OAuth app |
| `SESSION_SECRET` | a long random string — `openssl rand -hex 32` |
| `SPONSOR_MAINTAINER` | optional, defaults to `joax` |
| `SPONSOR_MIN_DOLLARS` | optional, defaults to `1` |

Until `GITHUB_CLIENT_ID` and `SESSION_SECRET` are set, sign-in reports itself as
unconfigured and `/app/*` stays closed — the marketing pages are unaffected.

**4. Preview deployments.** Add the same variables to the Preview environment if you want
to exercise sign-in there; the callback URL must then match the preview origin, so it's
usually easier to test on production.

## Operational notes

- **Scope.** OAuth requests `read:user` only — read-only, no repository access. It's the
  scope GitHub requires for the sponsorship fields (verified against the live schema: the
  query fails with `INSUFFICIENT_SCOPES` without it).
- **Private sponsorships** are honoured: `viewerIsSponsoring` is authoritative and the
  tier amount may be hidden, so `entitled()` admits a sponsor whose amount reads as `null`
  rather than failing closed.
- **One-time sponsorships don't unlock hosting** — the account page thanks the user and
  explains that a monthly tier is what's needed.
- **Raising the price later** doesn't retroactively lock out existing sponsors unless
  `SPONSOR_MIN_DOLLARS` is deliberately raised.
- **CSP.** The marketing pages run under a strict policy; `/app/*` gets a looser one
  (`connect-src 'self' wss: https:`, inline styles) because the app connects to arbitrary
  user gateways and React sets inline styles. Both are in `vercel.json`.
- **The install step is no longer a no-op** (unlike the marketing-only build): the web app
  needs Vite, so Vercel runs `npm ci --ignore-scripts` — the flag skips Electron's ~100MB
  postinstall binary download, which the web build doesn't need.

## What is deliberately not here

- No accounts of our own, no passwords, no email delivery, no password resets.
- No Stripe, Paddle, or invoicing. GitHub owns billing, refunds, and VAT.
- No analytics, and no per-user records of any kind.
- No proxying of gateway traffic: the app talks straight to the user's gateway, so we never
  see conversations, tokens, or data.
