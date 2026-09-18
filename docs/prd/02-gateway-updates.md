# PRD 02: Gateway updates, done properly

| | |
|---|---|
| **Status** | Draft for approval · 18 Sep 2026 |
| **Owner** | PM A |
| **Plan section** | Phase 1 · "Gateway updates, done properly" |
| **Baseline** | `main` @ 374064e · gateway OpenClaw 2026.9.4 (`…/scratchpad/gw/2026.9.4/package`) |
| **Depends on** | [PRD 01](01-shared-groundwork.md): `Overlay`, `Pill`, `CommandHint`, `stateTone`, `hasMethod`/`hasEvent`, `useGatewaySupport`, `expectRestart` |
| **Decision (binding)** | Update the gateway directly with `update.run`, behind a confirm step. "Via agent" stays only as the fallback for connections without admin. |
| **Effort** | M (3 days), 3 PRs |

---

## 1. Summary

**Problem.** Today JoaxClaw learns about a gateway update only if the connection has `operator.admin`, because it calls `update.status` and nothing else. It then hands the update to an agent in a new chat and stops following it. The agent runs `openclaw update` and then restarts the gateway with a `sleep 4` after the turn ends. JoaxClaw can't tell you:
- whether the update worked,
- what phase it is in,
- that an automatic update is about to restart the gateway in the middle of a long team run.

**Outcome.** Every connection hears about a new version. An admin connection updates the gateway in place, after one confirmation, and watches it move through its phases. The reconnect overlay says the gateway is updating instead of blaming a channel change. After the reconnect, JoaxClaw reports success or rollback. An automatic update shows its countdown, and you can hold it for an hour. The Gateway tab gains an update history.

**Solution.**
- The existing `GatewayUpdateBanner` and `store/gatewayUpdate.ts` are extended. Nothing new is added to the banner stack.
- The banner gains four states:
  - **available**: today's state.
  - **campaign**: automatic update countdown, with Hold.
  - **running**: a phase line built from Strip anatomy.
  - **result**: succeeded, failed or rolled back.
- It is fed by three sources:
  - the hello-ok snapshot, which reaches every connection;
  - the `update.available` event, which also reaches every connection;
  - for admin connections, `update.status`, `update.run.changed` and `update.runs.get`.
- "Update gateway" opens an `Overlay` confirm and then calls `update.run`.
- Without admin, the banner offers today's "Update via agent" (or the CLI command) instead.
- A new **Updates** row in Gateway → Gateway opens the history and failure details.

## 2. Background and evidence

### 2.1 How the app behaves today

| Behaviour | Evidence |
|---|---|
| Update detection runs only with admin | `GatewayUpdateBanner.tsx:15,19` calls `check()` only when `grantedScopes` includes `operator.admin`. `store/gatewayUpdate.ts:40` returns early without admin. |
| Detection is `update.status` → `updateAvailable`, at most once every 30 min | `store/gatewayUpdate.ts:41-50` |
| Banner copy: "**OpenClaw {latest}** is available ({channel}). The gateway is on {current}." | `GatewayUpdateBanner.tsx:38-41`. The design brief quotes "You're on vM", but the code says "The gateway is on {current}". The code wins, and this PRD keeps the code's wording. |
| The action is "Update via agent" | `GatewayUpdateBanner.tsx:25-30,44-46` → `buildGatewayUpdatePrompt()` (`lib/gatewayUpdate.ts:24-45`) → `sendViaAgent` (`lib/agentPrompt.ts:9-19`) |
| The agent script is `openclaw update --yes --no-restart`, then `nohup sh -c 'sleep 4; openclaw gateway restart'` | `lib/gatewayUpdate.ts:15-22` |
| Skip is persisted per version; Dismiss lasts the session | `store/gatewayUpdate.ts:11,55-62` |
| The Gateway tab has a second, separate **Update** button that also goes via agent | `GatewayView.tsx:217-237, 356-359` |
| The hello-ok **snapshot is thrown away**. Only `features`, `policy`, `auth.scopes` and `server.version` are kept. | `lib/gateway.ts:347-353` |
| The reconnect overlay always blames a channel change | `ReconnectOverlay.tsx:37-41` |
| It gives up after 12 attempts (~52 s), then shows "Could not reconnect — the gateway may still be restarting" | `store/connection.ts:20, 307-311` |
| There are no toasts; banners give feedback inline | design brief; `App.tsx:200-205` banner stack |

### 2.2 What the gateway offers (2026.9.4, verified in source)

Scopes and since-versions come from `dist/method-scopes-tKV11oMS.mjs`. Param and result schemas come from `dist/sessions-rlbLHLas.mjs`. Handlers are in `dist/update-C1wfgEl4.mjs`. Event guards are `EVENT_SCOPE_GUARDS` in `dist/server-start-DzfvczE1.mjs`.

