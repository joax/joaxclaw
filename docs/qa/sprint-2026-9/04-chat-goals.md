# QA checklist — PRD 04 Chat goals

Source: docs/prd/04-chat-goals.md · Engineer: Eng 3 · Milestones: 04-a (lib/goals.ts, Session.goal, store/goals.ts, chat.sendGoalStart, GoalControl start/view/pause/resume/clear on desktop), 04-b (blocked/Continue, budget/Keep going, Edit, Mark done/Start a new goal, retry/replay, phone sheet), 04-c (chat-list marker, Sessions Goal column, refresh-on-final, Goal label on the user bubble)

Fixtures: `src/lib/__tests__/fixtures/sprint/chatGoals.ts` (real 2026.9.4 shapes: every goal status, params, results, `sessions.changed` slices, every error frame).

Legend: **[U]** unit test (vitest, src/lib/__tests__) · **[R]** code review · **[M]** manual app check (desktop + 390px phone)

## FR-1 Gate and eligibility

- [ ] **04-FR1.a** [U] Given hello-ok `features.capabilities` contains `session-goal-start-v1` and `features.methods` contains `sessions.goal.update` and `sessions.goal.clear`, when the gate is evaluated, then it is on. Remove any one of the three and it is off. _(PRD §7 FR-1, §8.4)_
- [ ] **04-FR1.b** [R] The gate uses `gatewayClient.supports('session-goal-start-v1')` and `gatewayClient.hasMethod(...)` (or `useGatewaySupport({capabilities, methods})`) and re-evaluates on a new `connectionSeq`. _(§8.4)_
- [ ] **04-FR1.c** [U] `eligibleSessionKey('agent:main:dashboard:<uuid>')` is true, `''` (new chat) is true, a key containing `:subagent:` is false, a key matching `isCronSessionKey` (`:cron:`) is false, a key containing `:heartbeat` is false. _(§9 eligibleSessionKey)_
- [ ] **04-FR1.d** [M] On a gateway without the capability (2026.7 or 2026.6.5): no GoalControl in either header layout, no chat-list marker, no Sessions Goal column. _(FR-1, §9 manual 10)_
- [ ] **04-FR1.e** [M] A subagent, cron or heartbeat chat shows no GoalControl. _(§5.5 "Session kind not eligible")_
- [ ] **04-FR1.f** [R] Being disconnected does NOT hide an already-rendered GoalControl (see FR-12). `useGatewaySupport` returns `supported:false` while disconnected, so the component must not gate on it alone. _(§5.5 Offline vs §8.4, see Ambiguities A6)_

## FR-2 Start a goal (F1)

- [ ] **04-FR2.a** [U] `buildStartParams('Ship v2', opId, now)` returns `{sessionKey, message:'Ship v2', idempotencyKey: opId, intent:{kind:'session-goal-start', version:1, issuedAtMs: now}}`. It has no `thinking`, `attachments`, `timeoutMs`, `deliver`, `fastMode`, `queueMode` or `toolBindings` keys. _(FR-2, §9 buildStartParams)_
- [ ] **04-FR2.b** [U] `validateObjective`: `''` and whitespace-only are rejected. 16,000 UTF-16 units passes and 16,001 fails (`OBJECTIVE_16000` / `OBJECTIVE_16001`). The decomposed `OBJECTIVE_NFD` is NFC-normalised (`=== OBJECTIVE_NFC`) before length is measured and before sending. _(§9)_
- [ ] **04-FR2.c** [U] An objective with a disallowed control character (U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F, e.g. `OBJECTIVE_WITH_CONTROL_CHAR`) is stripped or rejected on the client. Tab, LF and CR are kept. The gateway rejects a start whose message changes under sanitisation. _(Gateway contract C-7)_
- [ ] **04-FR2.d** [U] `idempotencyKey` is 1–128 chars (nanoid(21)). _(FR-2)_
- [ ] **04-FR2.e** [R] Exactly one `chat.send` per submit. Goal start does NOT go through `sendMessage`'s init-conflict retry, which sends a fresh `nanoid(16)` idempotencyKey per attempt (`store/chat.ts` ~1133-1149). Any retry of a start reuses the same `idempotencyKey` and the same `intent.issuedAtMs`. _(FR-2, G5)_
- [ ] **04-FR2.f** [R] The start goes through the chat store (`sendGoalStart(convId, objective, opId)`): the user bubble appears and the reply streams through the existing event path. `chat.send` is sent with request `timeoutMs` 0 and not awaited for the stream. The resolved ACK (`startAck`) seeds `sessions` row `.goal`. _(§8.1, §8.2)_
- [ ] **04-FR2.g** [U/R] The local user message is marked `goal: true`, and `UserMessage` renders the `◎ Goal` label (copy m.goalLabel "Goal") only for that flag. _(F1.6, §8.1)_
- [ ] **04-FR2.h** [M] Chip goes to **Pursuing · 0m** after a successful start. The popover closes. _(F1.6)_
- [ ] **04-FR2.i** [R] Start is disabled while the objective is empty or over 16,000. A character counter appears past 15,000. Over the limit shows e.tooLong "Keep the goal under 16,000 characters." _(F1.2, §5.6)_
- [ ] **04-FR2.j** [R] Start never sends `mentions`, `replyToId`, origin fields or `suppressCommandInterpretation`. _(Gateway contract C-6)_

