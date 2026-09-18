# QA checklist — PRD 03 Background tasks
Source: docs/prd/03-background-tasks.md · Engineer: Eng 2 · Milestones: 03-a, 03-b, 03-c, 03-d (in sprint) · 03-e held (out of sprint)
Legend: **[U]** unit test (vitest, src/lib/__tests__) · **[R]** code review · **[M]** manual app check (desktop + 390px phone)
Fixtures: `src/lib/__tests__/fixtures/sprint/backgroundTasks.ts` (real 2026.9.4 shapes) · gating lists: `fixtures/sprint/helloFeatures.ts`

## A. Pure model — `src/lib/tasks.ts` (03-a)
- [ ] **03-M.1** [U] Given `TASK_SUBAGENT_RUNNING` (number timestamps) and `TASK_ACP_STRING_TIMES` (ISO string timestamps), when `parseTask` runs, then both produce the same numeric-ms `createdAt/updatedAt/startedAt/endedAt` semantics. _(PRD §9 L543-544)_
- [ ] **03-M.2** [U] Given `TASK_UNKNOWN_KIND_MINIMAL` (no title, kind `podcast_generation`, runtime `workflow`), when parsed, then title is "Background task" and the unknown `kind`/`runtime` values are kept verbatim (not dropped, not coerced). _(PRD §9 L545-546; L79)_
- [ ] **03-M.3** [U] Given a list payload with a non-object entry or an entry without `id`, when `parseTaskList` runs, then that entry is skipped and the rest parse. _(PRD §8.1 L475)_
- [ ] **03-M.4** [U] `taskState` returns exactly: queued→"Queued"/working; running→"Running"/working; completed+`terminalOutcome:"blocked"`+`deliveryStatus:"failed"`→"Needs you"/needsYou; completed otherwise (incl. `TASK_BLOCKED_DISMISSED`, blocked+delivered)→"Done"/done; failed→"Failed"/failed; timed_out→"Timed out"/failed; cancelled→"Stopped"/idle. _(PRD §5.5 L291-298, §9 L547)_
- [ ] **03-M.5** [U] Script states: running→"Running"/working; exit 0→"Done"/done; exit≠0 (e.g. `JOB_DONE_FAIL` exit 2)→"Failed · exit 2"/failed; details gone→"Ended"/idle. `fromScriptJob` covers running, exit 0, exit ≠0, expired. _(PRD §5.5 L299, §9 L562-563)_
- [ ] **03-M.6** [U] `isNeedsYou` is true only for `terminalOutcome==="blocked" && deliveryStatus==="failed"`; false for `dismissed`, `pending`, `delivered`, and for a 2026.6.5 task with neither field. _(PRD §9 L548-549; FR-5 L422)_
- [ ] **03-M.7** [U] `kindLabel`/`kindIcon`: subagent→Subagent/`GitFork`; exec→"Background command"/`SquareTerminal`; automation_run and cron→Automation/`Clock`; image_generation/music_generation/video_generation→Image/Music/Video with `Image`/`Music`/`Clapperboard`; context_engine_turn_maintenance→Maintenance/`Wrench`; acp→"Coding agent"/`Bot`; cli→"CLI run"/`Terminal`; script job→Script/`Terminal`; unknown kind→falls back to runtime label, then "Task". _(PRD §5.5 L303-314, §9 L550)_
- [ ] **03-M.8** [U] `orderTasks`: running+queued first, oldest `startedAt` first (queued with no `startedAt` handled deterministically); then needs-you; then the rest by `endedAt` desc; ties broken by id. Input is gateway order (updatedAt desc, e.g. `LIST_SESSION_RESULT`) and output must NOT depend on input order. _(PRD §5.4 L277, §9 L551)_
- [ ] **03-M.9** [U] `stripItems({tasks, jobs, now, openedAtMs, hidden})` with `now=NOW`: keeps all queued/running and needs-you; keeps `TASK_IMAGE_FAILED` (failed 2 h ago), drops `TASK_TIMED_OUT_OLD` (30 h); keeps `TASK_SUBAGENT_DONE` (4 min) and `TASK_CANCELLED` (1 min), drops `TASK_DONE_STALE` (25 min) unless `endedAt >= openedAtMs`. _(PRD §5.4 L279-282, FR-9 L439-441, §9 L552-555)_
- [ ] **03-M.10** [U] `stripItems` drops ids in `hidden` for finished items, but a needs-you id in `hidden` is still returned. _(PRD §5.4 L284, §9 L556)_
- [ ] **03-M.11** [U] `stripItems` merges script jobs (transcript refs + `jobs.list` sessionKey match) and dedupes by jobId; `JOB_OTHER_SESSION` is excluded. _(PRD §9 L557; FR-8 L435)_
- [ ] **03-M.12** [U] `dashboardItems`: running, needs-you and failed-in-last-24 h across all agents; max 5 rows returned for the section; empty array when none. _(PRD §5.4 L285-287)_
- [ ] **03-M.13** [U] `summaryLine`: "{n} running · {m} needs you · {k} failed · {j} done" in that order, zero parts omitted (e.g. only "2 running · 3 done"). _(PRD §5.2 L164, §9 L558)_
- [ ] **03-M.14** [U] `worstTone`: failed > needsYou > working > done > idle. _(PRD §9 L559, §5.2 L165)_
- [ ] **03-M.15** [U] `taskMatchesSession(task, CHAT_KEY)` is true via requester (`sessionKey`), `childSessionKey` and `ownerKey` (`TASK_OWNER_MATCH_ONLY`); false for `TASK_AUTOMATION_RUNNING` (other chat). _(PRD §9 L560)_
- [ ] **03-M.16** [R] `lib/tasks.ts` is pure: no imports of stores, `gatewayClient`, React, or `Date.now()` (time is a parameter). _(PRD §8.1 L475)_