| Method / event | Scope | Since | Params → result | Used for |
|---|---|---|---|---|
| hello-ok `snapshot.updateAvailable` / `snapshot.updateSchedule` | any / read | — | `updateAvailable {currentVersion, latestVersion, channel, commitsBehind?, commits?[≤5]}`. Clients without read get only the first three fields. `updateSchedule` goes only to read-capable clients (`canReadDetailedUpdateMetadata`, `message-handler-BBAGn2rf.mjs`; builder in `health-state-DsIuwAbj.mjs`). | Update notice for **every** connection, at connect |
| `update.available` (event) | none (`[]`) | — | Read-capable clients get `{updateAvailable ｜ null, schedule?}`; others get `{updateAvailable: {currentVersion, latestVersion, channel} ｜ null}`. Emitted when availability or the schedule changes (`server-startup-post-attach-HBBOikle.mjs`). | Live notice, campaign countdown |
| `update.status` | admin | ≤2026.7 | `{refreshCheckout?}` → `{updateAvailable ｜ null, activeRun?, lastRun?, effectiveChannel?, schedule?, sentinel}` | Admin detail on connect; the result after a reconnect on older gateways |
| `update.run` | admin | ≤2026.7 | `{sessionKey?, note?, restartDelayMs? (0–60000), timeoutMs?, …}` → `{runId, ok, code?, message?, result: {status: ok｜error｜skipped, reason?, before?, after?, steps[], durationMs}, handoff?: {status, command, pid?}, restart}`. Rate limited to 30 calls per 60 s. | Update gateway |
| `update.run.changed` (event) | **admin** | — | `{runId, phase, status, updatedAtMs}` (`update-run-watcher-9rRNscAX.mjs`) | Phase line |
| `update.hold` | admin | 2026.8 | `{}` → `{ok, schedule?}`. Once per campaign; `ok:false` (not an error) when there's no campaign, it's applying, or it's already held. | Hold 1 hour |
| `update.runs.list` | admin | 2026.9 | `{limit? 1–100, default 20}` → `{runs: RunRecord[]}`, newest first | History |
| `update.runs.get` | admin | 2026.9 | `{runId}` → `{run: RunRecord ｜ null}` | Follow a run; read the result after a reconnect |
| `update.report` | admin + owner authority | 2026.9 | `{action:"preview", attemptId}` → `{status:"ready", title, body, previewDigest}`; `{action:"submit", attemptId, previewDigest}` → `created｜fallback｜pending｜retryable｜duplicate` | Report a failed update on GitHub |

**RunRecord** (`UpdateRunRecordSchema`), from `update-run-vocabulary-BYZF4sMi.mjs`:
- **Identity and state:** `runId`, `createdAtMs`, `updatedAtMs`, `trigger` (`chat｜control-ui｜cli｜campaign｜mac-app｜api`), `phase` (`requested → staging → validating → [repairing] → activating → restarting → verifying → finished`), `status` (`running｜succeeded｜failed｜rolled-back｜skipped`), `reason`.
- **What changed:** `target{version, sha, kind}`, `before`/`after{version, sha}`.
- **How it went:** `steps[]{step, status, detail}`, `verification{serviceRunning, versionMatch, pluginErrors[], channelsReady, readyz, …}`, `repair[]`, `finishedAtMs`, `downtimeMs`.

**How `update.run` actually behaves.** This matters for the design:
- **Managed service** (the normal install): the call returns within seconds with `result.status:"skipped"` and `reason:"managed-service-handoff-started"`. A detached `openclaw update --yes --json` then:
  - validates the candidate while the old gateway keeps serving (a canary boot with a 5-minute `/readyz` budget);
  - parks the old gateway, swaps the install and restarts;
  - so the disconnect comes **minutes after the click**, not immediately.

  Sources: `docs/install/updating/automatic-updates.md`, `update-C1wfgEl4.mjs`.
- **Unsupervised git checkout:** the call **blocks** through staging and validating, then restarts after `restartDelayMs` (default 2000). The app's default 30 s request timeout (`lib/gateway.ts:455`) would fire first.
- **Refusals** come back as a *successful* RPC with `ok:false` and `result.reason`:
  - `external-supervisor-update-required`
  - `restart-disabled` / `restart-unavailable`
  - `managed-service-handoff-unavailable` (with a safe `handoff.command`)
  - `managed-service-handoff-already-running`
  - `update-campaign-applying`
  - `not-openclaw-root`
  - `unsupported_git_channel`
  - `update-target-*`
  - `unexpected-error`

  `already-current` is a no-op (`update-outcome-C-GffEda.mjs`).
- **Chat notice:** passing `sessionKey` makes the gateway post "⏳ Restarting…/🔁 Back on…" notices into that chat (`docs/install/updating/automatic-updates.md`). JoaxClaw does **not** pass it (see §8.4).

**Campaigns** (automatic updates; `UpdateCampaignController`, `update-startup-B5Y6Lfsz.mjs`):
- Automatic updates are **off by default** (`update.auto.enabled`), and they need a managed service.
- A campaign moves through `waiting-for-idle` → a 60 s `countdown` → `applying`. A 15-minute hard deadline (`forceAtMs`) starts the update even if work remains.
- **Hold** is allowed once per campaign: it sets `holdUntilMs = now + 1h` and moves the deadline to `holdUntilMs + 15 min`.
- `update.run` during a campaign adopts it.

### 2.3 How the Control UI does it
From `dist/control-ui/assets/control-ui-core-CgyBiPIN.js` and `en-update-actions-eY0d-ZvN.js`.

**Sidebar card:**
- "Update available", "Update Gateway", "Updating Gateway…".
- Campaign wording: "Updating in {time}", "Waiting for active work · forced update in {time}", "Update held · resumes in {time}", "Hold 1 h".

**Confirm dialog:**
- Button: "Update and restart".
- Body: "Installs the available update on the connected Gateway and restarts it."
- "Running sessions are interrupted and this Control UI disconnects until the Gateway is back."
- "Installed {installed} · Available {available}".

**Run view:**
- "{completed} of {total} phases complete".
- "Gateway restarting…", "Reconnecting automatically. Update progress is saved on the gateway."
- Verification checks: Service, Version, Plugins, Channels, Inference.
- Report text: "Reporting requires a connected Gateway owner with administrator access."

**Its client flow:** sends only `{sessionKey}`, takes `runId`, then polls `update.runs.get` until the run is terminal.

### 2.4 Prior art
- **macOS Software Update / VS Code "Restart to Update":** these separate *available* from *about to happen* from *happened*. Each is a distinct, short state in the same place, and the restart always asks first. Lesson: one banner, several states, and a confirm only for the step that is disruptive.
- **Chrome's relaunch nudge:** a deadline plus one postpone. Lesson: Hold is a single, limited action, not a snooze menu. The gateway enforces "once per campaign".
- **GitHub Actions run view:** a phase list with the current step highlighted, with logs behind a disclosure. Lesson: show phases inline and put steps and checks one click away, in Details.

## 3. Goals / Non-goals

