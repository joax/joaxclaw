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

## Phase 0 result (measured 2026-07-14, against a `.ts.net` gateway)

```text
A. NO Origin  (device-less) → granted: (EMPTY — scopes cleared)
B. WITH Origin http://localhost:5173 → error: origin not allowed
   (CONTROL_UI_ORIGIN_NOT_ALLOWED — allow it in gateway.controlUi.allowedOrigins)
```

**Verdict: a PWA is viable.** Two *independent, surmountable* gates — not the hard
wall the stale "connect from main to avoid Origin" comment implied:

1. **Origin allowlist (config).** The browser origin was rejected before scopes were
   even considered. Fix: add the PWA's origin to `gateway.controlUi.allowedOrigins`,
   or serve the PWA **same-origin** from the gateway (loopback / RFC1918 / `.local` /
   `.ts.net` auto-accept).
2. **Scopes come from device identity, not Origin.** The no-Origin connection *also*
   returned empty — because the probe is **device-less**. The real Electron app also
   sends no Origin yet gets full scopes **because it signs the device challenge**. So
   the scope gate is device identity, which a browser can satisfy via **WebCrypto**
   (a non-extractable keypair signing the `connect.challenge` nonce) — exactly what
   OpenClaw's own browser Control UI does.

**⇒ The "no Origin → full scopes" comment in `electron/main/index.ts` is stale.** The
gate is device identity + origin allowlist, both reproducible in a browser.

## Phase 1 go/no-go — CONFIRMED ✅ (measured 2026-07-14)

`scripts/probe-signed-scopes.mjs` replays the desktop app's exact `v3` Ed25519 signed
handshake (reusing the approved device identity + stored operator device token),
connecting with and without an `Origin` header. Result against the real gateway:

```text
device-token: present
A. signed, NO Origin                          → operator.admin, approvals, pairing, read, talk.secrets, write
B. signed, Origin https://<gateway-host>      → operator.admin, approvals, pairing, read, talk.secrets, write
```

**A signed, Origin-bearing (browser/PWA) connection receives the FULL operator scope
set.** This directly disproves the protocol doc's "browser-origin cannot get full
scopes regardless of device identity" — with a device identity + an allowed origin, a
browser gets everything. **Go: a PWA is viable.**

Two requirements, both reproducible in a browser:
1. **Device identity** — an Ed25519 keypair signing the `connect.challenge` `v3` payload
   (browser: **WebCrypto**, non-extractable key in IndexedDB). First connect needs
   approval; the gateway then returns a per-role **device token** to resend on later
   connects (the only method that preserves operator scopes from a *remote* locality).
2. **Allowed origin** — serve the PWA same-origin from the gateway, or add its origin to
   `gateway.controlUi.allowedOrigins`.

## Running it in a browser (dev/test target)

`npm run dev` only launches Electron (which enforces a desktop `minWidth`, so you can't
shrink it to the mobile breakpoint). To develop/test the responsive layout and the PWA
path, run the **web target** — the same renderer served in a plain browser, where
`window.api` is absent so the browser shim (`src/lib/mobile/`) takes over:

```bash
npm run dev:web      # http://localhost:5173 — open in a browser; use device-emulation
                     # or narrow the window to cross the 768px breakpoint
npm run build:web    # static bundle → out/web (the future PWA)
npm run preview:web  # serve the built bundle
```

Config: `vite.config.web.ts` (`base: './'` so it can be served same-origin from the
gateway — no `allowedOrigins` change — or any mount point).

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
- [x] **Run the probe against a real gateway** → Origin is an allowlist gate; scopes
      come from device identity, not Origin. The "no Origin" comment is stale.
- [x] **Verdict: PWA is viable** (needs `allowedOrigins` + a WebCrypto device handshake)
- [x] Confirm a *signed* browser handshake from an allowed origin returns scopes →
      **CONFIRMED**: Origin-bearing signed connection gets the full operator scope set
- [x] **Shared core (wrapper-agnostic) — built:**
  - `src/lib/mobile/deviceIdentityWeb.ts` — WebCrypto Ed25519 `v3` handshake, non-extractable
    key in IndexedDB. **Unit-tested for byte-compatibility** (`deviceIdentityWeb.test.ts`:
    WebCrypto signs → `node:crypto` verifies, i.e. the gateway will accept it).
  - `src/lib/mobile/browserApi.ts` — `window.api` shim: real WebSocket `ws` + `deviceAuth`
    (WebCrypto identity + localStorage device-token cache) + desktop namespaces degraded to
    safe no-ops. Installed from `main.tsx`, **no-op under Electron** (guarded).
- [~] Responsive layout (desktop 3-pane → mobile drawer / single-column) — **in progress**
  - [x] App shell: side NavRail → hamburger drawer on narrow (`useIsNarrow` + `MobileNav`);
        desktop unchanged (breakpoint-gated). Verified by build/typecheck/dev-transform;
        needs a visual check in a browser at mobile width.
  - [x] Chat: mobile master-detail — list full-width when nothing's selected, conversation
        full-width with a back button when one is (desktop keeps side-by-side). Pop-out
        (`solo`) unaffected.
  - [x] Chat list redesigned for mobile (`MobileChatList`): purpose-built rows (avatar +
        bold name + last-message preview + time + running pulse), a persistent ⋯ menu for
        Rename/Delete (touch has no hover), and a ＋ FAB for new chat. Reuses the same
        ChatItem model + Active/Scheduled/date grouping.
  - [x] Dashboard right panel (300px) → stacks below the main column on narrow (one
        scrolling column); desktop keeps side-by-side.
  - [x] Browser build hides the Electron title bar / window controls (`isElectron()`).
  - [x] Mobile touch targets: global `@media (max-width:767px)` in index.css bumps
        buttons/inputs/selects to ≥40px min-height and form fields to 16px (readability +
        no iOS focus-zoom). First pass; tune per-surface as feedback comes in.
  - [x] Crons: master-detail on narrow (job list ↔ job detail with ← back; no auto-select
        into detail on mobile). Same pattern as chat.
  - [x] Editor drawers → full-screen sheet on mobile (`editorDrawerStyle` in
        `lib/mobilePanel`): CronEditor, AgentEditor, agent EdgeEditor, channel panel,
        process CollaborationPanel.
  - [x] Centered modals constrained to the viewport (maxWidth 92vw + maxHeight/scroll):
        new-agent, new-process, add-skill/add-plugin, reconnect overlay.
  - [ ] List+detail views still need master-detail (like Crons): Memory, Gateway (sub-tabs),
        Models, Themes. Complex detail panes need a design pass, not just master-detail:
        Agents (graph), Processes (graph editor), Teams (builder). Settings uses maxWidth
        so it's already usable. Talk (voice) needs its own check.
- [ ] Pairing/approval UX for a new browser device
- [ ] Decide wrapper (pure PWA vs Capacitor) → manifest + service worker, or native shell
- [ ] Notifications