## B. Store — `src/store/tasks.ts`, `store/scriptJobs.ts`, `store/taskHistory.ts`
- [ ] **03-FR1.a** [U/R] Given a connection whose features advertise `tasks.list` and scopes include read, when `start()` runs, then exactly two calls go out: `tasks.list {status:["queued","running"], limit:500}` and `tasks.list {status:["completed","failed","timed_out","cancelled"], sortBy:"endedAt", limit:100}` (compare against `LIST_PARAMS_ACTIVE`/`LIST_PARAMS_RECENT`). _(FR-1 L410)_
- [ ] **03-FR1.b** [U/R] Given `start()` is called on every (re)connect, then the `task` listener (via `gatewayClient.on`) is registered once for the app lifetime (no duplicate handler after N reconnects) and the lists reload on each connect. _(FR-1 L410; §8.2 L495, L502)_
- [ ] **03-FR1.c** [R] `sortBy` is only sent when the gateway supports it (≥2026.8); against a 2026.7 gateway the closed schema rejects unknown values → `invalid tasks.list params: …`. Either omit `sortBy` when unsupported or fall back on that error. _(Contract; src-7tzZ8j12.mjs:1722)_
- [ ] **03-FR2.a** [U] Given chat S opens, when the strip mounts, then `tasks.list {sessionKey:S, limit:100}` runs and its task ids are stored in `sessionIndex[S]`. _(FR-2 L412)_
- [ ] **03-FR2.b** [U] Race: two overlapping `loadSession(S)` calls resolve out of order; the older response does not overwrite the newer (per-key sequence, as `store/progressCards.ts`). _(§8.2 L507)_
- [ ] **03-FR3.a** [U] Given T running in the strip, when `EVT_UPSERT_COMPLETED` is ingested, then `byId[T]` is replaced by the new snapshot and the pill reads "Done" with no `tasks.list` call. _(FR-3 L415)_
- [ ] **03-FR3.b** [U] Given `EVT_UPSERT_NEW_CHILD_MATCH` (childSessionKey = open chat), then it joins that chat's index; a task whose only match is `ownerKey` also joins (see Ambiguity 5). _(FR-3 L416; §8.2 L498, L505)_
- [ ] **03-FR3.c** [U] Given `tasks.get` loaded `prompt`/`result` for T, when an upsert for T (which never carries `prompt`/`result`) arrives, then the drawer still shows the previously loaded Prompt/Result (upsert must not blank them). _(Contract: task-summary-Cb8eETle.mjs:117-118; server-runtime-subscriptions-dSZ219Ld.mjs:1615)_
- [ ] **03-FR3.d** [U] `EVT_DELETED` removes the id from `byId` and every `sessionIndex` entry; an open drawer on that id switches to d.gone. _(§8.2 L499; §5.6 L328)_
- [ ] **03-FR4.a** [U] `EVT_RESTORED` triggers `loadGlobal()` (both lists) plus `loadSession(key)` for every open chat key. _(FR-4 L419; §8.2 L500)_
- [ ] **03-FR4.b** [U] (fake timers) While any queued/running task exists, the active list reloads every 60 s; with none, no timer fires; timer cleared on disconnect. _(FR-4 L420; §8.2 L501)_
- [ ] **03-FR4.c** [U] Without `hasEvent('task')` (e.g. `FEATURES_2026_6_5`), a 15 s poll runs only while the strip or drawer is visible. _(§8.3 L514)_
- [ ] **03-FR6.a** [U] Retry sends `tasks.retry {taskIds:[T]}` (exactly one id); `results[0].ok` → row updated from `results[0].task`; `ok:false` → d.retryFail with `reason` (e.g. `RETRY_NOT_BLOCKED` → "Couldn't retry: completion delivery is not blocked"). _(FR-6 L425)_
- [ ] **03-FR6.b** [U] Dismiss sends `tasks.dismiss {taskIds:[T]}`; `DISMISS_OK` → row becomes "Done" (deliveryStatus `dismissed`, terminalOutcome still `blocked`); `ok:false` shows the reason inline. _(FR-6 L426)_
- [ ] **03-FR7.a** [U/M] Stop on a running gateway task with write scope: button text "Stopping…" and disabled until `tasks.cancel` resolves; `CANCEL_OK` → "Stopped". _(FR-7 L429-430)_
- [ ] **03-FR7.b** [U] `CANCEL_ALREADY_TERMINAL` → "Couldn't stop it: Task is already terminal."; `CANCEL_DENIED_NO_REASON` (no `reason`) → a non-"undefined" fallback text. _(FR-7 L431; Ambiguity 31)_
- [ ] **03-FR7.c** [R] Stop for a script job calls `jobs.stop {jobId}` (existing `stopJob`), not `tasks.cancel`. _(FR-7 L432)_
- [ ] **03-FR7.d** [R] `tasks.cancel` request uses a timeout long enough for the gateway's wait-until-settled (default `request()` timeout is 30 s); a client timeout surfaces as d.stopFail, not an unhandled rejection. _(Contract; §2.2 L69)_
- [ ] **03-SJ.1** [R] One app-wide `jobs.list` poll (3 s) in `store/scriptJobs.ts`, running only while a consumer needs it and `hasMethod('jobs.list')`; the separate polls in ScriptJobDock and ScriptsSection are gone. `subscribeJob` (1.5 s `jobs.get`) stays in `lib/scriptJobs.ts`. _(§8.1 L479; §8.4 L525)_
- [ ] **03-TH.1** [U] `taskHistory.load(T)` sends `tasks.history {taskId:T, limit:50}`; `loadEarlier()` sends the stored `nextCursor`; older pages are prepended; `nextCursor` absent → "Load earlier" hidden. _(FR-10 L444-445; §5.3 L249)_
- [ ] **03-TH.2** [U] `refreshHead()` is throttled to ≤1 call per 2 s, only while the drawer shows that task, triggered by an `upserted` event for that task; the merge dedupes by `messageId`/`__openclaw.id` (`HISTORY_PAGE_HEAD_REFRESH` overlaps the head by 2 entries → no duplicates). _(§5.3 L250; §8.4 L524; Contract)_
- [ ] **03-TH.3** [U] Loaded pages are cached per task until the drawer closes; reopening after close re-fetches. _(§8.4 L523)_
- [ ] **03-TH.4** [R] Output auto-scrolls to bottom only when the user was already at the bottom. _(§5.3 L251)_

