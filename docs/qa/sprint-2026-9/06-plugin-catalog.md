# QA checklist — PRD 06 Plugin catalog
Source: docs/prd/06-plugin-catalog.md · Engineer: Eng 4 · Milestones: PR 1 install-and-restart flow (all gateways) · PR 2 catalog browser (2026.9+)
Legend: **[U]** unit test (vitest, src/lib/__tests__ or src/store/__tests__) · **[R]** code review · **[M]** manual app check (desktop + 390px phone)
Fixtures: `src/lib/__tests__/fixtures/sprint/pluginCatalog.ts` (real 2026.9.4 shapes). Gateway line refs are `dist/` of openclaw 2026.9.4.

## FR-1 Gate (browser choice)
- [ ] **06-FR1.a** [U] Given hello-ok `features.methods` includes `plugins.catalog.browse` (fixture `HELLO_BEFORE_RESTART`), when Browse opens on Extensions → Plugins, then the catalog `PluginBrowser` renders (tabs + chips + list). _(§7 FR-1, §8.3)_
- [ ] **06-FR1.b** [U] Given the list is non-empty and lacks it (`HELLO_2026_8`), then `PluginSearchBrowser` (the old body) renders and **no** `plugins.catalog.*` request is sent. _(FR-1, FR-12)_
- [ ] **06-FR1.c** [U] Given `features.methods` is empty/absent, then the catalog browser calls `plugins.catalog.browse` once and, on `unknown method: plugins.catalog.browse` (`ERR_UNKNOWN_METHOD_BROWSE`), switches to `PluginSearchBrowser` without showing an error. The decision uses `advertisesMethod()` (tri-state), NOT `gatewayClient.hasMethod()` (which returns `false` for "no list"). _(FR-1, §5.4 "Older gateway")_
- [ ] **06-FR1.d** [U] Given no method list AND a non-admin connection, when browse is answered with `FORBIDDEN "missing scope: operator.admin"` (`ERR_UNKNOWN_METHOD_BROWSE_NON_ADMIN` — how an older gateway answers an unregistered method for non-admins), then it is also treated as "catalog unavailable" → fallback, not a danger box. _(gateway contract; see Ambiguities A1)_
- [ ] **06-FR1.e** [R] `ExtensionsView.tsx` chooses the browser via `useGatewaySupport`/`hasMethod` re-evaluated on `connectionSeq`, so reconnecting to a different gateway version swaps the browser. _(§8.1)_

## FR-2 Views (tabs, paging, search)
- [ ] **06-FR2.a** [U] When the modal opens, the default tab is **Featured** and the first call is `plugins.catalog.browse { intent: "featured", pageSize: 24 }` (no `query`, no `cursor`, no `category`). _(§5.2 A.1–2, FR-2)_
- [ ] **06-FR2.b** [U] Picking Trending / Official / Bundled / All calls browse with `intent` `"trending"` / `"official"` / `"bundled"` / `"all"` and `pageSize: 24`. _(FR-2)_
- [ ] **06-FR2.c** [U] **Load more** is rendered only when the last result has `nextCursor`; pressing it sends the same `intent`/`category`/`pageSize` plus `cursor: <nextCursor>` and APPENDS items. _(FR-2)_
- [ ] **06-FR2.d** [U] Given a page whose returned `nextCursor` equals the cursor just sent (ClawHub failure echo, fixture `BROWSE_CURSOR_PAGE_CLAWHUB_DOWN`), then Load more is hidden (no infinite re-request of the same cursor). _(gateway contract G-B5)_
- [ ] **06-FR2.e** [U] Typing a search debounces 250 ms (or Enter fires immediately) and sends `{ query, intent: "all", category? }` with **no** `cursor`; Load more is hidden for search results even if a cursor were present. _(§5.2 A.3, FR-2)_
- [ ] **06-FR2.f** [U] A whitespace-only query is treated as no query (tab view, paging allowed). _(gateway trims: plugins-Bseu8N34.mjs:83,89)_
- [ ] **06-FR2.g** [U] Clearing the search returns to the previously selected tab's list (intent + category restored). _(§5.2 A.3)_
- [ ] **06-FR2.h** [U] Items are de-duplicated by `entry.id` when appending pages. _(R; ids are stable `ch_`/`local_` encodings)_