## FR-3 Thinking preserved

- [ ] **04-FR3.a** [U/R] Given the chat's thinking level is `high` (non-adaptive and supported by the model, same rule as `thinkingForSend`), when a goal starts, then `sessions.patch {key, thinkingLevel:'high'}` resolves **before** `chat.send` is issued. _(FR-3, F1.4)_
- [ ] **04-FR3.b** [U/R] Given the level is unset or `adaptive`, no `sessions.patch` is sent. _(F1.4)_
- [ ] **04-FR3.c** [R] Behaviour when `sessions.patch` fails is defined and implemented. It needs `operator.admin`: `thinkingLevel` is not a write-scope patch field, so a write-only token gets `goalErrors.thinkingPatchNeedsAdmin`. _(see Ambiguities A2)_
- [ ] **04-FR3.d** [M] Manual 2: with thinking High, start a goal. `sessions.list` row `thinkingLevel` is `high`, and there is no "per-request runtime or routing overrides" error. _(§9 manual 2)_

## FR-4 New chat

- [ ] **04-FR4.a** [U/R] Given a conversation with `sessionKey ''`, when a goal starts, then `sessions.create {agentId, model?}` runs first (the model override is included when set), the conversation gets the new key, and `sessions.patch`/`chat.send` use that key. _(FR-4, F1.3)_

## FR-5 Busy

- [ ] **04-FR5.a** [U] `availableActions(goal, {idle:false, canWrite:true, online:true})`: Start, Resume, Continue and Keep going are absent or disabled. Pause, Edit, Mark done and Clear stay. _(FR-5, §9 availableActions)_
- [ ] **04-FR5.b** [R/M] While not idle, the hint h.busyReply "Wait for the reply to finish." shows inline. _(§5.5 Reply running)_
- [ ] **04-FR5.c** [U] `classifyGoalError(asAppGatewayError(goalErrors.busy))` → `'busy'`. The UI shows e.busy "The chat is still working. Try again when the reply finishes." and the objective or note draft is kept. _(FR-5, §8.5)_
- [ ] **04-FR5.d** [M] Manual 5: while streaming, Start is disabled. Force `chat.send` with intent from devtools and e.busy shows. _(§9 manual 5)_

## FR-6 Actions (Pause, Edit, Mark done, Clear)

- [ ] **04-FR6.a** [U] `buildUpdateParams(goal, sessionKey, 'pause', {}, opId, now)` → `{sessionKey, goalId: goal.id, operationId: opId, issuedAtMs: now, action:'pause'}` with no `note` key. Same for `complete`. _(FR-6, §9)_
- [ ] **04-FR6.b** [U] `buildUpdateParams(..., 'edit', {objective})` requires a non-empty objective (1–16,000) and sends no `note`. Calling it without an objective throws or returns an error. _(§9)_
- [ ] **04-FR6.c** [U] For pause, resume and complete, an empty or whitespace note is omitted. A note is trimmed and capped at 2000. _(§9)_
- [ ] **04-FR6.d** [U] `buildClearParams(goal, sessionKey, opId, now)` → identity fields only (`sessionKey, goalId, operationId, issuedAtMs`, optional `sessionId/agentId`). There is no `action` key: the schema is closed, so `action` would be rejected. _(Gateway contract C-3)_
- [ ] **04-FR6.e** [U/R] Each action sends exactly one request with a fresh `operationId` and `issuedAtMs`. On success the sessions row `.goal` is set from `result.goal` (`pauseResult`, `editResult`, `completeResult`), or set to `null` after `clearResult`, without waiting for `sessions.changed`. _(FR-6)_
- [ ] **04-FR6.f** [R] Edit (F6): the objective becomes a `Textarea` with Save and Cancel. The hint a.editHint "Saves without starting a run." shows. Save sends `{action:'edit', objective}`. Edit is not offered once the goal is `complete`. _(F6)_
- [ ] **04-FR6.g** [R] Clear (F8): an inline confirm row "Clear this goal?" with [Clear] [Cancel], and no dialog. Confirm sends `sessions.goal.clear`. The control returns to **Set goal**. _(F8)_
- [ ] **04-FR6.h** [M] Manual 3: Pause turns the chip to "Goal paused" with no turn. _(F3, §9 manual 3)_

## F3 Resume / FR-8 Blocked → Continue / F5 Budget → Keep going