## C. Background strip — `BackgroundStrip.tsx` / `TaskRow.tsx` (03-a)
- [ ] **03-S.1** [R] `ChatView` renders `BackgroundStrip` inside PRD 01 `StripBar` next to Progress, in ScriptJobDock's former slot; `ScriptJobDock.tsx` is deleted and no longer imported. _(§5.1 L153; FR-8 L436; §8.1 L483-484)_
- [ ] **03-S.2** [M] Collapsed line: chevron, "Background", headline (03-M.13), state pips (`trailing`), mono count of running items. _(§5.2 L162-164)_
- [ ] **03-S.3** [U/M] Collapsed tone = `worstTone` of listed items via `stateTone`. _(§5.2 L165)_
- [ ] **03-S.4** [M] No `ProgressTrack` when collapsed, except when the only item is a script job with a percentage. _(§5.2 L166; Ambiguity 35)_
- [ ] **03-S.5** [U/M] Strip renders nothing when `stripItems` is empty, and renders nothing before the first list arrives (no empty flash). _(§5.2 L167; FR-9 L439; §5.6 L321)_
- [ ] **03-S.6** [M] Open state: in place, max-height 40vh, scrolls; one `TaskRow` per item in `orderTasks` order. _(§5.2 L169)_
- [ ] **03-S.7** [M] Row: 13px kind icon, truncating title, meta line in `--text-secondary` "{Kind} · {agent} · {elapsed} · {n} tools · now: {tool}" (parts omitted when absent), changes "+{added} −{removed} in {files} files" when `diffStat` present, status `Pill`. _(§5.2 L170-173; §5.7 L341-342)_
- [ ] **03-S.8** [M] Row actions: Stop for running; Retry delivery + Dismiss delivery for needs-you; × (title "Hide") for finished; clicking the row body opens the drawer. _(§5.2 L174-179)_
- [ ] **03-S.9** [M] Needs-you row shows "Completed, but the result couldn't be delivered back" and, above the buttons, "Retrying may post the result twice." — inline, no confirm dialog, no toast. _(§5.2 L192-200; FR-5 L422; §5.7 L343-344)_
- [ ] **03-S.10** [U] × writes the id to localStorage key `joaxclaw-background-hidden` per session key (capped 200 ids); hidden persists across reload. _(§5.4 L284; §8.6 L535)_
- [ ] **03-S.11** [M] Script row: "Script · {elapsed}", `ProgressTrack` with % when `percent` is set; running script is accent-coloured, not amber; no amber dock border. _(FR-8 L437; §5.5 L301; §6 L405)_
- [ ] **03-S.12** [M] Script row recovery: reload the app while a script runs → it reappears via `jobs.list` sessionKey. _(§9 L587; §8.2 L506)_
- [ ] **03-S.13** [R] `ScriptJobCard` (thread) uses accent for running and `ProgressTrack`; header click opens the drawer on that job. _(§8.1 L485; §5.5 L301)_

