# Changelog

All notable changes to JoaxClaw are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- **Configure plugins from the app (incl. API keys).** The Extensions view previously only enabled/disabled plugins; each plugin now has a **Configure** action that opens a settings dialog. It surfaces the plugin's **API key** routed to the correct place in the gateway config — model providers → `models.providers.<id>.apiKey` (with an optional base-URL override), TTS providers → `messages.tts.providers.<id>.apiKey`, web-search plugins → `tools.web.search.apiKey` — plus an **Advanced** tab for the raw `plugins.entries.<id>` config (behaviour/`llm` gating). Keys can be literals or env-var `SecretRef`s (preserved read-only). All writes go through `config.patch`, so it works on **local and remote** gateways. New `lib/pluginConfig.ts` (curated key routing) + `PluginConfigModal`; curated paths validated against the gateway config schema, with unit tests.

### Fixed

- **Hardened the "Install via agent" script.** It used `openclaw plugins allow` — not a real subcommand, so it was a silent no-op (enabling relied entirely on `enabledByDefault`). The script now uses `openclaw plugins enable`, runs `install --force` so re-runs upgrade instead of failing, and adds an `openclaw plugins inspect` guard that aborts *before* the gateway restart if the plugin didn't register (so a failed install surfaces instead of a misleading "done"). Step output is kept visible for diagnosis. Same corrections applied to the plugin README and Help → Remote Teams. Verified end-to-end; covered by a regression test.

## [0.8.0] - 2026-06-21

### Added

