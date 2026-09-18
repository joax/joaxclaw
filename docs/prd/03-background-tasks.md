# PRD 03: Background tasks

| | |
|---|---|
| **Status** | Draft for approval · 18 Sep 2026 |
| **Owner** | PM A |
| **Plan section** | Phase 1 · "Background tasks" |
| **Baseline** | `main` @ 374064e · gateway OpenClaw 2026.9.4 · joaxclaw-fs 0.14.1 |
| **Depends on** | [PRD 01](01-shared-groundwork.md): `Strip`/`StripBar`, `SidePanel`, `Pill`, `stateTone`, `FilterTab`, `EmptyState`, `BottomSheet`, `Popover`/`MenuRow`, `CommandHint`, `hasMethod`/`hasEvent` |
| **Decision (binding)** | One Background strip **replaces** ScriptJobDock. |
| **Effort** | L (about 6 days), 4 PRs. A 5th PR (suggested tasks) is held for an owner decision (§11 Q1). |

---

## 1. Summary

**Problem.** An agent's subagents, background commands, automation runs and media jobs vanish from JoaxClaw once they start. The gateway records every one of them as a *task*: what it is, whether it's running, how it ended, and whether its result got back to the chat. JoaxClaw reads none of it. Script jobs (joaxclaw-fs `script_start`) have their own strip and their own Dashboard section, with their own polling, their own amber "running" colour and their own progress bar.

**Outcome.** Everything running in the background shows in one list, in four places:
- **Chat:** the Background strip, which replaces Scripts, lists this chat's work.
- **Drawer:** a task drawer shows any task's output, prompt and result, with Stop, Retry delivery and Dismiss.
- **Dashboard:** a Background section lists every agent's work.
- **Tray:** the tray counts running tasks.

A failed-task push opens that task. The one thing that "needs you" means exactly one thing: the work finished but its result couldn't be delivered back.

**Solution.**
- A `store/tasks.ts` loads `tasks.list` on connect and stays current from the `task` event. It reloads on `restored`, on reconnect, and every 60 s while anything runs, because the event can be dropped.
- A pure `lib/tasks.ts` does the kind labels, the state tones, the "needs you" rule, the ordering, and merging in script jobs.
- `BackgroundStrip` is built on PRD 01's `Strip` and takes ScriptJobDock's slot.
- `TaskDrawer` is built on `SidePanel` and shows `tasks.history` output. On gateways older than 2026.9 it shows the `tasks.get` prompt and result instead.
- The Dashboard's ScriptsSection becomes BackgroundSection.
- The tray and the push deep link are extended.
- Suggested-task cards are specified, but held back: the gateway never gives JoaxClaw chats the `suggest_task` tool (§2.2, §11 Q1).

## 2. Background and evidence

### 2.1 How the app behaves today

| Behaviour | Evidence |
|---|---|
| ScriptJobDock sits between ProgressCardDock and the thread | `ChatView.tsx:628-631` |
| It finds jobs two ways: from `script_start` results in the transcript (`collectJobRefs`) and by polling `jobs.list` every 3 s for jobs with this `sessionKey`, which is needed because a reloaded transcript loses its tool calls | `ScriptJobDock.tsx:25-40`, `lib/scriptJobs.ts:59-83` |
| Each job is watched by polling `jobs.get` every 1.5 s | `lib/scriptJobs.ts:103-129` |
| A **running** script is coloured amber (`--warning`), and the dock has an amber-tinted border. This conflicts with the rule that accent = working. | `ScriptJobDock.tsx:83, 118`; `ScriptJobCard.tsx:32, 47` |
| The dock draws its own 3px bar instead of `ProgressTrack` | `ScriptJobDock.tsx:174-178` |
| A finished job stays until you dismiss it, but only if the dock saw it running | `ScriptJobDock.tsx:50-76` |
| The joaxclaw-fs host deletes a finished job 10 min after it ends, and `jobs.get` returns at most the last 16 KiB of output | `plugins/joaxclaw-fs/index.js:686-688, 739` |
| The Dashboard's ScriptsSection polls `jobs.list` every 3 s and shows up to 5 running jobs with Stop. It hides when nothing is running. | `DashboardView.tsx:782-829`, placed at `:888` (desktop) and `:967` (phone) |
| The tray shows agent and team counts only, and clicking jumps to Chats or Teams | `electron/main/index.ts:45-88, 461-465`; `App.tsx:138-152` |
| The `backgroundTaskFailed` push category is already on by default in JoaxClaw | `lib/webPush.ts:41, 67` |
| **A tapped push can't open a task.** The service worker forwards only `navigate` and `url`, not `tag` (`public/sw.js:34, 65`). `pushUrlToNavigate` recognises only `automations` and `ask/<id>` (`lib/webPush.ts:200-218`). Its comment says background-task-failed has "no url", but that is out of date (§2.2). | as cited |
| Gateway `chat.history` entries become app messages in `toChatMessages`, which is private to `store/chat.ts:576-610` | as cited |

### 2.2 What the gateway offers (2026.9.4, verified in source)

- **Schemas:** `dist/src-7tzZ8j12.mjs` (`schema/tasks.ts`, `schema/task-suggestions.ts`).
- **Handlers:** `dist/tasks-D9hXEMUl.mjs`, `dist/task-suggestions-BfEdNAaD.mjs`.
- **Summary mapper:** `dist/task-summary-Cb8eETle.mjs`.
- **Scopes:** `dist/method-scopes-tKV11oMS.mjs`.
- **Event emitter:** `dist/server-runtime-subscriptions-dSZ219Ld.mjs`.
- **Event guards:** `EVENT_SCOPE_GUARDS` in `dist/server-start-DzfvczE1.mjs`.