- [ ] **04-F3.a** [R] Resume opens the optional note field (placeholder p.notePlaceholder "Add a note for the agent (optional)") and sends `{action:'resume', note?}`. It runs a turn, and the reply streams into the thread. No visible "Continue pursuing the current goal." bubble appears (the gateway writes it `display:false`). _(F3, §9 manual 3)_
- [ ] **04-F3.b** [R] The chat store picks up the resume run: `runId` = the resume `operationId`, which the client did not start through `chat.send`. The streaming indicator and stop button work for it. _(F3, Gateway contract C-12)_
- [ ] **04-FR8.a** [U/M] Given `sessions.changed` brings `goal.status:'blocked'` with `lastStatusNote:'No key'`, the chip shows "Goal blocked" with `AlertTriangle` in amber (`needsYou`). The popover leads with p.blockedLead "The agent is blocked:" followed by the note, in the warning-tinted box (`color-mix(--warning 10%, --bg-surface)` with a `--warning` border). _(FR-8, F4)_
- [ ] **04-FR8.b** [U] For blocked + idle, **Continue** is the primary action, and its note field is expanded and focused. Submitting sends `resume` with the note (`continueParams`). Not idle drops Continue. _(FR-8, §9)_
- [ ] **04-FR8.c** [M] Manual 4: the agent blocks. The chip turns amber and the note shows. Continue with a note resumes the goal, and the chip goes back to Pursuing. _(§9 manual 4)_
- [ ] **04-F5.a** [U/R] Given `budget_limited` (`goalBudgetLimited`), the popover says p.budgetLead "The goal used its token budget ({used} of {budget})." with formatted numbers, e.g. "50,312 of 50,000". The primary action **Keep going** sends `resume`. After `keepGoingAck`, `tokensUsed` shows 0. _(F5)_
- [ ] **04-F5.b** [U] The `usage_limited` actions are defined, and at least Resume/Keep going is offered, since the gateway allows resuming from it. _(see Ambiguities A12)_

## F7 / FR-9 Mark done and Done is final

- [ ] **04-FR9.a** [U] `availableActions(goalComplete, …)` → only Start a new goal and Clear. No Edit, Pause, Resume or Mark done. _(FR-9, §9)_
- [ ] **04-FR9.b** [U/R] **Start a new goal** sends `sessions.goal.clear`. Only after it succeeds does the start form open (F1). If the clear fails, the start form is not shown and the error shows. _(FR-9, F7)_
- [ ] **04-FR9.c** [R] The Done popover shows p.doneSummary "Done after {elapsed} · {tokens} tokens" (for example "Done after 2h 10m · 188,400 tokens" for `goalComplete`) and "Agent's note" when `lastStatusNote` is set. _(§5.4 Done, §5.6)_

## FR-7 / §8.3 Safe retry and operation IDs

- [ ] **04-FR7.a** [U] `opId` is built once per user intent (nanoid(21)), and `issuedAtMs = Date.now()` once. Both are stored in `pending[sessionKey].params`. _(§8.3)_
- [ ] **04-FR7.b** [U] Given an action failed with a network error ('Not connected', 'Connection closed', 'Disconnected', `Request … timed out`), `retry(sessionKey)` resends `pending.params` **byte-identical**: same `operationId`, `issuedAtMs`, `goalId`, `note` or `objective`, and the same presence or absence of `sessionId`/`agentId`. The gateway fingerprints the whole request, including `issuedAtMs`. _(FR-7, Gateway contract C-9)_
- [ ] **04-FR7.c** [U] The pending entry is dropped on success and on non-retryable gateway rejections. It is kept on network errors, timeouts and `retryable:true` rejections. _(§8.3)_
- [ ] **04-FR7.d** [U/R] Given a result with `replayed:true` (`pauseResultReplayed`, `startAckReplayed`), the session row is re-read before the chip changes. The historical `result.goal` is NOT written over a newer row goal. _(FR-7)_
- [ ] **04-FR7.e** [U] The `operation-conflict` class (`goalErrors.operationConflict` and `goalErrors.chatPathOperationConflict`) → build a new `operationId` **and a new `issuedAtMs`** and retry exactly once, silently. A second conflict shows e.generic. _(§5.5, §8.5)_
- [ ] **04-FR7.f** [U] `goalErrors.admitting` ("Goal is being admitted; retry the same request.", `retryable:true`) → one automatic retry after 500 ms with the same params. _(§8.5)_
- [ ] **04-FR7.g** [U] e.generic "Couldn't update the goal: {message}" shows the gateway `message`, not the JSON-stringified Error, with a **Retry** control that reuses the same params. _(§5.5 Error other)_
- [ ] **04-FR7.h** [M] Manual 6: kill the network mid-Pause, restore it, then Retry. The gateway returns `replayed:true` and the chip is correct. _(§9 manual 6)_

## §8.5 classifyGoalError (every row plus the forms the source emits)