**Goals**
- G1. Every connection (read, write or admin) sees that an update is available, with no admin-only polling.
- G2. An admin connection updates directly (confirm → `update.run`) and sees live phases.
- G3. The disconnect during an update is explained, and the app waits long enough to reconnect by itself.
- G4. After the reconnect, the outcome (succeeded, failed or rolled back) is shown once, with details.
- G5. The automatic-update countdown is visible, and an admin can hold it once.
- G6. Update history (the last 20 runs) with failure details and "Copy failure details". "Report on GitHub" appears only when the gateway allows it.
- G7. The "Via agent" path keeps working for connections without admin.

**Non-goals**
- Changing the update channel or turning automatic updates on or off. That is a `config.patch` of `update.*`, it belongs in Gateway settings, and it is deferred.
- `update.status {refreshCheckout}` for dev-channel git checkouts.
- Updating JoaxClaw itself. That is `UpdateBanner`, and it stays unchanged.
- Posting update notices into a chat.

## 4. Users and jobs

- **U1.** As the gateway owner, when a new OpenClaw version is out, I want to update from JoaxClaw with one confirmation, so I don't need a terminal on the host.
- **U2.** As the owner, while it updates, I want to see which phase it's in and know that the disconnect is expected, so I don't try to "fix" the connection.
- **U3.** As the owner, after it's back, I want to know whether it worked or rolled back, so I can move on or investigate.
- **U4.** As the owner in the middle of a long team run, when an automatic update is counting down, I want to hold it for an hour.
- **U5.** As a user on a phone or a read-only connection, I want to know an update exists and how to apply it (via an agent, or the command).
- **U6.** When an update failed, I want the details in a form I can paste into an issue, or file directly when the gateway allows it.

## 5. UX specification

### 5.1 Entry points and placement

| Surface | Why here (integration rules) |
|---|---|
| **`GatewayUpdateBanner`, in its existing place in the stack** (`App.tsx:204`, after ScopeWarningBanner) | Plan decision: extend it, don't add a banner. It's app-wide because an update affects every view. |
| **Reconnect overlay** (existing), via PRD 01 `expectRestart` | It is already where a disconnect is explained. |
| **Gateway → Gateway tab header**: the existing **Update** button is re-routed to the same confirm flow, and a new **History** button sits next to it | The plan puts history "next to Restart and Stop" (`GatewayView.tsx:356-361`). That tab's body is a full-height Monaco editor (`GatewayView.tsx:393-406`), so history opens in an `Overlay` instead of taking editor space. This refines the plan's layout; the plan's mockup showed an inline table. |

### 5.2 Banner states

The banner keeps today's anatomy (`GatewayUpdateBanner.tsx:33-54`):
- a container tinted `color-mix(accent 12%, bg-surface)` with a bottom border;
- a 26px round icon;
- a one-line message;
- actions on the right: `Btn sm`, then text "Skip", then an × dismiss.

Only the tint and icon change with state, through `stateTone`:

| State | When | Tone / icon | Message | Actions |
|---|---|---|---|---|
| `available` | `updateAvailable` set, no campaign, no run | working (accent) · `Server` | **OpenClaw {latest}** is available{ (channel)}. The gateway is on {current}. | admin: **Update gateway** · no admin + write: **Update via agent** · read only: "How to update" (opens the `CommandHint`) · Skip · × |
| `campaign-waiting` | `schedule.campaign.state = waiting-for-idle` | needsYou (amber) · `Clock` | The gateway updates to **{latest}** when current work finishes, or in {mm:ss to forceAtMs} at the latest. | admin: **Hold 1 hour** (hidden once held) · **Update now** · × |
| `campaign-countdown` | `state = countdown` | needsYou · `Clock` | The gateway updates to **{latest}** in {mm:ss to applyAtMs}. | admin: Hold 1 hour · Update now · × |
| `campaign-held` | `holdUntilMs` in the future | idle · `PauseCircle` | Update to **{latest}** is on hold until {HH:mm}. | Update now (admin) · × |
| `running` | we started a run, or the campaign is `applying`, or `activeRun` is running | working · `Loader2` (spins) | Updating to **{target}** · {phase label}. JoaxClaw reconnects on its own. | Phase line (§5.4). **Not dismissible.** It explains the disconnect that's coming, the way ApprovalsBanner isn't dismissible (`App.tsx:201-202`). |
| `refused` | `update.run` → `ok:false` | failed · `AlertTriangle` | The gateway didn't update: {refusal copy}. | per reason: **Update via agent** / `CommandHint` · × |
| `result-ok` | the run we followed ends `succeeded` | done · `CheckCircle2` | Gateway updated to **{after.version}**{ · down for {downtime}}. | Details · × |
| `result-failed` | ends `failed` | failed · `XCircle` | The update to **{target}** failed. The gateway is still on {before.version}. | Details · Copy failure details · × |
| `result-rolled-back` | ends `rolled-back` | failed · `Undo2` | The update to **{target}** didn't pass its checks and was rolled back to {before.version}. | Details · Copy failure details · × |

Precedence: `running` > `refused` > `result-*` > `campaign-*` > `available`. `lib/gatewayUpdate.ts bannerState()` works this out and is unit tested.

### 5.3 Flows

**F1 Update directly (admin).**
1. The banner is in `available`. Click **Update gateway**.
2. The `Overlay` (PRD 01) "Update the gateway?" opens (§5.5).
3. Click **Update and restart**. The button shows a loading state. The store:
   - arms `expectRestart({ reason: 'Gateway is updating', detail: 'Updating to {latest}. JoaxClaw reconnects on its own.', windowMs: 10 min, untilMs: +15 min })`;
   - calls `update.run({ note: 'Started from JoaxClaw' }, timeoutMs 15 min)`.
4. The dialog closes and the banner goes to `running` · "Requested".
5. The response arrives (seconds later for a managed service, after validation for a git checkout):
   - `ok:true` with `runId`: the store remembers `runId` (in localStorage, so a reload keeps following it) and follows the run (F2).
   - `ok:false` with a refusal reason: go to `refused` and clear the restart expectation.
   - `already-current`: go to `result-ok` with "The gateway is already on {current}."