| Method / event | Scope | Since | Params → result | Used for |
|---|---|---|---|---|
| `tasks.list` | read | ≤2026.7 | `{status?: one or [], agentId?, sessionKey?, limit? 1–500 (100), cursor?, sortBy?: updatedAt｜endedAt (2026.8)}` → `{tasks: TaskSummary[], nextCursor?}` | Strip (per session), Dashboard, tray |
| `tasks.get` | read | ≤2026.7 | `{taskId}` → `{task}`, adding `prompt?` and `result?` (≤4000 chars each) | Drawer header; Prompt/Result tabs |
| `tasks.history` | read | **2026.9** | `{taskId, cursor?, limit? 1–200 (100)}` → `{messages, nextCursor?}`. The messages are **the same objects `chat.history` returns** (the handler calls `chat.history` on the task's session). Returns `UNAVAILABLE` "This task has no readable transcript." when there is none. | Drawer Output |
| `tasks.cancel` | write | ≤2026.7 | `{taskId, reason?}` → `{found, cancelled, reason?, task?}`. It **waits** until the run settles as cancelled. | Stop |
| `tasks.retry` | write | 2026.7 | `{taskIds: 1–10}` → `{results: [{taskId, ok, reason?, duplicateRisk?, task?}]}` | Retry delivery |
| `tasks.dismiss` | write | 2026.7 | same params as retry → same result shape | Dismiss delivery |
| `task` (event) | read | — | `{action:"upserted", task}` ｜ `{action:"deleted", taskId}` ｜ `{action:"restored"}`. Sent with **`dropIfSlow: true`** and targeted at the requester session. It is **not** subscription-gated. | Live changes |
| `taskSuggestions.list` / `.dismiss` | read / write | ≤2026.7 | `{sessionKey?, agentId?}` → `{suggestions}`; `{taskId, reason?}` → `{dismissed}` | Suggested-task card |
| `taskSuggestions.accept` | **admin** (every mode) | ≤2026.7 | `{taskId, mode?: worktree｜local｜cloud｜session}` → `{taskId, key}` | "Start in a new chat" |
| `task.suggestion` (event) | read | — | `{action:"created", suggestion}` ｜ `{action:"resolved", taskId, resolution}`, with `dropIfSlow` | Suggested-task card |

**TaskSummary fields:**
- **Identity:** `id`, `kind` (= `taskKind ?? runtime`), `runtime` (`subagent｜acp｜cron｜cli`), `sessionKey` (the requester), `childSessionKey?`, `ownerKey`, `agentId?`, `runId?`, `parentTaskId?`.
- **State:** `status` (`queued｜running｜completed｜failed｜cancelled｜timed_out`; internally `lost` shows as `failed`), `title` (≤80, fallback "Background task"), `hasTranscript`.
- **Times:** `createdAt`, `updatedAt`, `startedAt?`, `endedAt?`.
- **Activity:** `toolUseCount?`, `lastToolName?`, `lastActivity?`, `diffStat? {files, added, removed}`.
- **Summaries:** `progressSummary?`, `terminalSummary?`, `error?`.
- **Delivery:** `deliveryStatus` (`pending｜delivered｜session_queued｜failed｜dismissed｜parent_missing｜not_applicable`), `terminalOutcome?` (`succeeded｜blocked`).
- **`taskKind` values seen:** `exec` (background command), `automation_run`, `image_generation`, `music_generation`, `video_generation`, `context_engine_turn_maintenance`.

**Facts that change the plan:**
1. **"Needs you" is precise.** Retry and Dismiss exist only for blocked subagent completion deliveries. The Control UI shows them when `terminalOutcome==="blocked" && deliveryStatus==="failed"` (`tasks-page-Dwq7IfQJ.js`). This PRD uses exactly that rule.
2. **`duplicateRisk` is not known in advance.** It is returned *by* `tasks.retry`, and it is always `true` after a retry (`subagent-completion-delivery-D_jYLxNd.mjs`). The plan said "warns first when the gateway reports duplicateRisk", which can't be done. We always warn before Retry, as the Control UI does ("Retrying may duplicate a result after an ambiguous acknowledgement.").
3. **JoaxClaw chats never produce suggested tasks.** The `suggest_task` tool is given only when the `chat.send` caller's client id is `control-ui`, `browser-copilot` or `tui`, *and* it has admin, *and* it sent the client cap `task-suggestions` (`chat-send-handler-oS9rX200.mjs` `normalizeChatSendRequest`; `message-channel-MQsF-tJM.mjs` `isOperatorUiClient`; `client-info-5hij-UZJ.mjs`). JoaxClaw connects as `gateway-client` with caps `['tool-events']` (`lib/gateway.ts:285, 339`). Suggestions made in the Control UI or TUI still reach every read-scoped client through `task.suggestion` `created`, because that one isn't session-targeted.
4. **"Start in a new chat" is mode `local`, not `session`.** Mode `session` *steers the suggestion into the source session* (`queueMode:"steer"`). `local` creates a new session labelled with the suggestion's title, and it is what the Control UI and TUI send. Accept needs admin in every mode. Suggestions live in memory only (100 entries or 2 MiB) and are lost on a gateway restart.
5. **The failed-task push has a deep link after all.** It is category `background-task-failed` (for `failed` or `timed_out`, but not cron, which uses `scheduled-task-failed`). Its `tag` is `openclaw-task-failed-<taskId>` (`server-start-DzfvczE1.mjs` `resolveEventWebPushNotification`). Its `url` is the Control UI chat path of the requester session, e.g. `chat/main/dashboard/4f1c…`, built by `buildControlUiSessionPath` in `session-key-PQkfotIJ.mjs`; it falls back to `tasks`. The gateway's default for this category is off, but JoaxClaw turns it on (`lib/webPush.ts:67`).
6. **Paging cursors are fragile.** A `tasks.list` cursor is invalidated by *any* change to the registry, giving `INVALID_REQUEST` "invalid or expired tasks.list cursor; restart pagination without a cursor". A list that is still settling can return `UNAVAILABLE` "Task activity did not stabilize…" with `retryAfterMs: 250`.
7. **Retention.** Terminal tasks are kept for 7 days, `lost` ones for 24 h, and blocked or dismissed deliveries for 7 days (`docs/automation/tasks.md`; `SUSPENDED_RETENTION_MS`).
8. **Visibility.** Results are filtered per caller through session sharing. Admins see everything.

### 2.3 How the Control UI does it
From `control-ui-core-CgyBiPIN.js` and `tasks-page-Dwq7IfQJ.js`.

**Tasks page:**
- Sections "Active" ("Queued and running background work.") and "Recent".
- "No background tasks yet."
- Buttons: Cancel ("Cancelling…"), "Retry delivery", "Dismiss delivery", "Copy result".
- Status text: "Completed, but result delivery is blocked."
- Status labels: Queued · Running · Completed · Failed · Cancelled · Timed out.
- Runtime labels: Subagent · Automation · ACP · CLI · Task.
- It loads Active with `tasks.list {status:[queued,running], limit:500}` and Recent with `{status:[completed,failed,timed_out,cancelled], sortBy:"endedAt", limit:200}`, then applies `task` events on top.
- It colours running as *warn*. We don't (integration rule 3).

**Chat rail "Background tasks":**
- "Running ({n})" / "Finished ({n})", "Stop {title}", "{n} tool uses".
- Task details: "Prompt", "Output", "No output yet.", "Loading task transcript…", "This task is no longer available."

**Suggestion card:** "Suggested task · in {repo}", "Start in a new session", "Copy prompt", "Administrator access is required to start suggested tasks."

### 2.4 Prior art
- **ChatGPT Tasks and Deep Research, Claude background tasks:** background work is announced in the conversation and finishes with a notification that opens its result. Lesson: the push must land on *that* task, not on a list.
- **Cursor background agents:** a sidebar list of agents, each with status, and a detail pane with the transcript and diff. Lesson: list plus detail drawer, with the change summary (`diffStat`) up front.
- **GitHub Actions:** running jobs are ordered by start time, finished ones newest first; the colours are fixed (yellow running, red failed, green passed). Lesson: fixed ordering, and a colour per state used everywhere. We use accent for running to match the app.

## 3. Goals / Non-goals

**Goals**
- G1. One Background strip per chat, listing that chat's gateway tasks and script jobs. It replaces ScriptJobDock.
- G2. A task drawer with output (2026.9+), prompt and result, plus Stop, Retry delivery, Dismiss delivery, Copy result and Open its chat.
- G3. A Dashboard Background section for every agent, replacing ScriptsSection.
- G4. A tray count of running tasks, plus a needs-you count.
- G5. The failed-task push, and the tier-1 in-app path, open that task's drawer in its chat.
- G6. One state-colour scheme across the strip, drawer, Dashboard and tray.

**Non-goals**
- Creating tasks from the UI.
- TaskFlow (`tasks flow *`, CLI only).
- `tasks audit` and `tasks maintenance`, which aren't RPCs.
- Changing the joaxclaw-fs plugin. Its `jobs.*` stay as they are.
- Changing JoaxClaw's client id to unlock `suggest_task` (§11 Q1).
- Keeping script jobs past the host's 10-minute GC.

## 4. Users and jobs

- **U1.** As the user chatting with an agent that spawned a researcher, I want to see it running under the chat header and open its output, so I know it's working and what it found.
- **U2.** As the user, when a result couldn't be delivered back, I want one clear "needs you" with Retry or Dismiss.
- **U3.** As the user, I want to stop a runaway background command from the strip or the Dashboard.
- **U4.** As the user on my phone, when a background task fails, I want the notification to open that task.
- **U5.** As the user on the Dashboard, I want every agent's background work in one place, filterable.
- **U6.** As the user with the app in the tray, I want to see "3 tasks running" without opening it.

## 5. UX specification

### 5.1 Entry points and placement

| Surface | Placement and justification |
|---|---|
| **Background strip** | In ChatView, in ScriptJobDock's slot (`ChatView.tsx:629-631`), inside PRD 01's `StripBar` next to Progress. Rule 1: what the agent reports sits above the thread. Rule 2: the strip shape. |
| **Task drawer** | A `SidePanel` (380px) mounted in `App.tsx` next to `FileDrawer` (`App.tsx:241-245`). Files and Tasks are mutually exclusive: opening one closes the other. On a phone it is full screen. The design brief lists "Drawer: FileDrawer" as the pattern. |
| **Dashboard → Background** | Replaces `ScriptsSection` in the same slots: second in the desktop right panel (`DashboardView.tsx:888`), and in the phone list (`:967`). |
| **Tray** | The existing menu gains one line, "N background tasks running", which opens the Dashboard. The tooltip gains "N tasks". |
| **Push / tier-1** | `backgroundTaskFailed` opens Chat → that session → that task's drawer. |
| Suggested-task card | *(held, §11 Q1)* In the thread, after the assistant message nearest the suggestion's `createdAt`. |

### 5.2 The Background strip

**Collapsed**, one line:
- Chevron, then "Background", then the summary headline, then the state pips (`trailing`), then a mono count of running items.
- Headline: `{n} running · {m} needs you · {k} failed · {j} done`. Zero parts are left out.
- Tone: the worst state wins (failed > needsYou > working > done), via `stateTone`.
- No `ProgressTrack` when collapsed: tasks have no percentage. A lone script job that prints a percentage shows the track.
- **Hidden** when there is nothing to list (§5.4 rule).

**Open, in place, max 40vh.** One `TaskRow` per item, in order (§5.4). A row is laid out as:
- kind icon (13px);
- title (truncates);
- meta line in `text-secondary`: kind · agent · elapsed · `{n} tools` · "now: {lastToolName}" · `+{added} −{removed}`;
- the status `Pill`;
- a row action:
  - Stop for running;
  - Retry delivery and Dismiss delivery for needs-you;
  - × (hide) for finished items.

Clicking the row opens the drawer.

```
Desktop, strip open
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ›  Progress    Compare the three pricing pages                   ▬▬▬▬▬▬────────  2/3    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ⌄  Background  2 running · 1 needs you · 3 done                          ● ● ◐    2     │
│   ⑂ Research competitor pricing                                        (Running) [Stop]  │
│     Subagent · researcher · 3m 12s · 14 tools · now: web_fetch                            │
│   ▭ npm run build                                             ▬▬▬▬──── 41% (Running) [Stop]│
│     Script · 41s                                                                          │
│   ◷ Summarize the inbox                                               (Needs you)        │
│     Automation · Completed, but the result couldn't be delivered back                     │
│     ⚠ Retrying may post the result twice.          [Retry delivery] [Dismiss delivery]  │
│   ⑂ Draft the pricing table                                            (Done)        ✕   │
│     Subagent · researcher · 2m 04s · +120 −8 in 3 files                                   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                                  message thread                                          │
```

The duplicate warning is shown **inline, before** Retry, rather than as a confirm dialog. That matches the no-toasts, inline-feedback rule, and it's what the Control UI does.

**Phone.** The strip becomes a chip in PRD 01's chip row: "Background 2 · 1 ⚠". The chip takes the worst-state tint. Tapping it opens a `BottomSheet` with the same rows. Tapping a row opens the drawer full screen, over the sheet.

```
┌──────────────────────────────────────┐
│ (Plan 2/3) (Background 2 · 1 ⚠)      │
├──────────────────────────────────────┤
tap ↓
┌──────────────────────────────────────┐
│               ───                    │
│  Background                     ✕    │
│  ⑂ Research competitor pricing       │
│    Subagent · 3m 12s   (Running)     │
│                           [Stop]     │
│  ◷ Summarize the inbox  (Needs you)  │
│    ⚠ Retrying may post it twice.     │
│    [Retry delivery] [Dismiss]        │
└──────────────────────────────────────┘
```

### 5.3 The task drawer

**Detail mode**, opened from a row or a push:

```
┌─ SidePanel 380 ─────────────────────────────┐
│ ←  Research competitor pricing        ⤢  ✕  │
│    (Running) · Subagent · 3m 12s            │
├─────────────────────────────────────────────┤
│ Agent      researcher                        │
│ Started    10:42:07                          │
│ Tools      14 · last web_fetch               │
│ Changes    3 files · +120 −8                 │
│ Delivery   Pending                           │
├─────────────────────────────────────────────┤
│ (Output) (Prompt) (Result)                   │  ← FilterTab
│ ▸ web_fetch acme.com/pricing                 │
│   Found 3 tiers: Starter $12, Team $39…      │
│ ▸ web_fetch globex.io/plans                  │
│ ▸ write pricing.md                           │
│              [Load earlier]                  │
├─────────────────────────────────────────────┤
│ [Open its chat]   [Copy result]   [■ Stop]   │
└─────────────────────────────────────────────┘
```

**Output tab:**
- `tasks.history` renders through the existing `UserMessage`/`AssistantMessage` components, read-only, with tools shown.
- It opens on the newest page (`limit: 50`), with "Load earlier" to page back.
- While the task runs, it re-reads the newest page when an `upserted` event arrives for this task, at most every 2 s.
- It auto-scrolls to the bottom only while you're already at the bottom, as the thread does.

**Other tabs:**
- **Prompt:** `tasks.get` `prompt` (≤4000 chars) as Markdown.
- **Result:** `result ?? terminalSummary ?? progressSummary`, as Markdown.

**Actions:**
- **Open its chat:** `childSessionKey` for a subagent, otherwise the requester `sessionKey`, through `loadSessionMessages(key)` (`ChatView.tsx:113-115`), then `selectConversation`.
- **Copy result:** "Copied" for 1.2 s.
- **Stop:** needs write. It becomes "Stopping…" until `tasks.cancel` returns, because the gateway waits for the run to settle.
- **Retry delivery / Dismiss delivery:** for needs-you only.

**Script jobs in the drawer:**
- The same header, with meta rows Command, Working dir, Exit code.
- The Output tab is the `jobs.get` tail in the existing `<pre>` style (`ScriptJobDock.tsx:181-188`).
- Prompt and Result are hidden.

**List mode**, from the Dashboard's "See all →" or the tray:
- The header reads "Background tasks".
- Filter tabs: `FilterTab`s Running · Needs you · Failed · All, plus an agent `Popover` filter.
- Below that, the same `TaskRow`s, then "Load more" (paging).
- Clicking a row opens detail mode, with ← back to the list.

**Phone:** `SidePanel` is `position:fixed; inset:0`, as FileDrawer is (`FileDrawer.tsx:45-46`).

### 5.4 Ordering and what each surface shows (`lib/tasks.ts`)
- **Order.** Running and queued first, oldest start first. Then needs-you. Then everything else, newest `endedAt` first. This is the Control UI's rule, and GitHub's.
- **Strip (this chat).** Tasks whose `sessionKey`, `childSessionKey` or `ownerKey` is this chat's session, from `tasks.list {sessionKey}`, plus this chat's script jobs. It shows:
  - all queued and running items;
  - all needs-you items;
  - failed and timed-out items that ended in the last 24 h;
  - completed and cancelled items that ended in the last 10 min, or while this chat was open.

  Finished items can be hidden with × (local, per session, in localStorage). Needs-you items can't be hidden locally; only Dismiss delivery clears them.
- **Dashboard (every agent).**
  - Running, needs-you, and failed in the last 24 h, up to 5 rows, then "See all →".
  - Hidden when all three are empty. This keeps the Dashboard's rule that empty sections return `null` (`DashboardView.tsx:439, 798`). The plan's empty text ("No background work…") moves to the drawer's list mode.

### 5.5 State tones and labels (one table, used everywhere)

| Condition | Label | Tone (`stateTone`) |
|---|---|---|
| `queued` | Queued | working |
| `running` | Running | working |
| `completed` + blocked + delivery `failed` | Needs you | needsYou |
| `completed` otherwise | Done | done |
| `failed` / `timed_out` | Failed / Timed out | failed |
| `cancelled` | Stopped | idle |
| Script running / exit 0 / exit ≠0 / ended with details gone | Running / Done / Failed · exit {n} / Ended | working / done / failed / idle |

The script "running" state moves from amber to **accent**. This is a deliberate fix (PRD 01 §1). ScriptJobCard in the thread is changed to match, so the inline card and the strip agree.

**Kind labels and icons:**

| Kind | Label | Icon |
|---|---|---|
| subagent | Subagent | `GitFork` |
| `exec` | Background command | `SquareTerminal` |
| `automation_run` / cron | Automation | `Clock` |
| image, music, video | Image / Music / Video | `Image` / `Music` / `Clapperboard` |
| `context_engine_turn_maintenance` | Maintenance | `Wrench` |
| acp | Coding agent | `Bot` |
| cli | CLI run | `Terminal` |
| Script job | Script | `Terminal` |

### 5.6 Every state

| Condition | Behaviour |
|---|---|
| Empty | Strip hidden, Dashboard section hidden, tray line "No background tasks running" (disabled). Drawer list uses `EmptyState` with `Layers`: "No background work. Tasks your agents start appear here." |
| Loading | Strip: nothing until the first list arrives, so it never flashes empty. Drawer Output: `Loader2` with "Loading output…". Dashboard: hidden until loaded. |
| Error | `tasks.list` fails: the strip keeps its last data. The drawer list shows an inline `--danger` line "Couldn't load background tasks: {msg}" with Retry. Cancel with `cancelled:false`: an inline line in the drawer, "Couldn't stop it: {reason}" (the gateway's text, e.g. "Task is already terminal."). Retry `ok:false`: "Couldn't retry: {reason}". |
| Offline / reconnecting | The strip keeps its last known rows, with actions disabled and the title "Reconnect to manage tasks". On reconnect, the full list reloads (the gateway sends no catch-up). |
| Older gateway, <2026.9 (no `tasks.history`) | Drawer has Prompt and Result only, with the note "Live output needs OpenClaw 2026.9 or later." |
| Older gateway, <2026.7 (no `tasks.retry`/`dismiss`) | Needs-you rows show the label but no buttons. |
| Older gateway, no `tasks.list` | Gateway tasks hidden entirely. The strip still shows script jobs, so today's behaviour is kept. |
| No readable transcript (`hasTranscript:false` or `UNAVAILABLE`) | Output shows "This task didn't keep its output." plus `terminalSummary`/`progressSummary`. |
| Task gone (deleted, or past retention) | Drawer shows "This task is no longer available." and hides the actions. |
| Read-only connection | No Stop, Retry or Dismiss. The rows still open. |
| No joaxclaw-fs plugin (`jobs.list` missing) | Script jobs are simply absent. There's no notice: the Files and Teams notices already cover the plugin. |
| Remote vs local | Identical. Everything goes over WS RPC. Script jobs use the plugin's RPCs, which work remote too. |
| Slow connection (events dropped) | The store reloads the list every 60 s while anything is queued or running, and on `restored`. |

### 5.7 Copy

| Id | String |
|---|---|
| s.label | Background |
| s.headline | {n} running · {m} needs you · {k} failed · {j} done |
| s.chip | Background {n} |
| row.meta | {Kind} · {agent} · {elapsed} · {n} tools · now: {tool} |
| row.changes | +{added} −{removed} in {files} files |
| row.needs | Completed, but the result couldn't be delivered back |
| row.dupWarn | Retrying may post the result twice. |
| a.stop / a.stopping | Stop / Stopping… |
| a.retry / a.dismiss | Retry delivery / Dismiss delivery |
| a.hide | Hide *(title of ×)* |
| a.openChat / a.copy / a.copied | Open its chat / Copy result / Copied |
| d.agent / d.started / d.tools / d.changes / d.delivery | Agent / Started / Tools / Changes / Delivery |
| d.delivery.values | Pending · Delivered · Queued in chat · Couldn't deliver · Dismissed · Chat is gone · — |
| d.tabs | Output · Prompt · Result |
| d.loadEarlier | Load earlier |
| d.loading | Loading output… |
| d.noOutput | No output yet. |
| d.noTranscript | This task didn't keep its output. |
| d.oldGateway | Live output needs OpenClaw 2026.9 or later. |
| d.gone | This task is no longer available. |
| d.stopFail / d.retryFail | Couldn't stop it: {reason} / Couldn't retry: {reason} |
| l.title | Background tasks |
| l.filters | Running · Needs you · Failed · All |
| l.allAgents | All agents |
| l.empty | No background work. Tasks your agents start appear here. |
| l.error | Couldn't load background tasks: {message} |
| l.more | Load more |
| dash.label | Background |
| dash.seeAll | See all → *(existing)* |
| tray.some / tray.none | ⏳  {n} background task(s) running / ⏳  No background tasks running |
| tray.tooltip | JoaxClaw — {agents}, {teams}, {tasks} running |
| off.actions | Reconnect to manage tasks |
| sug.title *(held)* | Suggested task |
| sug.start / sug.copy / sug.dismiss | Start in a new chat / Copy prompt / Dismiss |
| sug.noAdmin | Starting it needs admin access. Copy the prompt into a new chat instead. |

The tray line uses an emoji because the existing tray labels do (`electron/main/index.ts:62-68`). Native menus can't render lucide icons.

### 5.8 Keyboard and accessibility
- The strip button has `aria-expanded`. Rows are `<button>`s that open the drawer. Row actions are separate buttons with `aria-label`s: "Stop {title}", "Retry delivery for {title}".
- The status `Pill` includes the label text, so colour is never the only signal.
- The drawer is `role="complementary"` with `aria-label="Background task"`. Escape closes it. Focus moves to its heading when it opens and returns to the row when it closes.
- Output updates are **not** live-announced, to avoid chatter. Status changes are announced in an `aria-live="polite"` region in the drawer header.
- Running icons use `animate-pulse-dot` (reduced motion honoured by PRD 01).

### 5.9 Notifications and deep links
1. **Service worker** (`public/sw.js`): add `tag: payload.tag` to the notification `data`, and forward it in the `joax-navigate` message.
2. **`lib/webPush.ts`**: add a pure `pushToNavigate({ url, tag })`. It returns `{ section:'chat', sessionKey?, taskId? }`:
   - The tag `^openclaw-task-failed-(.+)$` gives `taskId`.
   - The url path `chat/<agentId>[/<segments…>]` gives the session key `agent:<agentId>:<segments joined by ":">`, or `agent:<agentId>:main` when there are no segments. The reverse of `buildControlUiSessionPath`, including the `~key/` form.
   - The existing `automations` and `ask/` mappings are kept.
3. **`App.tsx` `joax:navigate` handler** (`App.tsx:161-170`): accepts `sessionKey` and `taskId`. With a `sessionKey`, it runs `loadSessionMessages(sessionKey)` and then `selectConversation`. With a `taskId`, it runs `useTasksStore.getState().openDrawer(taskId)`. The drawer loads `tasks.get` itself, so a cold start works.
4. **Tier-1**: none. Electron has no notifications (`notificationsSupported()` returns false there), and the PWA gets the gateway push. Adding a local one too would double-notify.
5. **Tray click**: "N background tasks running" sends `app:navigate` with `'dashboard'`, and then the drawer opens in list mode. `onNavigate` currently carries a section string only (`App.tsx:155-158`), so it gains a `joax:navigate` detail with `{ section:'dashboard', tasks:'list' }`.

## 6. Design-book conformance

| Item | Used |
|---|---|
| Strip | PRD 01 `Strip` in `StripBar`: one line, opens in place, hidden when empty, one open at a time, a chip plus `BottomSheet` on a phone |
| Drawer | PRD 01 `SidePanel` (FileDrawer's layout) |
| Pills | PRD 01 `Pill` with `stateTone`. The same labels and colours in the strip, drawer and Dashboard. |
| One bar | `ProgressTrack` for script percentages. ScriptJobDock's and ScriptJobCard's private bars are removed. |
| Filter tabs, empty state, popover | PRD 01 `FilterTab`, `EmptyState`, `Popover` |
| Dashboard section | The existing `SectionHead`, `MobileCard` and `SeeAll` (`DashboardView.tsx:92-122`) |
| Tokens | `--accent`, `--warning`, `--danger`, `--success`, `--text-secondary`, `--bg-elevated`, `--border`, `--bg-primary` (output `<pre>`) |
| Feedback | Inline only: the duplicate warning before Retry, and error lines in the drawer |
| **Changes to existing visuals** | Script running goes from amber to accent. The amber dock border (`ScriptJobDock.tsx:83`) goes away. |
| **New** | Nothing beyond PRD 01's pieces |

## 7. Functional requirements

**FR-1 Load on connect.** Given a 2026.9 gateway with read scope, when the app connects, then `tasks.list {status:[queued,running], limit:500}` and `tasks.list {status:[completed,failed,timed_out,cancelled], sortBy:"endedAt", limit:100}` run once each. The `task` listener is attached once and survives reconnects.

**FR-2 Chat load.** Given a chat with session S opens, when the strip mounts, then `tasks.list {sessionKey:S, limit:100}` runs, and its tasks are indexed under S.

**FR-3 Live upsert.**
- Given the strip shows task T as running, when `task {action:"upserted", task:{id:T, status:"completed"}}` arrives, then T's pill changes to Done without a reload.
- Given an upserted task whose `sessionKey` or `childSessionKey` matches an open chat, then it joins that chat's index.

**FR-4 Restored and drops.**
- Given `task {action:"restored"}`, then both global lists and every open chat's list reload.
- Given any task is queued or running, then the global active list reloads every 60 s.

**FR-5 Needs-you rule.** Given a completed task with `terminalOutcome:"blocked"` and `deliveryStatus:"failed"`, then it is labelled Needs you (amber), shows Retry delivery and Dismiss delivery, and shows the duplicate warning above them.

**FR-6 Retry and dismiss.**
- When the user clicks Retry delivery, then `tasks.retry {taskIds:[T]}` is sent. On `ok`, the row updates from the returned `task`. On `ok:false`, then d.retryFail shows with the `reason`.
- Dismiss delivery behaves the same way with `tasks.dismiss`.

**FR-7 Stop.**
- Given a running gateway task and write scope, when the user clicks Stop, then the button shows Stopping… until `tasks.cancel` returns.
- `cancelled:true` makes the row show Stopped.
- `cancelled:false` shows d.stopFail with `reason`.
- For a script job, Stop calls `jobs.stop` (existing).

**FR-8 Scripts merged.**
- Given a chat launched a script (`script_start` in the transcript, or `jobs.list` `sessionKey` match), then it appears as a Script row in the Background strip.
- ScriptJobDock is no longer rendered.
- The script's percentage uses `ProgressTrack`.

**FR-9 Strip visibility.**
- Given no qualifying items (§5.4), then the strip renders nothing.
- Given a completed task ended more than 10 min ago and the chat was not open then, then it is not listed.

**FR-10 Drawer output (2026.9).**
- Given `hasTranscript:true`, when the drawer opens, then `tasks.history {taskId, limit:50}` runs, and the messages render with tools.
- "Load earlier" pages back with `nextCursor`.

**FR-11 Drawer fallback.**
- Given `hasMethod('tasks.history')` is false, then Output is hidden and the note d.oldGateway shows.
- Given `hasTranscript:false`, then Output shows d.noTranscript.

**FR-12 Dashboard.**
- Given 2 running tasks across agents and 1 script, then Background lists 3 rows, and "See all →" opens the drawer in list mode.
- Given none, then the section is hidden.

**FR-13 Tray.**
- Given 3 running or queued tasks plus running scripts, then the tray menu shows "⏳ 3 background tasks running", and the tooltip includes "3 tasks".
- Counts update only when they change (the existing `lastTray` dedupe, `App.tsx:143-151`).

**FR-14 Push deep link.**
- Given a push with tag `openclaw-task-failed-abc` and url `chat/main/dashboard/4f1c`, when it is tapped, then the app opens Chat, loads session `agent:main:dashboard:4f1c`, and opens the drawer on task `abc`.
- Given only the tag, then it opens the drawer, with no chat switch.

**FR-15 Paging robustness.**
- Given "Load more" returns "invalid or expired tasks.list cursor", then the list reloads from the start once, silently.
- Given `UNAVAILABLE` with `retryAfterMs`, then it retries once after that delay.

**FR-16 Mutual exclusion.** Given the Files drawer is open, when a task drawer opens, then Files closes, and the other way round.

## 8. Technical design

### 8.1 Files

| Path | New/changed | What |
|---|---|---|
| `src/lib/tasks.ts` | new, pure | `parseTask`, `parseTaskList`, `taskState(task)` → `{label, tone}`, `isNeedsYou`, `kindLabel`/`kindIcon`, `orderTasks`, `stripItems({tasks, jobs, now, openedAtMs, hidden})`, `dashboardItems`, `summaryLine(items)`, `worstTone`, `fromScriptJob(job)` → `BackgroundItem`, `taskMatchesSession(task, key)` |
| `src/lib/webPush.ts` | changed | `pushToNavigate({url, tag})`, keeping `pushUrlToNavigate` as a wrapper; `sessionKeyFromControlUiPath(path)` |
| `src/lib/chatHistory.ts` | new, pure | `toChatMessages` moved out of `store/chat.ts:576-610` unchanged, so the drawer can reuse it. `chat.ts` imports it back. |
| `src/store/tasks.ts` | new | `byId`, `sessionIndex: Record<sessionKey, taskId[]>`, `activeLoadedAt`, `error`, `drawer: {open, mode:'list'｜'detail', taskId?, jobId?}`, `hidden` (persisted). Actions: `start()`, `loadGlobal()`, `loadSession(key)`, `ingest(payload)`, `cancel`, `retry`, `dismiss`, `openDrawer`, `openList`, `closeDrawer`. |
| `src/store/scriptJobs.ts` | new | One shared `jobs.list` poll (3 s, only while something needs it and `hasMethod('jobs.list')`). It replaces the separate polls in ScriptJobDock and ScriptsSection. `subscribeJob` (1.5 s `jobs.get`) stays in `lib/scriptJobs.ts`. |
| `src/store/taskHistory.ts` | new | Drawer paging: `load(taskId)`, `loadEarlier()`, `refreshHead()` (throttled 2 s) |
| `src/components/chat/BackgroundStrip.tsx` | new | `Strip` plus `TaskRow`s. Uses `collectJobRefs` for transcript jobs. |
| `src/components/tasks/TaskRow.tsx`, `TaskDrawer.tsx` | new | Row and drawer (list and detail) |
| `src/components/chat/ChatView.tsx` | changed | Swaps `ScriptJobDock` for `BackgroundStrip` inside `StripBar` |
| `src/components/chat/ScriptJobDock.tsx` | **deleted** | |
| `src/components/chat/ScriptJobCard.tsx` | changed | Accent for running, `ProgressTrack`. Clicking the header opens the drawer on that job. |
| `src/components/dashboard/DashboardView.tsx` | changed | `ScriptsSection` becomes `BackgroundSection` |
| `src/App.tsx` | changed | Mounts `TaskDrawer` beside `FileDrawer`; calls `useTasksStore.start()` in the connect effect; tray payload gains `tasks` and `needsYou`; the navigate handler gains `sessionKey`/`taskId`/`tasks` |
| `electron/main/index.ts`, `electron/preload/index.ts` | changed | `trayCounts` gains `tasks` and `needsYou`; one new menu item; tooltip |
| `public/sw.js` | changed | Forwards `tag` |

### 8.2 Data flow and event handling

```
connect ─▶ tasks.start():
   gatewayClient.on('task') once   (not per connection: this event isn't subscription-gated)
   loadGlobal(): active (limit 500) + recent (endedAt, 100)
   for every open chat key: loadSession(key)
task upserted ─▶ byId[id] = task; add to sessionIndex[task.sessionKey], sessionIndex[task.childSessionKey]
task deleted  ─▶ remove from byId and every index
task restored ─▶ loadGlobal() + every loadSession()
every 60 s while any queued or running ─▶ loadGlobal()        (dropIfSlow)
reconnect ─▶ the connect effect calls start() again ─▶ reload   (no catch-up from the gateway)
```

- **Session matching is done by the gateway.** `loadSession(key)` asks the gateway, which canonicalises main-session aliases (`tasks-D9hXEMUl.mjs`). Events then add by `sessionKey`/`childSessionKey`/`ownerKey` equality. A task whose key differs only by alias is found on the next `loadSession`.
- **Script jobs** are merged in `lib/tasks.ts` from `store/scriptJobs` plus the transcript refs, keeping ScriptJobDock's recovery logic (`jobRefsForSession`).
- **Races.** Keep the progress-cards `latest` sequence pattern (`store/progressCards.ts:23-26, 49-61`) per session key, so a slow list can't overwrite a newer one.

### 8.3 Capability gating

| Feature | Gate |
|---|---|
| Gateway tasks in any surface | `hasMethod('tasks.list')` and read scope |
| Live updates | `hasEvent('task')`. Without it, fall back to a 15 s poll while the strip or drawer is visible. |
| Output tab | `hasMethod('tasks.history')` |
| Stop | write scope + `hasMethod('tasks.cancel')` |
| Retry / Dismiss | write scope + `hasMethod('tasks.retry')` / `('tasks.dismiss')` |
| Script jobs | `hasMethod('jobs.list')`. This is a plugin method, and plugin methods are advertised (PRD 01 §2.1). |
| Suggestions *(held)* | `hasMethod('taskSuggestions.list')` + `hasEvent('task.suggestion')`; Accept needs admin |

### 8.4 Performance limits
- The active list is at most 500 (Control UI parity) and the recent list 100. A chat's list is 100, with no paging in the strip; the drawer's list mode pages.
- Output pages are 50 messages. The gateway caps a page at 4 MiB. Pages already loaded are cached per task until the drawer closes.
- Head refresh while running is at most every 2 s, and only while the drawer shows that task.
- One `jobs.list` poll app-wide (3 s), not one per chat plus one for the Dashboard as today.

### 8.5 Error handling
- `tasks.get`/`history` "task not found" or "Task not found." shows d.gone.
- The `tasks.history` `UNAVAILABLE` "This task has no readable transcript." shows d.noTranscript.
- The cursor and stabilise errors follow FR-15.
- Missing scope is logged by `gateway.ts:483-486`. The UI hides actions the connection's scopes can't use.

### 8.6 Migration
- ScriptJobDock's local dismissed set was in-memory only, so nothing is lost.
- New localStorage key `joaxclaw-background-hidden` (per session key, capped at 200 ids).

## 9. Test plan

**Unit tests** (`src/lib/__tests__/`):

`tasks.test.ts`:
- `parseTask`:
  - number and string timestamps;
  - a missing title falls back to "Background task";
  - unknown status and kind values survive.
- `taskState`: every row of §5.5, including `cancelled` → Stopped/idle and blocked-but-delivered → Done.
- `isNeedsYou`:
  - true only for blocked plus delivery `failed`;
  - false for `dismissed`, `pending` and `delivered`.
- `kindLabel`: every kind in §5.5; an unknown kind falls back to runtime, then to "Task".
- `orderTasks`: running oldest-start first, then needs-you, then the rest by `endedAt` descending; ties broken by id.
- `stripItems`:
  - the 10 min completed cutoff;
  - the 24 h failed cutoff;
  - "ended while open" keeps an item past 10 min;
  - hidden ids are dropped, but a needs-you item can't be hidden;
  - script jobs are merged and deduped by jobId.
- `summaryLine`: zero parts left out, and the order is running · needs you · failed · done.
- `worstTone`: failed > needsYou > working > done > idle.
- `taskMatchesSession`: requester, child and owner match; unrelated keys don't.

`scriptJobs.test.ts` (extend):
- `fromScriptJob`: running, exit 0, exit ≠0, expired.

`webPush.test.ts` (extend) — `pushToNavigate`:
- tag only;
- url only;
- both;
- `chat/main` → `agent:main:main`;
- `chat/main/dashboard/4f1c` → `agent:main:dashboard:4f1c`;
- the `~key/` form;
- an absolute URL with a base path;
- a non-task tag is ignored;
- the `automations` and `ask/` regressions.

`chatHistory.test.ts`: the moved `toChatMessages`, with the fixtures copied from the current behaviour (role filter, tool_use extraction, bare `<think>` drop).

**Manual QA** (isolated gateway profile):
1. Ask an agent to spawn a subagent for a two-minute research job:
   1. The strip appears showing "1 running".
   2. Open the row: the drawer's Output streams tool calls.
   3. Stop: the button shows Stopping… and then Stopped.
2. Background command (`exec` in background): check it shows as "Background command", and that Stop works.
3. Script job via `script_start`:
   1. It shows as a Script row with a `ProgressTrack` when it prints a %.
   2. ScriptJobDock is gone.
   3. Reload the app: the job is recovered through `jobs.list`.
4. Blocked delivery: make the parent session unavailable while a subagent finishes (e.g. delete the parent chat).
   1. The row shows Needs you with the warning.
   2. Retry: the result arrives, or the reason shows.
   3. Dismiss: the row becomes Done.
5. Dashboard shows tasks from two agents, and See all opens the list with working filters.
6. Tray (desktop) shows the count and opens the Dashboard list.
7. PWA on a phone with push enabled: make a subagent fail. Tapping the push opens the chat and that task's drawer.
8. Kill the network for 90 s while a task finishes, then reconnect: the status is corrected without a reload.
9. 2026.8 gateway: no Output tab, and the note shows. 2026.7: no Retry or Dismiss buttons.
10. Read-only token: rows open, but there are no action buttons.
11. Phone, 390px: the chip opens the sheet, the drawer is full screen, and the tap targets are ≥40px.

## 10. Rollout
- No flag. Everything is gated per §8.3.
- On a gateway without `tasks.list`, the Background strip degrades to exactly today's script behaviour, so removing ScriptJobDock never loses functionality.
- Ship after PRD 01, and after or alongside PRD 02 (independent).
- CHANGELOG: note that script jobs moved into the Background strip, and that "running" is now accent.

## 11. Risks and open questions

| # | Item | Owner decision? |
|---|---|---|
| Q1 | **Suggested-task cards will almost never appear.** The gateway gives `suggest_task` only to `control-ui`/`browser-copilot`/`tui` clients with admin and the `task-suggestions` cap (§2.2 fact 3). JoaxClaw is `gateway-client`. The options are:<br>(a) drop the cards;<br>(b) show only suggestions made from other surfaces (the Control UI or TUI) in the Dashboard;<br>(c) ask upstream to allow the cap for any operator client;<br>(d) switch JoaxClaw's client id to `control-ui`. That is **not recommended**: it changes restart-safe send, origin and other gateway behaviour. <br>**Recommendation: (c) plus hold PR 03-e.** The card spec in §5.1/§5.7 is ready if the gateway changes. | **yes** |
| Q2 | **Retry has no confirm dialog.** The duplicate warning is shown inline before the button. Is that enough, or do you want a confirm step? Recommendation: inline, matching the Control UI and the no-toasts rule. | yes |
| Q3 | **How long finished items stay in the strip** (10 min for done, 24 h for failed). The plan said "until the session goes idle", which is ambiguous for a chat that runs continuously. | yes |
| R1 | The event is `dropIfSlow`, so state can briefly go stale. Mitigated by the 60 s reload and the reload on reconnect. | no |
| R2 | The `tasks.history` shape when read through a harness `taskHistory.read` (not a session transcript) is **unverified**. Mitigation: `toChatMessages` drops unknown shapes, and the Output tab falls back to d.noTranscript when every message is dropped. | no |
| R3 | I did not trace end to end that the web-push `url` carries the session path. The code shows `sessionKeys[0]` from the broadcast options, which the `task` broadcast sets. The tag alone still opens the drawer. | no |
| R4 | Moving `toChatMessages` out of `chat.ts` touches the history loader linked to the "reload loses tool calls" bug. It's a pure move with a snapshot test, and no behaviour change. | no |
| R5 | Visibility filtering: a non-admin connection may not see every agent's tasks. That is expected, and the Dashboard shows what the gateway returns. | no |

## 12. Milestones

| PR | Contents | Size |
|---|---|---|
| 03-a | `lib/tasks.ts` + tests, `store/tasks.ts`, `store/scriptJobs.ts`, `BackgroundStrip` replacing ScriptJobDock, ScriptJobCard recolour | M |
| 03-b | `TaskDrawer` (detail and list), `lib/chatHistory.ts` move, `store/taskHistory.ts`, the actions | M |
| 03-c | Dashboard BackgroundSection, tray counts (main + preload), `pushToNavigate` + SW tag + App navigate | S–M |
| 03-d | Phone polish: chip, sheet and full-screen drawer QA; reduced motion | S |
| 03-e *(held, Q1)* | `store/taskSuggestions.ts`, the Suggested-task card in the thread | S |