## FR-3 Categories
- [ ] **06-FR3.a** [U] `plugins.catalog.categories {}` is called once per modal session (cached; reopening the modal in the same connection may refetch per "per modal session" — see A4); chips render in ascending `order` preceded by **All categories**. _(§5.2 A.1, FR-3, §8.5)_
- [ ] **06-FR3.b** [U] Picking a chip adds `category: <slug>` to the browse call (tab kept, cursor reset); **All categories** removes it. _(FR-3)_
- [ ] **06-FR3.c** [U] Given categories fails (`CATEGORIES_UNAVAILABLE`) or returns `[]`, the chips row is hidden and browsing still works. _(§5.4 "Categories fail", FR-3)_
- [ ] **06-FR3.d** [R] Chips are a toolbar of toggle buttons with `aria-pressed`. _(§5.6)_

## FR-4 Card action from state (`cardAction(entry, { admin })`)
- [ ] **06-FR4.a** [U] `installed && state==="enabled"` → pill **Installed** (success) + **Manage**. _(FR-4)_
- [ ] **06-FR4.b** [U] `state==="needs-setup"` → pill **Needs setup** (warning) + **Configure**. _(FR-4)_
- [ ] **06-FR4.c** [U] `state==="disabled"` (installed) → pill **Off** (neutral) + **Manage**. _(FR-4, §9.1)_
- [ ] **06-FR4.d** [U] `state==="error"` → pill **Error** (danger) + **Manage**. _(FR-4)_
- [ ] **06-FR4.e** [U] `action==="install"` + admin → **Install**. _(FR-4)_
- [ ] **06-FR4.f** [U] `action==="install"` + no admin → **Ask an admin**. _(FR-4)_
- [ ] **06-FR4.g** [U] `action==="unavailable"` → no button, text from `unavailableReason()`. _(FR-4)_
- [ ] **06-FR4.h** [U] ≥10 `cardAction` cases covering state×action×admin, using fixtures `ENTRY_*`. _(§9.1)_
- [ ] **06-FR4.i** [U] `catalog.official === true` shows pill **Official** (accent) in addition to the state pill. _(§5.5 pill.official, §6)_
- [ ] **06-FR4.j** [U] Card shows `{n} installs` when `installs` present, else `{n} downloads` when `downloads` present, else neither; summary falls back to **No description.** _(§5.5 card.*)_
- [ ] **06-FR4.k** [R] Pill state is conveyed as text, not colour only. _(§5.6)_

