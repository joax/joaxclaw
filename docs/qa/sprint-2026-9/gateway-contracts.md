# Gateway contract verification: sprint 2026.9 (PRDs 02–07)

QA phase 1, 18 Sep 2026. Every PRD claim about gateway methods, events and payloads was checked against the compiled gateway source. The per-PRD checklists (`NN-*.md`, "Gateway contract" group) turn these findings into checkable items. The fixtures in `src/lib/__tests__/fixtures/sprint/` encode the **source** shapes, not the PRD shapes.

## Sources used

| Build | Where | Notes |
|---|---|---|
| **2026.9.4** (source of truth) | `openclaw-2026.9.4.tgz`, unpacked in the QA scratchpad (`…/scratchpad/gw/2026.9.4/package/dist`) | The same tarball the PRDs cite. All `dist/…mjs:line` refs below point into it. |
| 2026.6.5 | `~/.nvm/versions/node/v24.14.0/lib/node_modules/openclaw` (the globally installed CLI) | **This is not 2026.9.x**, whatever the sprint brief says. It is useful as the "older gateway" baseline. Its refs are `…js` (no `.mjs`). |

No 2026.7 or 2026.8 build was available. Anything that says "since 2026.7/2026.8" was taken from the `since` column in `CORE_GATEWAY_METHOD_SPECS` (`dist/method-scopes-tKV11oMS.mjs:133`); it was not run.

## Cross-cutting facts (every engineer)