- **Per-channel policy editor.** Each configured channel's **Edit** dialog now has a **Policy** tab for the access + capability controls the gateway exposes under `channels.<id>`: **DM policy** (`pairing` / `allowlist` / `open` / `disabled`), a **DM/group allowlist** of sender IDs, **allow-bots**, **group policy**, and an **action-permissions** grid (what the agent may do on the platform — react, post, pin, moderate, roles, …). Policy can be set for the whole channel or **overridden per account or per group** (`channels.<id>.accounts.<id>` / `.groups.<id>`). Curated per provider (Telegram, Discord, Slack, Matrix, WhatsApp) from the gateway config schema; other channels keep using the Advanced raw editor. New `lib/channelPolicy.ts` + `ChannelPolicyEditor`; writes go through `config.patch` (with `replacePaths` for allowlist edits). Verified end-to-end against a live gateway.
- **Per-engine model lists in Settings → Local LLM.** Each reachable local engine now shows how many models it's serving, expandable to the full list. Works locally (via a new `ollama:fetch` main-process IPC, which isn't CORS-bound) and on a remote gateway (via the plugin's `engines.fetch`). Parses both Ollama (`/api/tags`) and OpenAI-compatible (`/models`) responses. New `fetchEngineModels()` / `parseModelIds()` in `lib/localEngines.ts`, with unit tests.
- **The model picker offers each engine's installed models.** Beyond the models declared in the gateway config, the picker now also lists models a local engine is actually serving (e.g. an Ollama model you pulled but never added to config), tagged `installed` and still selectable since the provider routes by name. Gateway-aware via `fetchEngineModels`, so it works on a remote gateway too. Used across the Agents, Agent editor, and CRON editor pickers.
- **Isolated cron-instance detection works for every engine, not just Ollama.** The "second instance on a companion port" convention (Ollama `:11434`→`:11435`) is now generalized to `<default port>+1` for all known engines (LM Studio, vLLM, llama.cpp/LocalAI, Jan, KoboldCpp), so the Local LLM Engines panel can flag an isolated instance and prompt for an `<engine>-cron` provider regardless of engine. Unused ports just probe down — no false positives.

### Fixed

- Deleting a channel (or removing an account) whose config contains arrays — now including policy **allowlists** — no longer fails the gateway's array-shrink guard: the store collects the block's array paths and passes them in `replacePaths`.

### Removed

- Dead Ollama-only helpers `checkOllama` / `resolveOllamaUrl` in `lib/ollamaHealth.ts` (which now only exports the widely-used `gatewayHost` / `isLocalGateway`).

## [0.7.1] - 2026-06-20

### Added

- **`joaxclaw-fs` plugin is published to npm** as [`openclaw-joaxclaw-fs`](https://www.npmjs.com/package/openclaw-joaxclaw-fs), so installing it on a gateway host is one command: `openclaw plugins install openclaw-joaxclaw-fs && openclaw plugins allow joaxclaw-fs`. A new CI workflow (`.github/workflows/publish-plugin.yml`) publishes the package automatically whenever its `package.json` version changes on `main`, version-guarded so unrelated pushes are a no-op (requires an `NPM_TOKEN` repo secret). The in-app Help → Remote Teams steps and the plugin README now lead with the npm install.

### Changed

- **"Install via agent" now installs the plugin from npm** instead of embedding its files as base64 in the chat message. The script handed to the host agent is now a short `openclaw plugins install openclaw-joaxclaw-fs` + allow + restart. This removed the renderer's dependency on the `teams:installScript` main-process IPC (and that IPC/preload bridge), eliminating the old "Restart JoaxClaw / No handler registered" failure mode. Offline hosts use the manual `--link` steps in Help → Remote Teams.

## [0.7.0] - 2026-06-20

### Added

- **Remote-gateway local-engine health & model listing.** The `joaxclaw-fs` plugin now exposes `engines.probe` and `engines.fetch` — host-side GETs that check a local LLM engine's liveness and read its model list **from the gateway host**. Previously, engines on a remote gateway's loopback/LAN showed as *unknown* because the app can only reach `localhost` on the client machine. The Local LLM Engines panel (Crons) and Settings card now route their probes through the plugin when the gateway is remote, and also discover engines on the host's default ports. Requested URLs are guarded to local-engine hosts only (loopback / `*.local` / private IPv4), so the methods can't be used as a general request proxy. New `probeStatus()` routing in `lib/localEngines.ts`; verified end-to-end against a live gateway.
- **Saved connections survive a `localStorage` reset.** Gateway connections are now mirrored to the file-based localstore (`~/.openclaw`-adjacent `~/.joaxclaw/store.json`) in addition to `localStorage`, and any missing ones are restored on startup (merged by URL). Previously an Electron `localStorage` reset (origin change, concurrent instances, profile corruption) could silently wipe them. New `restoreConnectionsFromBackup()` in `store/connection.ts`.

### Notes

- The `engines.*` probing requires the **updated `joaxclaw-fs` plugin** on the gateway host. Existing installs need to re-run **Install via agent** (remote Teams/Processes screen) or `openclaw plugins install --link ./plugins/joaxclaw-fs` + a gateway restart to pick up the new methods; until then remote engines stay *unknown* (no regression).

## [0.6.0] - 2026-06-19

### Added

- **Teams & Processes work over a remote gateway** via a new bundled gateway plugin, **`joaxclaw-fs`** ([plugins/joaxclaw-fs/](plugins/joaxclaw-fs/)). Team blueprints (`~/.openclaw/teams`) and process definitions/runs (`~/.openclaw/processes`) are files on the gateway host; the app used to read them only over local file IPC, so they were invisible on a remote gateway. The plugin registers `teams.*` and `processes.*` (read/write, operator-scoped) over the WebSocket. Both stores now probe for it and use an **RPC backend** when present (local *and* remote, incl. items authored by agents on the host), falling back to local files on a local gateway. Covers both features with one install.
- **"Install via agent"** — on a remote Teams/Processes screen, one click hands an agent on the gateway host a self-contained script (the plugin's files travel **base64-embedded inside the chat message** — no clone, npm, registry, or upload) that installs `joaxclaw-fs` and restarts the gateway. You just approve the command. A "Manual steps" path and Help → **Remote Teams** page document the same install.
- **Scoped channel routing** — agent bindings can now target more than the whole channel: a specific **account**, a **group/peer** (by id), a **Slack team**, or a **Discord guild**. A binding editor on each channel card builds the `match` and lists existing bindings with their scope; the gateway resolves the most specific match first (peer → guild → team → account → channel → default).
- **Multi-account channels** — add/name/remove additional accounts per channel (`channels.<id>.accounts.<id>`) and set the default account, directly from the channel card. Per-account credentials are editable via **Edit → Advanced**.
- **Secret-scan pre-commit gate** ([scripts/check-secrets.mjs](scripts/check-secrets.mjs)) — a dependency-free scanner runs first in the pre-commit hook over staged content and blocks commits containing keys/tokens/credentials (private keys, AWS/OpenAI/Google/GitHub/Slack/Stripe/etc., JWTs, `user:pass@` URLs, and the openclaw gateway-token format), with matches redacted in output. `npm run audit-secrets` scans every tracked file.

### Changed

- **Client hardware metrics are hidden when the gateway is remote.** GPU/CPU/RAM and the local-Ollama model list are read from the client machine (and `localhost:11434`), so they don't describe a remote gateway host. The status bar drops the GPU/RAM chips, and the System Monitor + dashboard Resources panel show a short "these are your client machine" note instead. New `useIsRemoteGateway()` selector in `store/connection.ts`.
- Teams and Processes now **re-load whenever the gateway (re)connects**, so the "install the plugin" notice re-probes and clears itself automatically after an install + gateway restart — no manual retry.
- Polished the team designer (graph editor + Teams view).
- Release workflow now creates the GitHub Release (with `CHANGELOG.md` notes) in a dedicated job that runs before the platform builds, so the notes can't be raced to an empty body by whichever build finishes first; the Linux/macOS jobs only upload their installer asset.

### Notes

- The `joaxclaw-fs` plugin ships in-repo and isn't published to a registry; remote installs use the in-app **Install via agent** flow or a manual `openclaw plugins install --link`. Publishing for one-command installs is a possible follow-up.

## [0.5.0] - 2026-06-17

### Added

- **Channel management (Settings → Channels)** — configure the messaging platforms the gateway talks on and assign each to an agent. Browse a catalog of ~33 openclaw channels; create one with first-class credential forms for the common channels (Telegram, Discord, Slack, WhatsApp, Feishu, SMS, QQ Bot) or a raw JSON5 editor (incl. env `SecretRef`s) for any other. Per-channel live status, enable/disable, Start/Stop/Logout runtime controls, and agent bindings (`bindings[]`). New `src/lib/channels.ts`, `src/store/channels.ts`, `src/components/gateway/ChannelsPanel.tsx`.
- **WhatsApp QR pairing in-app** — links over the gateway's `web.login.start` / `web.login.wait` RPCs (the same flow the official control-UI uses), rendering the QR as a PNG with auto-refresh and connection detection — no CLI shell-out, and it works for remote gateways.
- **Auto-reconnect with explanatory UI** — adding/enabling a channel makes the gateway reload and briefly drop the control-UI WebSocket. The app now silently retries with backoff and shows a `ReconnectOverlay` ("the gateway is reloading…") instead of bouncing to the connect screen, then restores the tab you were on. New `src/components/layout/ReconnectOverlay.tsx`; reconnect state in `src/store/connection.ts`.
- **Local LLM engine detection & isolation** — generalized the Ollama-only cron panel to any local engine (Ollama, LM Studio, vLLM, llama.cpp, LocalAI, Jan, KoboldCpp). Engines are discovered from gateway config providers and, on a local gateway, by probing default ports (+ the Ollama `:11435` cron convention). New `src/lib/localEngines.ts` + `src/components/crons/LocalEnginesPanel.tsx`. Architecture notes: [src/lib/LOCAL_ENGINES.md](src/lib/LOCAL_ENGINES.md).

### Changed

- `config.patch` writes that shrink the `bindings` array (unbind agent, delete channel) now pass `replacePaths: ['bindings']`, which the gateway requires for array-entry removal.
- `GatewayView` (Settings) remembers its active tab across remounts, so an auto-reconnect returns you to Channels rather than the Connection tab.
- `ollama:probe` IPC now takes a full health URL (`/api/tags` for Ollama, `/v1/models` for OpenAI-compatible engines) instead of an Ollama base URL.
- Removed the Ollama-specific `OllamaIsolationPanel` from `CronsView.tsx` in favor of the generalized `LocalEnginesPanel`.

### Notes / deferred (see src/lib/LOCAL_ENGINES.md)

- Generalize the Settings "Ollama Endpoints" override card to per-engine URLs (currently Ollama-only).
- Remote-gateway liveness for loopback instances stays `unknown` (would need a gateway-side probe RPC).

## [0.4.0] - 2026-06-10

### Added
- ESLint v10 (flat config) with `@typescript-eslint` and `eslint-plugin-react-hooks`
- `eslint.config.mjs` — TypeScript-aware rules; `react-hooks/rules-of-hooks` is an error, `exhaustive-deps` and unused vars are warnings
- Pre-commit hooks via `simple-git-hooks`: runs `lint → type-check → tests` on every commit; reinstalls automatically after `npm install`
- `lint` and `type-check` npm scripts
- `@vitest/coverage-v8` for coverage reporting (`npm test -- --coverage`)
- New test file `src/lib/__tests__/process.test.ts` — full coverage for `processParser`, `processCompiler`, and `processTemplate`
- Expanded `src/lib/__tests__/team.test.ts` — additional branch coverage across blueprint, compiler, and validation
- `coverage/` added to `.gitignore`

### Changed
- Test count: 59 → 138
- Statement coverage: 81.98% → 97.22%
- Branch coverage: 61.59% → 90.20%
- Function coverage: 94.64% → 100%

## [0.3.0] - 2026-06-09

### Added
- **Teams** — new Teams tab for composing and running multi-agent team workflows
- `TeamBlueprint` (`.team.json`) as the durable source of truth for team definitions; compiled `.md` is a derived artifact
- Native conditional branching in the blueprint (`routes`, `TeamRoute`, `TeamBranch`) with a visual route editor in the Build tab
- Skip-style branch routing — a route can jump over intermediate members; validation uses forward reachability (BFS) instead of raw edge counts
- Decision nodes in compiled graphs reuse the `handoff` type with multiple conditional outgoing edges — no new runtime node types needed
- Revision history for teams — every blueprint save and graph-tab save appends a snapshot (capped at 20); visible in the History tab
- Graph-tab saves are durable: appends revision, persists blueprint + revision file atomically, shows an error banner on failure
- Launch validation (`validateTeamForLaunch`) checks controller, members, route references, graph reachability, and smoke-tests the runtime compile path
- Export / import teams as `.team.json` bundles; import preserves compiled graph snapshot when present
- Dashboard Teams section — shows running/recent team runs with live status
- Chat input draft persistence — unsent text and attachments are saved per conversation and restored on return
- New app icons across all platforms (Linux, macOS, Windows, iOS, Android); tray icon updated
- `src/lib/TEAMS.md` — architecture reference for the team/process-builder source-of-truth boundary
- Process-builder skill updated to distinguish team-compiled process files from standalone process files

### Changed
- NavRail now includes a dedicated Teams entry (`UsersRound` icon)
- `saveCompiledDef` appends a revision snapshot and persists both blueprint and revision file before updating in-memory state
- Graph-tab save failure is now visible (error banner) rather than silent
- Revision list uses stable index keys to avoid duplicates when graph edits share a blueprint version number

### Fixed
- `computeRevisionSummary` now detects graph-edit and blueprint-regeneration transitions
- Process-builder skill validation checklist clarified: incoming-edge rule applies to standalone processes only; team branching graphs with skip routes are exempt

## [0.2.0] - 2026-06-08

### Added
- macOS universal DMG build (Intel + Apple Silicon) via GitHub Actions
- Unsigned — see README for first-launch instructions

### Changed
- GitHub Actions workflow now builds Linux DEB and macOS DMG in parallel

## [0.1.0] - 2026-06-08

First public release.

### Added

**Chat**
- Streaming assistant responses with reasoning block (auto-expands while streaming, collapses on completion)
- Tool call visibility with per-call status, duration, and expandable input/output
- Inline image, video, and audio rendering via markdown link syntax
- Audio player with format badge and source icons (Obsidian vault, Google Drive, Dropbox, remote)
- Image attachment support — paste, drag-drop, or file picker; images forwarded to vision models
- Voice recording input
- Message feedback (thumbs up / down) — persisted to `~/.openclaw/feedback/feedback.jsonl`; thumbs-down writes a memory note the agent reads next session
- Smooth scroll that tracks text streaming, tool call additions, and reasoning updates
- Instant jump to bottom on conversation load (no animation)
- `/compact` slash command for context compaction

**Dashboard**
- Quick-send card with agent picker (fixed dropdown clipping in scroll containers)
- Recent conversations list with last message preview
- Live system metrics panel (CPU, RAM, GPU via `systeminformation` + Ollama API)

**Agents**
- Agent grid with model, emoji, session count, and last-active time
- Subagent relationship display

**Sessions**
- Sortable, filterable session table
- Load any past session into chat for replay

**CRON Jobs**
- Job list with schedule description, model, last/next run time, and run history
- Inline run history with status, duration, token usage, and link to conversation
- **Ollama Isolation panel** — detects both Ollama instances (`:11434` main, `:11435` CRON), shows architecture diagram and contention warning, auto-expands when setup is needed

**Processes**
- Visual process graph builder with node types (agent turns, conditions, loops)
- Live execution monitor

**Models**
- Provider management (Ollama, OpenAI, Google, and more)
- Per-model token usage and cost tracking across sessions and CRON runs
- Model picker with live Ollama VRAM status

**Gateway Config**
- Monaco JSON editor for `openclaw.json`
- Gateway start/stop/restart controls
- Live Ollama model list with loaded status and VRAM usage

**Obsidian Integration**
- Vault detection and setup wizard
- File browser and graph view
- Memory panel

**Settings**
- Dark / light / custom themes with full CSS variable control
- Icon family selection (Lucide default)
- Status bar configuration

**Infrastructure**
- Linux `.deb` packaging via electron-builder
- GitHub Actions CI — builds and releases on version bump to `main`
- Ollama CRON isolation skill (`~/.openclaw/skills/ollama-cron-isolation/SKILL.md`)
- Updated `display-media` skill with audio player syntax and source badge documentation