- [ ] **04-ERR.a** [U] busy: `goalErrors.busy` (`UNAVAILABLE`, `details.reason:'goal-session-busy'`) → `'busy'`.
- [ ] **04-ERR.b** [U] ineligible: `goalErrors.ineligible` (`INVALID_REQUEST`, no details, message contains "requires an idle local session with recoverable history") → `'ineligible'` → e.ineligible "Goals need an idle chat whose history the gateway can recover. Start a new chat to set a goal."
- [ ] **04-ERR.c** [U] rebound: each of `goalErrors.goalRebound` (`details.reason:'goal-rebound'`), `sessionRemoved` ("Session changed or was removed; refresh its Goal."), `sessionChangedBeforeUpdate` ("Session changed before its Goal update; retry."), `sessionRebound` (`details.reason:'session-rebound'`), `chatPathSessionRebound` (`details.reason:'goal-session-rebound'`) and `resumeGoalReboundViaTurn` (`UNAVAILABLE`, message "SessionGoalOperationError: Goal changed or was cleared; …", no details) → `'rebound'`. The row is re-read and e.rebound "The goal changed somewhere else. Here's the latest." shows.
- [ ] **04-ERR.d** [U] conflict: `details.reason` `'operation-conflict'` or `'goal-operation-conflict'` → `'conflict'`.
- [ ] **04-ERR.e** [U] capacity: `details.reason:'capacity'` → `'capacity'`, shown as e.generic.
- [ ] **04-ERR.f** [U] Nested details: a plain object `{gatewayError:{code, message, details:{code:'GOAL_OPERATION_REJECTED', reason}}}` and the app's Error (`asAppGatewayError`) both classify correctly. Structured `details.reason`/`details.code` wins over message text. _(§8.5, §9 classifyGoalError)_
- [ ] **04-ERR.g** [U] `expired`, `invalid` (`invalidTime`, `invalidTransition`), `unexpected`, `missingWriteScope`, `startOverride`, `startInvalid`, `startGoalAlreadyExists` and `unknownMethod_2026_6_5` → `'generic'` (or a defined mapping) and never throw. _(§8.5 "anything else")_
- [ ] **04-ERR.h** [R] A `chat` `error` event that the gateway broadcasts for a failed start or resume (`runId` = operationId) does not leave a stuck streaming bubble or a second error bubble beside the inline goal error. _(Gateway contract C-12)_

## FR-10 Live updates and reconnect

- [ ] **04-FR10.a** [U] `sessions.changed` with `goal` (`sessionsChangedGoalPaused`, `sessionsChangedRunEndBlocked`) updates the row's goal through the existing `{...sess, ...p}` merge. `goal:null` (`sessionsChangedGoalCleared`) returns the control to Set goal. A payload **without** a `goal` key (`sessionsChangedGlobalNoGoal`, `sessionsChangedDelete`) leaves the goal unchanged. _(FR-10, §5.5 /new)_
- [ ] **04-FR10.b** [U] Goal updates apply whatever the `reason` or `phase` (`sessionsChangedCoalesced` has `reason:'chat.dispatch-error'`). The code does not filter on `reason === 'goal'`. _(Gateway contract C-10)_
- [ ] **04-FR10.c** [R] On reconnect the goal refreshes. Today this comes from `App.tsx`'s `useSessionsStore.getState().fetch()` (a full `sessions.list` replace). The `sessions.subscribe` result only ADDS unknown rows (`store/sessions.ts` merge keeps known rows), so it does not refresh the goal of a known row. Verify a goal changed while offline shows after reconnect. _(FR-10, see Discrepancies)_
- [ ] **04-FR10.d** [U] `refreshRecent()` sends `sessions.list {activeMinutes:10, limit:50}` and MERGES rows by key. It does not replace the list. _(§8.1)_
- [ ] **04-FR10.e** [U] Given a `chat` `final` for a session whose goal is `active`, and no `sessions.changed` with a newer `goal.updatedAt` within 2 s, then `refreshRecent()` is called once. If a newer goal arrives within 2 s, it is not called. At most one call per run end. _(FR-10, §8.6)_
- [ ] **04-FR10.f** [M] Manual 1: new chat, Set goal "List three facts about Mars, then mark the goal complete". The Goal label shows, the reply streams, and the chip goes Pursuing → Goal done without a reload. _(§9 manual 1)_
- [ ] **04-FR10.g** [M] Manual 8: main window and pop-out on the same chat. Pause in one and the other updates. _(§9 manual 8)_
- [ ] **04-FR10.h** [M] Manual 7: type `/new` and the chip returns to Set goal. _(§9 manual 7, §5.5)_

## FR-11 Chat list and Sessions

- [ ] **04-FR11.a** [R/M] Desktop `ChatRow`: an 11px `Target` icon next to the cron and heartbeat icons, coloured `toneColor(goalView(goal).tone)`, with title l.markerTitle "Goal: {status label}". Shown only when `goal` exists and `status !== 'complete'`. _(FR-11, §5.1)_
- [ ] **04-FR11.b** [R/M] `MobileChatList` row: a 12px `Target` icon before the time, with the same rule and colour. _(§5.1)_
- [ ] **04-FR11.c** [R/M] `SessionsView` gets a **Goal** column header (s.column "Goal") right after Status. A cell shows a `Pill` (stateTone) and the objective truncated to 40 chars. Rows without a goal show an empty cell. _(FR-11, §5.1)_
- [ ] **04-FR11.d** [R] Marker and column are absent when the FR-1 gate is off. _(FR-1)_

