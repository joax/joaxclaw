# Mobile companion — feasibility analysis & Phase 0

Can JoaxClaw have a mobile companion, and is a **PWA** viable? This captures the
architecture analysis and the Phase 0 investigation (transport + scopes), which
decides which path to build.

## TL;DR

The app is cleanly split into a **portable React + gateway-RPC layer** and a thin
**Electron shell**, so a companion is very feasible. The one thing that decides
*PWA vs. native wrapper* is whether a **browser-origin** connection can hold operator
scopes. That is the open Phase 0 question — the OpenClaw docs contradict each other,
so we settle it with a probe (below).

## How the app is built today

**Portable layer.** The whole renderer talks to the gateway through
`gatewayClient.request(...)` over one WebSocket: chat, agents, sessions, models,
channels, teams/processes, memory, host metrics, script jobs, crons, config. The app
*already* has a **remote-gateway abstraction** — when the gateway isn't local, features
that would use Electron IPC instead go over gateway RPCs (`host.metrics`,
`plugins.list`, `config.get`/`config.patch`, and the `joaxclaw-fs` plugin for
teams/processes/memory). **A mobile app is simply "always remote", so much of the
portability work already exists.**

**Electron shell.** `window.api.*` (~36 files touch it):
- **Core:** `ws` — the gateway socket, proxied through the main process.
- **Desktop-only:** updater, tray, window chrome, zoom, chat pop-out.
- **Local filesystem:** theme import/export, local `~/.openclaw` config, `localstore`,
  local skill/obsidian writes. *Mostly unused on a remote connection.*

## The Phase 0 question: browser origin vs. scopes

`electron/main/index.ts` proxies the socket through the main process **on purpose**:

> "Connect from the main process so no Origin header is sent (the gateway clears
> scopes for browser-origin connections)… ws package connects without an Origin
> header — gateway grants full scopes."

A browser **cannot** suppress `Origin`, so if that still holds, a pure PWA can't hold
operator scopes. But the OpenClaw docs disagree with each other:

| Source | Claim |
| --- | --- |
| [Gateway protocol](https://docs.openclaw.ai/gateway/protocol) | "Browser-origin connections cannot receive full operator scopes, regardless of device identity." |
| [Control UI](https://docs.openclaw.ai/web/control-ui) | "Browser Control UI sessions receive **full operator scopes**"; browser profiles generate device IDs. |

Two things point at the Control UI being right:

1. **OpenClaw's own Control UI is a browser SPA** (Vite + Lit) that "speaks directly to
   the Gateway WebSocket on the same port" — it evidently functions with scopes.
2. The scope-clearing rule the docs actually state is about **device-LESS** sessions:
   > "When device-less operation is allowed through trust paths… OpenClaw still clears
   > self-declared scopes to an empty set unless that path has a named
   > scope-preservation exception."

   Meanwhile **JoaxClaw now performs a device-identity handshake** (signs the
   `connect.challenge` nonce; receives `hello-ok.auth.deviceToken(s)`). So the app's
   "no Origin" comment may predate device auth and be a legacy workaround.

Related config: `gateway.controlUi.allowedOrigins` must list the exact browser origin
for non-loopback deployments (loopback / RFC1918 / `.local` / `.ts.net` are auto-accepted).

## Settling it — the probe

`scripts/probe-origin-scopes.mjs` runs two **identical device-less** handshakes whose
only difference is the `Origin` header, so any difference in granted scopes is caused
by Origin alone. Read-only; it changes nothing on the gateway.

```bash
node scripts/probe-origin-scopes.mjs <wsUrl> <token> [origin]
# e.g. node scripts/probe-origin-scopes.mjs wss://gateway.example:18789 "$TOKEN"
```

Interpreting the result:

| Result | Meaning | Path |
| --- | --- | --- |
| Both handshakes get scopes | Origin is not a gate | **PWA viable** (+ `allowedOrigins`) |
| Both EMPTY | **device-less** is the gate, not Origin | **PWA likely viable** — implement device identity via WebCrypto |
| No-Origin has scopes, Origin empty | Origin *is* a gate for device-less | Re-test with a **signed** browser handshake; if still empty → **Capacitor** |

## Paths (once Phase 0 answers)

| | Pure PWA | Capacitor wrap | React Native |
| --- | --- | --- | --- |
| Code reuse | ~85% | **~85–90%** | ~40% (UI rewritten) |
| Scope problem | depends on Phase 0 | avoided (native socket) | avoided |
| Effort | low–medium | medium | high |

## Work required either way

1. **`window.api` shim** — implement `api.ws` on a real WebSocket; map the rest to
   existing gateway RPCs (metrics/config/plugins/teams/memory already have remote
   equivalents) or graceful no-ops (updater, tray, window, zoom, theme file dialogs,
   `localstore` → IndexedDB).
2. **Responsive layout** — today it's a desktop 3-pane (240px chat sidebar + main +
   300px right panel). Mobile needs drawer/bottom-tab navigation and single-column.
   Components use CSS vars + flex, so this is adaptation, not a rewrite.
3. **Auth** — pair the phone as its **own device** (the device-identity + per-role
   `deviceToken` mechanism already exists) rather than copying the desktop token.
   In a browser this means a **WebCrypto** keypair (non-extractable, IndexedDB).
4. **Notifications** — agent replies while backgrounded: push (service worker, or
   native push via Capacitor) or polling. Likely a follow-on phase.
5. **Voice (Talk)** and media — browser/WebRTC capable; needs mobile testing.

## Status

- [x] Architecture analysis (portable layer vs. Electron shell)
- [x] Identify the deciding question (browser origin vs. scopes)
- [x] Research OpenClaw docs — **found a direct contradiction**, plus evidence that
      the real gate is *device-less*, not origin
- [x] Build the empirical probe
- [ ] **Run the probe against a real gateway** ← next
- [ ] If needed: test a *signed* (device-identity) browser handshake
- [ ] Pick the path and scope Phase 1