## FR-5 Detail pane
- [ ] **06-FR5.a** [U] Selecting a card calls `plugins.catalog.get { id }` exactly once per `id` per modal session (second select uses `detailById`). _(FR-5, §8.5)_
- [ ] **06-FR5.b** [U] Header shows name, **by {author}** (from `detail.author.displayName ?? detail.author.handle ?? catalog.author`), `v{latestVersion}`, **verified** when a verification tier is present, `{n} installs`. _(§5.3 wireframe, §5.5 pane.by/pane.verified)_
- [ ] **06-FR5.c** [U] `needsSummary(detail)`: one required sensitive field → `1 API key (ISSUE_TOKEN)`; only non-sensitive required → `{n} required setting(s)`; none → `Nothing to configure`. _(§5.5 pane.needs.*, §9.1)_
- [ ] **06-FR5.d** [U] For `detail.origin === "local"` (`DETAIL_LOCAL`, configuration always `[]`) the pane does NOT claim "Nothing to configure" (see A7). _(gateway contract G-D4)_
- [ ] **06-FR5.e** [U] Skills line `Adds skills: {names}` uses `detail.skills[].name`; MCP line `Starts MCP servers: {names}` uses `detail.mcpServers`; each hidden when empty. _(§5.5 pane.adds.*)_
- [ ] **06-FR5.f** [U] Security row: `status` matching `/^(clean|pass|safe)$/i` → **Verified clean**; `blocked` → **Blocked by ClawHub**; any other status (suspicious, pending, stale, unknown…) → **Review recommended**; `security` absent → row hidden. Date suffix only when a date exists (`checkedAt` is never sent by 2026.9.4 — see D5). _(§5.5 pane.security.*)_
- [ ] **06-FR5.g** [U] Compatibility: when `detail.compatibility.minGatewayVersion` > `gatewayClient.serverVersion`, show warning **Needs OpenClaw {version} or later** (fixture `DETAIL_CLAWHUB_NEEDS_NEWER_GATEWAY`, min 2026.10.0 vs 2026.9.4). Equal/lower → no warning; absent → nothing. _(FR-5, §5.5 pane.compat.min)_
- [ ] **06-FR5.h** [U] Version picker shown only when `detail.origin === "clawhub"` and `versions.length > 0`; default = `catalog.latestVersion`, labelled `{v} (latest)`; the choice feeds `installParamsForEntry(..., { version })`. _(§5.2 B.1, FR-5)_
- [ ] **06-FR5.i** [M] README renders via `MarkdownContent` with chat's HTML sanitising (a `<details>` block renders, `<script>` doesn't). Absent README → **This plugin doesn't include a README.** _(FR-5, §5.4)_
- [ ] **06-FR5.j** [U] README longer than 64 KiB (`DETAIL_OVERSIZE_README`) is truncated to the first 64 KiB with link **Read the full README on ClawHub**. _(§8.5)_
- [ ] **06-FR5.k** [U] ClawHub link builder matches the Control UI: scoped `@owner/name` or known author → `https://clawhub.ai/{owner}/plugins/{name}`, else `https://clawhub.ai/plugins/{packageName}`; no link without `packageName`. _(§8.5 "Unverified" — now verified, see D11)_
- [ ] **06-FR5.l** [U] Detail failure → **Couldn't load details for {name}. {message}** + **Try again**; Install remains available from the card. _(§5.4)_
- [ ] **06-FR5.m** [R] Pane shows **Installing restarts the gateway. JoaxClaw reconnects on its own.** above the Install button (admin + installable only). _(§5.2 B.1, §5.5 pane.restartNote)_
- [ ] **06-FR5.n** [M] `catalog.imageUrl` loads lazily with `referrerPolicy="no-referrer"`, falls back to lucide `Puzzle`. _(§8.5)_