## D. Task drawer — `TaskDrawer.tsx` (03-b)
- [ ] **03-D.1** [R] Mounted in `App.tsx` next to `FileDrawer` on PRD 01 `SidePanel` (380px). _(§5.1 L154; §8.1 L487)_
- [ ] **03-FR16.a** [U/M] Opening the task drawer closes Files, and opening Files closes the task drawer. _(FR-16 L467; §5.1 L154)_
- [ ] **03-D.2** [M] Header: ← (list mode only), title, ⤢, ✕; sub-line `(Pill) · {Kind} · {elapsed}`. Meta rows "Agent", "Started" (HH:MM:SS local), "Tools" ("14 · last web_fetch"), "Changes" ("3 files · +120 −8"), "Delivery". _(§5.3 L225-235; §5.7 L349)_
- [ ] **03-D.3** [U] Delivery label map: pending→"Pending", delivered→"Delivered", session_queued→"Queued in chat", failed→"Couldn't deliver", dismissed→"Dismissed", parent_missing→"Chat is gone", not_applicable or absent→"—". _(§5.7 L350)_
- [ ] **03-D.4** [M] Tabs via `FilterTab`: "Output · Prompt · Result". _(§5.3 L236; §5.7 L351)_
- [ ] **03-FR10.a** [U/M] `hasTranscript:true` + `hasMethod('tasks.history')` → `tasks.history {taskId, limit:50}` on open; messages render through `UserMessage`/`AssistantMessage` read-only with tool calls (toolCall/arguments + toolResult rows attached) via the shared `toChatMessages`. _(FR-10 L444; §5.3 L248)_
- [ ] **03-D.5** [M] Output loading shows `Loader2` + "Loading output…"; an empty page shows "No output yet."; "Load earlier" pages back. _(§5.6 L322; §5.7 L352-354)_
- [ ] **03-FR11.a** [U/M] `hasMethod('tasks.history')` false (`featuresWithout(['tasks.history'])`, or 2026.8) → Output tab hidden, note "Live output needs OpenClaw 2026.9 or later.", Prompt/Result still shown. _(FR-11 L448; §5.6 L324)_
- [ ] **03-FR11.b** [U/M] `hasTranscript:false` (`TASK_MAINTENANCE_NO_TRANSCRIPT`) or `ERR_HISTORY_NO_TRANSCRIPT` → "This task didn't keep its output." plus `terminalSummary`/`progressSummary`; no `tasks.history` call when `hasTranscript:false`. _(FR-11 L449; §5.6 L327; §8.5 L529)_
- [ ] **03-D.6** [U] `ERR_HISTORY_UNAVAILABLE` ("Unable to load this task's transcript…") shows an inline error with retry, NOT d.noTranscript. `ERR_HISTORY_BAD_CURSOR` restarts from the head. _(Contract; Ambiguity 17)_
- [ ] **03-D.7** [U] R2: when every message of a page is dropped by `toChatMessages` (`HISTORY_HARNESS_UNKNOWN_SHAPE`), Output shows d.noTranscript. _(§11 R2 L615)_
- [ ] **03-D.8** [M] Prompt tab renders `tasks.get` `prompt` as Markdown; Result tab renders `result ?? terminalSummary ?? progressSummary` as Markdown; both handle absent values (`GET_RESULT_NO_PROMPT`) and 4000-char values (`GET_RESULT_OVERSIZE`). _(§5.3 L254-255)_
- [ ] **03-D.9** [U/M] `ERR_GET_NOT_FOUND` ("task not found: <id>") or `ERR_HISTORY_NOT_FOUND` ("Task not found.") or a `deleted` event → "This task is no longer available." and all actions hidden. _(§5.6 L328; §8.5 L528)_
- [ ] **03-D.10** [M] Actions row: "Open its chat", "Copy result" (→ "Copied" for 1.2 s), "Stop" (running + write), "Retry delivery"/"Dismiss delivery" (needs-you only). _(§5.3 L257-261; §5.7 L348)_
- [ ] **03-D.11** [U/R] "Open its chat" uses `childSessionKey` for a subagent, otherwise the requester `sessionKey`, via `loadSessionMessages(key)` then `selectConversation`. _(§5.3 L258)_
- [ ] **03-D.12** [M] Script job in the drawer: same header; meta rows "Command", "Working dir", "Exit code"; Output = `jobs.get` tail in the existing `<pre>` style; Prompt/Result tabs hidden. _(§5.3 L263-266)_
- [ ] **03-D.13** [M] List mode (from Dashboard "See all →" or tray): header "Background tasks"; `FilterTab`s "Running · Needs you · Failed · All"; agent `Popover` with "All agents"; `TaskRow`s; "Load more" paging; row → detail with ← back to list. _(§5.3 L268-272; §5.7 L359-364)_
- [ ] **03-D.14** [M] List-mode empty: `EmptyState` with `Layers` icon, "No background work. Tasks your agents start appear here." _(§5.6 L320; §5.7 L362)_
- [ ] **03-D.15** [U/M] List-mode `tasks.list` failure: inline `--danger` line "Couldn't load background tasks: {message}" with Retry, where {message} is `gatewayError.message` (not the JSON-stringified `Error.message`). _(§5.6 L322; §5.7 L363)_
- [ ] **03-FR15.a** [U] "Load more" gets `ERR_LIST_CURSOR_EXPIRED` → reload from the start once, silently (a second failure shows l.error). _(FR-15 L464)_
- [ ] **03-FR15.b** [U] `ERR_LIST_UNSTABLE` (`UNAVAILABLE`, `retryAfterMs:250`) → one retry after 250 ms, read from `err.gatewayError.retryAfterMs`. _(FR-15 L465)_

