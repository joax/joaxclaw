# Changelog

All notable changes to JoaxClaw are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
