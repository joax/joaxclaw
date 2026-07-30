// Renders the account card from /api/auth/session. Kept deliberately dumb: the server
// decides entitlement, this only describes it.

const el = document.getElementById('status')
const params = new URLSearchParams(location.search)
const next = params.get('next') || '/app/'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const loginUrl = () => `/api/auth/login?next=${encodeURIComponent(next)}`

// Why they were bounced here, if they were.
const NOTICES = {
  signin: 'Sign in to open the web app.',
  sponsor: 'The web app is hosted for sponsors — a monthly sponsorship unlocks it.',
  expired: 'That sign-in attempt expired. Please try again.',
}
const notice = NOTICES[params.get('reason')] || (params.get('error') === 'signin'
  ? 'Something went wrong signing in with GitHub. Please try again.'
  : params.get('error') === 'expired' ? NOTICES.expired : null)

function render(html) {
  el.innerHTML = (notice ? `<p class="notice-line">${esc(notice)}</p>` : '') + html
  el.hidden = false
}

function show(session) {
  if (!session.configured) {
    render(`
      <h3>Browser access isn't enabled here</h3>
      <p>This deployment has no sign-in configured. You can still
      <a href="/#download">use the desktop app</a> or host the web build yourself — see below.</p>`)
    return
  }

  if (!session.signedIn) {
    render(`
      <h3>Sign in with GitHub</h3>
      <p>The web app is hosted for sponsors of the project. Signing in checks your
      sponsorship — nothing else, and nothing is stored about you.</p>
      <p><a class="btn primary" href="${loginUrl()}">Sign in with GitHub</a></p>`)
    return
  }

  const who = `${session.avatarUrl ? `<img class="avatar" src="${esc(session.avatarUrl)}" alt="" width="20" height="20">` : ''}<strong>${esc(session.login)}</strong>`

  if (session.sponsor) {
    const amount = session.monthlyDollars ? ` ($${session.monthlyDollars}/mo)` : ''
    render(`
      <h3>You're in</h3>
      <p>Signed in as ${who} — sponsor${esc(amount)}. Thank you.</p>
      <p><a class="btn primary" href="${esc(next)}">Open the web app</a>
         <a class="btn" href="/api/auth/logout">Sign out</a></p>`)
    return
  }

  const min = session.minDollars ?? 1
  const oneTime = session.oneTime
    ? `<p>We can see your one-time sponsorship — thank you for it. Hosting is tied to a
       <em>monthly</em> tier, so it doesn't unlock the web app on its own.</p>`
    : ''
  render(`
    <h3>Not sponsoring yet</h3>
    <p>Signed in as ${who}. The hosted web app needs a monthly sponsorship of
    $${esc(min)} or more.</p>
    ${oneTime}
    <p><a class="btn primary" href="https://github.com/sponsors/${esc(session.maintainer)}">♥ Sponsor $${esc(min)}/month</a>
       <a class="btn" href="/api/auth/logout">Sign out</a></p>
    <p class="fineprint fineprint-left">Already sponsoring? Your sponsorship is re-checked
    when you sign in again — <a href="${loginUrl()}">refresh it now</a>.</p>`)
}

fetch('/api/auth/session', { headers: { accept: 'application/json' } })
  .then(r => r.json())
  .then(show)
  .catch(() => render(`
    <h3>Couldn't check your sign-in</h3>
    <p>The account service didn't respond. You can still
    <a href="/#download">use the desktop app</a>, or host the web build yourself.</p>`))