## FR-12 Offline / FR-13 One pending action

- [ ] **04-FR12.a** [U] `availableActions(goal, {online:false, …})` → none. _(§9)_
- [ ] **04-FR12.b** [R/M] While disconnected, the chip still renders the last known state, and the actions are disabled with h.offline "Reconnect to manage the goal." _(FR-12)_
- [ ] **04-FR13.a** [U] While `pending[sessionKey]` exists, `act()`/`start()` for that session send nothing. _(FR-13)_
- [ ] **04-FR13.b** [R/M] While pending, the pressed action shows a `Loader2`, every action is disabled with title h.pending "Wait for the pending goal action.", and the chip keeps its current state until the result arrives. _(§5.3, §5.5 Loading)_

## Scope

- [ ] **04-SCOPE.a** [U] `availableActions(goal, {canWrite:false, …})` → none. _(§9)_
- [ ] **04-SCOPE.b** [R/M] Read-only token: the chip and popover render, actions are hidden, and h.readOnly "This connection can't change goals." shows. _(§5.5, §9 manual 11)_
- [ ] **04-SCOPE.c** [R] `canWrite` counts `operator.admin` as write. The gateway grants every method to admin (`authorizeOperatorScopesForMethod`). _(see Discrepancies)_

## §5.2 Control states and `goalView`

- [ ] **04-VIEW.a** [U] `goalView` for each status → label / icon / tone: none → "Set goal" / `Target` / idle; `active` → "Pursuing · {elapsed}" / `Target` / working; `paused` → "Goal paused" / `PauseCircle` / idle; `blocked` → "Goal blocked" / `AlertTriangle` / needsYou; `budget_limited` → "Budget reached" / `Gauge` / needsYou; `usage_limited` → "Usage limit reached" / `Gauge` / needsYou; `complete` → "Goal done" / `CheckCircle2` / done. _(§5.2, §9)_
- [ ] **04-VIEW.b** [U] Elapsed is `now − createdAt`: 0 → "0m", 59 min → "59m", 60 min → "1h 0m", 26h 3m → "26h 3m". _(§5.2, §9)_
- [ ] **04-VIEW.c** [U] `parseGoal`: a full record (`goalActive`) parses. A record missing optional fields (`goalMinimal`) parses. An unknown status (`looseGoalInputs.unknownStatus`) is kept and maps to the idle tone. `null`, `undefined`, strings and arrays → `null`. Numeric-string timestamps are accepted. Extra fields such as `tokenStart`/`tokenStartFresh` are tolerated. _(§9 parseGoal)_
- [ ] **04-VIEW.d** [R] The trigger uses `triggerStyle`. With a goal, the text is `toneColor(tone)` and the background `toneTint(tone, 12)`. The label truncates at 150px with an ellipsis. The title attribute is t.title "Goal: {objective}". _(§5.2, §5.1)_
- [ ] **04-VIEW.e** [R] The elapsed timer ticks once every 60 s, only while the goal is `active` and the chip is mounted, and the interval is cleared on unmount. _(§5.2, §8.6)_
- [ ] **04-VIEW.f** [M] Popover while active shows heading p.heading "Goal", the status pill, the objective, then p.time "Time", p.tokens "Tokens used" (e.g. "41,200"), and p.note "Agent's note" (only when `lastStatusNote`). Then the rows Pause / Edit / Mark done / Clear goal (`MenuRow danger`). _(§5.4)_

## Placement and phone

- [ ] **04-UI.a** [M] Desktop: GoalControl sits right after `ThinkingSelect` in the model/thinking group, before Files, Display, `⋯` and pop-out. The title is still the only element that shrinks. With the Files drawer open, nothing is pushed off. _(§5.1, §10, R3)_
- [ ] **04-UI.b** [M] Pop-out (`ChatView solo`): same as desktop. _(§5.1)_
- [ ] **04-UI.c** [M] Phone (390px): GoalControl is in header row 2 after ThinkingSelect, and the row scrolls sideways. The popover opens as a `BottomSheet` (`Popover sheetOnNarrow`). Actions are 40px-tall `Btn`s in a 2-column grid. Objective and note textareas use 16px font, so iOS doesn't zoom. _(§5.4 Phone, §9 manual 9)_
- [ ] **04-UI.d** [R] Popover width is 320 and right-aligned. _(§5.1)_

## §5.7 Keyboard and accessibility

- [ ] **04-A11Y.a** [R] Trigger is a `<button>` with `aria-haspopup="dialog"`, `aria-expanded`, and `aria-label` "Goal: {status label}" (or "Set goal"). _(§5.7; PRD 01 `Popover` hardcodes `'aria-haspopup': 'menu'` and `role="menu"`, see Ambiguities A7)_
- [ ] **04-A11Y.b** [R/M] Initial focus goes to the textarea (start, Continue) or the heading (view). Tab stays within the popover. Escape closes it and returns focus to the trigger. _(§5.7)_
- [ ] **04-A11Y.c** [R] Ctrl/Cmd+Enter submits Start goal, Continue and Save. Plain Enter inserts a newline. Arrow keys inside a textarea are not hijacked by the Popover's menu navigation. _(§5.7)_
- [ ] **04-A11Y.d** [R] Status changes are announced once via `aria-live="polite"` (e.g. "Goal blocked"). The icon and label always carry the state, so colour is never the only signal. _(§5.7)_

