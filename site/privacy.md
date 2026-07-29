# Privacy policy

*Last updated: 29 July 2026*

This policy covers the **joaxclaw.ai** website and the **JoaxClaw desktop application**.
The short version: JoaxClaw has no accounts, no telemetry, and no servers of ours for
your data to sit on.

## The application

**We collect nothing.** The desktop app contains no analytics, no crash reporting, no
usage tracking, and no phone-home of any kind. There is no JoaxClaw account, and we
operate no service the app talks to.

The app connects **only** to the OpenClaw gateway you configure, at the address you
enter. Everything you do in it — conversations, agents, teams, scheduled jobs — happens
between your machine and that gateway.

**What's stored, and where.** All of it stays on your computer:

- Connection settings, including your gateway token, and your app preferences and themes — in `~/.joaxclaw/`.
- A device identity keypair used to authenticate to your gateway — in `~/.joaxclaw/identity/`. The private key never leaves your machine.
- Conversation history lives on your **gateway**, not in the app, and is governed by however you have configured that gateway.

Uninstalling the app and deleting `~/.joaxclaw/` removes everything it kept.

**Third parties are your choices, not ours.** Your gateway may talk to model providers,
messaging platforms, and plugins that you configure. Those services receive whatever you
send them and apply their own privacy policies. JoaxClaw does not add any recipient of
its own.

**Updates.** The app checks GitHub for new releases. That request reaches GitHub, not us,
and is subject to [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).

## The website

joaxclaw.ai is a static site with **no cookies, no analytics, and no tracking**. It is
hosted on GitHub Pages and downloads are served from GitHub Releases, so GitHub processes
requests to it — including IP addresses — under its own privacy statement. Nothing is
collected by us, and nothing on the site attempts to identify you.

## Sponsorship

Sponsorship is handled entirely by **GitHub Sponsors**. Payment details go to GitHub and
its payment processor, never to us; we see only what GitHub shows a sponsored maintainer,
which is your GitHub handle and sponsorship tier unless you sponsor privately. See
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).

## Children

JoaxClaw is a developer tool and is not directed at children under 13.

## Changes to this policy

This document lives in the [project repository](https://github.com/joax/joaxclaw/blob/main/site/privacy.md),
so every change to it is in public version history. If optional hosted services are ever
introduced — an account model has been discussed — this policy will be updated to
describe them **before** any such service launches, and the terms above will continue to
apply to the free desktop app.

## Contact

Questions about this policy: **joaxap@gmail.com**, or open an issue on
[GitHub](https://github.com/joax/joaxclaw/issues). For security reports, please follow
[SECURITY.md](https://github.com/joax/joaxclaw/blob/main/SECURITY.md) instead.
