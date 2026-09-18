# QA checklist — PRD 02 Gateway updates, done properly
Source: docs/prd/02-gateway-updates.md · Engineer: Eng 1 · Milestones: 02-a (snapshot/event ingest, bannerState, confirm + update.run, refusal copy, Gateway tab Update), 02-b (follow run, polling, phase line, expectRestart, result after reconnect, notify), 02-c (campaign + Hold, History overlay, Details, Copy, Report)
Legend: **[U]** unit test (vitest, src/lib/__tests__) · **[R]** code review · **[M]** manual app check (desktop + 390px phone)
Fixtures: `src/lib/__tests__/fixtures/sprint/gatewayUpdates.ts` (names below in `code`). Hello feature lists: `fixtures/sprint/helloFeatures.ts`.

## 02-a · Hello snapshot and live notice (FR-1, FR-2)
- [ ] **02-A1.a** [U] Given a hello-ok whose `snapshot` is `helloSnapshotReadCampaign`, when the handshake completes, then `gatewayClient.helloUpdate` equals `{ available: availableFull, schedule: scheduleCountdown }`. _(§8.1 gateway.ts row, PRD l.478)_
- [ ] **02-A1.b** [U] Given `helloSnapshotNone` (keys absent), then `helloUpdate` is `{}` / both undefined, not `null` objects that render a banner. _(l.478)_
- [ ] **02-A1.c** [R] `helloUpdate` is reset in `_open()` (a new socket never shows the previous gateway's update). _(l.478)_
- [ ] **02-A1.d** [U] Given a read-only grant (`['operator.read']`) and `helloSnapshotReadNoCampaign`, when `ingestHello()` runs, then `bannerState` is `available` and **no** `update.*` RPC was sent (mock `request` call log is empty for `update.`). _(FR-1 l.440; manual QA 1 l.587)_
- [ ] **02-A1.e** [U] Given `helloSnapshotNoRead` (3-field reduced shape, no schedule), then `parseUpdateAvailable` returns `{currentVersion:'2026.9.4', latestVersion:'2026.9.4', channel:'dev'}` and no campaign state is derived. _(§9 parseUpdateAvailable l.543-546)_
- [ ] **02-A1.f** [U] `parseUpdateAvailable(null)`, `(undefined)`, `({})`, `({latestVersion: 5})`, `('x')` all return `null`. _(l.546)_
- [ ] **02-A1.g** [U] `parseUpdateAvailable(availableDevGit)` keeps `commitsBehind: 7` and `commits` (≤5, subjects up to 120 chars). _(l.292)_
- [ ] **02-A2.a** [U] Given banner hidden, when `ingestAvailable(evAvailableDetailed)` runs, then state becomes `available` with latest `2026.9.5`. _(FR-2 l.442)_
- [ ] **02-A2.b** [U] Given `available`, when `ingestAvailable(evAvailableCleared)` / `(evAvailableClearedLegacy)` runs, then the banner hides. _(FR-2)_
- [ ] **02-A2.c** [U] Given `running` or any `result-*`, when `updateAvailable:null` arrives, then the state is unchanged. _(FR-2)_
- [ ] **02-A2.d** [U] `ingestAvailable(evCampaignCountdown)` updates `schedule`; `ingestAvailable(evAvailableLegacy)` (no `schedule` key) does NOT clear a previously known schedule… **or** does (decide; see Ambiguities A4) — test asserts the chosen rule. _(l.221, §8.2)_
- [ ] **02-A2.e** [R] `start()` subscribes to `update.available` and `update.run.changed` exactly once via `gatewayClient.on` (idempotent across reconnects; second `start()` adds no listener). _(l.498-501)_
- [ ] **02-A2.f** [R] `App.tsx` calls `useGatewayUpdateStore.getState().start()` inside the connect effect; it runs again on each connect and re-reads hello + re-fetches the followed run. _(l.484, l.501)_

## 02-a · Banner states, precedence, Skip/Dismiss (§5.2, §5.6)
- [ ] **02-B1.a** [U] `bannerState` precedence `running` > `refused` > `result-*` > `campaign-*` > `available`: one test per adjacent pair using combined inputs. _(l.190, l.565-566)_
- [ ] **02-B1.b** [U] Skip for `2026.9.5` suppresses `available` for 2026.9.5 only; `available` for `2026.9.6-beta.2` still shows; Skip never suppresses `running`. _(l.567)_
- [ ] **02-B1.c** [U] Dismiss suppresses every state except `running`. _(l.568)_
- [ ] **02-B1.d** [U] A result whose runId is in `seenResults` is not shown again. _(l.569)_
- [ ] **02-B1.e** [U] `campaign-held` wins over `campaign-waiting` when `holdUntilMs > now` even though the gateway's `campaign.state` is `waiting-for-idle` (`scheduleHeld`). _(l.183; contract GC-7)_
- [ ] **02-B1.f** [U] `running` is chosen when (i) we started a run, (ii) `schedule.campaign.state === 'applying'` (`scheduleApplying`), or (iii) `activeRun.status === 'running'` (`statusActiveRun`). _(l.184)_
- [ ] **02-B2.a** [R] Tone/icon per state via `stateTone`: available→working/`Server`; campaign-waiting & countdown→needsYou/`Clock`; held→idle/`PauseCircle`; running→working/`Loader2` spinning; refused→failed/`AlertTriangle`; result-ok→done/`CheckCircle2`; result-failed→failed/`XCircle`; result-rolled-back→failed/`Undo2`. _(l.180-188, l.432)_
- [ ] **02-B2.b** [R] Banner anatomy unchanged: container `color-mix(accent 12%, bg-surface)` tint (colour from stateTone), bottom border, 26px round icon, one-line message, actions right: `Btn sm`, text "Skip", × dismiss. _(l.170-176, l.429)_
- [ ] **02-B2.c** [R] Banner stays in its existing slot after ScopeWarningBanner in `App.tsx`; no new banner component added to the stack. _(l.25, l.164)_
- [ ] **02-B3.a** [U] Action set per scope in `available`: admin (+`hasMethod('update.run')`) → "Update gateway"; no admin + `operator.write` → "Update via agent"; read only → "How to update"; always Skip and ×. _(l.180, §8.3 l.506-514)_
- [ ] **02-B3.b** [R] `running` renders no × and no Skip. _(l.184, l.434)_
- [ ] **02-B3.c** [M] Offline/reconnecting: in `running`, banner freezes on last phase; in any other state actions are disabled with title "Reconnect to update". _(l.361)_

## 02-a · Confirm + update.run (FR-3, FR-4, FR-5, F1)
- [ ] **02-C1.a** [U] Given admin, clicking "Update gateway" opens the confirm and sends no RPC; Cancel, × and Escape send nothing. _(FR-3 l.444)_
- [ ] **02-C1.b** [R] Confirm is a PRD 01 `Overlay`, width 440 desktop, `maxWidth: 94vw` on phone; initial focus on **Cancel**; Enter on "Update and restart" confirms. _(l.275, l.352, l.417)_
- [ ] **02-C1.c** [U] Confirm copy: title "Update the gateway?"; body "Installs OpenClaw {latest} on the gateway host and restarts it."; "Installed {current} · Available {latest}"; "Running chats are interrupted and JoaxClaw disconnects until the gateway is back."; buttons "Update and restart" / "Cancel". _(c.* l.391-396)_
- [ ] **02-C1.d** [U] Running-chats line: n = `sessions.filter(s => s.hasActiveRun).length`; 1 → "1 chat is running now."; 2 → "2 chats are running now."; 0 → line hidden. _(l.292, c.running l.395)_
- [ ] **02-C1.e** [R] Dev channel with `commits`: a folded "{n} commits" list follows the versions line (`availableDevGit`). _(l.292)_
- [ ] **02-C2.a** [U] On confirm: `expectRestart` is called with `{ reason: 'Gateway is updating', detail: 'Updating to 2026.9.5. JoaxClaw reconnects on its own.', windowMs: 600000, untilMs: now+900000 }` BEFORE `update.run` is sent. _(F1.3 l.198-199)_
- [ ] **02-C2.b** [U] `update.run` is called exactly once with params `{ note: 'Started from JoaxClaw' }` (no `sessionKey`, no `restartDelayMs`, no `timeoutMs` param) and request timeout 900000 ms. _(l.199, FR-4 l.446, §8.4 l.517-522)_
- [ ] **02-C2.c** [U] Single flight: a second confirm/click while `update.run` is pending or state is `running` sends nothing. _(FR-4)_
- [ ] **02-C2.d** [U] Confirm button shows loading while pending; on send the dialog closes and banner goes `running` · "Requested". _(l.197, l.200, l.359)_
- [ ] **02-C3.a** [U] `runResponseHandoffStarted` (ok:true, result.status "skipped", reason `managed-service-handoff-started`) → store saves `followedRunId = RUN_IDS.ours` in localStorage `joaxclaw-gateway-update-run` and stays `running`. Must NOT be classified as refused/skipped. _(F1.5 l.202; GC-9)_
- [ ] **02-C3.b** [U] `runResponseGitOk` (ok:true, status ok) → follows the run. _(l.202)_
- [ ] **02-C3.c** [U] `runResponseRestartDisabled` → `refused` with r.restartOff and `clearRestartExpectation()` called. _(FR-5 l.448)_
- [ ] **02-C3.d** [U] `runResponseAlreadyCurrent` (**ok:false**, reason `already-current`) → `result-ok` with "The gateway is already on 2026.9.4.", not `refused`; restart expectation cleared. _(F1.5 l.204; GC-10)_
- [ ] **02-C3.e** [U] `refusalCopy` per reason: `external-supervisor-update-required`→r.external; `restart-disabled` & `restart-unavailable`→r.restartOff; `managed-service-handoff-unavailable`→r.handoff + `CommandHint command={handoff.command}`; `managed-service-handoff-already-running`→r.busy; `update-campaign-applying`→r.campaign; everything else (`not-openclaw-root`, `unsupported_git_channel`, `update-target-*`, `managed-service-handoff-failed`, `unexpected-error`, unknown `foo`) → r.other "The gateway refused the update ({reason})." + Update via agent. Iterate `REFUSAL_REASONS`. _(l.399-404, l.571-573)_
- [ ] **02-C3.f** [U] RPC error (not refusal) on `update.run`, e.g. `errMissingAdminForRun` → `refused` showing the gateway's `message` read from `err.gatewayError.message` (not the JSON-stringified Error message). _(l.360; GC-15)_
- [ ] **02-C3.g** [U] Rate limit `errRateLimitedRun` → `refused` with "The gateway is busy. Try again in 37s." (seconds = ceil(retryAfterMs/1000)). _(§8.5 l.525)_
- [ ] **02-C3.h** [U] "Connection closed" rejection while an expectation is armed is treated as expected (no `refused`); after reconnect F3 runs. With no `followedRunId` (response never arrived) F3 uses `update.status` `activeRun`/`lastRun` or the version fallback. _(F1.6 l.205; A7)_
- [ ] **02-C3.i** [U] "Request update.run timed out" after 15 min → `refused`/error state, restart expectation cleared. _(A8)_
- [ ] **02-C4.a** [R] Gateway tab **Update** button (`GatewayView.tsx`) uses the same store flow: confirm → `update.run` for admin, via agent without admin. The old separate via-agent path is removed for admin. _(l.166, l.483)_

## 02-a · Non-admin paths (F5, F6, FR-10)
- [ ] **02-D1.a** [U] Write-only grant: "Update via agent" calls `buildGatewayUpdatePrompt()` then `sendViaAgent(prompt, onOpenChat)` — unchanged; the existing `gatewayUpdate.test.ts` script assertions still pass. _(FR-10 l.460, F5 l.228-230)_
- [ ] **02-D1.b** [U] Banner stays `available` after via-agent; after reconnect F3 fallback shows "The gateway is back on {version}." _(l.230)_
- [ ] **02-D2.a** [R] Read-only: "How to update" expands `CommandHint command="openclaw update"` inline under the message row (PRD 01 CommandHint, lead "On the gateway host, run"). _(F6 l.232, cmd.lead l.413)_

## 02-b · Following a run (F2, FR-6, FR-7)
- [ ] **02-E1.a** [U] Following R: `ingestRunChanged(evRunChangedValidating)` → phase line current = Validating, 1/5. _(FR-6 l.450)_
- [ ] **02-E1.b** [U] Event for another runId while following R (`evRunChangedOtherRunRunning`) is ignored. With no followed run, the same event (status running) makes the banner `running` for that run; `evRunChangedOtherRunTerminal` with no followed run is ignored. _(FR-6)_
- [ ] **02-E1.c** [U] Same-phase repeat events (heartbeat revision in `evRunChangedSequence`) cause no extra aria-live announcement. _(l.416)_
- [ ] **02-E2.a** [U] While `running`, `update.runs.get({runId})` is polled every 2000 ms (fake timers), only when `hasMethod('update.runs.get')` and admin; stops on terminal status or after 20 min. _(F2.1 l.208, §8.6 l.531)_
- [ ] **02-E2.b** [U] Poll errors `errRestartDraining` / "Not connected" do not leave `running` and do not surface an error. _(GC-16)_
- [ ] **02-E2.c** [U] Without `update.run.changed` but with admin (older gateway), `update.status` `activeRun` is polled every 2 s. _(l.362)_
- [ ] **02-E3.a** [U] When phase reaches `activating` or `restarting` (event or poll), `expectRestart` is re-armed with detail "Updating to 2026.9.5 · Restarting. Update progress is saved on the gateway." (o.detail with phase label). _(F2.2 l.209, o.detail l.398)_
- [ ] **02-E3.b** [M] FR-7: run reaches activating, socket drops → overlay title "Gateway is updating", keeps retrying up to 15 min (not the 12-attempt limit). _(FR-7 l.452)_
- [ ] **02-E4.a** [U] `phaseProgress(runRequested)` → 0/5, current Staging pending/indeterminate. _(l.559)_
- [ ] **02-E4.b** [U] `phaseProgress(runValidating)` → 1/5, current Validating. _(l.560)_
- [ ] **02-E4.c** [U] `phaseProgress(runRepairing)` (repairing entered **after verifying**) inserts a sixth phase and does not move completed count backwards or crash. _(l.561; GC-5)_
- [ ] **02-E4.d** [U] `phaseProgress(runSucceeded)` (phase `finished`, status succeeded) → 5/5. _(l.562)_
- [ ] **02-E4.e** [U] `phaseProgress(runFailedAtVerifying)` (phase is `finished`; the `verifying` **step** is `failed`) → Verifying marked failed. Derivation must use `steps[]`, not `run.phase`. _(l.563; GC-4)_
- [ ] **02-E4.f** [U] `parseRun(runUnknownVocabulary)` keeps `phase:'rehearsing'`, `status:'paused'`, `trigger:'webhook'` as strings; `phaseProgress` does not throw. `parseRun(runMinimal)` works; `parseRun(runOversize)` caps steps (cap value documented in code). _(l.553-556)_
- [ ] **02-E5.a** [R] Phase line uses Strip anatomy: label · `ProgressTrack` · mono count; visible phases Staging, Validating, Activating, Restarting, Verifying; markers `CheckCircle2` (done, success), `CircleDot` (current, accent, pulsing), `Circle` (pending, dimmed); indeterminate until first phase event. _(l.250-262)_
- [ ] **02-E5.b** [R] `ProgressTrack` `aria-label="Update progress, {n} of {total} phases"`. _(l.418)_
- [ ] **02-E5.c** [M] Phone <768px: only current label, bar, count ("Validating ▬▬── 2/5"); banner wraps to two rows, actions on row 2, tap targets ≥40px. _(l.262, l.337-351)_
- [ ] **02-E6.a** [U] Messages: b.running "Updating to **{target}** · {phase}. JoaxClaw reconnects on its own."; b.runningOther "The gateway is applying an update to **{target}**. JoaxClaw reconnects on its own." for a campaign/other run without phase detail. _(l.382-383)_

## 02-b · Result after reconnect (F3, FR-8, notify)
- [ ] **02-F1.a** [U] On `connected` with `followedRunId` in localStorage, `update.runs.get({runId})` is called; `runsGetRunning` → stays `running` and polls. _(F3.1-2 l.213-214)_
- [ ] **02-F1.b** [U] FR-8: `runsGetRolledBack` → `result-rolled-back` shown once; runId appended to `joaxclaw-gateway-update-seen` (capped array); after a simulated reload (fresh store, same localStorage) it is not shown. _(FR-8 l.454, l.537)_
- [ ] **02-F1.c** [U] `runsGetSucceeded` → `result-ok` "Gateway updated to **2026.9.5** · down for 38s." _(b.ok l.384, l.186)_
- [ ] **02-F1.d** [U] `runsGetNull` → `backOn` fallback and `followedRunId` removed. _(§8.5 l.526)_
- [ ] **02-F1.e** [U] `errInvalidRunId` (corrupt localStorage value) → treated like `run:null`; `followedRunId` removed; no crash. _(GC-12)_
- [ ] **02-F1.f** [U] No `update.runs.get` advertised (≤2026.8): uses `update.status` `activeRun`/`lastRun` with matching runId. _(F3.1 l.213)_
- [ ] **02-F1.g** [U] No run record (no admin, or `status2026_6_5`): `serverVersion === target` → `result-ok` without downtime; otherwise "The gateway is back on {serverVersion}." with Details disabled. _(F3.4 l.216-218)_
- [ ] **02-F1.h** [U] Terminal `skipped` run (`runAlreadyCurrent`, or a refusal recorded by the detached CLI) maps to a defined state (see Ambiguities A2) — never stuck in `running`. _(A2)_
- [ ] **02-F2.a** [U] Result messages: b.failed "The update to **{target}** failed. The gateway is still on {before}."; b.rolledBack "The update to **{target}** didn't pass its checks and was rolled back to {before}."; actions Details · Copy failure details · ×. _(l.187-188, l.387-389)_
- [ ] **02-F2.b** [U] `formatDowntime(38000)` → "38s"; `(64000)` → "1m 04s"; `(null)` → "". _(l.584)_
- [ ] **02-F3.a** [U] Tier-1 `notify()` fires once when a followed run reaches terminal status after reconnect and the app is hidden; titles "Gateway updated" / "Gateway update failed"; body from b.ok / b.failed; `navigate: { section: 'gateway' }`. _(§5.9 l.423)_
- [ ] **02-F3.b** [R] `NotifyNavigate.section` type in `lib/notifications.ts` includes `'gateway'` and the navigate handler routes it. _(l.485)_

## 02-c · Campaign and Hold (F4, FR-9)
- [ ] **02-G1.a** [U] `campaignCountdown(scheduleCountdown.campaign, NOW_MS)` → "0:48"; banner "The gateway updates to **2026.9.5** in 0:48."; ticks each second (fake timers: +1s → "0:47"). _(FR-9 l.457, b.countdown l.378)_
- [ ] **02-G1.b** [U] waiting counts to `forceAtMs`: `scheduleWaiting` at NOW_MS → "13:00"; banner "The gateway updates to **2026.9.5** when current work finishes, or in 13:00 at the latest." _(b.waiting l.377)_
- [ ] **02-G1.c** [U] held counts to `holdUntilMs`; banner "Update to **2026.9.5** is on hold until {HH:mm}." (local time of holdUntilMs). _(b.held l.379)_
- [ ] **02-G1.d** [U] Past times clamp to "0:00". _(l.579)_
- [ ] **02-G1.e** [R] The 1 s re-render interval exists only while a campaign state is shown. _(l.532)_
- [ ] **02-G2.a** [U] Hold 1 hour → `update.hold` called with `{}` exactly (closed schema). `holdOk` → `campaign-held` with `holdUntilMs` from the returned schedule. _(F4.2 l.222-223)_
- [ ] **02-G2.b** [U] After a hold, Hold is never shown again for that campaign id — including `scheduleCountdownAfterHold` (hold expired, `holdUntilMs` in the past). _(FR-9 l.458)_
- [ ] **02-G2.c** [U] `holdRefusedAlreadyHeld` / `holdRefusedNoCampaign` / `holdRefusedNoSchedule` → state re-derived (from the returned schedule and/or `update.status`), no error line. _(F4.2 l.224)_
- [ ] **02-G2.d** [U] Hold RPC error (`errHoldUnavailable`) → inline `--danger` line "Couldn't hold the update: update hold status is temporarily unavailable". _(l.360, b.holdError l.390)_
- [ ] **02-G2.e** [U] Hold hidden when `!hasMethod('update.hold')` or no admin. _(l.362, l.508)_
- [ ] **02-G3.a** [U] "Update now" opens the same confirm (F1). _(F4.3 l.225)_
- [ ] **02-G3.b** [U] `evCampaignApplying` → `running` (b.runningOther when no followed run) for every read-capable connection, and `expectRestart` is armed on `applying` regardless of admin. _(F4.4 l.226)_
- [ ] **02-G3.c** [U] `evCampaignCleared` after `applying` (failed apply) leaves `running` (to available or a result) — the banner never stays on "Updating…". _(GC-8)_
- [ ] **02-G3.d** [R] Campaign actions admin-only: Hold 1 hour (hidden once held) · Update now · ×; non-admin sees message + × only. _(l.181-183)_

## 02-c · History, Details, Copy, Report (F7, F8, FR-11..13)
- [ ] **02-H1.a** [U] History button shown only when admin && `hasMethod('update.runs.list')` (true with `METHODS_2026_9_4`); hidden on 2026.8 lists / no admin. _(l.483, l.510)_
- [ ] **02-H1.b** [U] `loadHistory()` calls `update.runs.list` with `{ limit: 20 }` (or no params); renders `runsListFull` newest first (20 rows). _(FR-11 l.462, l.533)_
- [ ] **02-H1.c** [U] `runsListEmpty` → h.empty "No updates yet. Updates started anywhere appear here." (via `EmptyState`). _(l.405)_
- [ ] **02-H1.d** [U] Loading row: `Loader2` "Loading update history…"; failure (`errUnknownRunsList` etc.) → error text in overlay + Retry. _(l.359-360)_
- [ ] **02-H1.e** [U] `triggerLabel`: campaign→"Automatic", chat→"From a chat", control-ui→"Control UI", cli→"Command line", mac-app→"Mac app", api→"App or API", any trigger whose runId is in our own-runIds list (localStorage, capped 20) → "JoaxClaw". _(h.by l.407, l.583)_
- [ ] **02-H1.f** [U] Result pill labels: Running · Succeeded · Failed · Rolled back · Skipped (`Pill` + stateTone). _(h.result l.408)_
- [ ] **02-H1.g** [R] Real `<table>` with `<th scope="col">` columns When · Version · Started by · Result · Down; Details is a `<button>`; phone drops "Down". _(l.419, l.352, h.cols l.406)_
- [ ] **02-H2.a** [R] Details view in the same overlay with back arrow; shows Phases, Checks (Service · Version · Plugins · Channels · Ready — Passed · Failed · Not checked), "Steps ({n})" and "Repair attempts ({n})" as disclosures, step `detail` shown. _(F7.2 l.236, l.409-410)_
- [ ] **02-H2.b** [U] Check mapping from `verification`: Service←`serviceRunning`, Version←`versionMatch`, Plugins←`pluginErrors` (empty = Passed, n>0 = Failed "(n errors)"), Channels←`channelsReady`, Ready←`readyz`; absent key → "Not checked". _(h.check l.410; GC-6)_
- [ ] **02-H3.a** [U] FR-13 `failureMarkdown(runFailedAtVerifying)` contains versions (2026.9.4 → 2026.9.5), trigger, reason `post-update-verification-failed`, failed steps with `detail`, failed checks; backticks in `detail` are escaped. _(FR-13 l.468, l.582)_
- [ ] **02-H3.b** [U] Copy writes to clipboard and the button shows "Copied" for 1200 ms. _(FR-13)_
- [ ] **02-H3.c** [U] Copy failure details only shown for a failed/rolled-back **latest** run in History (and in result-failed / result-rolled-back banners). _(F7.3 l.237, l.187-188)_
- [ ] **02-H4.a** [U] FR-12: Details of the latest failed run calls `update.report {action:'preview', attemptId: runId}` exactly once; "Report on GitHub" shown only when result `status === 'ready'` (`reportPreviewReady`). _(FR-12 l.465)_
- [ ] **02-H4.b** [U] Preview → `errReportForbidden` (FORBIDDEN) → only Copy shows, no error text. Same for `errReportStale` / `errReportNoAuthority` (INVALID_REQUEST). _(FR-12 l.466; GC-13)_
- [ ] **02-H4.c** [U] Preview not called when `!hasMethod('update.report')` or no admin. _(l.512)_
- [ ] **02-H5.a** [U] Report on GitHub shows preview `title` and `body` read-only (scrolls) with "Submit report"; Submit calls `update.report {action:'submit', attemptId, previewDigest}` with request timeout 105000 ms. _(F8 l.240-241)_
- [ ] **02-H5.b** [U] Submit results: `reportSubmitCreated` → "Reported. View issue ↗" linking `url`; `reportSubmitFallback` → "Open the prefilled issue ↗" linking `fallbackUrl`; `reportSubmitPending`/`reportSubmitRetryable` → gateway `message` + Retry; `reportSubmitDuplicate` → "Already reported" + link (`url` ?? `fallbackUrl`); `reportSubmitDuplicateNoLink` → "Already reported" without link. _(F8.3 l.242-246)_
- [ ] **02-H5.c** [U] Submit error (`errReportStale`) shows the gateway message inline; no crash. _(A10)_

## 02 · Capability gating and older gateways (§8.3, FR-14, §10)
- [ ] **02-I1.a** [U] With `METHODS_2026_9_4`/events 2026.9.4 and admin: canNotice, canRun, canHold, canHistory, canFollow, canPhases, canReport all true; viaAgent false. _(l.506-513)_
- [ ] **02-I1.b** [U] With the 2026.6.5 feature lists (`helloFeatures.ts`) and admin: canRun true, canHold/canHistory/canFollow/canPhases/canReport false; canNotice **true** (`update.available` is in 2026.6.5 GATEWAY_EVENTS). _(§10 l.609; GC-1)_
- [ ] **02-I1.c** [U] viaAgent = `!admin && scopes.includes('operator.write')`. _(l.513)_
- [ ] **02-I1.d** [U] 2026.6.5 `update.run` response (`runResponse2026_6_5`, no `runId`) → no follow; `running` until disconnect; after reconnect F3 version fallback. _(§10 l.609)_
- [ ] **02-I1.e** [U] FR-14 fallback path (no `update.available` event advertised and no snapshot field): admin uses `update.status` as today; non-admin shows no banner; History and Hold hidden. _(FR-14 l.470)_
- [ ] **02-I1.f** [R] The UI never calls an admin method without `operator.admin` (grep store actions: each `update.status/run/hold/runs.*/report` call is guarded). _(§8.5 l.527)_
- [ ] **02-I1.g** [R] Nothing touches local `~/.openclaw` or the local filesystem; identical behaviour for remote and local gateways. _(l.364)_

## Copy (grouped) — exact strings
- [ ] **02-J1** [U] Banner: b.available, b.update "Update gateway", b.viaAgent "Update via agent", b.howTo "How to update", b.skip "Skip" with title "Skip {latest} — don't remind me until the next release", b.waiting, b.countdown, b.held, b.hold "Hold 1 hour", b.updateNow "Update now", b.running, b.runningOther, b.ok, b.alreadyCurrent, b.backOn, b.failed, b.rolledBack, b.details "Details", b.copy "Copy failure details", b.holdError — exactly as PRD l.372-390. Channel shown in parentheses only when not stable/latest/release (existing rule, `GatewayUpdateBanner.tsx`).
- [ ] **02-J2** [U] Confirm c.title/c.body/c.versions/c.impact/c.running/c.confirm/c.cancel as l.391-396.
- [ ] **02-J3** [U] Overlay o.reason "Gateway is updating", o.detail "Updating to {target} · {phase}. Update progress is saved on the gateway." (l.397-398).
- [ ] **02-J4** [U] Refusals r.external, r.restartOff, r.handoff, r.busy, r.campaign, r.other as l.399-404.
- [ ] **02-J5** [U] History h.title "Update history", h.empty, h.cols, h.by, h.result, h.phases "Phases", h.checks "Checks", h.steps "Steps ({n})", h.repair "Repair attempts ({n})", h.check values, h.report "Report on GitHub", h.submit "Submit report", h.reported (l.405-412).
- [ ] **02-J6** [R] No toasts anywhere in this feature; all feedback in banner/overlay/dialog. _(l.433)_

## Accessibility and keyboard
- [ ] **02-K1** [R] Banner `role="status"` `aria-live="polite"`; phase changes announced once per phase, not per poll (live text only changes on phase change). _(l.416)_
- [ ] **02-K2** [M] Confirm: focus lands on Cancel; Tab reaches Update and restart; Enter there confirms; Escape closes and sends nothing. _(l.417, FR-3)_
- [ ] **02-K3** [M] History overlay: keyboard reachable Details buttons, back arrow, disclosures (Steps, Repair attempts) toggle with Enter/Space. _(l.419)_
- [ ] **02-K4** [M] 390px phone: banner two rows, actions row 2, 40px tap targets; confirm and history full width (94vw); history hides Down. _(l.337-352, manual 7 l.601)_

## Manual end-to-end (isolated gateway profile only — never the owner's live gateway)
- [ ] **02-M1** [M] Read-only token + update available: notice with "How to update"; connection log shows no `update.*` admin calls. _(l.587)_
- [ ] **02-M2** [M] Admin, managed service: Cancel sends nothing; Update and restart → phase line advances; overlay "Gateway is updating" and reconnects; result shows once; reload → not shown again. _(l.588-593)_
- [ ] **02-M3** [M] Refusal (restart disabled, unsupervised): `refused` copy and the socket stays up. _(l.594)_
- [ ] **02-M4** [M] Campaign on a beta profile with `update.auto.enabled`: countdown ticks; Hold → held and Hold disappears; Update now → confirm. _(l.595-598)_
- [ ] **02-M5** [M] Network drop during `validating`, restore → run picked up by runId. _(l.599)_
- [ ] **02-M6** [M] History rows match `openclaw update status --json` `lastRun`; failed run Details shows steps. _(l.600)_
- [ ] **02-M7** [M] Older gateway (2026.6.5 available locally): no Hold, no History; notice still appears for every connection (see GC-1). _(l.602)_

## Gateway contract (per 2026.9.4 source; implementation must honour these)
- [ ] **GC-1** [R] `update.available` (event) and hello `snapshot.updateAvailable` already exist in **2026.6.5** and go to every connection (2026.6.5 `health-state-VRUXjZyB.js:28`, `server-startup-post-attach-s4oDk9tN.js:647`). `snapshot.updateSchedule` and schedule in the event are 2026.9-era only. `update.status` on 2026.6.5 returns only `{sentinel}` (`update-B6J_RJip.js:40`), so the "today's update.status" fallback detects nothing there.
- [ ] **GC-2** [R] Detailed update metadata (`currentSha`, `upstreamRef`, `upstreamSha`, `commitsBehind`, `commits`, and `updateSchedule`/`schedule`) needs operator.read, which `operator.write` and `operator.admin` imply (`operator-scope-compat-iV7_Lmth.mjs:10-11`, `events-Dk8ohZI-.mjs:12-27`).
- [ ] **GC-3** [R] `update.run.changed` is admin-guarded (`server-start-DzfvczE1.mjs:2980`), payload exactly `{runId, phase, status, updatedAtMs}`; emitted by a 2 s watcher poll on each `updatedAtMs` change and once at terminal (`update-run-watcher-9rRNscAX.mjs:97-118`). Both events are listed in hello `features.events` for every connection regardless of scope; all `update.*` methods are advertised (none `advertise:false`).
- [ ] **GC-4** [R] A terminal run always has `phase: "finished"` (`update-run-record-DyYy8-Zk.mjs:983`); failed/skipped marks the then-current phase step `failed`/`skipped`, rolled-back marks it `completed` (`:978-981`). Phase progress for terminal runs must read `steps[]`.
- [ ] **GC-5** [R] `repairing` is entered either forward (from ≤validating) or **backward from `verifying`** (`update-run-ledger-B_LBZZgT.mjs:258-261`), then returns to `verifying`.
- [ ] **GC-6** [R] RunRecord is a closed object with `origin`, `target{channel,tag,kind,version,sha}`, `before/after{version,sha,buildId}` (all nullable), `steps[≤128]{step,status,startedAtMs?,endedAtMs?,detail?}`, `verification{booted,runningVersion,runningBuildId,serviceRunning,pid,port,versionMatch,pluginErrors[≤32],channelsReady,readyz,settled,noticeDelivered,doctorHint}`, `repair[≤16]{attempt,status,startedAtMs,endedAtMs?,summary?,reason?}`, `confirmedAtMs`, `finishedAtMs`, `downtimeMs` (`sessions-rlbLHLas.mjs:554-633`). Step statuses: pending, in_progress, completed, failed, skipped.
- [ ] **GC-7** [R] Campaign has no "held" state: a hold sets `state:'waiting-for-idle'`, `holdUntilMs=now+1h`, `forceAtMs=holdUntilMs+15min`; `holdUntilMs` stays on later `countdown`/`applying` states (`update-startup-B5Y6Lfsz.mjs:96-113,152,181`). Hold once per campaign is enforced in memory (`held` flag, `:98`). `applyAtMs` exists only in `countdown`.
- [ ] **GC-8** [R] A failed campaign apply clears `schedule.campaign` (`update-startup-B5Y6Lfsz.mjs:185-189`); a new update.available frame follows.
- [ ] **GC-9** [R] `update.run` returns `ok:true` for a started managed handoff although `result.status` is `"skipped"` (`update-C1wfgEl4.mjs:847`); `restart` is `null` then; the run's phase stays `requested` until the detached CLI records `staging` (`:768`).
- [ ] **GC-10** [R] Every `update.run` call creates a ledger run and returns `runId`, including refusals (`:473-482`); refusals finish the run as `skipped`/`failed` with `reason` (`:782-786`) and appear in `update.runs.list`. `already-current` is `ok:false`, `status:'skipped'` (git in-process only, `update-control-plane-sentinel-D6xfGgXT.mjs:35-43`).
- [ ] **GC-11** [R] JoaxClaw's run trigger is `api` (client id `gateway-client`, mode `backend`; `update-C1wfgEl4.mjs:453`), **but** becomes `campaign` when `update.run` adopts a campaign (`:577-581`).
- [ ] **GC-12** [R] `update.runs.get` `runId` must match the UUID pattern (`sessions-rlbLHLas.mjs:531`); otherwise INVALID_REQUEST "invalid update.runs.get params: …". Unknown valid UUID → `{run:null}`. `update.runs.list` `limit` 1–100, default 20, newest first by `createdAtMs` (`update-run-record-DyYy8-Zk.mjs:913`).
- [ ] **GC-13** [R] `update.report`: admin scope + owner authority (shared token/password = `system`, or profile `gateway-owner`) else FORBIDDEN; only the **latest** reportable run is accepted, otherwise INVALID_REQUEST "This failed update attempt is stale or unavailable." (`update-C1wfgEl4.mjs:270-300`). Preview result also carries `attemptId`.
- [ ] **GC-14** [R] `update.run`, `update.hold`, `update.report` are control-plane writes: 30 per 60 s per method+device/IP, error `UNAVAILABLE` with top-level `retryable:true, retryAfterMs` and `details.limit:"30 per 60s"` (`server-methods-v1T0byyX.mjs:294-311`). `update.status`/`runs.*` are not rate-limited.
- [ ] **GC-15** [R] Errors are `{code, message, ...opts}`; the app's `request()` rejects with `Error(JSON.stringify(error))` and `gatewayError` attached (`src/lib/gateway.ts:487`) — read `gatewayError.message`/`code`.
- [ ] **GC-16** [R] During restart drain, requests fail `UNAVAILABLE "<method> unavailable during gateway restart"`, `retryAfterMs:1000`, `details.reason:"gateway-restarting"` (`server-methods-v1T0byyX.mjs:336-346`).
- [ ] **GC-17** [R] `update.hold` params are the closed `{}`; result `{ok, schedule?}` (the refusal returns the current schedule, so no `update.status` re-read is required).
- [ ] **GC-18** [R] `update.status` params `{refreshCheckout?}` (2026.9); 2026.6.5 schema is closed `{}` — never send `refreshCheckout`.

## Regression
- [ ] **02-R1** [U] Existing `gatewayUpdate.test.ts` (`buildGatewayUpdatePrompt` script: `set -e`, `openclaw update --yes --no-restart`, detached `sleep N; openclaw gateway restart`) still passes.
- [ ] **02-R2** [U] Skip key `joaxclaw-gateway-update-skip` still read/written; a previously skipped version stays skipped after upgrade. _(§8.7 l.536)_
- [ ] **02-R3** [R] App self-update `UpdateBanner` untouched. _(l.146)_
- [ ] **02-R4** [U] Reconnect overlay without an update expectation still gives up after `RECONNECT_MAX_ATTEMPTS` (12) with the existing copy. _(l.54)_
- [ ] **02-R5** [R] No per-connection subscription added for update events; `connectionSeq`-based renewals of other features unaffected. _(l.500)_
- [ ] **02-R6** [U] Admin `check()` still rate-limited to once per 30 min when used as the fallback. _(l.46)_
- [ ] **02-R7** [R] ApprovalsBanner/ScopeWarningBanner order in `App.tsx` unchanged. _(l.164)_

## Ambiguities / untestable
- **A1 (l.45-46, 362, 469-471, 608-609, 620)** "Older gateway → today's admin `update.status` check" and FR-14's premise ("a 2026.7 gateway (no `update.available` in `features.events`)") don't match the source: 2026.6.5 already advertises `update.available` and sends `snapshot.updateAvailable` to everyone, and its `update.status` returns no `updateAvailable`. FR-14's "non-admin shows no banner" would regress on 6.5–8.x. R5 is answered: the event and snapshot field exist since at least 2026.6.5 (schedule does not).
- **A2 (l.185-188, 215)** No banner state for a followed run that ends `skipped` (for example `already-current` found by the detached CLI, `managed-service-handoff-cancelled`, or a refusal). Needs a rule (suggest: `already-current` → b.alreadyCurrent; other skipped → `refused` with refusalCopy(reason)).
- **A3 (l.563)** "`failed` at `verifying` marks Verifying failed": the record's phase is `finished`; only `steps[]` tell which phase failed, and for `rolled-back` the phase step is marked `completed`. Not testable as written against `run.phase`.
- **A4 (l.221, 442)** Whether an `update.available` frame without `schedule` (a non-read connection, or an availability change before any schedule was seen) clears a known campaign is unspecified.
- **A5 (l.181, 377)** "{mm:ss to forceAtMs}": the deadline is ≥15 min away and up to 75 min after a hold. mm:ss over 60 minutes (e.g. "74:12") is unspecified.
- **A6 (l.226, 383)** "banner shows `running` for **every** connection" on `applying`: connections without operator.read never receive `schedule` (GC-2), so they can't. Only read-capable connections can.
- **A7 (l.205)** If the socket drops before the `update.run` response, no runId is known; F3 only describes reading `followedRunId`. The fallback (update.status activeRun/lastRun, or runs.list newest) is unspecified.
- **A8 (l.199, 522)** Behaviour when the 15 min request timeout fires is unspecified.
- **A9 (l.407, 520)** "JoaxClaw (api + a runId this app started)": runs we start during a campaign get trigger `campaign` (GC-11). The label must key on own-runId first, whatever the trigger.
- **A10 (l.242-246)** Submit errors (INVALID_REQUEST stale, FORBIDDEN, rate limit) have no copy.
- **A11 (l.224)** "re-read `update.status`" after `ok:false`: the hold response already carries `schedule`. Either is fine; the test should accept both.
- **A12 (l.198, 209)** `windowMs: 10 min` from the click. A managed-service update can disconnect more than 10 min later (staging + a 5 min canary budget), and connections without `update.run.changed` (read/write, or 2026.8) never re-arm it on `activating`. Only a manual check can confirm the overlay reason.
- **A13 (l.237, 465)** "the latest run": the gateway's "latest" is its active run, else the newest by `createdAtMs`. A refused run (status `skipped`, reason for example `restart-disabled`) counts as reportable (`update-outcome-C-GffEda.mjs:52-58`). Whether Copy/Report should show for refusals is unspecified.
- **A14 (l.556)** "`steps` capped": no cap value is given, so this can't be tested without one.
- **A15 (l.410 vs l.122)** The Control UI's "Inference" check has no RunRecord field. The PRD's "Ready" maps to `readyz`, which is an assumption.
- **A16 (l.620 R1)** Report authority for device-token connections: `hasUpdateReportOwnerAuthority` needs `system` (shared token/password) or profile `gateway-owner`. A device-token operator gets `gateway-owner` only when no `gateway.roles` are configured (`github-user-identity-D1LIz6kl.mjs:214-216`). Only a manual check can settle it; gating on preview success covers it.
