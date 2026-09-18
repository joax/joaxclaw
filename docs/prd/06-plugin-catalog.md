# PRD 06: Plugin catalog

> **Status:** Draft for owner approval · **Author:** PM B · **Date:** 2026-09-18
> **Phase:** 2 (build step 5) · **Effort:** M (2.5–3 days)
> **Gateway:** `plugins.catalog.*` needs OpenClaw ≥ 2026.9. Older gateways keep today's `plugins.search` browser.
> **Depends on:** [01-shared-groundwork](01-shared-groundwork.md): `FilterTab`, `Pill` (with `stateTone`), `Card`, `EmptyState`, `Overlay`, `BottomSheet`, `CommandHint`, `gatewayClient.hasMethod()`, `connectionSeq`, and **`expectRestart()` with the reconnect-overlay reason** (01 builds it and accepts this PRD's `expectRestart(reason: string)` form). Unblocks [07-meetings](07-meetings.md), which installs the Meet/Teams/Zoom plugins through the install flow defined here.

---

## 1. Summary

**Problem.**
- Since 0.25.0 you can install plugins from JoaxClaw, but *finding* one means typing into a single ClawHub search box (`PluginBrowser.tsx:41–50`). There's no way to browse, no categories, no "what's popular", and no way to see what a plugin is before installing it.
- After an install, the app says "Restart the gateway for these changes to take effect." and leaves the restart to you (`PluginBrowser.tsx:53–57`). On a remote gateway that means an agent chat (`GatewayView.tsx:194–215`).
- The gateway (2026.9) now has a real catalog: bundled and ClawHub plugins together, with featured, trending and official lists, categories, per-plugin install state, and a detail record with the README, configuration fields, versions and security verdict.

**Outcome.** Browse opens on a storefront: views, category chips, cards whose button reflects the plugin's real state on your gateway (Install, Manage, Unavailable), and a detail pane to read before installing. Install runs consent, installs, **restarts the gateway for you**, and waits for the reconnect. The channel form (`ChannelPluginSetup`) and Meetings (PRD 07) share that same install-and-restart flow.

**Solution.**
- Upgrade `PluginBrowser` in place. Keep the `SkillBrowser`-style modal, and add views (`FilterTab`), category chips and a detail pane, fed by `plugins.catalog.browse`/`categories`/`get`.
- Move install orchestration into `store/pluginCatalog.ts` as one flow: install → consent or install-policy review → `gateway.restart.request` → wait for the reconnect → refresh. Reuse the existing `ConsentDialog`, extended for the install-policy warning, which the app doesn't handle today.
- Gate the whole thing on `hasMethod('plugins.catalog.browse')`. Older gateways fall back to today's browser unchanged.

---

## 2. Background and evidence

### 2.1 How the app behaves today (0.26.1)

| Area | Evidence | Notes |
|---|---|---|
| Entry | `ExtensionsView.tsx:199–201`: a **Browse** button beside **Add plugin**. It opens `PluginBrowser` when `tab === 'plugins'` (`:244–249`). | ExtensionsView is mounted under Gateway → Extensions (`GatewayView.tsx:42,486`). |
| Browser | `PluginBrowser.tsx:13–112`: a modal, `z-[100]`, 620px. Search box → `plugins.search {query, limit: 25}` (`store/pluginCatalog.ts:72`). Result rows with Official/Community/Private trust labels (`lib/pluginCatalog.ts:168`). | No browse, categories or detail. |
| Installed check | `isInstalled(runtimeId, name)` against `installedIds` from the extensions store plus `justInstalled` (`PluginBrowser.tsx:20–21`) | Client-side guess. The catalog now gives us `local.state`. |
| Install | `store/pluginCatalog.ts:79–103`: `plugins.install(installParamsFor(pkg))`. On a consent refusal it calls `plugins.inspect` and parks a `consent` challenge. `acceptConsent` retries with `acknowledgeCapabilities: { reviewToken }` (`:105–122`). | Works. |
| Install-policy warning | Not handled: `readConsentRequired` only reads `capabilityConsentCode` (`lib/pluginCatalog.ts:85–97`). | **Gap.** A policy warning shows as a raw error today. |
| Consent UI | `ConsentDialog` (`PluginBrowser.tsx:121–178`), exported and reused by the channel form (`ChannelsPanel.tsx:19,649`, rendered as a sibling of the transformed `Overlay`, per the #74 lesson). | Reused. |
| After install | `restartRequired` flag → an accent banner "Restart the gateway for these changes to take effect." (`PluginBrowser.tsx:53–57`) | The app never restarts. **Correction to the plan:** "Install always restarts the gateway" is true of *the gateway's requirement*, not of what JoaxClaw does today. |
| Channel installs (0.26.1) | `ChannelPluginSetup` (`ChannelsPanel.tsx:695–790`): `plugins.list` → `pluginInstallState` (`lib/channels.ts:347`). Official + admin → **Install {label} plugin**; otherwise the host command `openclaw plugins install <spec>` with Copy (`lib/channels.ts:359`). After install: "Restart the gateway to load it (Gateway tab → Restart)." | Must adopt the shared restart flow. |
| Restart | `GatewayView.tsx:194–215`: local installs shell out through the Electron main process; remote ones go through `sendViaAgent`, with the comment "there's no lifecycle RPC". | **Correction:** `gateway.restart.request` exists (admin, ≤2026.7). See 2.2. This PRD uses it for installs; retrofitting the Gateway tab's Restart button belongs to PRD 02. |
| Reconnect overlay | `ReconnectOverlay.tsx:37–41`: the copy is fixed as "The gateway is reloading to apply your change — this happens after adding or enabling a channel…". `store/connection.ts` has a `reconnecting` flag but no reason. | **Gap:** the overlay can't say why. |
| Configure | `PluginConfigModal` (`ExtensionsView.tsx:258–260`), taking a `Plugin` from the extensions store | "Manage" opens this. |
| Scopes | `gatewayClient.grantedScopes` (`gateway.ts:141,348`); `ChannelPluginSetup` gates install on `operator.admin` (`ChannelsPanel.tsx:740`) | Same rule here. |
| Method gating | `advertisesMethod` (`lib/gatewayPolicy.ts:44–48`) returns `undefined` when there's no list, and `false` when the method isn't advertised. 01 wraps it as `hasMethod()`. | |

### 2.2 What the gateway offers

Scopes and since-versions come from `dist/method-scopes-tKV11oMS.mjs`. Schemas come from `dist/sessions-rlbLHLas.mjs` (region `packages/gateway-protocol/src/schema/plugins.ts`). All objects are closed (`additionalProperties: false`).

| Method | Scope | Since | Params → result | Used for | Handler |
|---|---|---|---|---|---|
| `plugins.catalog.browse` | read | 2026.9 | `{ query? (≤200), intent?: "all"\|"bundled"\|"trending"\|"official"\|"featured", category? (^[a-z][a-z0-9-]*$), cursor? (≤4096), pageSize? (1–100, default 20) }` → `{ items: Entry[], nextCursor?, remoteError? }` | Lists, search, paging | `dist/plugins-Bseu8N34.mjs` |
| `plugins.catalog.categories` | read | 2026.9 | `{}` → `{ categories: [{ slug, label, description, icon, order }] }` | Category chips | same |
| `plugins.catalog.get` | read | 2026.9 | `{ id, version? }` → `{ plugin: Entry, detail: Detail }` | Detail pane | same |
| `plugins.inspect` | read | 2026.8 | `{ pluginId }` → `{ plugin, source?, declared, components, reviewToken, grants, trust?, catalog? }` | Consent surface (existing) | — |
| `plugins.install` | **admin** | ≤2026.7 | `{ source: "clawhub", packageName, version?, acknowledgeInstallPolicyWarning?: true, acknowledgeCapabilities?: { reviewToken } }` or `{ source: "official", pluginId, … }` → `{ ok, plugin, restartRequired: true, warnings? }` | Install | `dist/plugins-mutations-pdGQVwQb.mjs` |
| `plugins.list` | read | ≤2026.7 | → `{ plugins, diagnostics, mutationAllowed }` | Extensions list (existing); `mutationAllowed` | — |
| `gateway.restart.request` | **admin** | ≤2026.7 | `{ reason?, target?, safe?, restartIntent? }` | Restart after install | `dist/restart-B99ImsD6.mjs` |

**Entry** = `{ id (ch_… or local_…), catalog, local }`, where:
- `catalog` = `{ name, packageName?, summary?, family?, author?, official, categories[], icon?, imageUrl?, latestVersion?, downloads?, installs?, verificationTier?, publishedToClawHub? }`;
- `local` = `{ present, installed, enabled, state: "enabled"|"disabled"|"needs-setup"|"not-installed"|"error", pluginId?, install?: InstallAction, action: "install"|"manage"|"unavailable" }`.

**Detail** = `{ origin: "clawhub"|"local", packageName?, author?, topics[], createdAt?, updatedAt?, readme? (≤512 KiB), compatibility?: { pluginApiRange?, builtWithOpenClawVersion?, pluginSdkVersion?, minGatewayVersion? }, configuration: [{ name, description?, required, sensitive }], mcpServers[], skills[], versions: [{ version, createdAt, changelog, tags }] (≤10), verification?, security?: { status, verdict?, summary?, guidance?, auditUrl?, checkedAt? } }`.

**Behaviour verified in the handlers.**

*Browse*
- A search can't be combined with a cursor: `query.trim() && cursor` → `INVALID_REQUEST "Plugin search does not accept a browse cursor."` So "Load more" only pages lists, never search results. The plan was right about this.
- **ClawHub partly down:** the call still succeeds, with local items and a `remoteError` such as `"ClawHub is unavailable: <err>. Bundled plugins remain available."`.
- **Everything down:** `UNAVAILABLE "Plugin discovery is unavailable: … Retry to reconnect to ClawHub."`.
- `local.action === "install"` requires `mutationAllowed`, meaning the config isn't read-only. There is **no reason field** for `"unavailable"`, so the app infers the reason (8.3). The plan's "Unavailable, with a reason" needs this inference.
- `intent: "bundled"` skips ClawHub. `intent: "all"` with no query puts official plugins first, then sorts by downloads.

*Install*
- It **does not restart the gateway itself**. It always returns `restartRequired: true`.
- OpenClaw's Control UI then calls `gateway.restart.request { reason: "Apply an installed plugin change" }` and waits for a new `hello.server.bootId` (`dist/control-ui/assets/plugins-page-BMxmOsAv.js`).

*Errors* (`details` in precedence order)
1. Capability consent: `{ capabilityConsentCode: "PLUGIN_CAPABILITY_CONSENT_REQUIRED", pluginId, reviewToken, widened?, acceptedAt? }`.
2. Install policy: `{ installPolicyCode: "install_policy_warning_acknowledgement_required", targetName, targetType, requestMode, reason, findings?: [{ ruleId, severity: info|warn|critical, message, file?, line?, evidence? }] }`. Retry with `acknowledgeInstallPolicyWarning: true`.
3. ClawHub trust: `{ clawhubTrustCode: "clawhub_security_unavailable"|"clawhub_download_blocked", version?, warning? }`.

Official and bundled plugins are exempt from capability consent (`docs/plugins/manage-plugins.md`).

**Out of scope:** `plugins.controlUi.*` (2026.9) serves browser code that plugins ship for OpenClaw's own UI. JoaxClaw will not run third-party UI code.

### 2.3 How the Control UI does it

The Plugins hub (`plugins-page-BMxmOsAv.js`; strings in `control-ui-core-CgyBiPIN.js`, `pluginsPage`):
- Title **Plugins**, "Extend your Claw with tools". Chips: **All**, **Featured**, **Trending**, then the ClawHub categories in `order`. The Official and Bundled intents exist in the strings but aren't used on the page.
- The overview has sections (Featured, Trending, one per category) of 8 cards, each with **View all**.
- Cards show the name, the author or official attribution, a summary (fallback "Optional OpenClaw capability."), and an **Install** button, or a status badge when installed.
- The `remoteError` shows in a warning banner. Empty/offline: "No ClawHub plugins match this view.", "Connect to browse plugins from ClawHub.", "Loading ClawHub plugins…".
- The detail page has README / Configuration / Skills / Compatibility / Versions tabs, plus a sidebar with Downloads, Version, Updated, "Security audit" and "View on ClawHub". Its empty states include "This plugin does not include a README." and "This plugin does not declare any configuration fields."
- The install wizard runs **Review → Install → Restart → Configure → Enable**.
  - Review says "Installation restarts the Gateway and briefly interrupts active sessions."
  - Progress: "Installing the reviewed plugin package…", "The Gateway is restarting. Reconnecting and checking installed state…".
  - Failures: "The Gateway did not reconnect after installation. Check the Gateway status, then retry."; "The Gateway reconnected, but the installed plugin was not found. Retry to refresh its state."
  - Policy warning: "Review required" / **Continue installation**.
  - Success: "Plugin ready" / "{name} is installed and enabled."

We take the restart-and-verify loop and the failure wording. We don't take the five-step wizard: JoaxClaw already has a Configure modal, so our flow is shorter (5.2).

### 2.4 Prior art

- **VS Code Marketplace:** list on the left, detail on the right, one primary button whose label reflects state (Install / Uninstall / Reload required). *Lesson:* state drives the button, and a pending reload is a state, not an afterthought.
- **Obsidian community plugins:** a browse modal with a detail pane, a "turn on restricted mode" consent, and "Enable" after install. *Lesson:* keep browsing inside a modal over the settings page, not a new top-level section. That is what our Browse modal already is.
- **Raycast Store:** curated featured, then categories, with permissions shown at install. *Lesson:* featured first, and access shown at the moment of decision. Our `ConsentDialog` covers that moment.

---

## 3. Goals / Non-goals

**Goals**
1. Browse featured, trending, official, bundled and all plugins, filtered by category, on 2026.9 gateways.
2. Every card shows the plugin's state on *this* gateway and the one action that makes sense.
3. A detail pane to read the README, configuration needs, versions and security verdict before installing.
4. One install flow everywhere (Browse, the channel form, Meetings): consent → install-policy review → install → automatic restart → verified.
5. No dead buttons: without admin you get the host command and "Install via agent"; on an older gateway you get today's browser.

**Non-goals**
- Uninstall or update from the catalog. Uninstall stays on the Extensions row (the store supports it, `pluginCatalog.ts:126`). Updates are CLI-only on the gateway side.
- Running `plugins.controlUi` code.
- Installing from npm, git or a local path (the RPC only accepts `clawhub` and `official`).
- Skills browsing, which stays in `SkillBrowser`.
- A catalog-driven configure wizard. Manage opens the existing `PluginConfigModal`.

---

## 4. Users and jobs to be done

- **As the owner**, I want to see what's worth installing (featured, trending, official) without knowing names in advance.
- **As the owner**, before installing I want to know what a plugin needs (API keys), whether it's verified, and what it will be allowed to do.
- **As the owner**, when I install, I want the gateway restarted and the plugin working, without a trip to the Gateway tab or an agent chat.
- **As the owner on a read-only or non-admin connection**, I want to be told exactly what to run on the host.
- **As the owner setting up Slack or a meeting plugin**, I want the same one-click install and restart from wherever I am.

---

## 5. UX specification

### 5.1 Entry points and placement

- **Gateway → Extensions → Plugins → Browse** (unchanged button, `ExtensionsView.tsx:199`). The modal widens from 620px to 880px, with a list and a detail pane.
  - This is justified because browsing is a transient task over the Extensions page (Obsidian's pattern). A new nav section would add a destination for something done rarely.
- **The channel form** (`ChannelPluginSetup`) and **Meetings setup** (PRD 07) call the same store action `installAndRestart(target)`. They don't open the browser.
- **The Extensions → Plugins list** gets nothing new, apart from "Manage" deep-linking into `PluginConfigModal`, which already exists.

### 5.2 Flows

**A. Browse**
1. Open Browse. The view tabs are **Featured** (default) · Trending · Official · Bundled · All, using `FilterTab`. Category chips come from `plugins.catalog.categories` (cached for the session), plus "All categories". A search box sits above.
2. The list loads `plugins.catalog.browse { intent, category?, pageSize: 24 }`. **Load more** follows `nextCursor`.
3. Typing a search (debounced 250 ms, or Enter) switches to `{ query, intent: "all", category? }` with no paging. Clearing the search returns to the tab.
4. Selecting a card opens its detail in the right pane (desktop) or pushes a detail screen (phone): `plugins.catalog.get { id }`.

**B. Install (admin)**
1. Press **Install** on a card or in the pane.
   - For ClawHub entries, the pane's version picker picks `version`. The default is latest.
   - The pane says, above the button: "Installing restarts the gateway. JoaxClaw reconnects on its own."
2. The store calls `plugins.install(installParamsFor(entry.local.install, version))`, and the button shows "Installing…".
   - **Consent refusal** → existing `ConsentDialog` (unchanged wording; "Install anyway" becomes "Install {name}", Q4). Accept → retry with the `reviewToken`.
   - **Install-policy refusal** → the same dialog in review mode: title "Review required", the gateway's `reason`, and a findings list (severity pill + message + `file:line`). Buttons **Cancel** / **Continue installation**, which retries with `acknowledgeInstallPolicyWarning: true`. If a critical finding is present, the primary button uses the danger variant.
   - **Trust refusal** (`clawhub_download_blocked`) → an inline danger box with the gateway's message. No retry.
3. On success the store calls PRD 01's `expectRestart({ reason: "Restarting to finish installing {name}", detail })`, then `gateway.restart.request { reason: "Apply an installed plugin change" }`.
4. The `ReconnectOverlay` shows "Restarting to finish installing {name}" instead of its channel copy.
5. On reconnect (`connectionSeq` increments), the store runs `plugins.list` and re-reads the entry.
   - `state: "enabled"` → the card shows **Installed** (success pill), and the pane shows "Installed. {name} is ready." with **Manage**.
   - `needs-setup` → **Needs setup** (warning pill) and **Configure**.
   - `error` → **Error** (danger pill) plus the diagnostic.
6. If there's no reconnect within 90 s: "The gateway didn't come back after installing {name}. Check it on the Gateway tab, then try again." with **Try again**, which re-checks `plugins.list` and requests the restart again.

**C. Install without admin.** The button reads **Ask an admin**. The pane shows:
- "Installing needs admin access. Run this on the gateway host:" with the command `openclaw plugins install <spec>` and a Copy button. The spec is `clawhub:<packageName>` for ClawHub entries, `<npmSpec>` for official ones, or `openclaw plugins install <pluginId>` when only the id is known.
- The command renders in 01's `CommandHint` (with Copy).
- **Install via agent**, which sends the command plus `openclaw gateway restart` through `sendViaAgent`. This is the `ChannelPluginSetup` / `ToolSearchHint` pattern.

**D. Manage.** `local.action === "manage"` → **Manage** opens `PluginConfigModal` for `local.pluginId`, taking the `Plugin` from the extensions store (reload it first if missing).

### 5.3 Wireframes

**Desktop: Browse modal (880px), Featured, detail open**
```
┌─ Browse plugins ─────────────────────────────────────────────────────────────────── ✕ ┐
│ 🔍 Search ClawHub plugins…                                                             │
│ [Featured] Trending  Official  Bundled  All                                            │
│ (All categories) (Channels) (Memory) (Developer) (Voice) (Productivity) →              │
│ ⚠ ClawHub isn't reachable right now. Showing bundled and installed plugins.            │
├───────────────────────────────────────────┬────────────────────────────────────────────┤
│ ┌───────────────────────────────────────┐ │ Issue Tracker                   (Official) │
│ │ Vault Notes            (Official)     │ │ by example-publisher · v1.4.2 · verified   │
│ │ Read and search a notes vault.        │ │ 12.4k installs · updated 3 days ago        │
│ │ 3.1k installs          (Installed)    │ │ ──────────────────────────────────────────│
│ └───────────────────────────────────────┘ │ Needs                                      │
│ ┌───────────────────────────────────────┐ │  • 1 API key (ISSUE_TOKEN, required)       │
│ │▌Issue Tracker          (Official)     │ │  • Adds skills: triage                     │
│ │ Search, create and update issues.     │ │ Security   Verified clean · 12 Sep         │
│ │ 12.4k installs          [ Install ]   │ │ Version    [1.4.2 (latest) ▾]              │
│ └───────────────────────────────────────┘ │ ──────────────────────────────────────────│
│ ┌───────────────────────────────────────┐ │ README                                     │
│ │ Home Control                          │ │ # Issue Tracker                            │
│ │ Lights, climate and scenes.           │ │ Connects agents to …                       │
│ │ (Needs setup)         [ Configure ]   │ │                                            │
│ └───────────────────────────────────────┘ │ Installing restarts the gateway.           │
│              [ Load more ]                │ JoaxClaw reconnects on its own.            │
│                                           │                          [ Install ]       │
└───────────────────────────────────────────┴────────────────────────────────────────────┘
```

**Desktop: install-policy review (the ConsentDialog variant)**
```
            ┌───────────────────────────────────────────────────────┐
            │ ⚠ Review required                                      │
            │ The gateway's install policy flagged Issue Tracker:    │
            │ "Package runs a postinstall script."                   │
            │  (warn)  scripts/postinstall.js:3  spawns a process    │
            │  (info)  README.md  links to an external host          │
            │                       [Cancel] [Continue installation] │
            └───────────────────────────────────────────────────────┘
```

**Phone: list → detail (full-screen sheet)**
```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ ✕  Browse plugins            │   │ ←  Issue Tracker             │
│ 🔍 Search ClawHub plugins…   │   │ (Official) v1.4.2 · verified │
│ [Featured] Trending Offic… → │   │ 12.4k installs               │
│ (All) (Channels) (Memory) →  │   │ Needs: 1 API key             │
├──────────────────────────────┤   │ Security: Verified clean     │
│ Vault Notes      (Installed) │   │ Version [1.4.2 (latest) ▾]   │
│ Read and search a vault.     │   │ ──────────────────────────── │
│──────────────────────────────│   │ # Issue Tracker              │
│ Issue Tracker    [ Install ] │   │ Connects agents to …         │
│ Search, create and update…   │   │                              │
│──────────────────────────────│   │ Installing restarts the      │
│ Home Control  (Needs setup)  │   │ gateway.                     │
│                [ Configure ] │   │ [          Install         ] │
└──────────────────────────────┘   └──────────────────────────────┘
```

**Reconnect overlay with a reason**
```
                 ┌─────────────────────────────────────────────┐
                 │               (logo + spinner)              │
                 │  Restarting to finish installing Issue      │
                 │  Tracker                                     │
                 │  The gateway restarts to load new plugins.  │
                 │  It usually takes a few seconds. JoaxClaw   │
                 │  reconnects on its own.                     │
                 │  ▭ gw.example.ts.net  · attempt 2           │
                 └─────────────────────────────────────────────┘
```

### 5.4 States

| State | Behaviour |
|---|---|
| Loading list | 6 skeleton cards (`shimmer` on `--bg-elevated`), and "Loading plugins…" for screen readers |
| Empty view | `EmptyState`: "No plugins match this view." |
| Empty search | "Nothing matches "{query}"." |
| `remoteError` | An amber line above the list with the gateway's text, abbreviated to "ClawHub isn't reachable right now. Showing bundled and installed plugins." when the message starts with "ClawHub is unavailable". The Trending/Featured tabs show `EmptyState` with the same line. |
| Discovery down (`UNAVAILABLE`) | Danger box: "Couldn't load the plugin catalog: {message}" with **Try again** |
| Categories fail | The chips row is hidden; the rest works |
| Detail loading / fails | Pane skeleton; on failure "Couldn't load details for {name}. {message}" with **Try again**. Install stays available from the card. |
| No README | "This plugin doesn't include a README." |
| Offline / reconnecting | The modal stays open with a line "Reconnecting to the gateway…". Buttons are disabled. On `connectionSeq` change the current view reloads. |
| Older gateway (< 2026.9) | `hasMethod('plugins.catalog.browse') === false` → today's `PluginBrowser` search UI, unchanged (renamed internally `PluginSearchBrowser`). Unknown (`undefined`, no method list) → try browse, and fall back on `unknown method`. |
| No admin | Browsing works (read scope). Install → **Ask an admin** (flow C). Manage → still opens Configure, whose save may fail with its own scope error (existing behaviour). |
| Config read-only (`mutationAllowed: false`) | `local.action` is `unavailable` for installs → "This gateway doesn't allow plugin changes from apps." plus the host command. |
| Unavailable, other | A local-only row without an install action → "Not available from the catalog." |
| Remote vs local | Identical: every step is an RPC, including the restart. |
| Install in progress elsewhere | The store is single-flight (`busy`). Other Install buttons are disabled with the title "Another plugin is installing". |
| Restart refused (not admin) | Can't happen, since install already required admin. If `gateway.restart.request` fails: "Installed {name}, but the gateway couldn't restart: {message}. Restart it from the Gateway tab." |

### 5.5 UI copy

| Key | String |
|---|---|
| modal.title | Browse plugins |
| search.placeholder | Search ClawHub plugins… |
| tab.featured / trending / official / bundled / all | Featured / Trending / Official / Bundled / All |
| chip.all | All categories |
| card.installs | {n} installs |
| card.downloads | {n} downloads |
| card.fallbackSummary | No description. |
| pill.official | Official |
| pill.installed | Installed |
| pill.needsSetup | Needs setup |
| pill.off | Off |
| pill.error | Error |
| btn.install | Install |
| btn.installing | Installing… |
| btn.manage | Manage |
| btn.configure | Configure |
| btn.askAdmin | Ask an admin |
| btn.loadMore | Load more |
| pane.by | by {author} |
| pane.verified | verified |
| pane.needs | Needs |
| pane.needs.key | {n} API key(s) ({names}) |
| pane.needs.setting | {n} required setting(s) |
| pane.needs.none | Nothing to configure |
| pane.adds.skills | Adds skills: {names} |
| pane.adds.mcp | Starts MCP servers: {names} |
| pane.security | Security |
| pane.security.clean | Verified clean · {date} |
| pane.security.review | Review recommended |
| pane.security.blocked | Blocked by ClawHub |
| pane.version | Version |
| pane.latest | (latest) |
| pane.compat.min | Needs OpenClaw {version} or later |
| pane.restartNote | Installing restarts the gateway. JoaxClaw reconnects on its own. |
| pane.noReadme | This plugin doesn't include a README. |
| pane.installed | Installed. {name} is ready. |
| admin.needed | Installing needs admin access. Run this on the gateway host: |
| admin.viaAgent | Install via agent |
| admin.readOnly | This gateway doesn't allow plugin changes from apps. Run this on the gateway host: |
| remote.down | ClawHub isn't reachable right now. Showing bundled and installed plugins. |
| list.empty | No plugins match this view. |
| search.empty | Nothing matches "{query}". |
| list.error | Couldn't load the plugin catalog: {message} |
| detail.error | Couldn't load details for {name}. {message} |
| retry | Try again |
| review.title | Review required |
| review.body | The gateway's install policy flagged {name}: |
| review.continue | Continue installation |
| consent.install | Install {name} |
| overlay.installing | Restarting to finish installing {name} |
| overlay.body | The gateway restarts to load new plugins. It usually takes a few seconds. JoaxClaw reconnects on its own. |
| restart.timeout | The gateway didn't come back after installing {name}. Check it on the Gateway tab, then try again. |
| restart.failed | Installed {name}, but the gateway couldn't restart: {message}. Restart it from the Gateway tab. |
| installed.missing | The gateway restarted, but {name} isn't listed as installed. Try again. |
| trust.blocked | ClawHub blocked this download: {message} |
| busy.other | Another plugin is installing |

### 5.6 Keyboard and accessibility

- The tabs are a `role="tablist"` (Left/Right to move). The chips are a toolbar of toggle buttons (`aria-pressed`). The cards are a `role="list"`, each card a button that opens the detail. Up/Down moves between cards and Enter opens.
- Esc closes the detail pane first on a phone, otherwise the modal.
- Focus moves to the pane heading when the detail opens.
- The pill state is conveyed in text ("Installed"), not only by colour.
- The overlay reason sits in an `aria-live="assertive"` region.

### 5.7 Notifications and deep links

- No push: install is interactive.
- `focusGatewayTab('extensions')` plus a new one-shot `openPluginBrowser({ query?, pluginId? })` lets Meetings (PRD 07) open Browse on a specific plugin. Implemented as a module-level pending intent, the same way `focusGatewayTab` works (`GatewayView.tsx:33`).

---

## 6. Design-book conformance

| Item | Used |
|---|---|
| Modal | `SkillBrowser`/`PluginBrowser` modal shell (`fixed … z-[100]`, `rgba(0,0,0,.5)`, surface card, `0 8px 24px` shadow) |
| Tabs | 01 `FilterTab` (from `ChatView.tsx:775`) |
| Chips / pills | 01 `Pill` (`borderRadius 999`, 10–11px, 12–15% tint). Official = accent, Installed = success, Needs setup = warning, Error = danger, Off = neutral border. |
| Cards | 01 `Card` in the `PluginBrowser` row style (`--bg-elevated`, 1px border, radius) |
| Empty | 01 `EmptyState` (faded `Puzzle` icon, one line) |
| Consent | Existing `ConsentDialog`, extended with a review mode. Still rendered as a sibling. |
| Overlay | Existing `ReconnectOverlay`, with an optional reason |
| Banners | None added. The amber `remoteError` line is inline in the modal, like the existing restart line (`PluginBrowser.tsx:53`). |
| Tokens | Colours only via `var(--…)` and `color-mix` |
| Copy | Says what happens: "Install", then an inline outcome. Errors name the fix. |
| **New** | (1) A **detail pane** inside the browser modal. It's justified because a pre-install read is the core of this feature, and it's built from existing parts (MarkdownContent for the README, Pill, Btn). (2) The overlay's reason line comes from PRD 01's `expectRestart`, so nothing new here. |

---

## 7. Functional requirements

**FR-1: Gate.**
- *Given* hello-ok advertises `plugins.catalog.browse`, *when* Browse opens on the Plugins tab, *then* the catalog browser shows.
- *Given* it isn't advertised, *then* today's search browser shows unchanged.
- *Given* the method list is empty, *then* the catalog browser tries browse and falls back on `unknown method`.

**FR-2: Views.**
- *When* a tab is picked, *then* `browse` is called with that `intent` and `pageSize: 24`, and **Load more** appears only when `nextCursor` is present.
- *Given* a search query, *then* the call has no cursor and Load more is hidden.

**FR-3: Categories.**
- *Given* categories load, *then* chips show in `order`, and picking one adds `category` to the browse call.
- *Given* the call fails, *then* the chips are hidden.

**FR-4: Card action from state.** Given `local`:
- `installed && state === "enabled"` → Installed pill and Manage;
- `state === "needs-setup"` → Needs setup and Configure;
- `state === "disabled"` → Off and Manage;
- `state === "error"` → Error and Manage;
- `action === "install"` and admin → Install;
- `action === "install"` and no admin → Ask an admin;
- `action === "unavailable"` → no button, with the reason text from `unavailableReason()`.

**FR-5: Detail.**
- *When* a card is selected, *then* `get` is called once per `id` (cached per modal session). The pane shows the author, verification, installs, needs (from `configuration`), skills and MCP servers, security, compatibility (warning when `minGatewayVersion` > `serverVersion`), a version picker (ClawHub only), and the README rendered with `MarkdownContent`, with HTML sanitised as in chat.

**FR-6: Install and consent.**
- *Given* Install, *when* the gateway refuses with capability consent, *then* `ConsentDialog` shows the declared surface, and accepting retries with `acknowledgeCapabilities`.
- *When* it refuses with an install-policy warning, *then* the review dialog shows the reason and findings, and Continue retries with `acknowledgeInstallPolicyWarning: true`. Both acknowledgements are carried if both were needed.

**FR-7: Restart.**
- *Given* install succeeds, *then* the store sets the overlay reason and calls `gateway.restart.request`.
- *When* `connectionSeq` next increments, *then* the store refreshes `plugins.list`, the extensions store and the current catalog view, and resolves the install as enabled / needs-setup / error.

**FR-8: Timeout.** *Given* no reconnect within 90 s, *then* the timeout message and Try again show.

**FR-9: No admin.** *Given* no `operator.admin`, *then* no install RPC is sent. The command with Copy and **Install via agent** show instead.

**FR-10: Shared flow.**
- *Given* the channel form or Meetings calls `installAndRestart({ source: "official", pluginId, displayName })`, *then* the same consent, review, restart and verify runs.
- `ChannelPluginSetup`'s "Restart the gateway to load it (Gateway tab → Restart)" is replaced by the automatic restart.

**FR-11: Reconnect renewal.** *Given* the modal is open across a reconnect, *then* the list reloads on the new `connectionSeq`, and in-flight requests from the old connection are ignored.

**FR-12: Fallback parity.** On gateways below 2026.9, the existing browser's behaviour, including its consent flow, is unchanged. Only the post-install restart (FR-7) is added.

---

## 8. Technical design

### 8.1 Modules

| Path | New/changed | Purpose |
|---|---|---|
| `src/lib/pluginCatalog.ts` | Changed (pure) | Add the types `DiscoveryEntry`, `DiscoveryDetail`, `CatalogCategory`, `CatalogIntent`. Add `cardAction(entry, { admin }) → { kind, label, pill }`, `unavailableReason(entry, { mutationAllowed })`, `installParamsForEntry(entry, { version?, reviewToken?, policyAck? })`, `hostInstallCommand(entry)`, `readInstallPolicyWarning(error)`, `needsSummary(detail)`, `summariseRemoteError(msg)`. Keep `installParamsFor` for the search fallback and channels. |
| `src/store/pluginCatalog.ts` | Changed | Add catalog browsing state: `intent`, `category`, `query`, `items`, `nextCursor`, `remoteError`, `categories`, `detailById`, `loadView()`, `loadMore()`, `loadDetail(id)`. Add the install orchestration: `installAndRestart(target)` with a phase machine `idle → installing → consent → review → restarting → verifying → done/failed`, a `policy` challenge next to `consent`, and `acceptPolicy()`. Keep the existing API working. |
| `src/store/connection.ts`, `ReconnectOverlay.tsx` | **From 01** | `expectRestart({ reason, detail })` and the overlay reason are built in PRD 01 (G5). This PRD only calls them: `expectRestart({ reason: 'Restarting to finish installing {name}', detail: overlay.body })`. |
| `src/components/extensions/PluginBrowser.tsx` | Changed | Becomes `PluginBrowser` (catalog) + `PluginSearchBrowser` (the old body, used as the fallback) + `PluginDetailPane`. `ConsentDialog` gains `mode: 'consent' \| 'review'`. |
| `src/components/extensions/ExtensionsView.tsx` | Changed | Choose the browser by `hasMethod`. Handle `openPluginBrowser` intents. |
| `src/components/gateway/ChannelsPanel.tsx` | Changed | `ChannelPluginSetup` calls `installAndRestart`. The post-install copy changes to the verified state. |
| `src/lib/gatewayRestart.ts` | **New** (or shared with PRD 02 if it lands first) | `requestGatewayRestart(reason)` wraps `gateway.restart.request`. |

### 8.2 Data flow and events

- There is **no catalog event.** The store refreshes after its own mutations and on `connectionSeq` change while the modal is open.
- It also listens to `plugins.*` changes indirectly: the extensions store reloads on reconnect, as today.
- **Restart detection:** hello-ok's `server.bootId` is what the Control UI compares. JoaxClaw doesn't read it today (`gateway.ts:348–352` reads scopes, features and version only). Add `gatewayClient.bootId` and treat "connected with a different bootId" as restart complete. Falling back to "`connectionSeq` advanced" when `bootId` is absent is acceptable.

### 8.3 Capability gating and inferred reasons

- Browser choice: `hasMethod('plugins.catalog.browse')`.
- Install button: `grantedScopes.includes('operator.admin')`.
- `unavailableReason`: `!mutationAllowed` (from the last `plugins.list`) → the read-only text; `!entry.local.install` → "Not available from the catalog."; otherwise "Can't be installed from here."

### 8.4 Error handling

- Structured errors are read from `gatewayError.details` (the existing `structured()` helper, `store/pluginCatalog.ts:54`).
- Precedence follows the gateway's: consent, then policy, then trust.
- Everything else → `errText`.
- The phase machine guarantees one outcome per attempt. A reconnect during `installing` (before the response) shows "The connection dropped while installing {name}. Check the plugin list, then try again." and refreshes the list.

### 8.5 Performance and limits

- `pageSize` 24 (under the 100 cap). Categories are fetched once per modal session. Details are cached by id.
- The README can be 512 KiB. Render at most the first 64 KiB, with "Read the full README on ClawHub" linking to `https://clawhub.ai/…`. **Unverified:** the exact ClawHub URL shape. Take it from the Control UI's "View on ClawHub" link builder in `plugins-page-*.js`.
- Icons: `catalog.imageUrl` may point to ClawHub. Load it lazily with `referrerPolicy="no-referrer"`, and fall back to the lucide `Puzzle` icon.

### 8.6 Migration

No persisted state. The `justInstalled` list is replaced by the refreshed `local.state`, and is kept only for the fallback browser.

---

## 9. Test plan

### 9.1 Unit tests (`src/lib/__tests__/pluginCatalog.test.ts`, extended)

**`cardAction`** — every `state`×`action`×admin combination (at least 10 cases), including:
- installed but disabled → Off/Manage;
- `install` without admin → Ask an admin;
- `unavailable` → no button.

**`unavailableReason`** — read-only, no install action, generic.

**`installParamsForEntry`**
- ClawHub with a version, and with `reviewToken` plus `policyAck`.
- Official with no version sent. Never sends `version` for official, since the closed schema would reject it.

**`hostInstallCommand`** — `clawhub:<pkg>`, npmSpec, id fallback.

**`readInstallPolicyWarning`** — valid details; missing reason → null; findings with a bad severity → still parses the reason and drops bad findings.

**`needsSummary`**
- 1 sensitive required field → "1 API key (NAME)".
- Only non-sensitive fields → "{n} required settings".
- None → "Nothing to configure".

**`summariseRemoteError`** — the "ClawHub is unavailable" prefix → the short copy; other text → passed through.

**Store phase machine** (`src/store/__tests__/pluginInstall.test.ts`, with a mocked `gatewayClient`)
1. Success → restarting → verifying → done.
2. Consent → accept → done.
3. Policy → continue → done.
4. Consent then policy → both acknowledgements sent.
5. Restart timeout.
6. Install error with trust details.

### 9.2 Manual QA script (isolated profile, 2026.9.4 gateway)

1. Browse → Featured loads, Trending, Official, Bundled, All; category chips filter; Load more pages; search disables paging.
2. Disconnect the network to ClawHub (block `clawhub.ai` in `/etc/hosts` on the host) → the amber line, and bundled and installed entries still listed.
3. Open the detail of a plugin with a README, config fields and versions; switch the version.
4. Install a community plugin that triggers consent → the dialog → accept → the overlay with its reason → reconnect → Installed.
5. Install something that trips the install policy (set `security.installPolicy` to warn on scripts) → review → continue.
6. Install an official plugin (no consent) → overlay → Installed / Needs setup → Configure opens `PluginConfigModal`.
7. Kill the gateway during the restart and keep it down for 2 minutes → the timeout copy → start it → Try again → Installed.
8. Connect with a read-only token → Ask an admin, the command copies, Install via agent opens a chat.
9. Connect to a 2026.8 gateway → the old search browser, unchanged.
10. Remote gateway → the same as step 6.
11. Channel form: add Discord without its plugin → Install → the same overlay and verification.
12. Phone PWA: list → detail → back; install; overlay.

---

## 10. Rollout

- Gate: `hasMethod('plugins.catalog.browse')` (2026.9+). Older gateways get the unchanged browser, plus the automatic restart after install on gateways where `gateway.restart.request` is advertised (≤2026.7 onward, so effectively all).
- The automatic restart also changes the channel form's behaviour on every gateway version. Call it out in the CHANGELOG.
- No flag. Two PRs (12).

---

## 11. Risks and open questions

| # | Item | Owner? |
|---|---|---|
| Q1 | **Auto-restart after install** (recommended, matching the Control UI) vs asking "Restart now?" first. A restart interrupts running sessions. With auto, the pane's "Installing restarts the gateway" note is the warning. | **Yes** |
| Q2 | Default tab: Featured (plan and Control UI) vs All. Featured is sparse today (only 4 official entries carry `catalog.featured`, per `dist/official-external-plugin-bundled-catalogs-*.mjs`). ClawHub's featured list may be richer. Recommendation: Featured, with All one tap away. | Yes |
| Q3 | Should the Gateway tab's Restart/Safe buttons switch to `gateway.restart.request` for remote gateways (removing the agent round-trip)? That belongs to PRD 02 (the other PM). Flagged so the two stay consistent. | Coordinate |
| Q4 | Rename the consent button from "Install anyway" to "Install {name}", as in the Control UI. The current wording implies a warning even when there isn't one. | Yes (copy) |
| R1 | The meeting plugins may not appear in browse: `google-meet` has no ClawHub spec and no `catalog` block, so it's likely missing from both remote and local lists (inferred from `listManagedPlugins`). PRD 07 installs them by `pluginId`, not via Browse. | No |
| R2 | The `bootId` field in hello-ok is **unverified** in JoaxClaw's typing. Check `hello.server.bootId` against a live 2026.9.4 hello (the Control UI reads `snapshot.hello.server.bootId`). | No |
| R3 | `catalog.configuration` field names may not map to `plugins.entries.<id>.config` paths. A future link to `PLUGIN_CONFIG_FORMS` (feeding `FieldSpec`) is a follow-up, not v1. | No |

---

## 12. Milestones and effort

| PR | Scope | Effort |
|---|---|---|
| 1 | **Install-and-restart flow.** Policy-warning handling, `requestGatewayRestart`, `bootId`, store phase machine + tests (uses 01's `expectRestart`). `ChannelPluginSetup` adopts it. Ships value on all gateways. | M (1–1.5 d) |
| 2 | **Catalog browser.** Lib additions + tests, store browsing state, the new `PluginBrowser` with the detail pane, fallback wiring, `openPluginBrowser` intent, phone layout. | M (1.5 d) |
