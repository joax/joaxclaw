# JoaxClaw

Desktop client for [Openclaw](https://openclaw.dev) — a self-hosted AI agent gateway. Built with Electron, React, and TypeScript.

![Platform](https://img.shields.io/badge/platform-Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Chat** — streaming responses with reasoning blocks, tool call visibility, inline image/video/audio rendering, and voice input
- **Agents** — manage and monitor all configured agents with model assignments and session counts
- **Sessions** — browse, search, and replay past agent sessions
- **CRON Jobs** — view scheduled jobs, run history, and Ollama isolation setup guide
- **Processes** — visual process graph builder and execution monitor
- **Models** — configure providers (Ollama, OpenAI, Google, etc.), view per-model usage and costs
- **Gateway Config** — live Ollama model status, JSON editor, and gateway controls
- **Obsidian Integration** — vault browser, graph view, and memory panel
- **Dashboard** — quick-send to any agent, recent conversations, live system metrics
- **Themes** — dark/light/custom with full CSS variable control

## Requirements

- Linux x86-64
- [Openclaw gateway](https://openclaw.dev/docs/gateway) running locally or remotely
- Ollama (optional, for local models)

## Installation

### Linux

Download the latest `.deb` from the [Releases](../../releases) page and install:

```bash
sudo dpkg -i joaxclaw_*.deb
sudo apt-get install -f   # fix any missing dependencies
```

Launch **JoaxClaw** from your application menu or run `joaxclaw` in a terminal.

### macOS

Download the latest `.dmg` from the [Releases](../../releases) page.

> **Note:** The macOS build is currently unsigned. On first launch macOS will block it.
> Open **System Settings → Privacy & Security** and click **Open Anyway**, or run:
> ```bash
> sudo xattr -rd com.apple.quarantine /Applications/JoaxClaw.app
> ```

## Configuration

On first launch, enter your gateway URL and bearer token:

- **Gateway URL**: `ws://localhost:18789` for a local gateway
- **Token**: generate with `openclaw doctor --generate-gateway-token`

Click **Auto-fill from config** to read credentials directly from `~/.openclaw/openclaw.json` (local installs only).

## Ollama CRON Isolation

To prevent CRON jobs from cancelling interactive sessions, run a dedicated Ollama instance for background jobs. The CRON tab shows a live isolation status panel with setup instructions when Ollama is detected.

See `~/.openclaw/skills/ollama-cron-isolation/SKILL.md` for the full setup guide.

## Development

```bash
# Install dependencies
npm install

# Start in dev mode (hot reload)
npm run dev

# Production build
npm run build

# Package as .deb
npm run package:linux
```

**Stack**: Electron 33 · React 18 · TypeScript · Vite · Tailwind CSS · Zustand

## Releasing

Bump `"version"` in `package.json`, update `CHANGELOG.md`, then commit and push to `main`. GitHub Actions builds the `.deb` and creates a release automatically.
