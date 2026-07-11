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
| `teams.run` | write | `{ id, task, autorun? }` | `{ ok, id, nonce }` |
| `teams.delete` | write | `{ id }` | `{ ok, id }` |
| `processes.list` | read | — | `{ defs: [{ id, md }], runs: [{ id, run }] }` |
| `processes.get` | read | `{ id }` | `{ id, md }` |
| `processes.set` | write | `{ id, md }` | `{ ok, id }` |
| `processes.delete` | write | `{ id }` | `{ ok, id }` |
| `processes.runs.set` | write | `{ id, run }` | `{ ok, id }` |
| `engines.probe` | read | `{ url, timeoutMs? }` | `{ ok, status }` |
| `engines.fetch` | read | `{ url, timeoutMs? }` | `{ ok, status, body }` |
| `engines.pull` | write | `{ baseUrl, model }` | `{ pullId }` (Ollama; streamed, **overall** %) |
| `engines.pullStatus` | read | `{ pullId }` | `{ status, completed, total, done, error?, model }` |
| `engines.delete` | write | `{ baseUrl, model }` | `{ ok, status }` (Ollama) |
| `engines.show` | read | `{ baseUrl, model }` | `{ ok, status, body }` (Ollama `/api/show`) |
| `engines.keepAlive` | write | `{ baseUrl, model, keepAlive }` | `{ ok, status }` (load `<0` / unload `0`) |
| `memory.status` | read | — | `{ ok, feature: 'memory-skills' }` (presence probe) |
| `memory.skill.set` | write | `{ slug, markdown }` | `{ ok, slug }` (writes `skills/<slug>/SKILL.md`) |
| `memory.skill.remove` | write | `{ slug }` | `{ ok, slug }` |
| `memory.list` | read | `{ providerId, config }` | `{ items: [{ id, title, subtitle? }] }` (host-side browse) |
| `memory.read` | read | `{ providerId, config, id }` | `{ content }` |
| `memory.graph` | read | `{ providerId, config }` | `{ graph: { nodes, edges } }` (Obsidian backlink graph) |
| `host.metrics` | read | — | `{ ok, cpu, ramUsed, ramTotal, gpu: [{ model, utilizationGpu, memUsed, memTotal, temperatureGpu }] }` (gateway host CPU %/RAM bytes/GPU MB) |

Artifacts are passed through verbatim as strings (or `null` when missing); the app
owns (de)serialization. Ids are validated to stay inside the state directories.
`memory.skill.*` lets the Memory tab manage a memory connection's agent skill on a
remote gateway host (the local `~/.openclaw` is the wrong machine there); `memory.list`
/`memory.read` browse a server-local store's content. A credential in `config` may be an
`env:VAR` reference, resolved from the host's environment so the secret stays out of the
config and the skill file.

`teams.run` lets an agent launch a saved team against a concrete `task`. It's thin by
design: it only records the request as `<id>.runrequest.json` (with a one-shot `nonce`);
the JoaxClaw app polls for it, builds the launch prompt, optionally auto-launches when
`autorun` is set, and clears the request. The app owns prompt compilation and the live
run monitor, so the plugin never starts a run itself.

`engines.probe` / `engines.fetch` GET a local LLM engine's health/model URL **from
the gateway host** — that's how the app checks liveness and lists models for engines
on the host's loopback/LAN (unreachable from a remote client). The requested URL is
guarded to local-engine hosts only (loopback, `*.local`, private IPv4); anything else
is rejected, so these can't be used as a general request proxy. `engines.fetch` caps
the returned body at 1 MiB; the app parses it (Ollama `/api/tags`, OpenAI `/models`).

## Install

From npm (recommended — works on any gateway host with internet). `--force` makes
this same command upgrade an existing install:

```bash
openclaw plugins install --force openclaw-joaxclaw-fs
openclaw plugins enable joaxclaw-fs
openclaw plugins inspect joaxclaw-fs   # verify it registered (exits non-zero if not)
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