6. If the socket drops before the response arrives, the pending request rejects with "Connection closed" (`lib/gateway.ts:224`). While an expectation is armed, that's treated as expected: the run is found after the reconnect (F3).

**F2 Follow a run (admin).**
1. `update.run.changed` events for `runId` update `phase`. Every 2 s while the banner shows `running`, the store also calls `update.runs.get` (as the Control UI does), because events can be missed.
2. When the phase reaches `activating` or `restarting`, the store re-arms `expectRestart` with detail "Updating to {target} · Restarting. Update progress is saved on the gateway."
3. The socket drops. The overlay shows the update reason (PRD 01 FR-9).

**F3 After the reconnect.**
1. On `status === 'connected'`, the store reads `runId` from localStorage and calls `update.runs.get({runId})`. On 2026.8 or older, it calls `update.status` and uses `activeRun`/`lastRun` with a matching `runId`.
2. `running` (for example `verifying`): stay in `running` and keep polling.
3. A terminal status: show the matching `result-*` state once, and record `runId` as seen in localStorage.
4. With no run record available (an older gateway without runs, or no admin), infer the result:
   - if `serverVersion` equals the target version, show `result-ok` without downtime;
   - otherwise show a neutral "The gateway is back on {serverVersion}." with Details disabled.

**F4 Automatic update (campaign).**
1. The snapshot or `update.available` carries `schedule.campaign`, so the banner shows `campaign-*`.
2. **Hold 1 hour** calls `update.hold`:
   - `ok:true`: go to `campaign-held` with the new `holdUntilMs`.
   - `ok:false`: re-read `update.status` and show whatever state results. The gateway doesn't say why it refused (§2.2).
3. **Update now** runs F1. The confirm dialog is kept, because the restart impact is the same.
4. When the campaign goes to `applying`, the banner shows `running` for **every** connection. Non-admin connections get no phase detail, because `update.run.changed` is admin-only. The store arms `expectRestart` on `applying` for everyone.

**F5 No admin (write scope).**
- **Update via agent** keeps today's behaviour exactly: `buildGatewayUpdatePrompt` → `sendViaAgent` (`GatewayUpdateBanner.tsx:25-30`).
- The banner stays in `available`. The agent chat is where progress shows. After the gateway comes back, F3's fallback path shows "The gateway is back on {version}."

**F6 Read only.** "How to update" expands `CommandHint command="openclaw update"` inline, under the message row.

**F7 History (admin, 2026.9 or newer).**
1. Gateway tab → **History** opens the `Overlay` "Update history" with the last 20 runs from `update.runs.list`.
2. A row's **Details** opens the run inside the same overlay (a back arrow returns to the list). It shows the phases, the steps (with `detail`), the verification checks and any repair attempts.
3. A failed or rolled-back *latest* run also shows "Copy failure details". "Report on GitHub" appears only if `update.report {action:"preview", attemptId: runId}` returned `status:"ready"` when Details opened.

**F8 Report.**
1. **Report on GitHub** shows the preview's title and body (read-only, scrolls) with **Submit report**.
2. Submit calls `update.report {action:"submit", attemptId, previewDigest}` with a 105 s timeout, the same as the Control UI.
3. The result is shown inline:
   - `created`: "Reported. View issue ↗"
   - `fallback`: "Open the prefilled issue ↗"
   - `pending`/`retryable`: the gateway's `message` with Retry
   - `duplicate`: "Already reported" plus a link if there is one

### 5.4 Phase line (running state)

The phase line uses Strip anatomy (PRD 01) inside the banner's message area: phase label, then `ProgressTrack`, then a mono count.
- Visible phases: Staging, Validating, Activating, Restarting, Verifying. Repairing is inserted only when the run enters it.
- `pct = completed / total`. The bar is indeterminate until the first phase event arrives.

```
Desktop, banner in the "running" state
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ (⟳)  Updating to 2026.9.5 · Validating. JoaxClaw reconnects on its own.               │
│      Staging ✓  Validating ●  Activating ○  Restarting ○  Verifying ○  ▬▬▬▬──────  2/5  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The step markers reuse ProgressCardDock's icons (`ProgressCardDock.tsx:79-83`): `CheckCircle2` success for done, `CircleDot` accent (pulsing) for current, `Circle` dimmed for pending. On a phone only the current label, the bar and the count show.

### 5.5 Wireframes

**Desktop · available (admin)**
```
┌──TitleBar──────────────────────────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────────────────────────────────────┤
│ (▣)  OpenClaw 2026.9.5 is available. The gateway is on 2026.9.4.                       │
│                                         [↑ Update gateway]   Skip   ✕                  │
├──NavRail─┬─────────────────────────────────────────────────────────────────────────────┤
```

**Desktop · confirm (`Overlay`, width 440)**
```
┌───────────────────────────────────────────────────┐
│  Update the gateway?                          ✕   │
├───────────────────────────────────────────────────┤
│  Installs OpenClaw 2026.9.5 on the gateway host   │
│  and restarts it.                                 │
│                                                   │
│  Installed 2026.9.4 · Available 2026.9.5          │
│                                                   │
│  ⚠ Running chats are interrupted and JoaxClaw     │
│    disconnects until the gateway is back.         │
│    2 chats are running now.                       │
├───────────────────────────────────────────────────┤
│                     [Cancel]  [Update and restart]│
└───────────────────────────────────────────────────┘
```
"2 chats are running now." counts `sessions.filter(s => s.hasActiveRun)`, the same count the tray uses (`App.tsx:147`). The line is hidden when the count is 0. For the dev channel with `commits`, a folded "3 commits" list follows the versions line.

**Desktop · campaign countdown (admin)**
```
├────────────────────────────────────────────────────────────────────────────────────────┤
│ (◷)  The gateway updates to 2026.9.5 in 0:48.            [Hold 1 hour] [Update now]  ✕ │
├────────────────────────────────────────────────────────────────────────────────────────┤
```

**Desktop · reconnect overlay during an update**
```
                 ┌──────────────────────────────────────────────┐
                 │               ( logo ⟳ )                     │
                 │           Gateway is updating                │
                 │  Updating to 2026.9.5 · Restarting. Update   │
                 │  progress is saved on the gateway.           │
                 │  ┌────────────────────────────────────────┐  │
                 │  │ ▣ ws://studio:18789 · attempt 7        │  │
                 │  └────────────────────────────────────────┘  │
                 │     [↻ Stop trying & connect manually]       │
                 └──────────────────────────────────────────────┘
