# openclaw-joaxclaw-fs

Gateway plugin that exposes JoaxClaw's host-side **teams**, **processes**, and **local
LLM engine** checks over the WebSocket so they work on a **remote** gateway (and so
agent-authored teams/processes are reachable from the app).

They live as files in the gateway host's state dir:

```
<stateDir>/teams/<id>.team.json       TeamBlueprint (source of truth)
<stateDir>/teams/<id>.md              compiled ProcessDef
<stateDir>/teams/<id>.revisions.json  revision snapshots
<stateDir>/processes/<id>.md          process definition
<stateDir>/processes/.runs/<id>.json  persisted run state
```

The desktop app normally reads these via local Electron file IPC, which only reaches
the host when the gateway is local. This plugin registers `teams.*` / `processes.*`
gateway RPC methods that read/write those directories on the host.

## Methods

| Method | Scope | Params | Returns |
|---|---|---|---|
| `teams.list` | read | — | `{ teams: [{ id, blueprint, md, revisions }] }` |
| `teams.get` | read | `{ id }` | `{ id, blueprint, md, revisions }` |
| `teams.set` | write | `{ id, blueprint?, md?, revisions? }` | `{ ok, id }` |
| `teams.delete` | write | `{ id }` | `{ ok, id }` |
| `processes.list` | read | — | `{ defs: [{ id, md }], runs: [{ id, run }] }` |
| `processes.get` | read | `{ id }` | `{ id, md }` |
| `processes.set` | write | `{ id, md }` | `{ ok, id }` |
| `processes.delete` | write | `{ id }` | `{ ok, id }` |
| `processes.runs.set` | write | `{ id, run }` | `{ ok, id }` |
| `engines.probe` | read | `{ url, timeoutMs? }` | `{ ok, status }` |
| `engines.fetch` | read | `{ url, timeoutMs? }` | `{ ok, status, body }` |

Artifacts are passed through verbatim as strings (or `null` when missing); the app
owns (de)serialization. Ids are validated to stay inside the state directories.

`engines.probe` / `engines.fetch` GET a local LLM engine's health/model URL **from
the gateway host** — that's how the app checks liveness and lists models for engines
on the host's loopback/LAN (unreachable from a remote client). The requested URL is
guarded to local-engine hosts only (loopback, `*.local`, private IPv4); anything else
is rejected, so these can't be used as a general request proxy. `engines.fetch` caps
the returned body at 1 MiB; the app parses it (Ollama `/api/tags`, OpenAI `/models`).

## Install

From npm (recommended — works on any gateway host with internet):

```bash
openclaw plugins install openclaw-joaxclaw-fs
openclaw plugins allow joaxclaw-fs
openclaw gateway restart
```

Local gateway (dev — symlink so edits reload):

```bash
openclaw plugins install --link ./plugins/joaxclaw-fs
openclaw gateway restart
```

Remote gateway, no shell access: JoaxClaw's **Install via agent** flow (on the remote
Teams or Processes screen) installs this on the host for you (it embeds the plugin
files in a chat message, so it works even air-gapped). The app uses these methods
automatically when the plugin is present.

### Publishing

CI publishes this package to npm automatically when its `package.json` version
changes on `main` (`.github/workflows/publish-plugin.yml`). Bump the `version`, update
this README / the app's CHANGELOG, and push — the workflow is a no-op for any version
already on npm. Requires an `NPM_TOKEN` repository secret with publish rights.