## Copy (exact strings, §5.6)

- [ ] **04-COPY.a** [R] Trigger labels: "Set goal", "Pursuing · {elapsed}", "Goal paused", "Goal blocked", "Budget reached", "Usage limit reached", "Goal done". The phone wireframe shows "Pursuing 24m": use the same t.active string on both.
- [ ] **04-COPY.b** [R] Popover: "Set a goal", "What should the agent keep working toward?", "The agent sees the goal on every turn and keeps going until it's done or blocked. /new clears it.", "Start goal", "Goal", "Time", "Tokens used", "Agent's note", "{used} of {budget}", "The agent is blocked:", "The goal used its token budget ({used} of {budget}).", "Add a note for the agent (optional)".
- [ ] **04-COPY.c** [R] Actions: "Pause", "Resume", "Continue", "Keep going", "Edit", "Save", "Cancel", "Saves without starting a run.", "Mark done", "Clear goal", "Start a new goal", "Clear this goal?", "Done after {elapsed} · {tokens} tokens".
- [ ] **04-COPY.d** [R] Hints and errors: "Wait for the reply to finish.", "Wait for the pending goal action.", "Reconnect to manage the goal.", "This connection can't change goals.", "The chat is still working. Try again when the reply finishes.", "Goals need an idle chat whose history the gateway can recover. Start a new chat to set a goal.", "The goal changed somewhere else. Here's the latest.", "Couldn't update the goal: {message}", "Keep the goal under 16,000 characters.".
- [ ] **04-COPY.e** [R] Other: bubble label "Goal", Sessions column "Goal", marker title "Goal: {status label}". None of the Control UI strings ("Goal achieved", "Goal unmet", "Pursuing goal") are used. _(§5.6 note, Q2)_

## §8 Technical design conformance

- [ ] **04-TD.a** [R] `src/lib/goals.ts` is pure (no store or React imports) and exports `parseGoal`, `goalView`, `availableActions`, `buildStartParams`, `buildUpdateParams`, `buildClearParams`, `classifyGoalError`, `validateObjective`, `eligibleSessionKey`. _(§8.1)_
- [ ] **04-TD.b** [R] `Session.goal?: SessionGoal | null` is added in `lib/types.ts`. `useSessionsStore` is the only source of truth for the goal. `store/goals.ts` holds only `pending` and `errors`. _(§8.1, §8.2)_
- [ ] **04-TD.c** [U] Ordering: a result's goal is written only when it is newer than the row's goal (`updatedAt`) with the same `goalId`, or when the row has no goal. A clear result writes `null`. A start result after a clear writes the new goal even if the id differs. _(§8.2; see Ambiguities A5)_
- [ ] **04-TD.d** [R] Goal colours come only from `stateTone` (`toneColor`/`toneTint`), with no hardcoded colour values. _(§6, stateTone.ts header)_
- [ ] **04-TD.e** [U] `src/lib/__tests__/goals.test.ts` exists and covers every §9 bullet. _(§9)_

## Gateway contract (correct per 2026.9.4 source)

