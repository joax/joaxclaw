# Remote gateways — local vs remote operations

The renderer talks to the Openclaw gateway over a WebSocket, but several
"management" operations historically went through the **Electron main process**
against the **local** machine (`~/.openclaw`, `localhost`, the `openclaw` CLI). Those
only affect the gateway when it runs on the same machine. A **remote** gateway
exposes only its WS port — its filesystem, ports, and CLI are unreachable from the
client.

**Rule:** any gateway-affecting feature must branch on local vs remote.

## Detecting remote

```ts
import { useIsRemoteGateway } from '../../store/connection' // hook, in components
import { isRemoteGatewayState } from '../../store/connection' // non-hook, in stores
```

Both are `status === 'connected' && !isLocalGateway(gatewayHost(connection.url))`
(host classification lives in [src/lib/ollamaHealth.ts](../src/lib/ollamaHealth.ts)).

## The three ways to handle remote

1. **Prefer a gateway RPC** over the WS — works local *and* remote. Config, models,
   channels, engines, teams/processes (via the `joaxclaw-fs` plugin) all do this.
   `config.get` / `config.patch` are the general config RPCs (`config.patch` sends a
   `{ raw: JSON.stringify(patch), baseHash, replacePaths }` merge patch and
   **hot-reloads** the gateway).
2. **Run on the host via an agent** — when only a shell/CLI can do it and no RPC
   exists. Open a chat with the default agent (it runs on the host with shell tools)
   and hand it the command; the user approves execution. Helper:
   [`sendViaAgent()`](../src/lib/agentPrompt.ts). Same shape as the
   joaxclaw-fs "Install via agent" flow ([RemotePluginNotice](../src/components/common/RemotePluginNotice.tsx)).
3. **Degrade honestly** — show `unknown` / `configured` / a clear notice instead of
   reading local state and implying it reflects the remote gateway. Never silently
   read/write local `~/.openclaw` for a remote gateway.

## Worked example — the Gateway tab ([GatewayView.tsx](../src/components/gateway/GatewayView.tsx))

Its buttons used to be local-only. Now:

| Control | Local | Remote |
| --- | --- | --- |
| **Config editor** (Reload / Save) | read/write `~/.openclaw/openclaw.json` via `window.api.config` | `config.get` to load, `config.patch` to save (RPC #1). Full-config editor → patch replaces each present top-level section (`replacePaths: Object.keys(parsed)`) and nulls out sections the user deleted. |
| **Status** | `openclaw gateway status --json` CLI | derived: WS connected ⇒ running (no reachable status CLI). |
| **Restart / Safe / Stop** | `openclaw gateway …` via Electron main | `sendViaAgent(...)` with the `openclaw gateway …` command, then jump to the chat (RPC #2). No lifecycle RPC exists. |

The tab shows a "remote" badge + a one-line notice explaining the host-side behavior.

### Known gap

The remote config editor round-trips the **parsed** config (JSON), so comments and
exact formatting normalize on save (the RPC has no raw-text form). Deleting an entire
top-level section works (nulled in the patch); everything else is a straight replace.

## See also

- Config values survive round-trips as literal strings *or* `SecretRef`
  (`{ source, provider, id }`) objects — see the `SecretRef` handling in
  [ModelsView](../src/components/models/ModelsView.tsx) /
  [ChannelsPanel](../src/components/gateway/ChannelsPanel.tsx); don't stringify them.
- Memory: `remote-gateway-localhost-pitfall`, `local-engines-feature` (probing remote
  engines via the plugin's `engines.*` RPCs).