1. **Advertising.** `features.methods` = every core spec without `advertise:false` (`method-scopes-tKV11oMS.mjs:2956`) + channel-plugin methods (`server-methods-list-Bm-R-rqW.mjs:14`). 2026.9.4 advertises 423 core methods and hides 22. None of the methods used by 02–07 is hidden. The only exception is `sessions.get`, which none of them needs. `features.events` = `GATEWAY_EVENTS` (`server-methods-list-Bm-R-rqW.mjs:18`) and is **not** filtered by scope. The full real lists are in `fixtures/sprint/helloFeatures.ts`. (PRD 01 §2.1 says 23 methods are `advertise:false`; the source has 22. It doesn't matter here.)
2. **Capabilities** in hello-ok (`message-handler-BBAGn2rf.mjs:2303-2322`) include `session-goal-start-v1` and `taskSuggestions.acceptModes`. 2026.6.5 sends no capabilities at all.
3. **Error frame** = `{code, message, details?, retryable?, retryAfterMs?}` (`error-codes-C3Z5XSDw.mjs:65`). There are three forms every lib must classify:
   - **Unknown method:** `INVALID_REQUEST "unknown method: <m>"`. For a **non-admin** caller, though, an unclassified method fails the scope check first: unclassified methods default to `operator.admin`, so the result is `FORBIDDEN "missing scope: operator.admin"` (`method-scopes-tKV11oMS.mjs:3153`, `server-methods-v1T0byyX.mjs:179-203`, same in 2026.6.5). **An older gateway does not reliably say "unknown method".** Gate on `hasMethod()`, not on the error.
   - **Missing scope:** `FORBIDDEN "missing scope: X"` with `details {code:"MISSING_SCOPE", missingScope, requiredScopes}`. Other FORBIDDENs have no such `details`, so check `details.code` before treating a FORBIDDEN as a scope problem.
   - **Rate limit** (control-plane writes): `UNAVAILABLE "rate limit exceeded for <m>; retry after Ns"` with `retryable`, `retryAfterMs` and `details {method, limit:"30 per 60s"}`. 2026.6.5 allows "3 per 60s" (`server-methods-v1T0byyX.mjs:294-311`). During a restart drain the error is `UNAVAILABLE … unavailable during gateway restart` with `details.reason:"gateway-restarting"` (`:336-346`).
4. **App plumbing.** `gatewayClient.request()` rejects with `Error(JSON.stringify(error))` and keeps the structured error on `.gatewayError` (`src/lib/gateway.ts:487`). Any code that reads `code`/`details`/`retryAfterMs` must read `.gatewayError`, not parse `.message`. The default request timeout is 30 s.
5. **Closed schemas everywhere.** An unknown or newer param is rejected with `INVALID_REQUEST "invalid <m> params: … unexpected property '<x>'"`. Sending a param an older gateway lacks, such as `sortBy` or `offset`, breaks the call. It doesn't degrade.
6. **`hasMethod()` returns a boolean** (false when there is no list). Only `advertisesMethod()` is tri-state. PRD 06 l.44/l.268 treat it as tri-state.

---

## PRD 02: Gateway updates (Eng 1)

**Contract as built (2026.9.4)**

| Item | Scope · since | Shape |
|---|---|---|
| `snapshot.updateAvailable` | any | `{currentVersion, latestVersion, channel, currentSha?, upstreamRef?, upstreamSha?, commitsBehind?, commits?[≤5]{sha,subject}}`. Clients without read get only the first 3 fields. Absent when there is no update. (`health-state-DsIuwAbj.mjs:58-82`, `sessions-rlbLHLas.mjs:712`) |
| `snapshot.updateSchedule` | read | `{channel, autoEnabled, install?, target?, campaign?{id, state: waiting-for-idle｜countdown｜applying, announcedAtMs, applyAtMs?, holdUntilMs?, forceAtMs, updatedAtMs}}` (`sessions-rlbLHLas.mjs:761`) |
| `update.available` event | all | Read clients: `{updateAvailable｜null, schedule?}`. Others: the 3-field form. Sent with `dropIfSlow`. (`server-startup-post-attach-HBBOikle.mjs:793-838`) |
| `update.run.changed` event | admin | `{runId, phase, status, updatedAtMs}`. Sent by a 2 s watcher, and once more at the end. (`update-run-watcher-9rRNscAX.mjs`) |
| `update.status` | admin | `{refreshCheckout?}` → `{sentinel, updateAvailable｜null, activeRun?, lastRun?, effectiveChannel?, schedule?}` (`update-C1wfgEl4.mjs:350-399`) |
| `update.run` | admin · control-plane write | closed params; result `{runId, ok, code?, message?, …, result{status, mode, reason?, before?, after?, steps[], durationMs}, handoff?, restart｜null, sentinel}` (`:443-859`) |
| `update.hold` | admin · 2026.8 | `{}` → `{ok, schedule?}` |
| `update.runs.list` / `.get` | admin · 2026.9 | `{limit? 1–100 (20)}` → `{runs}`; `{runId: UUID}` → `{run｜null}` |
| `update.report` | admin + owner authority · 2026.9 | preview → `{status:"ready", attemptId, title, body, previewDigest}`; submit → created／fallback／pending／retryable／duplicate |

**Discrepancies**

| # | PRD says | Source says | Impact |
|---|---|---|---|
| 02-1 | Older gateways lack the notice. Fallback to `update.status` (l.45-46, 362, 469-471, 608-609, R5 l.620). | 2026.6.5 already sends `snapshot.updateAvailable` and the `update.available` event to **every** connection (6.5 `health-state-VRUXjZyB.js:28`, `server-startup-post-attach-s4oDk9tN.js:647`). Its `update.status` returns **only `{sentinel}`** (`update-B6J_RJip.js:40`). | Detect updates from the snapshot and event on every version. The `update.status` fallback finds nothing on 6.5. Hiding the banner for non-admins or older gateways would be a regression. FR-14's "event not advertised" case doesn't happen in practice. |
| 02-2 | "`failed` at `verifying` marks Verifying failed" (test plan l.563). | A terminal run's `phase` is always `"finished"` (`update-run-record-DyYy8-Zk.mjs:983`). Only `steps[]` records which step failed. | `phaseProgress` must read `steps[]`, not `phase`. |
| 02-3 | Phase order `validating → [repairing] → activating` (l.74, l.251). | `verifying → repairing → verifying` is also allowed (`update-run-ledger-B_LBZZgT.mjs:258-261`). | The phase line must handle repairing after verifying. |
| 02-4 | Only `ok:true` matters. Every `ok:false` is a refusal (F1 l.202-204). | `already-current` returns `ok:false` with `result.status:"skipped"` (`update-control-plane-sentinel-D6xfGgXT.mjs:35-43`). A started managed handoff returns `ok:true` with `result.status:"skipped"` (`update-C1wfgEl4.mjs:847`). | Check `reason` before showing refusal copy. A followed run that ends `skipped` needs a banner state, and the PRD has none. |
| 02-5 | A refusal creates no run. | Refusals create ledger runs and return a `runId` (`update-C1wfgEl4.mjs:473, 782-786`). Refusals classified as failed count as reportable (`update-outcome-C-GffEda.mjs:52-58`). | They show up in History, so the UI needs a decision on Copy/Report for them. |
| 02-6 | The refusal reason list (l.88-95). | It is missing `managed-service-handoff-failed` (`:696, 816`), `invalid-update-target`, `unsupported-update-target` and `update-target-upstream-mismatch` (`:566`). | These must fall through to the generic "other" copy, and a test should cover it. |
| 02-7 | JoaxClaw runs always have trigger `api` (l.407, l.520). | When `update.run` adopts an active campaign, the trigger becomes `campaign` (`:577-581`). | Label runs as "yours" from the runIds you stored, not from `trigger`. |
| 02-8 | A campaign has a "held" state (l.103-104, l.224). | There is no such state. A hold sets `waiting-for-idle` plus `holdUntilMs`, and `holdUntilMs` stays set after it expires (`update-startup-B5Y6Lfsz.mjs:101-110, 152, 181`). A refused `update.hold` still returns `schedule`. | `bannerState` must test `holdUntilMs > now` before `state`. There's no need to re-read `update.status` after a hold. |
| 02-9 | `update.report` works on any failed run; only FORBIDDEN is swallowed (l.71, FR-12 l.465-466). | Preview accepts only the gateway's **latest** run. Any other run gets `INVALID_REQUEST "This failed update attempt is stale or unavailable."` (`update-C1wfgEl4.mjs:295-300`). Owner authority is `system` (token/password auth) or the profile `gateway-owner` (`message-handler-BBAGn2rf.mjs:2740, 2866`). | Show Report only on the latest run, and swallow the stale error as well as FORBIDDEN. |
| 02-10 | Polling survives the restart (§8.5). | During the drain, requests fail with `UNAVAILABLE` and `details.reason:"gateway-restarting"`. | Treat that error as "still running", not as a failure. |
| 02-11 | Unknown `runId` → `{run:null}` (§8.5 l.526). | `runId` must match the UUID pattern (`sessions-rlbLHLas.mjs:531`). A corrupt stored value gives `INVALID_REQUEST`. | Validate or catch the stored runId. |
| 02-12 | A campaign in `applying` shows "running" on every connection (l.226). | Connections without read never receive `schedule`. The pinned target is `schedule.target`, which may be a git ref with no version. | Qualify the copy, or source it from `updateAvailable`. |

Verified as the PRD states: scopes and since versions; payload projection by read scope; campaign timings (15 min force, 60 s countdown, 1 h hold); restart delay (default 2000 ms, clamped to 60000); `runs.list` default of 20, newest first; the phase, status and trigger vocabularies.

---

## PRD 03: Background tasks (Eng 2)

**Contract as built:**
- **Scopes and versions.** `tasks.list`, `tasks.get` and `tasks.history` need read; `history` is new in 2026.9. `tasks.cancel`, `tasks.retry` and `tasks.dismiss` need write; `retry` and `dismiss` arrived in 2026.7. `taskSuggestions.accept` needs admin (`method-scopes-tKV11oMS.mjs:859-900, 2454-2465, 2926-2931`). The `task` and `task.suggestion` events are delivered with read (`server-start-DzfvczE1.mjs:2977-2978`).
- **Params** are closed objects (`src-7tzZ8j12.mjs:1713-1765`):
  - `tasks.list {status?, agentId?, sessionKey?, limit 1–500 (100), cursor ≤512, sortBy? updatedAt｜endedAt (since 2026.8)}`
  - `tasks.history {taskId, cursor, limit 1–200}`
  - `tasks.retry` / `tasks.dismiss {taskIds: 1–10}`
- **TaskSummary** is built by `mapTaskSummary` (`task-summary-Cb8eETle.mjs:108-152`). `prompt` and `result` (≤4000 chars) appear **only** in `tasks.get` and in the retry/dismiss results.
- **`task` event** payloads: `{action:"upserted", task}`, `{action:"deleted", taskId}` or `{action:"restored"}`. It is sent with `dropIfSlow` and isn't subscription-gated.
- **Push payload:** `{title, body, tag:"openclaw-task-failed-<id>", renotify:false, url}`. It fires only for tasks that end failed or timed_out, and never for cron tasks.

**Discrepancies**

| # | PRD says | Source says | Impact |
|---|---|---|---|
| 03-1 | The push `url` is an absolute URL with a base path (l.91, l.387, test l.572). | It is relative, with the leading `/` removed and no basePath. It may carry a `#gatewayUrl=…` fragment. A task with no requester session gets just `"tasks"`. (`control-ui-shared-DqFhbHR8.mjs:11-17`, `server-start-DzfvczE1.mjs:2093-2101`) | `pushToNavigate` must accept relative paths, ignore the fragment and handle `tasks`. Add unit tests for all three. |
| 03-2 | Session path → key: a simple decode (l.387). | Paths use percent-encoding, `.`→`%2E`, `~dot`/`~dotdot`, a doubled leading `~~`, and `~key/` for reserved or short-hex segments (`session-key-PQkfotIJ.mjs:66-105`). `chat/<agent>` means `agent:<agent>:<mainKey>`, and `mainKey` is configurable. | Port the decode rules. Don't hard-code `:main`. |
| 03-3 | Not-found errors (§8.5 l.528). | `tasks.get`: `"task not found: <id>"`. `tasks.history`: `"Task not found."`. Both are INVALID_REQUEST (`tasks-D9hXEMUl.mjs:297, 51`). | Match both texts. |
| 03-4 | `tasks.history` has one error, "no readable transcript" (§8.5 l.529). | There are two more. `UNAVAILABLE "Unable to load this task's transcript. Refresh the task and try again."` is also returned for pages over 4 MiB and for access changes (`:121`). `"Invalid task history cursor. Refresh the task."` (`:59`). | Don't map UNAVAILABLE to "no transcript". Give it Retry copy. |
| 03-5 | Retry works on needs-you tasks. | Only `suspended` deliveries can be re-driven. Anything else gets `ok:false "completion delivery is not blocked"` (`subagent-completion-delivery-D_jYLxNd.mjs:164-167`). `duplicateRisk` is set only on the suspended path. | The retry-failed state (`d.retryFail`) is reachable and needs a test. |
| 03-6 | Cancel returns a `reason` (FR-7 l.431). | Access denied returns `{found:false, cancelled:false}` with no reason (`tasks-D9hXEMUl.mjs:310-320`). | Needs fallback copy. |
| 03-7 | (Not stated.) | `task` upserts and `tasks.list` never carry `prompt` or `result`. | If an upsert replaces the drawer's task wholesale, the Prompt and Result tabs go blank. Merge fields instead of replacing. |
| 03-8 | `sortBy` for the recent list (FR-1). | `sortBy` arrived in 2026.8 and the schema is closed, so a 2026.7 gateway rejects the whole call. | Gate it, or retry without `sortBy`. |
| 03-9 | Older-gateway fallback shows Prompt/Result (no `tasks.history`). | 2026.6.5 tasks have no `prompt`/`result`, `hasTranscript`, `deliveryStatus` or `terminalOutcome`, and there is no `task` event. Its cursor is a numeric offset. | Fallback screens are empty on 6.5. Gate the whole feature on `hasEvent('task')` plus `tasks.retry`. |
| 03-10 | `taskSuggestions.dismiss` → `{dismissed}` (l.73). *Held (03-e).* | It returns `{taskId, dismissed}`, with `dismissed:false` for a hidden suggestion. `accept` defaults to `mode:"worktree"` (`task-suggestions-BfEdNAaD.mjs:475, 571-584`). | For 03-e: send `mode:"local"` explicitly. |

PRD 03 R3 is confirmed: the push URL does carry the requester session.

---

## PRD 04: Chat goals (Eng 3)

**Contract as built:**
- **`sessions.goal.update`** (write, since 2026.8, `method-scopes-tKV11oMS.mjs:1404`) takes a union of closed objects (`sessions-goal-U8Cv3IfC.mjs:424-451`).
  - Identity fields: `{sessionKey, agentId?, sessionId?, goalId, operationId 1–128, issuedAtMs}`.
  - Plus either `{action:"edit", objective 1–16000}` or `{action: pause｜resume｜complete｜block, note? ≤2000}`.
  - Result: `{operationId, action, sessionId, goalId, goal?, runId?, replayed?, status}`.
- **`sessions.goal.clear`** takes the identity fields only and returns `status:"cleared"`.
- **Starting a goal** is done by `chat.send` with `intent {kind:"session-goal-start", version:1, issuedAtMs}` (`sessions-rlbLHLas.mjs:1743`), gated on the capability `session-goal-start-v1`.
- **Where the goal appears:** `goal` is on `sessions.list` rows and on `sessions.changed` (as `goal: row.goal ?? null`, `session-event-payload-6znNKcu1.mjs:11,92`). There is no dedicated goal event.
- **SessionGoal** has a required `tokenStart` and an optional `tokenStartFresh`, which the PRD doesn't list.

**Discrepancies**

| # | PRD says | Source says | Impact |
|---|---|---|---|
| 04-1 | Goal start sets the thinking level with write scope (l.76, l.170, FR-3 l.393). | `sessions.patch {thinkingLevel}` needs **`operator.admin`**. `thinkingLevel` isn't in the write-scope field set (`method-scopes-tKV11oMS.mjs:11-43`). | A write-only token fails before the goal starts. Needs a defined fallback: skip the patch, or gate the control on admin. |
| 04-2 | Errors come as `INVALID_REQUEST` with `details {code:"GOAL_OPERATION_REJECTED", reason}` (§8.5 l.473-482). | That holds only for plain `sessions.goal.*` (`sessions-goal-IoWLbKRI.mjs:133`). Start and resume go through the chat.send path, where the reason is prefixed `goal-…` and there's no `details.code` (`chat-send-handler-oS9rX200.mjs:3462`). Errors during turn admission are `UNAVAILABLE "SessionGoalOperationError: …"` with no details (`:631-677`). "Session changed or was removed; refresh its Goal." has no details either (`sessions-goal-IoWLbKRI.mjs:43`). | The error classifier needs all four forms, each with a fixture-backed test (the forms are in `chatGoals.ts`). |
| 04-3 | The reason list (§8.5). | It is missing `session-rebound`, `expired` (retry more than 24 h after `issuedAtMs`) and `invalid` (clock skew, or acting on a complete goal) (`session-accessor-BxcCxteu.mjs:4543-4639`). | Add copy, or a generic fallback. |
| 04-4 | A retry reuses the operationId (l.455-459). | The receipt fingerprint covers **every** param, including `issuedAtMs`, `sessionId` and `agentId` (`session-goal-request-ZN0NYr1A.mjs:5`). Receipts expire at `issuedAtMs + 24h`. | A retry must be byte-identical. Store the whole request, not just the id. The existing init-conflict retry in chat send makes a fresh idempotency key, which must **not** happen for goal start. |
| 04-5 | The popover shows the "Agent's note" from `lastStatusNote` (l.229, l.330). | A Pause or Resume note from the operator overwrites `lastStatusNote` and is never cleared (`session-accessor…:4500`). | The label is wrong after Continue-with-note. Needs a product decision on the copy. |
| 04-6 | Open fact 11: how the agent's `update_goal` reaches the app (l.86). | `update_goal` emits no `sessions.changed`. The new goal arrives with the next session snapshot: the run-end `sessions.changed {phase:"end"}` (`server-chat-BP_fmUto.mjs:448`), `session.message`, or an `agent` tool event. | The 2 s refresh fallback is mostly redundant. Make sure the run-end event updates the row. |
| 04-7 | The agent can only update a goal (l.82). | The agent can also create one, with a `token_budget` (`create_goal`, `openclaw-tools-Bo9W_tg_.mjs:4433`). | A goal can appear without any user action, and the UI must handle it. |
| 04-8 | Reconnect refreshes the goal via the subscription (FR-10, §2.1 l.44). | The `sessions.subscribe` result only adds unknown rows. The refresh actually comes from `App.tsx:122` calling `fetch()`. | Code review: keep that `fetch()`. |
| 04-9 | Offline keeps showing the last known goal (FR-12). | `useGatewaySupport` returns `supported:false` while disconnected, so the chip disappears. | This is an app-side conflict. Gate on the last-known support, not the live one. |
| 04-10 | The Popover has dialog semantics with textarea autofocus (§5.7 l.357). | The PRD 01 `Popover` hard-codes `role="menu"` and `aria-haspopup="menu"`, and captures the arrow keys. | Needs a dialog variant of Popover, or `Overlay`. |
| 04-11 | `canWrite = operator.write` (§8.4 l.467). | The gateway accepts `operator.admin` for write methods. | An admin-only token would be treated as read-only. |
| 04-12 | Objective ≤16000 chars. | The objective must already be NFC and contain no control characters (tab, LF and CR are allowed). Length is counted in UTF-16 units. `mentions` and `queueMode` are rejected alongside an intent. | Normalise on the client, or map the validation error. |
| 04-13 | Hide the marker and column on older gateways (FR-1). | 2026.6.5 already carries `goal` on rows and events. | This is a product choice, not a gateway limit. |

---

## PRD 05: Chat export, PR 2 (Eng 3). PR 1 is merged; regression only.

**Contract as built:**
- **`chat.history`** (read). Its closed params are listed in `sessions-rlbLHLas.mjs:1560`:
  - `sessionKey`, `agentId?`, `cursor?`
  - `limit? 1–1000` (default 200)
  - `maxBytes?`, `offset? ≥0`, `messageId?`, `sessionId?`
  - `maxChars? 1–500000` (default 8000)
- **Its response** (`chat-history-handler-DpOELHcj.mjs:948`) contains:
  - `messages`
  - `offset?` (echoed only when sent) and `nextOffset?` (only when `hasMore`)
  - `hasMore?`, `totalMessages?`, `deltaCursor?`
  - `sessionInfo{…, hasActiveRun, activeLeafEntryId}`
- **Row ids** live only in `__openclaw.{id, seq, truncated?, reason?}`.
- **`chat.message.get`** (read) takes `{sessionKey, messageId, maxChars? ≤2e6}` and returns `{ok, message?, unavailableReason?}`.

**Discrepancies**

| # | PRD says | Source says | Impact |
|---|---|---|---|
| 05-1 | Page with `offset: 0 → nextOffset`. With no `hasMore`, treat it as a single page (l.304, §5.2 A.2). | 2026.6.5's closed schema **rejects `offset`**: `invalid chat.history params: … unexpected property 'offset'` (6.5 `chat-DOMgZOP2.js:1731`, `schema-KBhSSPA3.js:2696`). 9.4 computes `hasMore`/`nextOffset` even when `offset` isn't sent (handler `:767`). | Make the first request **without** `offset`. That keeps the single-page fallback working on older gateways. |
| 05-2 | "File contains all 1,240 entries" and "Reading N messages" (l.416, l.152). | `totalMessages`, `offset` and `nextOffset` count **raw** records, including hidden heartbeat and NO_REPLY rows. `limit` counts visible rows (handler `:241-247`). | Base progress on offsets. Don't assert "exported rows == totalMessages". |
| 05-3 | Dedupe on `__openclaw.id` (l.416). | One record can project to two rows with the same id (commentary fallback, `session-transcript-readers-BZjuw2hz.mjs:1561`). The gateway also **replays the oldest record** at the start of the next page (handler `:249`). | Dedupe per occurrence, the way the Control UI does. A plain Set drops rows. The fixture `PAGING_PAGE_A/B/C` covers this. |
| 05-4 | Oversized messages (l.63). | The placeholder has `__openclaw {truncated:true, reason:"oversized"}` and **no** `toolCallId`, `toolName` or `isError` (handler `:74`). Display-cap rows have `reason:"display-cap"` (`:1782`). | Count truncation from `__openclaw.truncated`. An oversized tool result can't be paired, so keep it as an orphan instead of dropping it. |
| 05-5 | A "Transcript unavailable" sentinel (l.65, l.300). | That sentinel appears only when a placeholder exceeds 128 KiB (`:113`), which is effectively unreachable. The real failures are `UNAVAILABLE`, `retryable:true, retryAfterMs:250`: "session history is rebuilding; retry shortly" (`:582`) and "session changed while reading history; reload the conversation" (`:798`). | The reader needs retry-after handling. The PRD doesn't specify any. |
| 05-6 | (Not covered.) | Nested tool activity comes as a `role:"custom"` row with `customType:"openclaw.nested-tool.v1"`, holding a `toolCall` block plus a `type:"toolResult"` block (`sqlite-transcript-store` `:256`, readers `:2055`). | Merged `toChatMessages` drops every custom row, so nested tool calls are still lost on reload and in the export. |
| 05-7 | **Gaps in PR 1 (merged)** against FR-2, FR-3 and FR-15. | Only exact `toolCall`/`tool_use` blocks are recognised, and ids come only from `id` (`tool_use_id` gets a random nanoid). There is no `running` status and no `historyHasMore`/`historyTotal`. The "Earlier messages aren't loaded" line and the captured 9.4 fixture test are both missing. | Regression items are marked **GAP** in `05-chat-export.md`. Decide whether PR 2 or a follow-up fixes them. |

Resolved by source: R3, the channel sender, is a top-level `senderLabel` on user rows. R4, commentary-only assistant rows, are dropped by the gateway, and their `toolResult` rows still arrive as orphans.

---

## PRD 06: Plugin catalog (Eng 4)

**Contract as built:**
- **Catalog RPCs** (read, since 2026.9). All three are new in 2026.9, and none exists in 2026.6.5.
  - `plugins.catalog.browse {query≤200, intent, category, cursor, pageSize 1–100}` → `{items: Entry[], nextCursor?, remoteError?}` (`sessions-rlbLHLas.mjs:344-368`, `plugins-Bseu8N34.mjs:81-143`).
  - `plugins.catalog.categories {}` → `{categories:[{slug,label,description,icon,order}]}`.
  - `plugins.catalog.get {id, version?}` → `{plugin: Entry, detail: Detail}` (`:371-441`).
- **Management RPCs**, **none of which exists in 2026.6.5**:
  - `plugins.list` (read) → `{plugins, diagnostics, mutationAllowed}`.
  - `plugins.search` (read).
  - `plugins.inspect` (read, 2026.8).
  - `plugins.install` (admin) → `{ok, plugin: ListRow, restartRequired, warnings?}`.
- **`gateway.restart.request`** (admin, present in 6.5) → `{ok, status: scheduled｜deferred｜coalesced, preflight, restart{…}}` (`restart-coordinator-9EVX5NoM.mjs:34-49`).
- **Restart signals:**
  - `shutdown` event `{reason, restartExpectedMs?}`.
  - hello-ok `server.bootId` changes on every boot (`run-fzUO4BXB.mjs:2001`). 2026.6.5 has no `bootId`.

**Discrepancies**

| # | PRD says | Source says | Impact |
|---|---|---|---|
| 06-1 | Install via `installParamsFor(entry.local.install, version)`. No `local.install` → "Not available from the catalog" (§5.2 B.2 l.162, §8.3 l.443). | A ClawHub-only entry **never** has `local.install`. `projectLocalFacts(undefined)` returns `{present:false, …, action}` only, and `install` is set only for a present, not-installed local plugin (`catalog-discovery-DVpbiIEc.mjs:20-33`). | As specified, **every ClawHub plugin would show "Not available"**. Build `{source:"clawhub", …}` from `catalog.packageName`, and use `local.action` (`install`／`manage`／`unavailable`) as the gate. |
| 06-2 | The host command uses `<npmSpec>` for official plugins (l.175, l.479). | No entry or row carries an npm spec. The official install action is `{source:"official", pluginId}`. | Use `openclaw plugins install <pluginId>` (bare ids resolve to official) or `clawhub:<pkg>`. |
| 06-3 | "Everything down → UNAVAILABLE" (l.71). | UNAVAILABLE comes only when the **local** inventory throws (`plugins-Bseu8N34.mjs:140-141`). When ClawHub is down, browse succeeds with a `remoteError`. | The error state differs from what the PRD specifies. Test both. |
| 06-4 | `remoteError` means "Showing bundled and installed plugins" (l.70, l.262). | The text varies by intent (`:97, :137`). `featured`, `trending` and `official` return **no items**. `all` with no query returns installed plugins only. `bundled` returns an **empty list** ("Bundled publication status could not be verified."). | The offline copy is wrong for most views, and the Bundled tab is empty offline. Match the prefix "ClawHub is unavailable", then pick copy based on the item count. |
| 06-5 | "Verified clean · {date}" (l.64, l.307). | `projectSecurity` fills only `status`, `auditUrl` and `summary` (`management-service-a9oXcryo.mjs:173-181`). There is no date, verdict or guidance. `status` is one of `blocked`, `pending`, `stale`, the moderation state, the scan status or `unknown`. | Drop the date. Map `/^(clean｜pass｜safe)$/` to the pass state, as the Control UI does. |
| 06-6 | (Not covered.) | When ClawHub fails on a cursor page, browse returns `nextCursor: params.cursor`, echoing the cursor it was given (`:136`). | A naive "Load more" loops forever. Stop when `nextCursor === cursor`. Fixture `browseCursorEcho`. |
| 06-7 | Install result `{ok, plugin, …}` = a catalog entry (l.56). | `plugin` is a `plugins.list` row. Install enables the plugin only when its config is ready; otherwise it is left `needs-setup` or `disabled`, with `warnings` (`management-install-DVho0eeC.mjs:197-269`). | Handle `disabled` and `warnings` after install. Verify with `plugin.id`. |
| 06-8 | Restart timeout 90 s (l.172). | `gateway.restart.request` can return `deferred`, which waits for active runs for up to **300 s** (`restart-PDAKwQWW.mjs:136`). A second request inside the 30 s cooldown returns `coalesced`. | 90 s can fire while the restart is legitimately pending. On `deferred`, extend the timeout. PRD 01's `expectRestart` window is 2 min. |
| 06-9 | Trust-block error code. | `clawhub_download_blocked` → **INVALID_REQUEST**, with the audit text in `details.warning`. Consent, policy and `clawhub_security_unavailable` → UNAVAILABLE (`management-mutations-IdXujYee.mjs:61-71`). | The classifier must branch on `details` rather than the code. `clawhub_security_unavailable` has no copy. |
| 06-10 | Older gateway → "unknown method" → fallback browser (l.268, l.375). | A non-admin gets `FORBIDDEN missing scope: operator.admin` instead (see cross-cutting fact 3). 2026.6.5 lacks `plugins.search`, `plugins.install`, `plugins.list` and `plugins.inspect`, so the "old browser" fallback doesn't work there either. | Gate with `hasMethod('plugins.catalog.browse')`, and fall back only when `hasMethod('plugins.search')`. Otherwise show a CommandHint. |
| 06-11 | Local entries have versions, config and author. | `local_…` entries are always `official:false` and have no stats, author or image. Their detail has empty `configuration`, `versions` and `topics` (`catalog-discovery:131, 146-161`). | Hide the version picker. Don't claim "Nothing to configure" for them. |
| 06-12 | The detail's `author` is a string. | `catalog.author` is a string, but `detail.author` is an object `{handle?, displayName?, imageUrl?}`. `skills` is `{name, description?}[]`. `versions[].createdAt` is in ms. | Type these correctly, using the fixtures. |

Verified: the ClawHub URL pattern (`https://clawhub.ai/{owner}/plugins/{basename}`, else `/plugins/{packageName}`); the order of precedence consent → policy → trust; `intent:"bundled"` skips ClawHub; four `featured` entries.

---

## PRD 07: Meetings, PRs 1–2 (Eng 4)

**Contract as built:**
- **Transcript RPCs.** All four need read, are advertised, and are **absent in 2026.6.5**. They emit **no events**.
  - `transcripts.list` (2026.8): `{limit 1–200 (50), cursor, query, providerId, accountId, agentId, startedAfter, startedBefore}` → `{sessions, nextCursor}`.
  - `transcripts.get` (2026.8): `{selector, includeUtterances?, limit 1–100, cursor, query}` → `{session, summary?, utterances?, nextCursor}`. Legacy mode (up to 2000 utterances, text clipped at 4000 chars) applies when `limit`, `cursor` and `query` are all absent.
  - `transcripts.export` (2026.9): `{selector, format: markdown｜jsonl}` → `{filename, mimeType, encoding:"base64", data, sizeBytes ≤4 MiB}`.
  - `transcripts.status` (2026.9): `{}` → `{enabled, providers, configuredSources, active, latestTranscript, omitted}`.
- **Error shape.** Library errors are `INVALID_REQUEST` with `details.type`. An archive role denial is `FORBIDDEN` with **no** details, which is the same code as missing-scope, so check `details`.

**Discrepancies**

| # | PRD says | Source says | Impact |
|---|---|---|---|
| 07-1 | Duration = `stoppedAt − startedAt` (l.79-80), types unstated. | The timestamps are **ISO strings** (`transcripts-M-a_ANB8.mjs:58-59, 67-68`). | `durationLabel` must parse them. The date in the selector is UTC. |
| 07-2 | Selectors can be rebuilt. | A selector has the form `YYYY-MM-DD/<safe id>` (`store-DsUNqEhh.mjs:47`). | Pass it back verbatim, never rebuild it. |
| 07-3 | Match the live session with `normaliseMeetingUrl`, which keeps Zoom `pwd` and strips tracking params (l.698, l.269, l.592). | The gateway stores **only origin + pathname**: `` meetingUrl: `${url.origin}${url.pathname}` `` (`source-locator-BSjIr0Fk.mjs:10`). | As specified, the match **never** succeeds. Compare lower-cased origin + path, and keep the full URL only for the join prompt. |
| 07-4 | Summarize goes through `sendViaAgent` with no `agentId` (l.309, FR-13 l.602). | The `transcripts` tool allows only the owning agent to summarize or stop (`ownsTranscriptSession`, `openclaw-tools-Bo9W_tg_.mjs:2926-2933`). Anyone else gets "transcripts session not found". The tool doesn't exist while `transcripts.enabled === false` (`:3293`). | Send to `session.agentId ?? default`. Disable Summarize while capture is off. |
| 07-5 | Uninstalled meeting plugins show in `plugins.list` (l.230, l.74). | An uninstalled official plugin is listed only when it has catalog metadata. The google-meet, teams-meetings and zoom-meetings entries have none (`management-service-a9oXcryo.mjs:791-796`). | Treat "absent" as not installed. Install with `plugins.install {source:"official", pluginId}` directly, and respect `mutationAllowed`. |
| 07-6 | Turning capture on just reloads status (FR-6 l.577, l.300). | There's no hot-reload rule for `transcripts.*`, so the default is a **restart** (`config-reload-plan-CuYf6HEr.mjs:300, 378`). The one exception is autoStart edits that only change titles (`:369`). | Call `expectRestart` (PRD 01) and reload on `connectionSeq`. The same applies to Discord saves in PR 3. |
| 07-7 | `manualAction` shape unknown (l.128, R2 l.774). | Google Meet documents `manualAction {reason, message}` plus `browser{nodeId, targetId, browserUrl}` (`docs/plugins/google-meet.md:131`). Teams and Zoom remain unverified. | Parse `manualAction.message`. |
| 07-8 | Google Meet has no guest name (l.127, l.260). The copy says admit "OpenClaw notes" (l.268). | Google Meet has `chrome.guestName`, default "OpenClaw Agent" (`google-meet/config.md:39`). | The copy is wrong unless Q5 is adopted. |
| 07-9 | One `whenOccupied` per guild is enforced (l.101, FR-15, PR 3). | Config validation accepts the setting. At runtime the gateway logs a warning and marks the session `start-failed` (`auto-start-BuGStKGP.mjs:300`). Config strings need `min(1)`. | The client-side check is required. Omit empty keys. |
| 07-10 | `chat.newConversation(..., {navigate:false})` stays on the current chat (l.262, FR-9). | This is on the app side: `newConversation` always sets `activeConvId` (`src/store/chat.ts:733-744`). | `navigate:false` needs a store change as well. |

Resolved by docs: Q2, transcribe storage. Explicit `transcribe` writes no durable rows while `transcripts.enabled` is false (`docs/cli/transcripts.md:421-423`), which matches the PRD's reading.
