# Contributing to JoaxClaw

Thanks for your interest! JoaxClaw is a desktop control UI for an
[OpenClaw](https://openclaw.dev) gateway. This guide covers how to get set up and what
we look for in a contribution.

## Getting started

```bash
git clone https://github.com/joax/joaxclaw.git
cd joaxclaw
npm install
npm run dev      # hot-reload dev build
```

You'll need an OpenClaw gateway to connect to (local or remote). See the
[README](README.md#connect-to-your-gateway) for connection details.

## Before you open a pull request

Run the same checks the pre-commit hook runs:

```bash
npm run lint
npm run type-check
npm test
```

All three must pass. A dependency-free **secret scanner** also runs on commit and blocks
anything that looks like a key or token — never commit real credentials (use a
`SecretRef` / env var, or a placeholder in docs).

Other expectations:

- **Match the surrounding code** — naming, structure, inline-style conventions, and the
  CSS-variable theming (`var(--accent)`, etc.). New code should read like the file it
  lives in.
- **Keep changes focused.** One logical change per PR; update [CHANGELOG.md](CHANGELOG.md)
  under `[Unreleased]` when behaviour changes.
- **Add tests** for non-trivial logic (we use [Vitest](https://vitest.dev); see
  `src/lib/__tests__`).
- **Architecture notes** live next to the code — e.g. [`src/lib/TEAMS.md`](src/lib/TEAMS.md)
  and [`src/lib/LOCAL_ENGINES.md`](src/lib/LOCAL_ENGINES.md). Read the relevant one before
  reworking that area, and update it if you change the design.

## For larger changes

Open an issue first to discuss the approach. The [roadmap](ROADMAP.md) is intentionally
lightweight and shaped by real use — if something there matters to you, say so.

## Reporting bugs / requesting features

Use the issue templates. Good bug reports include your OS, the JoaxClaw version, whether
the gateway is local or remote, and steps to reproduce.

## Commit messages

Short, imperative summaries (`fix: …`, `feat: …`, `docs: …`). Explain the *why* in the
body when it isn't obvious.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