## FR-6 Install and consent / review / trust
- [ ] **06-FR6.a** [U] `installParamsForEntry` for a ClawHub-only entry (no `local.install`, fixture `ENTRY_REMOTE_INSTALLABLE`) → `{ source:"clawhub", packageName: catalog.packageName, version? }`. _(D1)_
- [ ] **06-FR6.b** [U] With `local.install = { source:"official", pluginId }` → `{ source:"official", pluginId }` and **never** `version` even if one is passed. _(§9.1)_
- [ ] **06-FR6.c** [U] With `reviewToken` and `policyAck` → adds `acknowledgeCapabilities: { reviewToken }` and `acknowledgeInstallPolicyWarning: true`; with neither → neither key present (closed schema). _(§9.1, FR-6)_
- [ ] **06-FR6.d** [U] Consent refusal (`INSTALL_ERR_CONSENT`) → store phase `consent`, `plugins.inspect { pluginId }` fetched for the declared surface, existing `ConsentDialog` shown; primary button reads **Install {name}** (was "Install anyway"). Accept → retry with `acknowledgeCapabilities.reviewToken` = the challenge token; the token is never sent without an explicit accept. _(FR-6, Q4)_
- [ ] **06-FR6.e** [U] `readInstallPolicyWarning(error)` on `INSTALL_ERR_POLICY` returns reason + 2 findings; missing `reason` → `null`; wrong `installPolicyCode` → `null`; `INSTALL_ERR_POLICY_BAD_FINDING` → reason kept, bad finding dropped; `INSTALL_ERR_POLICY_NO_FINDINGS` → reason, empty list. _(§9.1)_
- [ ] **06-FR6.f** [U] Policy refusal → phase `review`; dialog title **Review required**, body **The gateway's install policy flagged {name}:** + quoted `reason`, findings as severity pill + message + `file:line` (just `file` when no line); buttons **Cancel** / **Continue installation**. _(§5.2 B.2, wireframe §5.3)_
- [ ] **06-FR6.g** [U] A `critical` finding (`INSTALL_ERR_POLICY_CRITICAL`) makes **Continue installation** the danger variant. _(§5.2 B.2)_
- [ ] **06-FR6.h** [U] Continue retries with `acknowledgeInstallPolicyWarning: true`; if a consent challenge follows, the final request carries BOTH acknowledgements (store test 4). _(FR-6, §9.1 store 4)_
- [ ] **06-FR6.i** [U] Precedence: details are checked consent → policy → trust (mirrors plugins-mutations-pdGQVwQb.mjs:41). _(§8.4)_
- [ ] **06-FR6.j** [U] `clawhub_download_blocked` (`INSTALL_ERR_TRUST_BLOCKED`) → inline danger box **ClawHub blocked this download: {message}**, no retry button, no restart. _(§5.2 B.2, §5.5 trust.blocked, store test 6)_
- [ ] **06-FR6.k** [U] Any other error (incl. `clawhub_security_unavailable`, rate limit, plain INVALID_REQUEST) → `errText` inline, phase `failed`, no restart. _(§8.4; see A9)_
- [ ] **06-FR6.l** [U] Cancel/dismiss in consent or review → phase back to `idle`, `busy` cleared, no install sent. _(R)_
- [ ] **06-FR6.m** [R] `ConsentDialog` (with `mode: 'consent' | 'review'`) is still rendered as a sibling of the transformed `Overlay` (#74 lesson). _(§6, §8.1)_
- [ ] **06-FR6.n** [U] Install button shows **Installing…** while phase is `installing`. _(§5.2 B.2)_

## FR-7 Restart and verify
- [ ] **06-FR7.a** [U] On install success, the store calls `useConnectionStore.getState().expectRestart({ reason: "Restarting to finish installing {name}", detail: <overlay.body> })` BEFORE sending `gateway.restart.request { reason: "Apply an installed plugin change" }`. _(§5.2 B.3, FR-7)_
- [ ] **06-FR7.b** [U] Restart params contain only `reason` (no `target`/`safe`/`restartIntent`). _(gateway contract G-R1)_
- [ ] **06-FR7.c** [U] A `status: "deferred"` or `"coalesced"` restart response is treated as success (phase stays `restarting`), not as failure. _(fixtures `RESTART_DEFERRED`, `RESTART_COALESCED`)_
- [ ] **06-FR7.d** [M] ReconnectOverlay shows **Restarting to finish installing {name}** and body **The gateway restarts to load new plugins. It usually takes a few seconds. JoaxClaw reconnects on its own.** in an `aria-live="assertive"` region. _(§5.2 B.4, §5.3, §5.6)_
- [ ] **06-FR7.e** [U] Restart completion = connected with a hello-ok `server.bootId` different from the pre-install one (`HELLO_AFTER_RESTART`); a reconnect with the SAME bootId (`HELLO_SAME_BOOT`) does not complete it; when bootId is absent (2026.6.5), the next `connectionSeq` increment completes it. _(§8.2)_
- [ ] **06-FR7.f** [R] `gatewayClient.bootId` is read from `res.server.bootId` in the connect handler next to `serverVersion` (gateway.ts ~l.348) and reset on disconnect. _(§8.2, R2)_
- [ ] **06-FR7.g** [U] On completion the store runs `plugins.list`, reloads the extensions store and the current catalog view, then resolves by the installed `pluginId` (from `plugins.install` result `plugin.id`): `enabled` → done, card **Installed**, pane **Installed. {name} is ready.** + **Manage**; `needs-setup` → **Needs setup** + **Configure**; `error` → **Error** + the `plugin.error` text. _(§5.2 B.5, FR-7)_
- [ ] **06-FR7.h** [U] Plugin id absent from the refreshed `plugins.list` (`LIST_AFTER_INSTALL_MISSING`) → **The gateway restarted, but {name} isn't listed as installed. Try again.** _(§5.5 installed.missing)_
- [ ] **06-FR7.i** [U] `disabled` after install (explicitly disabled in config) resolves to **Off** + **Manage**, not a failure. _(see A8)_
- [ ] **06-FR7.j** [U] `gateway.restart.request` rejects → **Installed {name}, but the gateway couldn't restart: {message}. Restart it from the Gateway tab.**; the restart expectation is cleared. _(§5.4, §5.5 restart.failed)_
- [ ] **06-FR7.k** [U] Install `warnings[]` (e.g. "…without enabling it because it requires configuration first…", `INSTALL_OK_NEEDS_SETUP`) are not dropped silently (see A8). _(R)_

## FR-8 Timeout
- [ ] **06-FR8.a** [U] (fake timers) No restart completion within 90 s of the restart request → **The gateway didn't come back after installing {name}. Check it on the Gateway tab, then try again.** + **Try again**. _(FR-8, §5.5 restart.timeout, store test 5)_
- [ ] **06-FR8.b** [U] **Try again** re-runs `plugins.list`; if the plugin is now present → resolves as FR-7.g; otherwise re-sends `gateway.restart.request` and re-arms the timer. _(§5.2 B.6)_
- [ ] **06-FR8.c** [U] When the restart response is `deferred`, the timeout does not fire before the gateway's deferral can finish (see D8), or the message says the restart is waiting for active work. _(D8)_

## FR-9 No admin
- [ ] **06-FR9.a** [U] Given `grantedScopes` lacks `operator.admin`, pressing **Ask an admin** sends NO `plugins.install` and NO `gateway.restart.request`. _(FR-9)_
- [ ] **06-FR9.b** [U] `hostInstallCommand(entry)`: ClawHub → `openclaw plugins install clawhub:<packageName>`; official install action → `openclaw plugins install <pluginId>`; neither → id fallback `openclaw plugins install <local.pluginId>`. _(§5.2 C, §9.1; see D2 on npmSpec)_
- [ ] **06-FR9.c** [M] Pane shows **Installing needs admin access. Run this on the gateway host:** + command in 01's `CommandHint` with Copy; **Install via agent** sends the command plus `openclaw gateway restart` through `sendViaAgent`. _(§5.2 C, §5.5 admin.*)_
- [ ] **06-FR9.d** [U] Manage still opens `PluginConfigModal` without admin. _(§5.4 No admin)_

## FR-10 Shared flow
- [ ] **06-FR10.a** [U] `installAndRestart({ source:"official", pluginId, displayName })` runs the same consent → review → install → restart → verify machine as Browse. _(FR-10)_
- [ ] **06-FR10.b** [R] `ChannelPluginSetup` (ChannelsPanel.tsx ~l.725) no longer renders "Restart the gateway to load it (Gateway tab → Restart)"; it shows the verified state. _(FR-10)_
- [ ] **06-FR10.c** [R] `openPluginBrowser({ query?, pluginId? })` is a module-level one-shot intent consumed by ExtensionsView like `focusGatewayTab`. _(§5.7)_

## FR-11 Reconnect renewal
- [ ] **06-FR11.a** [U] With the modal open, a `connectionSeq` change reloads the current view (and categories if they had failed); responses to requests issued under the previous `connectionSeq` are discarded. _(FR-11)_
- [ ] **06-FR11.b** [M] While reconnecting, the modal stays open with **Reconnecting to the gateway…** and all buttons disabled. _(§5.4 Offline)_
- [ ] **06-FR11.c** [U] A drop during `installing` (before the response) → **The connection dropped while installing {name}. Check the plugin list, then try again.** and a `plugins.list` refresh; no auto-retry of install. _(§8.4)_

## FR-12 Fallback parity
- [ ] **06-FR12.a** [U] On a gateway without catalog methods, `PluginSearchBrowser` still calls `plugins.search { query, limit: 25 }` and keeps its consent flow and Official/Community/Private labels. _(FR-12)_
- [ ] **06-FR12.b** [U] Its successful install now also triggers the FR-7 restart (when `gateway.restart.request` is callable). _(FR-12, §10)_

## States (§5.4) and copy (§5.5)
- [ ] **06-ST.a** [M] Loading list → 6 skeleton cards (`shimmer` on `--bg-elevated`) + SR-only **Loading plugins…**. 
- [ ] **06-ST.b** [U] Empty view → `EmptyState` **No plugins match this view.**; empty search → **Nothing matches "{query}".**
- [ ] **06-ST.c** [U] `summariseRemoteError`: any text starting `ClawHub is unavailable` → **ClawHub isn't reachable right now. Showing bundled and installed plugins.**; other text passed through. Tested with all four real variants (`BROWSE_ALL_CLAWHUB_DOWN`, `BROWSE_FEATURED_CLAWHUB_DOWN`, `BROWSE_BUNDLED_CLAWHUB_DOWN`, `BROWSE_SEARCH_BOTH_DOWN`). _(see D4 on accuracy)_
- [ ] **06-ST.d** [U] `remoteError` renders as the amber line above the list; Featured/Trending with empty items render `EmptyState` with the same line.
- [ ] **06-ST.e** [U] Browse `UNAVAILABLE` (`BROWSE_ERR_DISCOVERY_DOWN`) → danger box **Couldn't load the plugin catalog: {message}** + **Try again**.
- [ ] **06-ST.f** [U] `unavailableReason`: `mutationAllowed === false` (last `plugins.list`) → **This gateway doesn't allow plugin changes from apps. Run this on the gateway host:** + host command; else no install target → **Not available from the catalog.**; else **Can't be installed from here.** _(§8.3, §9.1)_
- [ ] **06-ST.g** [U] Single-flight: while `busy`, other Install buttons are disabled with title **Another plugin is installing**.
- [ ] **06-ST.h** [R] Copy strings match §5.5 exactly: `Browse plugins`, `Search ClawHub plugins…`, `Featured / Trending / Official / Bundled / All`, `All categories`, `Load more`, `Try again`, `Manage`, `Configure`, `Install`, `Installing…`, `Ask an admin`, `Install via agent`, `Version`, `(latest)`, `Security`, `Needs`.
- [ ] **06-ST.i** [R] Remote vs local gateway behave identically (every step is an RPC; no Electron shell-out in the install path).

## Keyboard / accessibility (§5.6)
- [ ] **06-A11Y.a** [M] Tabs are `role="tablist"`; Left/Right move between tabs.
- [ ] **06-A11Y.b** [M] Cards are `role="list"` of buttons; Up/Down moves, Enter opens detail; focus moves to the pane heading.
- [ ] **06-A11Y.c** [M] Esc closes the phone detail screen first, then the modal (desktop: closes the modal).
- [ ] **06-A11Y.d** [R] Overlay reason in `aria-live="assertive"`.

## Phone (<768px)
- [ ] **06-PH.a** [M] 390 px: list full width; selecting a card pushes a full-screen detail with ← back; tabs and chips scroll horizontally; no horizontal page scroll.
- [ ] **06-PH.b** [M] 390 px: install → overlay → verified state; Install button full-width at the bottom of the detail.

## Design (§6)
- [ ] **06-DS.a** [R] Modal 880 px (was 620), `z-[100]`, `rgba(0,0,0,.5)` backdrop, `0 8px 24px` shadow; colours only via `var(--…)`/`color-mix`.
- [ ] **06-DS.b** [R] Uses 01's `FilterTab`, `Pill` (`stateTone`), `Card`, `EmptyState`, `CommandHint`; no new banner component.

## Gateway contract (implementation must honour — per 2026.9.4 source)
- [ ] **06-GW.1** [R] Scopes: `plugins.catalog.browse|categories|get`, `plugins.list`, `plugins.search`, `plugins.inspect`, `gateway.restart.preflight` = `operator.read`; `plugins.install|uninstall|setEnabled|refresh`, `gateway.restart.request` = `operator.admin` (method-scopes-tKV11oMS.mjs:1742-1753, 2104-2141, 2697, 2909-2925). All advertised (none `advertise:false`).
- [ ] **06-GW.2** [R] Browse params closed: `query ≤200`, `intent ∈ all|bundled|trending|official|featured` (default `all`), `category` `^[a-z][a-z0-9-]*$` ≤64, `cursor` 1–4096, `pageSize` 1–100 (default 20). Search + cursor → `INVALID_REQUEST "Plugin search does not accept a browse cursor."`.
- [ ] **06-GW.3** [R] Entry = `{ id, catalog, local }`; `catalog.author` is a string, `detail.author` is `{ handle?, displayName?, imageUrl? }`; `detail.skills` is `{ name, description? }[]`; `detail.verification` is `{ tier, summary?, sourceRepo?, sourceCommit?, sourcePath?, scanStatus? }`.
- [ ] **06-GW.4** [R] `local.install` is present ONLY for a present-but-not-installed local plugin with an install record; ClawHub-only entries install via `catalog.packageName` with `source:"clawhub"`.
- [ ] **06-GW.5** [R] Local-only entries (`local_…`) are always `official:false`, have no stats/author/imageUrl, and their detail has empty `configuration`/`versions`/`topics`, no readme/security/compatibility.
- [ ] **06-GW.6** [R] `plugins.install` params: union of two closed objects; `version` only on `clawhub`; ack fields `acknowledgeInstallPolicyWarning: true` (literal) and `acknowledgeCapabilities: { reviewToken }`. Result `{ ok:true, plugin: <plugins.list row>, restartRequired:true, warnings? }` — `plugin` is the list-row shape, not a discovery entry.
- [ ] **06-GW.7** [R] Install error codes: consent/policy/security-unavailable → `UNAVAILABLE`; download-blocked and bad requests → `INVALID_REQUEST`. Clients must branch on `details`, never on `code`/message.
- [ ] **06-GW.8** [R] `gateway.restart.request` has no typebox schema; `reason` trimmed + truncated to 200; result `{ ok, status: scheduled|deferred|coalesced, preflight, restart }`. A `deferred` restart waits for active work up to 300 s by default; a second request within 30 s is `coalesced` with `cooldownMsApplied`.
- [ ] **06-GW.9** [R] The gateway broadcasts `shutdown { reason, restartExpectedMs? }` before closing; `hello-ok.server.bootId` (optional, 1–96 chars) changes on every boot; 2026.6.5 sends no bootId.
- [ ] **06-GW.10** [R] Control-plane write budget: `plugins.install` and `gateway.restart.request` are `controlPlaneWrite` → 30/60 s on 2026.9.4 (3/60 s on 2026.6.5). Consent + policy retries + restart = up to 4 writes per install.
- [ ] **06-GW.11** [R] Unknown method: admin callers get `INVALID_REQUEST "unknown method: <m>"`; non-admin callers get `FORBIDDEN "missing scope: operator.admin"` with `details.code:"MISSING_SCOPE"` (scope check precedes handler lookup).
- [ ] **06-GW.12** [R] During the restart drain, requests fail `UNAVAILABLE "<method> unavailable during gateway restart"` with `retryable:true, retryAfterMs:1000, details.reason:"gateway-restarting"` — must not be surfaced as a catalog error.

## Regression
- [ ] **06-RG.a** [U] Existing `src/lib/__tests__/pluginCatalog.test.ts` cases (`installParamsFor`, `readConsentRequired`, `describeSurface`, `trustLabel`) pass unchanged.
- [ ] **06-RG.b** [U] Store's existing API (`search`, `install`, `acceptConsent`, `dismissConsent`, `uninstall`, `reset`) still works for the fallback browser and Extensions row uninstall.
- [ ] **06-RG.c** [M] Extensions → Plugins list, toggle (`plugins.setEnabled`), and Configure (`PluginConfigModal`) unchanged.
- [ ] **06-RG.d** [M] ChannelsPanel non-admin path still shows `openclaw plugins install <spec>` with Copy.
- [ ] **06-RG.e** [M] ReconnectOverlay without an expectation still shows its channel copy; unexpected drops keep the 12-attempt limit.
- [ ] **06-RG.f** [M] SkillBrowser unaffected.
- [ ] **06-RG.g** [R] CHANGELOG notes that channel-form installs now restart the gateway automatically. _(§10)_

## Ambiguities / untestable
- **A1** (PRD l.268, l.375) "fall back on `unknown method`" — a non-admin client on an older gateway gets `FORBIDDEN missing scope: operator.admin` instead; PRD doesn't say whether that also triggers fallback. Also l.269/l.442 say `hasMethod()` returns `undefined` for "no list", but the shipped `gatewayClient.hasMethod()` returns boolean (`false`); only `advertisesMethod()` is tri-state.
- **A2** (l.6 vs l.166, l.427) `expectRestart(reason: string)` vs `expectRestart({ reason, detail })`: 01 accepts both (`RestartExpectationInput`); PRD should pick one (object form needed for `detail`).
- **A3** (l.172, l.405) 90 s timeout vs restart deferral up to 300 s and 01's `DEFAULT_RESTART_WINDOW_MS` = 2 min (a drop later than 2 min after `expectRestart` isn't treated as expected). Control UI uses 30 s. Which window governs a `deferred` restart is unspecified.
- **A4** (l.153, l.454) "cached for the session" vs "fetched once per modal session" — connection session or modal open?
- **A5** (l.175, l.479) "`<npmSpec>` for official ones" — no discovery or list field carries an npm spec (D2); untestable as written.
- **A6** (l.169–171, l.403) Resolution states omit `disabled` (install leaves a plugin disabled when the config explicitly disables it) and `not-installed`.
- **A7** (l.300–303, l.395) `needsSummary` for local-origin detail: `configuration` is always `[]`, so "Nothing to configure" would be false for installed plugins that do need config.
- **A8** (l.162–172) Install `warnings[]` (e.g. "installed without enabling it because it requires configuration first") — no UI copy.
- **A9** (l.165, l.334) Only `clawhub_download_blocked` has copy; `clawhub_security_unavailable` (retryable-ish) isn't mentioned.
- **A10** (l.307, l.308) "Verified clean · {date}" — no date is ever sent (D5); "Review recommended" mapping for non-clean statuses (pending/stale/unknown) not defined.
- **A11** (l.262) "Showing bundled and installed plugins." is inaccurate for several real `remoteError` variants (D4).
- **A12** (l.155) search uses `intent:"all"` "category?" — whether the current tab's Official filter is dropped during search (gateway supports `intent:"official"` + query → `isOfficial=true`) is unstated.
- **A13** (l.349) `openPluginBrowser({ pluginId })` — the browser needs a discovery `id` (`ch_…`/`local_…`), not a pluginId; mapping (via `plugins.list` row `catalogId` or `"local_"+base64url(pluginId)`) is unspecified.
- **A14** (l.395) "version picker (ClawHub only)" — does switching version re-fetch `plugins.catalog.get { id, version }` (readme/config/security are per-version) or just change the install param?
- **A15** (l.272) "Remote vs local: Identical" — untestable as a unit; manual only.