## E. Dashboard (03-c)
- [ ] **03-FR12.a** [M] `ScriptsSection` replaced by `BackgroundSection` in both slots (desktop right panel second, `DashboardView.tsx` ~L888; phone list ~L967) using `SectionHead`, `MobileCard`, `SeeAll`; label "Background". _(§5.1 L155; §6 L402; §5.7 L365)_
- [ ] **03-FR12.b** [U/M] 2 running tasks on two agents + 1 running script → 3 rows; "See all →" opens the drawer in list mode. _(FR-12 L452)_
- [ ] **03-FR12.c** [U/M] Nothing running/needs-you/failed-in-24 h → section returns `null` (hidden), also hidden until first load. _(FR-12 L453; §5.4 L287; §5.6 L322)_

## F. Tray (03-c)
- [ ] **03-FR13.a** [M] 3 running/queued tasks → tray menu line "⏳  3 background tasks running" (two spaces after the emoji, like existing lines), click → shows window, navigates to Dashboard and opens drawer list mode. _(FR-13 L456; §5.7 L367; §5.9 L391)_
- [ ] **03-FR13.b** [M] 0 → "⏳  No background tasks running", disabled. _(§5.6 L320; §5.7 L367)_
- [ ] **03-FR13.c** [R] Tooltip: "JoaxClaw — {agents}, {teams}, {tasks} running", zero parts omitted, "JoaxClaw" alone when all zero; e.g. "JoaxClaw — 3 tasks running". _(FR-13 L456; §5.7 L368)_
- [ ] **03-FR13.d** [R] `tray:update` payload gains `tasks` and `needsYou` (main + preload), clamped ≥0; App pushes only when the `lastTray` key changes. _(FR-13 L457; §8.1 L487-488)_

## G. Push deep link (03-c)
- [ ] **03-FR14.a** [R] `public/sw.js` stores `tag: payload.tag` in notification `data` and forwards `tag` in the `joax-navigate` message; `main.tsx` calls `pushToNavigate({url, tag})`. _(§5.9 L384)_
- [ ] **03-FR14.b** [U] `pushToNavigate` over `PUSH_NAV_EXPECTATIONS`: tag `^openclaw-task-failed-(.+)$` → `taskId`; `chat/main` → `agent:main:main`; `chat/main/dashboard/4f1c` → `agent:main:dashboard:4f1c`; `~key/` form; percent-decoding and `~~`/`~dot`/`~dotdot` decoding; `#gatewayUrl=` fragment ignored; `automations` → crons; `ask/<id>` → chat; non-task tag ignored; `approve/…` → undefined. _(§5.9 L385-388; §9 L565-574)_
- [ ] **03-FR14.c** [U] `pushUrlToNavigate` remains as a wrapper with identical results for existing cases. _(§8.1 L476)_
- [ ] **03-FR14.d** [M] Phone PWA: tap a background-task-failed push → Chat, session `agent:main:dashboard:…` loaded, drawer open on that task (cold start works because the drawer loads `tasks.get`). _(FR-14 L460; §5.9 L389; §9 L594)_
- [ ] **03-FR14.e** [U/M] Tag only (or url `tasks`) → drawer opens on the task; no conversation switch. _(FR-14 L461; Ambiguity 19)_
- [ ] **03-FR14.f** [R] No local (tier-1) notification is added for task failure. _(§5.9 L390)_

## H. Every state (§5.6)
- [ ] **03-ST.1** [M] Offline/reconnecting: strip keeps last rows, action buttons disabled with title "Reconnect to manage tasks"; on reconnect the full list reloads. _(§5.6 L323; §5.7 L369)_
- [ ] **03-ST.2** [U/M] Gateway without `tasks.retry`/`tasks.dismiss` (`FEATURES_2026_6_5`): needs-you label shows, no buttons. _(§5.6 L325)_
- [ ] **03-ST.3** [U/M] Gateway without `tasks.list`: gateway tasks hidden everywhere; strip still shows script jobs. _(§5.6 L326; §10 L602)_
- [ ] **03-ST.4** [U/M] Read-only connection (no `operator.write`): no Stop/Retry/Dismiss anywhere; rows still open the drawer. _(§5.6 L329; §8.3; §9 L597)_
- [ ] **03-ST.5** [U] No joaxclaw-fs (`jobs.list` not advertised): no script rows, no notice. _(§5.6 L330)_
- [ ] **03-ST.6** [M] Remote gateway behaves identically (all over WS). _(§5.6 L331)_
- [ ] **03-ST.7** [M] Kill network 90 s while a task finishes, reconnect → status corrected without app reload. _(§9 L595)_
- [ ] **03-ST.8** [U] `tasks.list` failure keeps last data in the strip (no clear). _(§5.6 L322)_