```

**Desktop · Gateway tab header and history overlay**
```
│ Gateway                                ✓ Running PID 4121 · remote                              │
│ ~/.openclaw/openclaw.json   [↑ Update → 2026.9.5] [History] [Restart] [Safe] [■ Stop] [Reload]  │

┌─ Update history ─────────────────────────────────────────────────── ✕ ┐
│ When           Version              Started by   Result       Down    │
│ Today 09:12    2026.9.3 → 2026.9.4  JoaxClaw     (Succeeded)  38s     │
│ Sep 11 02:00   2026.9.2 → 2026.9.3  Automatic    (Rolled back) 1m 04s │  [Details]
│ Sep 02 21:40   2026.9.1 → 2026.9.2  Command line (Succeeded)  41s     │
└───────────────────────────────────────────────────────────────────────┘

┌─ ← Update on Sep 11 02:00 ───────────────────────────────────────── ✕ ┐
│ 2026.9.2 → 2026.9.3 · Automatic · (Rolled back)                       │
│ Phases   Staging ✓ Validating ✓ Activating ✓ Restarting ✓ Verifying ✗ │
│ Checks   Service ✓  Version ✓  Plugins ✗ (1 error)  Channels ○        │
│ ▸ Steps (12)                                                          │
│ ▸ Repair attempts (1)                                                 │
│                      [Copy failure details]  [Report on GitHub]       │
└───────────────────────────────────────────────────────────────────────┘
```

**Phone (<768px)**
The banner wraps into two rows. Actions go on row 2, with 40px tap targets.
```
┌──────────────────────────────────────┐
│ (▣) OpenClaw 2026.9.5 is available.  │
│     The gateway is on 2026.9.4.      │
│  [↑ Update gateway]      Skip    ✕   │
├──────────────────────────────────────┤

