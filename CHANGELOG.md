# Changelog

All notable changes to JoaxClaw are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- **Local LLM engine detection & isolation** — generalized the Ollama-only cron panel to any local engine (Ollama, LM Studio, vLLM, llama.cpp, LocalAI, Jan, KoboldCpp). Engines are discovered from gateway config providers and, on a local gateway, by probing default ports (+ the Ollama `:11435` cron convention). New `src/lib/localEngines.ts` + `src/components/crons/LocalEnginesPanel.tsx`. Architecture notes: [src/lib/LOCAL_ENGINES.md](src/lib/LOCAL_ENGINES.md).

### Changed

- `ollama:probe` IPC now takes a full health URL (`/api/tags` for Ollama, `/v1/models` for OpenAI-compatible engines) instead of an Ollama base URL.
- Removed the Ollama-specific `OllamaIsolationPanel` from `CronsView.tsx` in favor of the generalized `LocalEnginesPanel`.

### TODO (see src/lib/LOCAL_ENGINES.md)

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
