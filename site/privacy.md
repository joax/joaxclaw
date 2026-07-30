# Privacy policy

*Last updated: 30 July 2026*

This policy covers the **joaxclaw.ai** website, the **JoaxClaw application** (desktop and
web), and **signing in** for the hosted web app.

The short version: the app has no accounts and no telemetry, and there is no database
here. Signing in asks GitHub one question — do you sponsor the project — and the answer
lives in a signed cookie in your browser. We store nothing about you on our side.

## The application

**We collect nothing.** The app — desktop or web — contains no analytics, no crash
reporting, no usage tracking, and no phone-home of any kind. It has no account of its own,
and we operate no service it talks to. (Signing in, described below, gates *access to the
hosted copy*; the running app never reports to us.)

The app connects **only** to the OpenClaw gateway you configure, at the address you
enter. Everything you do in it — conversations, agents, teams, scheduled jobs — happens
between your machine and that gateway.

**What's stored, and where.** All of it stays on your own device:

- Connection settings, including your gateway token, and your app preferences and themes — in `~/.joaxclaw/` on desktop, or your browser's local storage in the web app.
- A device identity keypair used to authenticate to your gateway — in `~/.joaxclaw/identity/` on desktop, or a non-extractable key in your browser's IndexedDB in the web app. The private key never leaves your device.
- Conversation history lives on your **gateway**, not in the app, and is governed by however you have configured that gateway.

Uninstalling the app and deleting `~/.joaxclaw/` — or clearing site data for the web app —
removes everything it kept.

**A note on trust in the web app.** Because we serve the hosted copy, we could in principle
serve modified code, which a desktop or self-hosted build wouldn't allow. If that matters
for your threat model, self-host the build or use the desktop app; both are byte-for-byte
reproducible from the public repository.

**Third parties are your choices, not ours.** Your gateway may talk to model providers,
messaging platforms, and plugins that you configure. Those services receive whatever you
send them and apply their own privacy policies. JoaxClaw does not add any recipient of
its own.

**Updates.** The app checks GitHub for new releases. That request reaches GitHub, not us,
and is subject to [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).

## The website

joaxclaw.ai is a static site with **no analytics and no tracking**, and the only cookies it
ever sets are the sign-in ones described below. It is hosted on **Vercel**, and downloads
are served from GitHub Releases, so both process requests — including IP addresses — under
their own privacy policies ([Vercel](https://vercel.com/legal/privacy-policy),
[GitHub](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement)).
Nothing is collected by us, and nothing on the site attempts to identify you.

## Signing in (hosted web app only)

Signing in exists for one purpose: to check whether your GitHub account sponsors the
project, so the hosted copy of the web app can be served to sponsors.

- **What we ask GitHub for.** The read-only `read:user` scope, used to read your login and
  whether you sponsor this project. We do not request access to your repositories, and we
  cannot write anything to your account.
- **The access token is not kept.** It is used once, during sign-in, and discarded.
- **There is no database.** The result — your GitHub login, avatar URL, and a yes/no
  sponsorship verdict — is placed in a cryptographically signed cookie in your browser and
  nowhere else. We keep no user records, so there is nothing to export, breach, or sell.
- **It expires on its own.** The cookie lasts 12 hours, after which your sponsorship is
  re-checked at next sign-in. Signing out deletes it immediately.
- **You can revoke it** at any time from GitHub's
  [authorized OAuth apps](https://github.com/settings/applications) settings.

The desktop app and any self-hosted build never involve this step at all.

## Sponsorship

Sponsorship is handled entirely by **GitHub Sponsors**. Payment details go to GitHub and
its payment processor, never to us; we see only what GitHub shows a sponsored maintainer,
which is your GitHub handle and sponsorship tier unless you sponsor privately. See
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).

## Children

JoaxClaw is a developer tool and is not directed at children under 13.

## Changes to this policy

This document lives in the [project repository](https://github.com/joax/joaxclaw/blob/main/site/privacy.md),
so every change to it is in public version history. The hosted web app and its sign-in are
the only optional service that exists; if that ever changes, this policy will be updated
**before** the change ships. The terms above continue to apply unchanged to the free
desktop app and to self-hosted builds. See also the [terms](terms.html).

## Contact

Questions about this policy: **joaxap@gmail.com**, or open an issue on
[GitHub](https://github.com/joax/joaxclaw/issues). For security reports, please follow
[SECURITY.md](https://github.com/joax/joaxclaw/blob/main/SECURITY.md) instead.