## I. Accessibility & keyboard
- [ ] **03-A.1** [R] Strip toggle is a button with `aria-expanded`; rows are `<button>`s; row actions are separate buttons with `aria-label` "Stop {title}", "Retry delivery for {title}" (and Dismiss/Hide equivalents). _(§5.8 L377)_
- [ ] **03-A.2** [R] Pill always includes the text label. _(§5.8 L378)_
- [ ] **03-A.3** [R/M] Drawer: `role="complementary"`, `aria-label="Background task"`; Escape closes; focus moves to heading on open and back to the originating row on close. _(§5.8 L379)_
- [ ] **03-A.4** [R] Output is not in a live region; status changes go through an `aria-live="polite"` region in the drawer header. _(§5.8 L380)_
- [ ] **03-A.5** [R] Running icons use `animate-pulse-dot`; reduced motion respected. _(§5.8 L381; 03-d)_

## J. Phone (<768px) (03-d)
- [ ] **03-P.1** [M] Strip becomes a chip in PRD 01's chip row, e.g. "Background 2 · 1 ⚠", with worst-state tint; tap → `BottomSheet` with the same rows. _(§5.2 L202; Ambiguity 2)_
- [ ] **03-P.2** [M] Tapping a row opens the drawer full screen (`position:fixed; inset:0`) over the sheet. _(§5.2 L202; §5.3 L274)_
- [ ] **03-P.3** [M] 390px: tap targets ≥40px; no horizontal scroll; needs-you buttons wrap. _(§9 L598)_

## K. Capability gating (§8.3)
- [ ] **03-G.1** [U] Every surface gated on `hasMethod('tasks.list')` + read scope; live updates on `hasEvent('task')`; Output on `hasMethod('tasks.history')`; Stop on write + `hasMethod('tasks.cancel')`; Retry/Dismiss on write + `hasMethod('tasks.retry')`/`('tasks.dismiss')`; scripts on `hasMethod('jobs.list')`. Test with `FEATURES_2026_9_4`, `FEATURES_2026_6_5`, `featuresWithout([...])`. _(§8.3 L513-518)_
- [ ] **03-G.2** [R] No method is called to probe support (gating by hello-ok, not by catching "unknown method"). _(PRD 01)_

## L. Required tests exist (§9)
- [ ] **03-T.1** [R] `src/lib/__tests__/tasks.test.ts` covers every bullet of §9 L541-560. 
- [ ] **03-T.2** [R] `scriptJobs.test.ts` extended with `fromScriptJob` (4 cases). _(L562-563)_
- [ ] **03-T.3** [R] `webPush.test.ts` extended with `pushToNavigate` (all L565-574 cases, plus `#gatewayUrl=` fragment). 
- [ ] **03-T.4** [R] `chatHistory.test.ts` pins `toChatMessages` (role filter, toolCall + toolResult attachment, bare `<think>` drop) and `store/chat.ts` imports it from `lib/chatHistory.ts`. _(L576; §8.1 L477; R4)_

## M. Suggested tasks — 03-e (held, out of sprint)
- [ ] **03-SUG.1** [R] *(held, out of sprint)* `store/taskSuggestions.ts` loads `taskSuggestions.list {sessionKey?}` and applies `task.suggestion` `created`/`resolved`, gated on `hasMethod('taskSuggestions.list')` + `hasEvent('task.suggestion')`. _(§8.3 L519; §12 L627)_
- [ ] **03-SUG.2** [M] *(held, out of sprint)* Card: "Suggested task", "Start in a new chat" (→ `taskSuggestions.accept {taskId, mode:"local"}`), "Copy prompt", "Dismiss" (→ `taskSuggestions.dismiss {taskId}`); without admin: "Starting it needs admin access. Copy the prompt into a new chat instead." _(§5.7 L370-372; §2.2 fact 4)_
- [ ] **03-SUG.3** [R] *(held, out of sprint)* Nothing from 03-e ships in 03-a..03-d (no store, no card, no `taskSuggestions.*` calls).

