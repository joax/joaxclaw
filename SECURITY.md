# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately instead, either:

- **GitHub** — the repository's **Security → Report a vulnerability** tab (private
  vulnerability reporting), or
- **Email** — joaxap@gmail.com with `SECURITY` in the subject.

Include what you can: affected version, steps to reproduce, impact, and any logs or
proof-of-concept. **Don't include real tokens or API keys** — redact them.

This is a small open-source project, so there's no formal SLA, but reports are taken
seriously and acknowledged on a best-effort basis. Once a fix is available we'll release
it and credit you (if you'd like) in the release notes.

## Supported versions

Fixes land on `main` and ship in the next release. Please verify against the **latest
release** before reporting.

## Scope

JoaxClaw is a **desktop control UI** for an [OpenClaw](https://openclaw.dev) gateway. It:

- connects to a gateway over WebSocket using a bearer token you provide,
- stores saved connections (including tokens) locally on your machine, and
- reads/writes gateway config via the gateway's own RPCs.

In scope: issues in the JoaxClaw app itself — e.g. mishandling or leaking of credentials,
unsafe handling of untrusted gateway/agent content, or insecure IPC.

Out of scope: vulnerabilities in the **OpenClaw gateway** or its plugins/agents — please
report those to the [OpenClaw project](https://openclaw.dev) upstream. The exception is
the bundled [`joaxclaw-fs`](plugins/joaxclaw-fs/) plugin, which is part of this repo.

## Good practices for users

- Treat your gateway **token** like a password; it grants operator access to the gateway.
- Prefer env-var `SecretRef`s over literal keys in config where possible.
- Keep the gateway reachable only over trusted networks (e.g. a VPN/tailnet) when remote.
