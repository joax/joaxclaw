# JoaxClaw on mobile

Porting JoaxClaw to **Android first, then iOS** via **Capacitor**, as **one
responsive codebase with an adaptive shell** — not a fork. The full plan, decisions,
and phased checklist live in the vault: `repositories/joaxclaw/MOBILE_PORT_ROADMAP.md`.

This file tracks the in-repo mechanics.

## The idea in one paragraph

A phone is always a **remote** client to its gateway, and the app already has a
first-class remote mode (`useIsRemoteGateway`) that disables ~two-thirds of the native
surface (host metrics, local config editor, `openclaw` CLI, local Ollama, tray,
pop-outs). So the mobile port keeps the entire React renderer and reimplements just
**two** native capabilities behind the existing `window.api` boundary: an
`Origin`-controllable WebSocket and Ed25519 device identity + secure storage.

## What's landed (Phase 0 — the adaptive boundary)

Nothing changes on desktop yet; these establish the seams the responsive work fills in.

- **`src/lib/platform.ts`** — `usePlatform()` (runtime + OS + `isMobile`/`isTouch`),
  `useViewportWidth()`, and `MOBILE_BREAKPOINT`. The single switch adaptive components read.
- **`src/components/adaptive/CodeEditor.tsx`** — the one swap point for the code
  editors (gateway config + agent files). Renders Monaco on desktop; the mobile arm
  (CodeMirror 6 / textarea) is a marked TODO. Adopted in `GatewayView` and `AgentEditor`.
- **`src/components/adaptive/Graph.tsx`** — the swap point for the memory backlink
  graph. Renders the canvas force-graph on desktop; touch arm is a TODO. Adopted in `MemoryView`.
- **`src/lib/mobileBridge.ts`** — `installMobileBridge()` installs a no-op `window.api`
  when the Electron preload bridge is absent (Capacitor / browser dev), so the renderer
  boots. Wired in `src/main.tsx`; inert on desktop.
- **`capacitor.config.ts`** — Capacitor app config (inert until the CLI is installed).

## Setting up Capacitor (run on a machine with the Android SDK)

Not yet added to the repo — these are the steps for Phase 0's native scaffolding:

```bash
# 1. Install Capacitor
npm i @capacitor/core
npm i -D @capacitor/cli
npm i @capacitor/android          # (and @capacitor/ios later, on macOS)

# 2. Initialize against the existing config (appId/appName/webDir already in capacitor.config.ts)
npx cap init --web-dir out/renderer

# 3. Build the web bundle the native shell loads
npm run build                     # produces out/renderer (see note below)

# 4. Add the native project(s) and sync the web build in
npx cap add android
npx cap sync android

# 5. Open in Android Studio to run on a device/emulator
npx cap open android
```

**Build note.** `webDir` currently points at electron-vite's `out/renderer`. That
output is fine to start, but the renderer is built assuming an Electron context; a
dedicated web build target (a plain `vite build` of `index.html` → a `dist-web/`) is a
likely refinement so asset base paths and the CSP suit a WebView.

## Next up (Phase 1 — the two native bridges)

- **WebSocket plugin** with `Origin` control, bridged to the `connect/send/onMessage/
  onStatus` shape `src/lib/gateway.ts` expects (replaces the `mobileBridge` `ws` stub).
  A WebView's own `WebSocket` sends an `Origin` header the gateway strips scopes for —
  see the desktop rationale in the vault's `ARCHITECTURE_DECISIONS` #1.
- **Device identity plugin** — Ed25519 keygen/signing + Keychain/Keystore storage,
  reproducing the exact `"v3"` signing payload from `electron/main/deviceIdentity.ts`
  (set `platform` to `ios`/`android`).

See the roadmap in the vault for the full phasing and effort estimates.