## N. Gateway contract (per 2026.9.4 source; implementation must honour)
- [ ] **03-C.1** [R] Scopes: `tasks.list/get/history` = `operator.read`; `tasks.cancel/retry/dismiss` = `operator.write`; `taskSuggestions.list` read, `.create/.dismiss` write, `.accept` admin. Events `task`/`task.suggestion` need read (write also passes). All advertised (none `advertise:false`). (method-scopes-tKV11oMS.mjs:859-900, 2454-2465, 2926-2931; server-start-DzfvczE1.mjs:2977-2978)
- [ ] **03-C.2** [R] Params are closed objects: unknown keys → `INVALID_REQUEST "invalid <method> params: …"`. `tasks.list.limit` 1..500, `tasks.history.limit` 1..200, `tasks.retry/dismiss.taskIds` 1..10. (src-7tzZ8j12.mjs:1713-1765)
- [ ] **03-C.3** [R] Status filter uses ledger names (`completed`, not `succeeded`); `failed` also returns internally-`lost` tasks. (tasks-D9hXEMUl.mjs:133-144)
- [ ] **03-C.4** [R] `tasks.list` default order is `updatedAt` DESC (ties by id); the app re-sorts for display. (task-registry-BgL80S2s.mjs:826-831)
- [ ] **03-C.5** [R] The `task` event carries full summaries (snapshots), deduped server-side (identical summary not re-sent); never `prompt`/`result`; `deleted` carries only `taskId`; `restored` carries nothing; `dropIfSlow`; session-targeted only as a visibility filter (not subscription-gated). (server-runtime-subscriptions-dSZ219Ld.mjs:1608-1647; server-start-DzfvczE1.mjs:3163-3165)
- [ ] **03-C.6** [R] `tasks.cancel` never errors for not-found/denied: it answers `ok:true` with `{found:false, cancelled:false, reason?}`; `reason` can be absent. (tasks-D9hXEMUl.mjs:310-331)
- [ ] **03-C.7** [R] `tasks.retry` `duplicateRisk` is present only when a suspended delivery was re-driven; the in-progress path returns `ok:true` without it. UI warns before Retry regardless. (subagent-completion-delivery-D_jYLxNd.mjs:157-203)
- [ ] **03-C.8** [R] `tasks.dismiss` leaves `terminalOutcome:"blocked"` and sets `deliveryStatus:"dismissed"` → Done. (subagent-completion-delivery-D_jYLxNd.mjs:212-221)
- [ ] **03-C.9** [R] Not-found texts differ: `tasks.get` → "task not found: <id>"; `tasks.history` → "Task not found." (both INVALID_REQUEST); match both case-insensitively, or better, treat INVALID_REQUEST from get/history on a known id as gone. (tasks-D9hXEMUl.mjs:51, 297)
- [ ] **03-C.10** [R] `tasks.history` cursors are opaque base64url, bound to the task; `nextCursor` goes OLDER from a newest-first first page; messages are chronological within a page; dedupe by `messageId`/`__openclaw.id`. (tasks-D9hXEMUl.mjs:21-40, 69-77; control-ui-boot-shared-BpwdVi0Y.js hx())
- [ ] **03-C.11** [R] `tasks.list` cursor is opaque and invalidated by any registry revision or access revision change; on 2026.6.5 it is a numeric offset and the error is "invalid tasks.list cursor". (tasks-D9hXEMUl.mjs:155-179; tasks-45-fMvsF.js:103)
- [ ] **03-C.12** [R] Failed-task push: `{title, body, tag:"openclaw-task-failed-<id≤80>", renotify:false, url}`, only for `failed`/`timed_out` and runtime ≠ `cron`; `url` = session path relative (no leading slash, no basePath) + optional `#gatewayUrl=<ws url>` fragment, or `"tasks"` when the task has no requester session. (server-start-DzfvczE1.mjs:2034-2046, 2091-2102; control-ui-shared-DqFhbHR8.mjs:11-17)
- [ ] **03-C.13** [R] Gateway rejections arrive in the app as `Error` whose `message` is `JSON.stringify(error)` with the structured `{code, message, details?, retryable?, retryAfterMs?}` on `.gatewayError` — read fields from there. (src/lib/gateway.ts:478-487)
- [ ] **03-C.14** [R] 2026.6.5: `tasks.list/get/cancel` only; no `task` event, no `hasTranscript`, `deliveryStatus`, `terminalOutcome`, `toolUseCount`, `lastToolName`, `prompt`, `result`. UI must not crash on their absence and must not show needs-you. (tasks-45-fMvsF.js:38-151)
- [ ] **03-C.15** [R] `taskSuggestions.dismiss` returns `{taskId, dismissed}`; dismissing a hidden/missing suggestion is `ok:true, dismissed:false`. `accept` default mode is `worktree` — always send `mode:"local"`. (task-suggestions-BfEdNAaD.mjs:475, 563-585)