- [ ] **C-1** `sessions.goal.update` and `sessions.goal.clear`: scope `operator.write`, advertised (no `advertise:false`), since "2026.8" (`method-scopes-tKV11oMS.mjs:1404-1415`). Absent in 2026.6.5.
- [ ] **C-2** Update params are a union of two **closed** objects: `{sessionKey, agentId?, sessionId?, goalId, operationId(1–128), issuedAtMs(int ≥0), action:'edit', objective(1–16000)}` or `{…identity, action:'pause'|'resume'|'complete'|'block', note?(≤2000)}`. Unknown keys → `INVALID_REQUEST "invalid sessions.goal.update params: …"` (`sessions-goal-U8Cv3IfC.mjs:424-451`).
- [ ] **C-3** Clear params are the closed identity object only, with no `action` (`:452`).
- [ ] **C-4** Result `{operationId, action, sessionId, goalId, goal?, runId?, replayed?:true, status:'started'|'updated'|'cleared'}`. `status` is `started` iff a turn was admitted (resume). `goal` is absent after clear. Resume ACKs also carry `messageSeq`, and parsing must be loose (`chat-send-handler-oS9rX200.mjs:4931`).
- [ ] **C-5** `chat.send` goal start: `intent:{kind:'session-goal-start', version:1, issuedAtMs}` (closed). `idempotencyKey` is the operationId (≤128). The objective must be non-blank, ≤16,000 UTF-16 units, already NFC, and free of disallowed control chars. Forbidden with intent: `thinking`, `fastMode`, `fastAutoOnSeconds`, `timeoutMs` (param), `deliver:true`, `toolBindings`, `queueMode`, origin fields, system-input fields, `mentions` (`:4386-4393`, `:4434`).
- [ ] **C-6** Start ACK `{operationId, action:'start', sessionId, goalId, goal, runId(=idempotencyKey), status:'started', messageSeq?}`. A replay returns the historical receipt with `replayed:true`.
- [ ] **C-7** Start on a session that already has a goal fails ("goal already exists"). The UI must clear first (Start a new goal = clear → start).
- [ ] **C-8** Transitions: only `complete` is terminal. Edit, pause, resume and block on a complete goal → `invalid` "goal is already complete". Resume from `budget_limited`/`usage_limited` resets `tokensUsed` to 0 and deletes `budgetLimitedAt`/`usageLimitedAt`. A `note` on any status action (pause, resume, complete, block) **overwrites `lastStatusNote`**, and the note is never cleared (`session-accessor-BxcCxteu.mjs:4490-4516`).
- [ ] **C-9** Receipts: keyed by (sessionKey, operationId), valid until `issuedAtMs + 24h`. The fingerprint covers the whole request (method + every param incl. `issuedAtMs`, `sessionId`, `agentId`), HMAC'd with the gateway device key. Same request → historical result + `replayed:true` (no `sessions.changed`). Different payload → `operation-conflict`. `issuedAtMs` > now + 5 min → `invalid`. `issuedAtMs` + 24 h ≤ now → `expired`. ≥4096 live receipts → `capacity` (`:4532-4661`).
- [ ] **C-10** Error forms differ by path. `sessions.goal.update/clear` (non-resume) → `INVALID_REQUEST` + `details:{code:'GOAL_OPERATION_REJECTED', reason}` with reasons `invalid|expired|operation-conflict|session-rebound|goal-rebound|capacity`. The chat.send path (start AND resume) receipt lookup → `details:{reason:'goal-'+code}` (e.g. `goal-operation-conflict`). Transition errors during a start/resume turn → `UNAVAILABLE` with message `"SessionGoalOperationError: …"` and no details. Busy → `UNAVAILABLE`, `retryable:true`, `details.reason:'goal-session-busy'`. Ineligible → `INVALID_REQUEST`, message only.
- [ ] **C-11** Broadcast: a non-replayed operator change → `sessions.changed {sessionKey, agentId, reason:'goal', ts, …row snapshot incl. goal}`, debounced 100 ms / max 500 ms, where the last payload wins. The agent's `update_goal`/`create_goal` emit **no** `sessions.changed`. The new goal rides on the next snapshot-bearing event: the run-end `sessions.changed {phase:'end'}`, a transcript `session.message`/`sessions.changed {phase:'message'}`, or `agent` tool events to tool-event recipients.
- [ ] **C-12** Resume runs a chat turn with `runId` = `operationId` and a hidden user message "Continue pursuing the current goal." (+ "\nOperator note: {note}"). A failed start/resume turn also broadcasts a `chat` error event for that runId.
- [ ] **C-13** Row goal: `goal` on `sessions.list`/`subscribe` rows is **absent** when there is none. On `sessions.changed` it is `row.goal ?? null`, except it is omitted for the unscoped `global` row and for delete payloads. The row goal is a read-time projection: `tokensUsed` may grow and `status` may read `budget_limited` with `updatedAt ≈ now` without a stored write.
- [ ] **C-14** Capability `session-goal-start-v1` is always in hello-ok `features.capabilities` on 2026.9.4 (`message-handler-BBAGn2rf.mjs:2319`). No dedicated goal event exists in `GATEWAY_EVENTS`.
- [ ] **C-15** `sessions.patch {key, thinkingLevel}` requires `operator.admin`. Only `label, autoLabel, icon, color, category, boardFace, pinned, archived, unread, model, permissionMode` are write-scope (`method-scopes-tKV11oMS.mjs:11-43`).
- [ ] **C-16** Missing scope → `FORBIDDEN "missing scope: operator.write"`, `details:{code:'MISSING_SCOPE', missingScope, requiredScopes}`. Unknown method (2026.6.5) → `INVALID_REQUEST "unknown method: sessions.goal.update"`, and chat.send with `intent` → `"invalid chat.send params: at root: unexpected property 'intent'"`.
- [ ] **C-17** `/new` and `/reset` clear the goal and rotate `sessionId`, so a pending retry then gets `session-rebound`.

## Regression

- [ ] **04-REG.a** [U/R] Normal `sendMessage` is unchanged: it still sends `thinking` when set, attachments, a fresh `nanoid(16)` idempotencyKey, and the init-conflict retry.
- [ ] **04-REG.b** [R] `sessions.changed` merge in `store/sessions.ts` still merges whole payloads. A `goal` field doesn't break sorting, filtering or the running signal (`useSessionRunning`, `lib/sessionRunning.ts`).
- [ ] **04-REG.c** [R/M] Header on desktop and phone: ModelSelect, ThinkingSelect, Files, Display and pop-out still work and keep their order: model, thinking, **goal** | Files, Display, ⋯, pop-out.
- [ ] **04-REG.d** [M] Typing `/goal …` in the composer still sends it as ordinary text, which the gateway interprets.
- [ ] **04-REG.e** [R] History reload (`chat.history`) doesn't show the hidden resume prompt, and doesn't crash on goal-start user messages. The Goal label is not expected after reload (R2).
- [ ] **04-REG.f** [M] Chats on older gateways (2026.6.5) behave exactly as before, with no new failed requests in the gateway log: no `sessions.goal.*` calls and no `chat.send` with `intent`.
- [ ] **04-REG.g** [U] `npm test`, `tsc -p tsconfig.web.json --noEmit` and eslint pass.

