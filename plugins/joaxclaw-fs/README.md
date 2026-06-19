# openclaw-joaxclaw-fs

Gateway plugin that exposes JoaxClaw's host-side **teams** and **processes** over the
WebSocket so they work on a **remote** gateway (and so agent-authored teams/processes
are reachable from the app).

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

Artifacts are passed through verbatim as strings (or `null` when missing); the app
owns (de)serialization. Ids are validated to stay inside the state directories.

## Install

Local gateway (dev — symlink so edits reload):

```bash
openclaw plugins install --link ./plugins/joaxclaw-fs
openclaw gateway restart
```

Remote gateway: JoaxClaw's **Install via agent** flow (on the remote Teams or Processes
screen) installs this on the host for you. Or get the folder onto the host once and
`openclaw plugins install <path>` there. The app uses these methods automatically when
the plugin is present.