## O. Regression
- [ ] **03-R.1** [U] Existing `pushUrlToNavigate` tests (automations, ask/, base path, approve declined, bad url) pass unchanged. 
- [ ] **03-R.2** [U] `historyMessages.test.ts` and chat reload tests pass after the `toChatMessages` move; reloaded chats still show tool calls (PR #79 behaviour). _(R4)_
- [ ] **03-R.3** [M] ScriptJobCard in the thread still shows live progress, output tail and Stop.
- [ ] **03-R.4** [M] Tray agent/team lines and their click targets (Chats/Teams) unchanged.
- [ ] **03-R.5** [M] FileDrawer still opens/closes normally when no task drawer is involved.
- [ ] **03-R.6** [M] Progress strip (PRD 01/`ProgressCardDock`) still renders and only one strip is open at a time.
- [ ] **03-R.7** [R] No new gateway method is called on connect against a 2026.6.5 gateway except `tasks.list` (advertised there); no "unknown method" noise in the connection log.
- [ ] **03-R.8** [U] `defaultPushPrefs().categories.backgroundTaskFailed` stays `true`.
- [ ] **03-R.9** [R] `npm run typecheck`/lint/vitest green.

## Ambiguities / untestable
1. L164 vs L298: headline has no bucket for cancelled ("Stopped") items, yet they are listed in the strip (L282) — are they counted anywhere?
2. L202 chip "Background 2 · 1 ⚠" vs copy s.chip L340 "Background {n}" — the needs-you part has no copy id.
3. L191-192 diagram shows a needs-you row of kind "Automation", but the needs-you rule only occurs for subagent completion deliveries (L87; source subagent-completion-*).
4. L216-217 phone sheet uses "Retrying may post it twice." and "[Dismiss]" vs L344 "Retrying may post the result twice." and L346 "Dismiss delivery".
5. L278 (and L505) match strip items by sessionKey/childSessionKey/ownerKey, but FR-3 L416 and §8.2 L498 index events only by sessionKey/childSessionKey.
6. L282/FR-9 L441 "ended while this chat was open" — `openedAtMs` semantics undefined (per mount? per app session? reset when switching chats?).
7. L367 "{n} background task(s) running" vs FR-13 L456 "⏳ 3 background tasks running" (one space; existing lines use two). Pluralisation rule for 1 not stated beyond "(s)".
8. FR-13 L456 "3 running or queued tasks plus running scripts" → "3": unclear whether scripts are counted in {n}.
9. G4 L126 and §8.1 L488 add a `needsYou` tray count with no UI/copy in §5.7 — untestable as written.
10. FR-1 L410 "run once each" vs L502 "reconnect → start() again → reload" — once per connection, presumably.
11. FR-4 L420 reloads only the active list every 60 s; a task that finished during a dropped event disappears from active but the recent list is not refreshed until `restored`/reconnect.
12. FR-10 L444 gates Output on `hasTranscript:true`; `hasTranscript` is absent on older gateways (2026.6.5), and presumably some 2026.7/2026.8 — behaviour for `undefined` unspecified.
13. §5.3 L175 "Stop for running" — queued tasks are also cancellable (Control UI offers Cancel for Active = queued+running); unspecified for queued.
14. §5.3 L250 head refresh doesn't specify merge/dedupe (source anchors on `messageId`/`__openclaw.id`, src-7tzZ8j12.mjs:1746).
15. L255 Result for subagent/acp = latest progress text (task-summary-Cb8eETle.mjs:118), not necessarily final while running — Result tab may show partial text for a running task.
16. §5.6 L327/§8.5 L529 map only "This task has no readable transcript."; the other `UNAVAILABLE` "Unable to load this task's transcript. Refresh the task and try again." has no specified UI.
17. FR-15 L464: which surface's "Load more" (drawer list mode only?), and whether the Output tab's history cursor error ("Invalid task history cursor. Refresh the task.") gets the same treatment.
18. FR-14 L461 "opens the drawer, with no chat switch" while §5.9 L385 says `pushToNavigate` always returns `section:'chat'` — does the app switch section to Chat without selecting a conversation?
19. §9 L572 "an absolute URL with a base path" — 2026.9.4 never sends one for task pushes (relative path + `#gatewayUrl=` fragment); the fragment case is missing from the test list.
20. L387 `chat/<agentId>` → `agent:<agentId>:main` ignores a custom `session.mainKey` (the gateway uses it at session-key-PQkfotIJ.mjs:82).
21. §5.9 L391: tray uses IPC `app:navigate` with a section string; "gains a `joax:navigate` detail" doesn't say how the IPC payload changes (preload API).
22. §8.6 L535 "capped at 200 ids" — per session key or total?
23. §5.8 L379 focus "returns to the row when it closes" — undefined when opened from a push or tray (no originating row).
24. FR-5 L422 "(amber)" colour words vs the tone system (needsYou) — verify via tone, not colour.
25. §5.2 L166 "a lone script job" — only item in the strip, or only script?
26. FR-12 L452 counts a running script in the Dashboard, but §5.4 L285-286 lists only gateway task buckets; finished/failed scripts on the Dashboard unspecified.
27. §2.2 L69 "It waits until the run settles" + app default 30 s request timeout — the Stopping… end state on timeout isn't specified.
28. FR-7 L431 `cancelled:false` shows `reason`, but `reason` can be absent (access denied) — no fallback copy.
29. Retry is shown for every blocked+failed task, but the gateway only re-drives `suspended` deliveries; a non-suspended blocked delivery returns "completion delivery is not blocked" (subagent-completion-delivery-D_jYLxNd.mjs:164-167). Not reproducible manually on demand.
30. §9 manual steps 1-11 (L579-598) need an isolated gateway profile; step 4 (blocked delivery) and 7 (push on phone) are hard to reproduce deterministically.
