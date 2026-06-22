# JoaxClaw roadmap

A high-level view of where JoaxClaw is and what's next. Shipped releases are detailed
in [CHANGELOG.md](CHANGELOG.md); this is the forward-looking summary.

## Shipped

JoaxClaw is a desktop control UI (Electron + React) for an [OpenClaw](https://openclaw.dev)
gateway. Major areas already in place:

- **Chat & agents** — streaming responses with reasoning + tool-call visibility, agent
  grid and editor, sessions browser/replay.
- **Teams & Processes** — visual multi-agent team builder, conditional branching,
  revision history, and a live execution monitor.
- **Channels** — manage ~33 messaging platforms, scoped agent routing
  (account / group / team / guild), multi-account, in-app WhatsApp QR pairing, and a
  per-channel **policy editor** (DM/allowlist/group policy + action permissions).
- **CRON jobs** — schedule agent turns or **whole team runs**, with run history.
- **Models** — provider/model management, per-model cost tracking, model picker that
  also surfaces engines' installed models.
- **Local LLM engines** — detect/health-check Ollama, LM Studio, vLLM, llama.cpp, Jan,
  KoboldCpp; cron-isolation detection; works against local *and* remote gateways.
- **Plugins** — enable/disable plus a per-plugin **Configure** dialog (API keys routed
  to the right config path) with a configured/needs-key badge.
- **Remote gateways** — Teams, Processes, and local-engine health work over a remote
  gateway via the bundled [`joaxclaw-fs`](plugins/joaxclaw-fs/) plugin (published to npm
  as `openclaw-joaxclaw-fs`), installable in one click from the app.
- **Obsidian** — vault browser, graph, and memory panel.

## Next / under consideration

- **Per-engine model listing in the model picker** for remote engines (the
  `engines.fetch` primitive exists; surface it more widely).
- **Richer plugin config forms** — schema-driven fields beyond the curated API-key
  routing, for plugins with non-trivial `config`/`llm` settings.
- **Obsidian for agents** — let gateway agents (not just the app) read/write the vault.
- **Broader curated coverage** — more channels with first-class credential/policy forms,
  more plugins with curated config.

## Non-goals

- JoaxClaw is a **control UI**, not a runtime — scheduling and agent execution live in
  the OpenClaw gateway. Features that belong in the gateway are proposed upstream, not
  reimplemented here.

Have an idea? Open an issue — the roadmap is intentionally lightweight and shaped by use.