running:
┌──────────────────────────────────────┐
│ (⟳) Updating to 2026.9.5             │
│     Validating ▬▬▬▬─────── 2/5       │
├──────────────────────────────────────┤
```
The confirm and history `Overlay`s open full width (`maxWidth: 94vw`) on a phone. History drops the "Down" column.

### 5.6 Every state

| Condition | Behaviour |
|---|---|
| Empty (no update, no run, no result) | Banner hidden (today's behaviour). The History button still shows for admin on 2026.9+. |
| Loading | `update.run` pending: the confirm button shows a spinner, then the banner goes to `running` · "Requested". History: a `Loader2` row "Loading update history…". |
| Error | RPC error on `update.run` (not a refusal): `refused`, with the gateway's message. `update.hold` failure: an inline `--danger` line under the banner, "Couldn't hold the update: {msg}". History load failure: the error in the overlay, with Retry. |
| Offline / reconnecting | The reconnect overlay replaces `<main>`, but the banner stack stays rendered above it (`App.tsx:200-205, 218-219`). In `running`, the banner freezes on the last known phase, and the overlay carries the update reason. In any other state, the banner keeps its last state, and its actions are disabled with the title "Reconnect to update". |
| Older gateway | No `update.available` event (`hasEvent`) and no snapshot field: fall back to today's admin-only `update.status` check. No `update.hold` (2026.7): hide Hold. No `update.runs.*` (≤2026.8): hide History, and use F3's `update.status`/version fallback. No `update.run.changed`: rely on polling `update.status` `activeRun` every 2 s. |
| No admin scope | No `update.run`/hold/history/report. Notices still show from the snapshot and event. Actions: Update via agent (write) or `CommandHint` (read only). |
| Remote vs local gateway | Identical. `update.run` runs on the gateway host either way. The old "via agent" was already host-side. Nothing touches the local `~/.openclaw` (remote-gateway pitfall). |
| Update started elsewhere (CLI, Control UI, campaign) | An admin sees `activeRun` from `update.status` on connect, or from `update.run.changed`, so the banner shows `running` for that run too, and the result after the reconnect. |
| Our run was already seen, then the app reloads | The result shows once only (the seen `runId` is in localStorage). |

### 5.7 Copy

| Id | String |
|---|---|
| b.available | **OpenClaw {latest}** is available{ ({channel})}. The gateway is on {current}. |
| b.update | Update gateway |
| b.viaAgent | Update via agent *(existing)* |
| b.howTo | How to update |
| b.skip | Skip *(existing; title "Skip {latest} — don't remind me until the next release")* |
| b.waiting | The gateway updates to **{latest}** when current work finishes, or in {mm:ss} at the latest. |
| b.countdown | The gateway updates to **{latest}** in {mm:ss}. |
| b.held | Update to **{latest}** is on hold until {HH:mm}. |
| b.hold | Hold 1 hour |
| b.updateNow | Update now |
| b.running | Updating to **{target}** · {phase}. JoaxClaw reconnects on its own. |
| b.runningOther | The gateway is applying an update to **{target}**. JoaxClaw reconnects on its own. |
| b.ok | Gateway updated to **{version}**{ · down for {downtime}}. |
| b.alreadyCurrent | The gateway is already on {current}. |
| b.backOn | The gateway is back on {version}. |
| b.failed | The update to **{target}** failed. The gateway is still on {before}. |
| b.rolledBack | The update to **{target}** didn't pass its checks and was rolled back to {before}. |
| b.details / b.copy | Details / Copy failure details |
| b.holdError | Couldn't hold the update: {message} |
| c.title | Update the gateway? |
| c.body | Installs OpenClaw {latest} on the gateway host and restarts it. |
| c.versions | Installed {current} · Available {latest} |
| c.impact | Running chats are interrupted and JoaxClaw disconnects until the gateway is back. |
| c.running | {n} chat is running now. / {n} chats are running now. |
| c.confirm / c.cancel | Update and restart / Cancel |
| o.reason | Gateway is updating |
| o.detail | Updating to {target} · {phase}. Update progress is saved on the gateway. |
| r.external | This gateway is run by an outside supervisor, so it can't update itself. Update it the way it was installed. |
| r.restartOff | Gateway restarts are turned off, so the update wasn't applied. Turn restarts on in the gateway config, then try again. |
| r.handoff | The gateway can't hand the update to its service safely. Run this on the gateway host instead: *(+ `CommandHint` with `handoff.command`)* |
| r.busy | Another update is already running. Wait for it to finish. |
| r.campaign | An automatic update is already being applied. |
| r.other | The gateway refused the update ({reason}). *(+ Update via agent)* |
| h.title / h.empty | Update history / No updates yet. Updates started anywhere appear here. |
| h.cols | When · Version · Started by · Result · Down |
| h.by | Automatic · From a chat · Control UI · Command line · Mac app · JoaxClaw *(api + a runId this app started)* · App or API |
| h.result | Running · Succeeded · Failed · Rolled back · Skipped |
| h.phases / h.checks / h.steps / h.repair | Phases · Checks · Steps ({n}) · Repair attempts ({n}) |
| h.check | Service · Version · Plugins · Channels · Ready — values: Passed · Failed · Not checked |
| h.report / h.submit | Report on GitHub / Submit report |
| h.reported | Reported. View issue ↗ · Open the prefilled issue ↗ · Already reported |
| cmd.lead | On the gateway host, run *(PRD 01 CommandHint)* |

### 5.8 Keyboard and accessibility
- The banner is `role="status"` with `aria-live="polite"`, so phase changes are announced once per phase, not on every poll.
- The confirm `Overlay` puts focus on **Cancel**: the destructive action is never the default. Enter on "Update and restart" confirms.
- The phase line exposes `ProgressTrack`'s `aria-label="Update progress, {n} of {total} phases"`.
- The history table uses real `<table>` markup with `<th scope="col">`. Details is a button.

### 5.9 Notifications and deep links
- No push. The gateway has no update push category (`PUSH_CATEGORIES`, `lib/webPush.ts:31-42`).
- Tier-1 `notify()` (PWA, only while the app is hidden): fires once when a run we followed reaches a terminal status after the reconnect. Titles are "Gateway updated" or "Gateway update failed", with the body taken from b.ok/b.failed. It uses `navigate: { section: 'gateway' }`, which needs `NotifyNavigate.section` to add `'gateway'` (`lib/notifications.ts:16-19`).

## 6. Design-book conformance

| Item | Used |
|---|---|
| Banner anatomy | Kept exactly: tint, 26px icon, `Btn sm`, text Skip, × (`GatewayUpdateBanner.tsx:33-54`). The tint colour comes from `stateTone`. |
| Tokens | `--accent`, `--warning`, `--danger`, `--success`, `--text-secondary`, `--bg-surface`, `--border`. All tints go through `color-mix`. |
| Primitives (PRD 01) | `Overlay`, `Pill` (history result), `CommandHint`, `EmptyState` (history), `ProgressTrack` |
| State colours | working = running/available · needsYou = campaign countdown · failed = failed/rolled back/refused · done = succeeded · idle = held |
| No toasts | All feedback is in the banner, the overlay or the dialog. |
| Not dismissible while it blocks you | `running` follows the ApprovalsBanner precedent. |
| Admin way round | Update via agent (existing), plus `CommandHint`. |
| **New** | The phase line inside a banner. It reuses the Strip layout and the step icons, so it adds no new visual vocabulary. |

## 7. Functional requirements

**FR-1 Notice for every connection.** Given a read-only connection to a gateway whose hello-ok snapshot has `updateAvailable`, when the app connects, then the banner shows `available` without any admin call.

**FR-2 Live notice.** Given the banner is hidden, when an `update.available` event arrives with an `updateAvailable`, then the banner shows it. When one arrives with `updateAvailable:null`, then the banner hides (unless it is in `running` or `result-*`).

**FR-3 Confirm before run.** Given admin, when the user clicks Update gateway, then no RPC is sent until they click "Update and restart". Cancel or Escape sends nothing.

**FR-4 Run.** Given the confirm, then `update.run` is called once with a 15 min timeout, `expectRestart` is armed, and a second click can't start another run while one is pending or running.

**FR-5 Refusal.** Given `update.run` returns `ok:false, result.reason:"restart-disabled"`, then the banner shows the `refused` state with r.restartOff, and the restart expectation is cleared.

**FR-6 Phases.** Given we follow run R, when `update.run.changed {runId:R, phase:"validating"}` arrives, then the phase line shows Validating as current and 1/5 complete. Events for other runIds are ignored unless there is no followed run and the event's status is `running` (a run started elsewhere).

**FR-7 Explained disconnect.** Given run R reached `activating`, when the socket drops, then the reconnect overlay shows "Gateway is updating" and keeps retrying for up to 15 min.

**FR-8 Result after reconnect.** Given R ended `rolled-back` while the app was disconnected, when the app reconnects, then `update.runs.get` is called and the banner shows `result-rolled-back` once. It does not reappear after a reload.

**FR-9 Campaign and hold.**
- Given `schedule.campaign.state="countdown"` with `applyAtMs` 48 s away, then the banner shows "…in 0:48", ticking each second.
- Given admin, when Hold 1 hour succeeds, then the banner shows `campaign-held` and Hold never shows again for that campaign id.

**FR-10 Via agent.** Given a write-only connection, when the user clicks Update via agent, then today's prompt is sent to the default agent in a new chat (unchanged behaviour).

**FR-11 History.** Given admin on 2026.9+, when the user opens History, then up to 20 runs show, newest first, with trigger labels from h.by. With no runs, the overlay shows h.empty.

**FR-12 Report gating.**
- Given the latest run failed, when Details opens, then `update.report preview` is called once. "Report on GitHub" is shown only if the preview answered `ready`.
- Given the preview returns `FORBIDDEN`, then only "Copy failure details" shows, with no error.

**FR-13 Copy failure details.** Given a failed run, when the user clicks Copy, then Markdown with the versions, trigger, reason, failed steps with their `detail`, and checks goes to the clipboard, and the button shows "Copied" for 1.2 s.

**FR-14 Older gateway.** Given a 2026.7 gateway (no `update.available` in `features.events`), then admin connections use `update.status` exactly as today. Non-admin connections show no banner (today's behaviour), and History and Hold are hidden.

## 8. Technical design

### 8.1 Files

| Path | New/changed | What |
|---|---|---|
| `src/lib/gateway.ts` | changed | Keep `res.snapshot?.updateAvailable` and `res.snapshot?.updateSchedule` from hello-ok, as `serverVersion` is kept (`gateway.ts:351-352`). Expose them as `helloUpdate: { available?, schedule? }`. Reset in `_open()`. |
| `src/lib/gatewayUpdate.ts` | changed | Keeps `buildGatewayUpdatePrompt`, and adds pure functions: `parseUpdateAvailable`, `parseSchedule`, `parseRun`, `phaseProgress(run)`, `runTone(status)`, `refusalCopy(reason)`, `bannerState(inputs, now)`, `campaignCountdown(schedule, now)`, `failureMarkdown(run)`, `triggerLabel(trigger, ownRunIds)`, `formatDowntime(ms)` |
| `src/store/gatewayUpdate.ts` | changed | Adds `schedule`, `followedRunId` (persisted under `joaxclaw-gateway-update-run`), `run`, `runs`, `seenResults` (persisted), `running`, `holdError`. Adds the actions `start()`, `ingestHello()`, `ingestAvailable(p)`, `ingestRunChanged(p)`, `runUpdate()`, `hold()`, `loadHistory()`, `previewReport(runId)`, `submitReport()`. `check()` is kept for admin detail. |
| `src/components/layout/GatewayUpdateBanner.tsx` | changed | Renders `bannerState()`. Adds the confirm `Overlay` and the phase line. |
| `src/components/gateway/UpdateHistoryOverlay.tsx` | new | List view and details view, plus the report |
| `src/components/gateway/GatewayView.tsx` | changed | The Update button uses the store's flow (confirm/run, or via agent without admin). Adds the History button, gated on `hasMethod('update.runs.list')` and admin. |
| `src/App.tsx` | changed | Calls `useGatewayUpdateStore.getState().start()` inside the connect effect (`App.tsx:114-136`). |
| `src/lib/notifications.ts` | changed | `NotifyNavigate.section` gains `'gateway'`. |

### 8.2 Data flow

```
hello-ok ──▶ gatewayClient.helloUpdate ──▶ store.ingestHello()     (every connection)
event update.available ─────────────────▶ store.ingestAvailable()  (every connection)
[admin] update.status on connect ───────▶ activeRun / lastRun / schedule
[admin] event update.run.changed ───────▶ store.ingestRunChanged()
[admin] poll update.runs.get (2 s, only while running, 2026.9+) ─▶ store.run
click ▶ Overlay confirm ▶ expectRestart ▶ update.run ▶ followedRunId
reconnect ▶ start() ▶ update.runs.get(followedRunId) ▶ result state (once)
```

- `start()` is idempotent. It subscribes once with `gatewayClient.on`, and those listeners survive reconnects (integration rule 6).
- There is **no** per-connection subscription to renew: `update.available` and `update.run.changed` are broadcasts guarded only by scope (`EVENT_SCOPE_GUARDS`).
- `start()` runs again on each connect. It re-reads hello and re-fetches the followed run.

### 8.3 Capability gating

```ts
const canNotice  = gatewayClient.hasEvent('update.available') || !!gatewayClient.helloUpdate.available
const canRun     = admin && gatewayClient.hasMethod('update.run')
const canHold    = admin && gatewayClient.hasMethod('update.hold')        // 2026.8+
const canHistory = admin && gatewayClient.hasMethod('update.runs.list')   // 2026.9+
const canFollow  = admin && gatewayClient.hasMethod('update.runs.get')
const canPhases  = admin && gatewayClient.hasEvent('update.run.changed')
const canReport  = admin && gatewayClient.hasMethod('update.report')      // then the preview must succeed
const viaAgent   = !admin && scopes.includes('operator.write')
```

### 8.4 Decisions made in this PRD
- **No `sessionKey` on `update.run`.**
  - Passing one makes the gateway write update notices into that chat's transcript. For JoaxClaw, "the current chat" is arbitrary, and the banner already reports.
  - Without a session, the gateway sends its notice through the main session's external route if there is one (`automatic-updates.md`). The owner may accept that.
  - Trigger records show `api`, so the history labels runIds this app started (kept in localStorage, capped at 20) as "JoaxClaw".
- **`restartDelayMs` is left at its default** (2 s).
- **Request timeout 15 min** covers the unsupervised git path, which blocks through validation. Validation's canary alone has a 5-minute budget.

### 8.5 Error handling
- Rate limit (`UNAVAILABLE`, `retryAfterMs`): show "The gateway is busy. Try again in {n}s." in `refused` state. Unlikely, since the button is single-flight.
- `update.runs.get` returning `run:null` for our runId: keep the `backOn` fallback, and drop `followedRunId`.
- Missing scope: `readMissingScope` already logs it (`gateway.ts:483-486`). The UI never calls an admin method without `admin`.
- The `result`, `handoff` and `sentinel` shapes are typed `Unknown` in places (§2.2), so parse them defensively in `lib/gatewayUpdate.ts`.

### 8.6 Performance
- Polling happens only while `running`: `update.runs.get` every 2 s, stopping at a terminal status or after 20 min.
- The campaign countdown re-renders once a second only while a campaign is shown.
- History is 20 rows, with no paging (the gateway allows up to 100).

### 8.7 Migration
- `joaxclaw-gateway-update-skip` is kept.
- New keys: `joaxclaw-gateway-update-run` and `joaxclaw-gateway-update-seen` (a capped array).

## 9. Test plan

**Unit tests** (`src/lib/__tests__/gatewayUpdate.test.ts`, which exists already; extend it):

`parseUpdateAvailable`:
- full shape;
- reduced shape (no read);
- null or garbage returns null.

`parseSchedule`:
- no campaign;
- each of `waiting-for-idle`, `countdown`, `applying`;
- held (`holdUntilMs` in the future).

`parseRun`:
- a minimal record;
- unknown phase or status values are kept as strings and not crashed on;
- `steps` capped.

`phaseProgress`:
- `requested` is 0/5;
- `validating` is 1/5 with current = Validating;
- `repairing` inserts a sixth phase;
- `finished` with `succeeded` is 5/5;
- `failed` at `verifying` marks Verifying failed.

`bannerState` precedence:
- running beats result beats campaign beats available;
- Skip suppresses `available` for that version only, never `running`;
- Dismiss suppresses everything except `running`;
- a seen result isn't shown again.

`refusalCopy`:
- every reason in §2.2;
- an unknown reason falls back to r.other with the reason code.

`campaignCountdown`:
- countdown to `applyAtMs`;
- waiting to `forceAtMs`;
- held to `holdUntilMs`;
- past times clamp to 0:00.

Other functions:
- `failureMarkdown`: includes the versions, reason, failed steps with `detail`, and failed checks, and escapes backticks.
- `triggerLabel`: covers every trigger, and `api` with our own runId gives "JoaxClaw".
- `formatDowntime`: 38000 gives "38s", 64000 gives "1m 04s", null gives "".

**Manual QA** (use an isolated gateway profile on a test machine, never the owner's live gateway; see memory "Gateway vs project scope"):
1. Read-only token on a gateway with an update available: the banner shows the notice with "How to update", and there are no admin calls in the connection log.
2. Admin, managed service:
   1. Update gateway, then Cancel: nothing is sent.
   2. Update gateway, then Update and restart: the phase line advances.
   3. The overlay says "Gateway is updating" and reconnects.
   4. The result banner shows once.
   5. Reload: it isn't shown again.
3. Force a refusal (set `gateway.restart` off, or equivalent): the `refused` copy shows and the socket stays up.
4. Campaign:
   1. Set `update.auto.enabled` on a beta channel profile and wait for a campaign.
   2. Check the countdown ticks, then Hold: the held state shows and Hold disappears.
   3. Update now: the confirm appears.
5. Unplug the network during `validating`, then restore it: the run is picked up again by its runId.
6. History: rows match `openclaw update status --json` `lastRun`, and Details of a failed run shows the steps.
7. Phone at 390px: the banner wraps; the confirm is full width; the tap targets are ≥40px.
8. 2026.7 gateway: today's behaviour, with no Hold and no History.

## 10. Rollout
- No flag. Every piece is gated on `hasMethod`/`hasEvent` and the admin scope (§8.3).
- Degradation by gateway version:
  - **2026.9:** everything.
  - **2026.8:** no history, no report, no `runs.get` (use `update.status` `lastRun`).
  - **≤2026.7:** today's behaviour, plus the direct `update.run` for admin, with a simpler "back on {version}" result.
- Ship after PRD 01. The "Update via agent" path isn't removed, so nothing regresses for connections without admin.

## 11. Risks and open questions

| # | Item | Owner decision? |
|---|---|---|
| R1 | **The plan said "a shared token isn't one" (owner) for reporting. The source says otherwise.** A shared-token or password operator counts as `system` authority and qualifies (`message-handler-*.mjs`, `update-C1wfgEl4.mjs`). JoaxClaw usually authenticates with a *device token* after pairing (`gateway.ts:317-340`), and I could not confirm which authority that gets. Mitigation: gate on the preview succeeding, as the plan already said. | no |
| R2 | **The plan implies the disconnect follows the click.** For managed services it comes minutes later, after validation. The banner's `running` state covers that gap, and `expectRestart` is re-armed on `activating`. | no |
| R3 | The unsupervised git path blocks `update.run` for minutes. Mitigation: 15 min timeout, and treat "Connection closed" as expected. | no |
| R4 | I found no explicit guard against two concurrent in-process `update.run` calls (update-contract research). Mitigation: the app is single-flight, and `update.status` `activeRun` disables the button. | no |
| R5 | Whether `update.available` and the snapshot fields exist before 2026.8 is **unverified** (only 2026.9.4 was read). We gate on `hasEvent`, so an older gateway falls back safely. | no |
| Q1 | **Pass `sessionKey` so the gateway posts "⏳ Restarting / 🔁 Back on" into a chat?** Recommendation: no (§8.4). | **yes** |
| Q2 | **Should Dismiss be allowed during a campaign countdown?** Recommendation: yes for the session, because the reconnect overlay still explains the restart. | yes |
| Q3 | Should "Update via agent" also be offered to admin connections as a secondary action (for example when `update.run` refuses)? Recommendation: only on refusal, as specified. | yes |

## 12. Milestones

| PR | Contents | Size |
|---|---|---|
| 02-a | Keep the hello snapshot; `update.available` ingest; notices for every connection; `bannerState` + tests; confirm + `update.run` + refusal copy; Gateway tab Update button re-routed | M |
| 02-b | Following a run: `update.run.changed`, polling, phase line, `expectRestart` wiring, the result after the reconnect, the tier-1 notify | S–M |
| 02-c | Campaign states + Hold; History overlay + Details + Copy + conditional Report | S–M |