## Ambiguities / untestable

- **A1** (L61, L389) The PRD writes the start result `status:"started"` and FR-2 "idempotencyKey ≤128". Both are correct, but the ACK also carries `messageSeq`/`serverTiming`/`interruptedActiveRun` outside the closed schema. It doesn't say whether `sendGoalStart` validates strictly. Parse loosely.
- **A2** (L170, L393) FR-3 needs `sessions.patch {thinkingLevel}`, which requires `operator.admin`. The PRD doesn't say what happens when the patch fails (write-only token): abort the start, or start at the session's current level with a warning.
- **A3** (L172, L302-305, FR-5 L399) F1.6 says the popover closes on submit, but FR-5/§5.5 want e.busy shown inline with the draft kept when the gateway answers `goal-session-busy`. The ACK arrives after admission, so it's unclear whether the popover stays open until the ACK or reopens on error.
- **A4** (L308, L479) "operation-conflict → new operationId, retry once" doesn't say whether `issuedAtMs` is refreshed too. Either works against the gateway, but the tests need one answer.
- **A5** (L453) The ordering rule "write only if updatedAt newer and goalId matches, or no goal" conflicts with Start a new goal (new goalId while the row still holds the old goal if the clear's event lags), with clear (no goal in result), and with row projections whose `updatedAt` is synthetic (budget crossing).
- **A6** (L310, L419 vs L464-468) FR-12 keeps the chip offline, but the §8.4 gate (and `useGatewaySupport`) evaluates false when disconnected. As written, GoalControl vanishes offline.
- **A7** (L357 vs L143, L372) The PRD requires `aria-haspopup="dialog"` and a form-bearing popover, but PRD 01 `Popover` hardcodes `aria-haspopup='menu'`, `role="menu"`, focuses the menu on open, and captures ArrowUp/Down. That conflicts with textarea autofocus (L166, L358) and Tab-cycling. Either Popover needs a variant or GoalControl can't "reuse Popover" as written.
- **A8** (L229, L283, L330) "Agent's note" labels `lastStatusNote`, but the gateway also writes the OPERATOR's resume/Continue/pause note there, and never clears it. After Continue with "the key is in the vault", the popover would attribute the operator's note to the agent, and a stale blocked reason persists while Pursuing.
- **A9** (L194, L415) FR-10's "no newer goal.updatedAt within 2 s → re-read once" isn't deterministic: the run-end `sessions.changed` (which carries the goal) may arrive before or after `final`, and a goal that didn't change never gets a newer `updatedAt`. The fallback is then always taken on every active-goal turn. "Once" per run or per session is unspecified.
- **A10** (L311, L386) FR-1 hides the marker and column on older gateways, but 2026.6.5 already carries `goal` on rows/events (set via `/goal` or the model tool). Hiding read-only goal display there is a product choice the PRD doesn't state explicitly.
- **A11** (L467) `canWrite = grantedScopes.includes('operator.write')` treats an admin-only grant as read-only, although the gateway authorises admin for every method.
- **A12** (L159, L507-511) `usage_limited` has a label but no primary action, and §9 tests only `budget_limited` → Keep going. The gateway resumes `usage_limited` the same way.
- **A13** (L162, L340) `{elapsed}` for the Done summary: `completedAt − createdAt` or `now − createdAt`? "Time" in the popover for paused or blocked goals is also unspecified (does it keep ticking?).
- **A14** (L417 vs L145) FR-11 excludes `complete` from the chat-list marker. The PRD doesn't say whether the Sessions column shows complete goals: FR-11 implies no, the §5.4 table example doesn't say.
- **A15** (L480, L482) `capacity → e.generic`: does it get the Retry button that "anything else" gets? Retrying the same op would keep failing.
- **A16** (L86, L558) Fact 11 / R1 "unverified" is now answered by source (see contract C-11). The fallback is still reasonable, but the risk text is stale.
- **A17** (L40-L48, L141, L150) Several line references predate PRD 01. `triggerStyle`/`MenuRow` now live in `src/components/ui/Popover.tsx`, and `chat.ts` sites moved (thinking clear is at ~780, the send at ~1135-1149). This isn't testable as written, so reviewers should use symbols.
- **A18** (L173, L559) "Goal label … client-side, for this session": the label is untestable after reload by design (R2). Manual 1 should check it only before reload.
- **A19** (L535) Manual 1 relies on the model choosing to call `update_goal`. That's non-deterministic, so it's not a reliable pass/fail step.
