# PRD 04: Chat goals

| | |
|---|---|
| **Status** | Draft for approval · 18 Sep 2026 |
| **Owner** | PM A |
| **Plan section** | Phase 2 · "Chat goals" |
| **Baseline** | `main` @ 374064e · gateway OpenClaw 2026.9.4 |
| **Depends on** | [PRD 01](01-shared-groundwork.md): `Popover`/`MenuRow`/`triggerStyle`, `BottomSheet` (via `Popover sheetOnNarrow`), `Pill`, `stateTone`, `Textarea` (existing `ui/Input`), `useGatewaySupport` |
| **Decision (binding)** | Goals live in the **chat header**. A "Set goal" button becomes a status chip with a popover. The composer is unchanged. |
| **Effort** | M (3 days), 3 PRs |

---

## 1. Summary

**Problem.** The gateway can hold one durable objective per chat, a *goal*. While the goal is active, the agent sees it on every turn. The agent can mark it done or blocked. You can pause it, resume it, edit it or clear it. JoaxClaw has none of this, so the only way to use goals is to type `/goal …` commands, and you can't see a goal's state anywhere.

**Outcome.** A chat's goal is a setting of the chat, shown in the header next to the model and thinking level:
- **Set goal** starts one.
- The control then becomes a chip coloured by state: Pursuing, Paused, Blocked, Budget reached or Done.
- The chip's popover shows the objective, time, tokens and the agent's last note, and holds every action.
- When the agent reports it's blocked, the chip turns amber, and **Continue** resumes the goal with a note.
- The chat list and the Sessions table mark chats that have a goal.

**Solution.**
- A pure `lib/goals.ts` parses the goal loosely and maps its status to a label and tone. It also builds operation requests that can be retried.
- `GoalControl` (the button or chip, plus a `Popover`) sits in both header layouts in `ChatView`.
- Starting a goal is a `chat.send` with `intent: {kind:"session-goal-start", version:1}`, sent through the chat store so the reply streams like any other turn.
- Every other action is `sessions.goal.update` or `sessions.goal.clear`.
- The goal's state arrives on the session row (`sessions.subscribe`/`sessions.changed`), which the sessions store already follows and renews on reconnect.

## 2. Background and evidence

### 2.1 How the app behaves today

| Behaviour | Evidence |
|---|---|
| The desktop header is one row: 🤖, title (the only part that shrinks), session chip, heartbeat, then the `ModelSelect` + `ThinkingSelect` group, then Files, Display and pop-out on the right | `ChatView.tsx:535-617`; the title-shrink comment is at `:541-543`; the model and thinking group is at `:559-575` |
| The phone header is two rows. Row 2 holds only model and thinking, and scrolls sideways. | `ChatView.tsx:480-533`, row 2 at `:518-532` |
| Header controls share `triggerStyle`, `menuStyle` and `MenuRow` (private) | `ChatHeaderControls.tsx:14-39, 197-214` |
| A chat without a session gets one on its first send, through `sessions.create` | `store/chat.ts:1059-1068` |
| `chat.send` carries `thinking` from the chat's own setting. The gateway stores the level on the session. | `store/chat.ts:1133-1146, 770-779` |
| The `Session` type has no `goal`. `sessions.changed` payloads are merged whole into the row (`{...sess, ...p}`), so a `goal` field would carry through without changes. | `lib/types.ts:46-72`; `store/sessions.ts:116-127` |
| The sessions subscription is renewed on every reconnect through `connectionSeq` | `store/sessions.ts:69-111` (PR #75) |
| History loading keeps only `user` and `assistant` roles | `store/chat.ts:576-583` |
| A "running" signal exists that is shared by the chat list and the composer | `components/chat/useSessionRunning.ts`, `lib/sessionRunning.ts` |
| Cron, heartbeat and subagent sessions are recognised by their keys | `lib/sessionName.ts:3-11`; `ChatView.tsx:837-841` |

### 2.2 What the gateway offers (2026.9.4, verified in source)

- **Schemas:** `dist/sessions-rlbLHLas.mjs` (`ChatSendIntentSchema`), `dist/sessions-goal-U8Cv3IfC.mjs` (goal methods and `SessionGoalSchema`).
- **Handlers:** `dist/sessions-goal-IoWLbKRI.mjs`, `dist/chat-send-handler-oS9rX200.mjs`.
- **Operations:** `dist/session-accessor-BxcCxteu.mjs`.
- **Scopes:** `dist/method-scopes-tKV11oMS.mjs`.
- **Capability:** `GATEWAY_SERVER_CAPS.SESSION_GOAL_START = "session-goal-start-v1"`, in hello-ok `features.capabilities` (`dist/message-handler-BBAGn2rf.mjs`).
- **Docs:** `docs/tools/goal.md`.

| Method / field | Scope | Since | Params → result | Used for |
|---|---|---|---|---|
| `chat.send` + `intent` | write | 2026.8 (capability `session-goal-start-v1`) | `{sessionKey, message: objective (1–16000, NFC), idempotencyKey (≤128) = operationId, intent: {kind:"session-goal-start", version:1, issuedAtMs}}` → `{operationId, action:"start", sessionId, goalId, goal, runId, status:"started"}` | Start goal (runs a turn) |
| `sessions.goal.update` | write | 2026.8 | `{sessionKey, sessionId?, agentId?, goalId, operationId (1–128), issuedAtMs, action:"edit", objective}` or `{…, action: pause｜resume｜complete｜block, note? (≤2000)}` → `{operationId, action, sessionId, goalId, goal?, runId?, replayed?, status: started｜updated}` | Edit, Pause, Resume/Continue (runs a turn), Mark done |
| `sessions.goal.clear` | write | 2026.8 | identity fields only → `{…, status:"cleared"}` | Clear; Start a new goal |
| Session row `.goal` | read | 2026.8 | `SessionGoal` on `sessions.list`/`subscribe` rows, and `goal: row.goal ?? null` on `sessions.changed` (`session-event-payload-6znNKcu1.mjs`). **Not in the published row schema**, which passes it through via `additionalProperties:true` (`sessions-row-Dtn8TM28.mjs`). | Chip state, chat-list marker, Sessions column |
| `sessions.changed` `reason:"goal"` | read (needs `sessions.subscribe`) | 2026.8 | Emitted after every non-replayed operator change | Live chip updates |

**SessionGoal:**
```
{ schemaVersion: 1, id, objective,
  status: active ｜ paused ｜ blocked ｜ usage_limited ｜ budget_limited ｜ complete,
  createdAt, updatedAt, tokensUsed, tokenBudget?, continuationTurns, lastStatusNote?,
  pausedAt?, blockedAt?, completedAt?, budgetLimitedAt?, usageLimitedAt? }
```

**Facts that change or correct the plan:**
1. **A goal start can't carry `thinking`.** It also can't carry a timeout, `deliver`, tool bindings or fast mode. The gateway answers "Goal start uses the session settings and local delivery; per-request runtime or routing overrides are not supported." (`chat-send-handler-oS9rX200.mjs`). JoaxClaw sends `thinking` on every normal message (`store/chat.ts:1133-1136`), so the goal start needs its own send path. To keep the chat's chosen level, it first saves the level on the session with `sessions.patch {thinkingLevel}`, which chat.ts already does for clearing (`:778`).
2. **No token budget from the operator.** Only the model's `create_goal` tool takes `token_budget`. The plan's open question is answered: no.
3. **The gateway writes no "Goal paused" lines.** Edit, pause, complete, block and clear add *no* transcript entries, only `sessions.changed` and a state event. The start is written as an ordinary visible **user message** (the objective). A resume is written as a hidden user message (`display:false`). The plan's "thread records goal changes as small system lines, so the history reads correctly later" can't be done from gateway data. Client-side lines would vanish on reload. See §5.3 and §11 Q1.
4. **"Kept going N turns" isn't available.** `continuationTurns` is set to 0 when a goal is created, and nothing in 9.4 increments it. The mockup's "Kept going 6 turns" is dropped.
5. **Blocked has no separate reason field.** The agent's note (from `update_goal {status:"blocked", note}`) is `lastStatusNote`.
6. **Statuses the plan missed:** `usage_limited` (reserved, never set) and `budget_limited`. The latter is set automatically when `tokensUsed ≥ tokenBudget`. Resuming from it resets the budget window.
7. **The agent can only mark a goal complete or blocked** (`update_goal`). It can't pause, resume, edit or clear. Per turn, only while the goal is active, the agent receives "Active goal: {objective ≤200 chars} — advance; keep active until fully achieved; block only after the same blocker on 3 consecutive turns…" (`inbound-meta-CYxFWb4j.mjs`).
8. **"Keeps going when you say continue" is not automatic.** There's no auto-loop. Work continues only through an operator resume (a hidden "Continue pursuing the current goal." turn), or through `/goal resume`.
9. **Start and resume need an idle, restart-safe session.** A busy session fails with `UNAVAILABLE` "This session still has active or queued work…" (`details.reason:"goal-session-busy"`, retryable). A subagent, cron, ACP, harness, global, archived or non-local session fails with "Goal start or resume requires an idle local session with recoverable history…".
10. **Operation IDs.** Receipts are kept 24 h. Repeating the same `operationId` with the same payload returns the *historical* result with `replayed:true`. Repeating it with a different payload gives `operation-conflict`. A `goalId` that's no longer current gives `goal-rebound`. An `issuedAtMs` more than 5 min ahead of the gateway clock gives `invalid`.
11. **When agent-made changes reach clients is unverified.** When the model calls `update_goal`, the gateway records a state event. I could not confirm that it emits `sessions.changed` at that moment, as opposed to at the next row refresh or the run-end `sessions.changed`.
12. `/new` and `/reset` clear the goal (`get-reply-DlAuUdnm.mjs`).

### 2.3 How the Control UI does it
The Control UI puts a **pill above the composer** (`control-ui-boot-shared-BpwdVi0Y.js`). The pill has a status label, the objective, a live elapsed timer, action chips and a details chevron. Goals are started in a **"Goal" composer mode**.

- **Status labels:** "Pursuing goal", "Goal paused", "Goal blocked", "Goal hit usage limits", "Goal unmet" (budget), "Goal achieved".
- **Other strings** (`chat.goals` in `control-ui-core-CgyBiPIN.js`):
  - "Start goal", "What should this goal accomplish?", "Save goal"
  - "Reconnect to manage goals.", "Wait for this run to finish. Your draft is unchanged.", "Wait for the pending goal action."
  - "Edit goal", "Pause goal", "Resume goal", "Clear goal"
- **Behaviour:**
  - Only one action can be pending at a time.
  - Retries reuse the cached `operationId`.
  - A `replayed` result refreshes the session list.
  - It gates on the capability.

**We deliberately differ on placement.** The owner chose the header (plan decision). The Control UI's composer mode is exactly what the owner rejected.

### 2.4 Prior art
- **Linear project status (On track, At risk, Off track, plus a latest update):** the status is a small coloured chip, and the reason lives one click away with the author and date. Lesson: the chip carries the state, and the popover carries the explanation (here, the agent's last note).
- **GitHub issue state (open, closed as completed, closed as not planned):** "done" is final, and reopening is an explicit action. Lesson: Done offers "Start a new goal", not "Reopen". The gateway enforces this too.
- **Chat-product "custom instructions" and project instructions:** a persistent directive set outside the thread, in settings. Lesson: this supports the owner's header placement. A goal is chat configuration, not a message.

## 3. Goals / Non-goals

**Goals**
- G1. Set, see and manage a chat's goal from the header, on desktop, on a phone and in pop-out windows.
- G2. The state is always visible: Pursuing, Paused, Blocked, Budget reached, Done.
- G3. A blocked goal gets one obvious action: **Continue** with an optional note.
- G4. Mark chats that have a goal in the chat list and the Sessions table.
- G5. Retries are safe. A flaky connection never starts two turns or double-applies an action.

**Non-goals**
- Changing the composer (owner decision). `/goal …` typed into the composer keeps working as ordinary text commands.
- Setting a token budget (not possible from the operator, §2.2 fact 2).
- An operator "Mark blocked" action. The gateway supports it, but it isn't useful to the user, who would pause instead.
- Thread lines for goal changes (§2.2 fact 3, §11 Q1).
- Goals on subagent, cron, heartbeat or ACP sessions. The gateway refuses them.

## 4. Users and jobs

- **U1.** As the user, I want to give a chat an objective the agent keeps in mind every turn ("migrate billing to v2 and get tests green"), so I don't repeat it.
- **U2.** As the user, I want to see at a glance whether the agent is still pursuing it, paused, blocked or done.
- **U3.** As the user, when the agent says it's blocked, I want to read why and tell it how to continue ("the key is in the vault now").
- **U4.** As the user, I want to pause the goal while I chat about something else, then resume it.
- **U5.** As the user on my phone, I want the same controls without the header overflowing.
- **U6.** As the user scanning my chats, I want to see which ones have a goal in progress.

## 5. UX specification

### 5.1 Entry points and placement

| Surface | Placement and justification |
|---|---|
| **GoalControl, desktop** | In the header's control group, right after `ThinkingSelect` (`ChatView.tsx:559-575`). Integration rule 1: the chat's settings live in the header. The title stays the only element that shrinks, and the chip's label truncates at 150px so it never pushes the Files, Display or pop-out controls off (`:541-543`). |
| **GoalControl, phone** | Header row 2, after ThinkingSelect (`ChatView.tsx:518-532`). The row already scrolls sideways. |
| **Popover** | PRD 01 `Popover`, right-aligned, width 320. On a phone it becomes a `BottomSheet` (`sheetOnNarrow`). |
| **Chat list marker** | A `Target` icon (11px) on `ChatRow` next to the cron and heartbeat icons (`ChatView.tsx:840-841`). On a phone, `MobileChatList`'s row gets a 12px icon before the time. The icon takes the goal's tone colour. |
| **Sessions tab** | A new **Goal** column after Status (`SessionsView.tsx:291-296`), with a `Pill` and the objective truncated to 40 chars |
| Pop-out chat window | Same as desktop. The pop-out renders `ChatView solo` with the same header (`ChatView.tsx:50, 595-616`). |

### 5.2 Control states

The trigger uses `triggerStyle` (`ChatHeaderControls.tsx:26-32`), like ModelSelect and ThinkingSelect. With a goal, the trigger is tinted by tone: text in the tone colour and background `toneTint(tone, 12)`.

| Goal status | Control label | Icon | Tone |
|---|---|---|---|
| none | Set goal | `Target` | idle (text-secondary) |
| `active` | Pursuing · {elapsed} | `Target` | working (accent) |
| `paused` | Goal paused | `PauseCircle` | idle |
| `blocked` | Goal blocked | `AlertTriangle` | needsYou (amber) |
| `budget_limited` | Budget reached | `Gauge` | needsYou |
| `usage_limited` | Usage limit reached | `Gauge` | needsYou |
| `complete` | Goal done | `CheckCircle2` | done (green) |

`{elapsed}` is `now − createdAt`, formatted as "24m" or "3h 10m". It ticks once a minute while the goal is active. The Control UI's timer runs from the same field.

### 5.3 Flows

**F1 Set a goal.**
1. Click **Set goal**. The popover opens with a `Textarea` (autofocus) and the helper text.
2. Type the objective. Ctrl/Cmd+Enter or **Start goal** submits it. The button is disabled while the field is empty, or over 16,000 characters (a counter shows past 15,000).
3. If the chat has no session yet, create one with `sessions.create`, exactly as the first send does (`store/chat.ts:1059-1068`).
4. If the chat has a non-adaptive thinking level, send `sessions.patch {key, thinkingLevel}` first. The goal's turns then run at the level shown in the header (§2.2 fact 1).
5. `chat.send {sessionKey, message: objective, idempotencyKey: opId, intent}`, with no `thinking` and no attachments. It goes through the chat store so the user bubble and the streaming reply appear as usual.
6. The popover closes and the chip shows **Pursuing · 0m**. The objective appears as the user's message, with a small `◎ Goal` label on the bubble (client-side, for this session; see §11 R2).

**F2 View.** Click the chip to open the popover (§5.4). It is read-only until you pick an action.

**F3 Pause / Resume.**
- **Pause** sends `sessions.goal.update {action:"pause"}`. There is no turn. The chip goes to Goal paused.
- **Resume** opens an optional note field, "Add a note for the agent (optional)", then sends `{action:"resume", note?}`. This **runs a turn**: the reply streams into the thread. The gateway writes the "Continue pursuing the current goal." prompt hidden.

**F4 Blocked → Continue.**
1. When the agent reports it's blocked, the chip turns amber: Goal blocked.
2. The popover leads with "The agent is blocked:" and shows `lastStatusNote`.
3. The primary action is **Continue**, with the note field expanded and focused.
4. Submitting sends `resume` with the note, and the chip goes back to Pursuing.

**F5 Budget reached.** The popover says "The goal used its token budget ({used} of {budget})." The primary action is **Keep going**, which resumes and resets the budget window (§2.2 fact 6).

**F6 Edit.** **Edit** turns the objective text into a `Textarea` with Save and Cancel, then sends `{action:"edit", objective}`. There is no turn: "Saves without starting a run." Edit isn't available once the goal is Done.

**F7 Mark done.** **Mark done** sends `{action:"complete"}`, and the chip turns green. This is final: the popover then offers **Start a new goal** (which clears, then runs F1) and **Clear**.

**F8 Clear.** **Clear** asks inline, with no dialog: the row turns into "Clear this goal? [Clear] [Cancel]". Confirming sends `sessions.goal.clear`, and the control goes back to Set goal.

**F9 Agent marks done or blocked.** A `sessions.changed` with the new goal updates the chip. The arrival time is unverified (§2.2 fact 11), so as a fallback: when a `chat` `final` event arrives for this session with a goal active, and no newer `goal.updatedAt` has come within 2 s, the store re-reads the session rows (`sessions.list {activeMinutes: 10, limit: 50}`) and merges them.

**One action at a time.** While any goal operation is pending, every action button is disabled, with the title "Wait for the pending goal action."

### 5.4 Wireframes

**Desktop header, no goal**
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🤖 Billing migration  agent:main:dash…  [◈ gpt-5.2 ▾] [🧠 High ▾] [◎ Set goal]   📁 [⚙ Basic ▾] ⧉ │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                        ┌─ Popover 320 ───────────────────┐
                                                        │ Set a goal                       │
                                                        │ ┌──────────────────────────────┐ │
                                                        │ │What should the agent keep    │ │
                                                        │ │working toward?               │ │
                                                        │ └──────────────────────────────┘ │
                                                        │ The agent sees the goal on every │
                                                        │ turn and keeps going until it's  │
                                                        │ done or blocked. /new clears it. │
                                                        │                   [Start goal]   │
                                                        └──────────────────────────────────┘
```

**Desktop header, active goal, popover open**
```
│ 🤖 Billing migration  agent:main:dash…  [◈ gpt-5.2 ▾] [🧠 High ▾] [◎ Pursuing · 24m]  📁 [⚙] ⧉ │
                                                        ┌──────────────────────────────────┐
                                                        │ Goal              (Pursuing)     │
                                                        │ Migrate billing to the v2        │
                                                        │ payments API and get the test    │
                                                        │ suite green.                     │
                                                        │ ──────────────────────────────── │
                                                        │ Time          24 min             │
                                                        │ Tokens used   41,200             │
                                                        │ Agent's note  3 tests left       │
                                                        │ ──────────────────────────────── │
                                                        │ ⏸ Pause                          │
                                                        │ ✎ Edit                           │
                                                        │ ✓ Mark done                      │
                                                        │ ✕ Clear goal                     │
                                                        └──────────────────────────────────┘
```
The actions are `MenuRow`s, as in the existing header menus (`ChatHeaderControls.tsx:197-214`). "Clear goal" uses `MenuRow danger`.

**Blocked**
```
                                                        ┌──────────────────────────────────┐
                                                        │ Goal           (Goal blocked)    │
                                                        │ Migrate billing to the v2 …      │
                                                        │ ┌ ⚠ The agent is blocked: ─────┐ │
                                                        │ │ No STRIPE_V2_KEY in the env. │ │
                                                        │ └──────────────────────────────┘ │
                                                        │ ┌──────────────────────────────┐ │
                                                        │ │Add a note for the agent      │ │
                                                        │ │(optional)                    │ │
                                                        │ └──────────────────────────────┘ │
                                                        │                   [Continue]     │
                                                        │ ✎ Edit   ✓ Mark done   ✕ Clear   │
                                                        └──────────────────────────────────┘
```
The "blocked" box uses `color-mix(--warning 10%, --bg-surface)` with a `--warning` border, the same tinted-notice style as `TextToolNotice` (`AssistantMessage.tsx:106`).

**Done**
```
                                                        ┌──────────────────────────────────┐
                                                        │ Goal             (Goal done ✓)   │
                                                        │ Migrate billing to the v2 …      │
                                                        │ Done after 2h 10m · 188,400 tok  │
                                                        │ Agent's note  All 412 tests pass │
                                                        │ ◎ Start a new goal               │
                                                        │ ✕ Clear goal                     │
                                                        └──────────────────────────────────┘
```

**Phone**
```
┌──────────────────────────────────────┐
│ ←  🤖 Billing migration     📁  ⚙    │
│ [gpt-5.2 ▾] [High ▾] [◎ Pursuing 24m]│  ← row 2, scrolls sideways
├──────────────────────────────────────┤
│ (Plan 2/3) (Background 1)            │  ← PRD 01 strip chips
├──────────────────────────────────────┤
tap the chip ↓
┌──────────────────────────────────────┐
│               ───                    │
│  Goal                (Pursuing)  ✕   │
│  Migrate billing to the v2 payments  │
│  API and get the test suite green.   │
│  Time 24 min · Tokens 41,200         │
│  Agent's note: 3 tests left          │
│  [ Pause ]  [ Edit ]                 │
│  [ Mark done ]  [ Clear goal ]       │
└──────────────────────────────────────┘
```
On a phone the actions are 40px-tall `Btn`s in a two-column grid instead of menu rows, for tap targets. The objective field is 16px so iOS doesn't zoom.

**Chat list and Sessions**
```
Chat list row:  ● Billing migration                 ◎  10:42
Sessions table: Name              │ Status   │ Goal                              │ Model │ …
                Billing migration │ (Idle)   │ (Pursuing) Migrate billing to …   │ …
```

### 5.5 Every state

| Condition | Behaviour |
|---|---|
| No goal (empty) | "Set goal" trigger in `text-secondary`. The popover holds the start form. |
| Loading (operation pending) | The pressed action shows a `Loader2` and every action is disabled ("Wait for the pending goal action."). The chip keeps its current state until the result comes back. |
| Reply running (not idle) | Start goal, Resume, Continue and Keep going are disabled, with the inline hint "Wait for the reply to finish." Pause, Edit, Mark done and Clear stay enabled, because they don't start a turn. |
| Error, busy (`goal-session-busy`) | Inline under the action: "The chat is still working. Try again when the reply finishes." The objective draft is kept. |
| Error, session not eligible | "Goals need an idle chat whose history the gateway can recover. Start a new chat to set a goal." |
| Error, `goal-rebound` / "Session changed or was removed" | Re-read the session row. Inline: "The goal changed somewhere else. Here's the latest." |
| Error, `operation-conflict` | Build a new `operationId` and retry once, silently. |
| Error, other | Inline `--danger` line, "Couldn't update the goal: {message}", with Retry. Retry reuses the same `operationId` (FR-7). |
| Offline / reconnecting | The chip stays, showing the last known state. Actions are disabled with the hint "Reconnect to manage the goal." |
| Older gateway (no `session-goal-start-v1` or no `sessions.goal.update`) | GoalControl isn't rendered. No chat-list marker, no Sessions column. |
| Scope: no write | Chip and popover are read-only. Actions are hidden, with the hint "This connection can't change goals." |
| Session kind not eligible (subagent, cron, heartbeat keys) | GoalControl isn't rendered. |
| Remote vs local gateway | Identical, all over WS RPC. |
| `/new` or `/reset` typed | `sessions.changed` brings `goal: null`, and the control returns to Set goal. |

### 5.6 Copy

| Id | String |
|---|---|
| t.set | Set goal |
| t.active | Pursuing · {elapsed} |
| t.paused / t.blocked / t.budget / t.usage / t.done | Goal paused / Goal blocked / Budget reached / Usage limit reached / Goal done |
| t.title | Goal: {objective} *(trigger title attribute)* |
| p.startTitle | Set a goal |
| p.placeholder | What should the agent keep working toward? |
| p.help | The agent sees the goal on every turn and keeps going until it's done or blocked. /new clears it. |
| p.start | Start goal |
| p.heading | Goal |
| p.time / p.tokens / p.note | Time / Tokens used / Agent's note |
| p.tokensBudget | {used} of {budget} |
| p.blockedLead | The agent is blocked: |
| p.budgetLead | The goal used its token budget ({used} of {budget}). |
| p.notePlaceholder | Add a note for the agent (optional) |
| a.pause / a.resume / a.continue / a.keepGoing | Pause / Resume / Continue / Keep going |
| a.edit / a.save / a.cancel | Edit / Save / Cancel |
| a.editHint | Saves without starting a run. |
| a.done / a.clear / a.new | Mark done / Clear goal / Start a new goal |
| a.clearConfirm | Clear this goal? |
| p.doneSummary | Done after {elapsed} · {tokens} tokens |
| h.busyReply | Wait for the reply to finish. |
| h.pending | Wait for the pending goal action. |
| h.offline | Reconnect to manage the goal. |
| h.readOnly | This connection can't change goals. |
| e.busy | The chat is still working. Try again when the reply finishes. |
| e.ineligible | Goals need an idle chat whose history the gateway can recover. Start a new chat to set a goal. |
| e.rebound | The goal changed somewhere else. Here's the latest. |
| e.generic | Couldn't update the goal: {message} |
| e.tooLong | Keep the goal under 16,000 characters. |
| m.goalLabel | Goal *(label on the objective's user bubble)* |
| s.column | Goal |
| l.markerTitle | Goal: {status label} |

The labels deliberately differ from the Control UI's "Goal unmet" and "Goal achieved". "Budget reached" and "Goal done" say what happened in plain words, matching the plan and the brief's copy rule.

### 5.7 Keyboard and accessibility
- The trigger is a `button` with `aria-haspopup="dialog"` (the popover holds a form, not only a menu), `aria-expanded`, and `aria-label="Goal: {status label}"` (or "Set goal").
- The popover gets initial focus on the textarea (start and Continue) or on the heading (view). Tab cycles within it. Escape closes it and returns focus to the trigger.
- Ctrl/Cmd+Enter submits Start goal, Continue or Save. Enter inserts a newline, since objectives can be long.
- Status changes are announced once through `aria-live="polite"` on the trigger: "Goal blocked".
- The icon plus the label carry the state, so colour is never the only signal.

### 5.8 Notifications and deep links
- No gateway push category exists for goals (`lib/webPush.ts:48-51`).
- The existing `agentFinished` push covers the turn that a Resume or Continue starts.
- A blocked goal isn't pushed. This is a candidate follow-up (tier-1 `notify` when a goal turns blocked while the PWA is hidden), listed in §11.

## 6. Design-book conformance

| Item | Used |
|---|---|
| Header control | `triggerStyle` and `Popover` from PRD 01, the same as ModelSelect and ThinkingSelect |
| Menu actions | `MenuRow` (+ `danger`) |
| Phone | `Popover sheetOnNarrow` → PRD 01 `BottomSheet`; header row 2 |
| Pills and state colours | `Pill` with `stateTone`: working = active, needsYou = blocked or budget, done = complete, idle = paused |
| Inputs | Existing `ui/Input` `Textarea`; 16px on a phone (brief) |
| Tinted notice | The "blocked" box reuses the warning-tinted notice style (`AssistantMessage.tsx:106`) |
| Feedback | Inline errors and hints only; no toasts, no dialogs (clear is confirmed inline) |
| Tokens | `--accent`, `--warning`, `--success`, `--text-secondary`, `--bg-elevated`, `--border`, `--danger` |
| **New** | None. The chip is a tinted `triggerStyle` button. ThinkingSelect already tints its trigger (`ChatHeaderControls.tsx:174`). |

## 7. Functional requirements

**FR-1 Gate.**
- Given hello-ok lists `session-goal-start-v1` and `sessions.goal.update`, and the chat's key isn't a subagent, cron or heartbeat key, then GoalControl renders.
- Otherwise nothing renders, including the chat-list marker and the Sessions column.

**FR-2 Start.**
- Given an idle chat with no goal, when the user submits "Ship v2" in Set goal, then exactly one `chat.send` is sent, with `message:"Ship v2"`, `intent.kind:"session-goal-start"`, `intent.version:1`, an `issuedAtMs`, an `idempotencyKey` of 128 characters or fewer, and **no `thinking`**.
- The reply streams into the thread.
- The chip becomes Pursuing.

**FR-3 Thinking preserved.** Given the chat's thinking level is High, when a goal starts, then `sessions.patch {key, thinkingLevel:"high"}` completes before the `chat.send`.

**FR-4 New chat.** Given a new chat with no session, when a goal starts, then `sessions.create` runs first (with the model override, if any), and the new key is used.

**FR-5 Busy.**
- Given the session is running, then Start goal, Resume, Continue and Keep going are disabled with h.busyReply.
- Given the gateway still answers `goal-session-busy`, then e.busy shows, and the draft is kept.

**FR-6 Actions.** Pause, Edit, Mark done and Clear each send exactly one request, with the current `goalId` and `sessionKey`, a fresh `operationId` and `issuedAtMs`. On success, the chip reflects the result's `goal` (or none, after clear) straight away, without waiting for the event.

**FR-7 Safe retry.**
- Given an action failed with a network or timeout error, when the user clicks Retry, then the **same** `operationId` and `issuedAtMs` are reused.
- Given the result has `replayed:true`, then the session row is re-read before the chip changes.

**FR-8 Blocked.**
- Given `sessions.changed` brings `goal.status:"blocked"` with `lastStatusNote:"No key"`, then the chip shows Goal blocked (amber), and the popover shows "The agent is blocked: No key" with Continue as the primary action.
- Continue sends `resume` with the note.

**FR-9 Done is final.** Given `status:"complete"`, then Edit, Pause and Resume aren't offered. "Start a new goal" sends `sessions.goal.clear` and then opens the start form.

**FR-10 Live and reconnect.**
- Given the app reconnects, then the renewed `sessions.subscribe` rows (`store/sessions.ts:69-111`) bring the current goal, and the chip updates without user action.
- Given a `chat` final event for a session with an active goal and no goal update within 2 s, then the session rows are re-read once.

**FR-11 Chat list and Sessions.** Given a session row has a goal whose status isn't `complete`, then its chat-list row shows the Target icon in the tone colour, and the Sessions table's Goal column shows the `Pill` and the objective.

**FR-12 Offline.** Given the app is disconnected, then the chip stays with the last known state, and every action is disabled with h.offline.

**FR-13 One pending action.** Given an operation is in flight, then no other goal action can be sent.

## 8. Technical design

### 8.1 Files

| Path | New/changed | What |
|---|---|---|
| `src/lib/goals.ts` | new, pure | `parseGoal(raw) → SessionGoal ｜ null` (loose), `goalView(goal, now) → {label, tone, icon, elapsed}`, `availableActions(goal, {idle, canWrite, online}) → Action[]`, `buildStartParams(objective, opId, now)`, `buildUpdateParams(goal, sessionKey, action, extra, opId, now)`, `buildClearParams`, `classifyGoalError(err) → 'busy'｜'ineligible'｜'rebound'｜'conflict'｜'capacity'｜'generic'`, `validateObjective(text)` (NFC, length), `eligibleSessionKey(key)` |
| `src/lib/types.ts` | changed | `Session.goal?: SessionGoal ｜ null` |
| `src/store/goals.ts` | new | `pending: Record<sessionKey, {action, opId, issuedAtMs, params}>`, `errors`, `start(convId, objective)`, `act(sessionKey, action, extra?)`, `retry(sessionKey)`. It writes the result's `goal` into `useSessionsStore` straight away. |
| `src/store/chat.ts` | changed | Adds `sendGoalStart(convId, objective, opId)`: the same session-creation and streaming path as `sendMessage`, but the payload carries `intent`, has no `thinking` and no attachments, and marks the local user message `goal: true`. |
| `src/store/sessions.ts` | changed | Adds `refreshRecent()` (`sessions.list {activeMinutes:10, limit:50}`, merged) for FR-10. `sessions.changed` already merges `goal`. |
| `src/components/chat/GoalControl.tsx` | new | Trigger plus `Popover` (list, forms, inline confirm) |
| `src/components/chat/ChatView.tsx` | changed | Renders `GoalControl` in both header layouts; adds the chat-list marker in `ChatRow` |
| `src/components/chat/MobileChatList.tsx` | changed | Adds the marker |
| `src/components/chat/UserMessage.tsx` | changed | Shows the `◎ Goal` label when `message.goal` |
| `src/components/sessions/SessionsView.tsx` | changed | Adds the Goal column |

### 8.2 Data flow

```
Set goal ▶ goals.start ▶ [sessions.create] ▶ [sessions.patch thinkingLevel] ▶ chat.sendGoalStart
      ▶ chat.send{intent} (not awaited; stream as usual) ─ ack {goal} ▶ sessions row .goal = goal
Action   ▶ goals.act ▶ sessions.goal.update|clear ─ result {goal} ▶ sessions row .goal = goal
Gateway  ▶ sessions.changed {goal} (subscribed; renewed on connectionSeq) ▶ row merge ▶ chip
chat final + active goal + nothing new within 2 s ▶ sessions.refreshRecent()
```

- **Where state lives.** The goal belongs to the session row, so `useSessionsStore` is the only source of truth. `store/goals.ts` holds only in-flight operations and errors. This keeps "one store per feature" without duplicating the goal record.
- **Subscriptions.** Nothing new to subscribe to. The per-connection `sessions.subscribe` is already renewed on reconnect, keyed on `connectionSeq` (PR #75), and it carries `goal`.
- **The start ack is not awaited.** chat.ts sends with `timeoutMs 0` and doesn't await the result, because the reply comes as events (`store/chat.ts:1125-1146`). `sendGoalStart` does the same, but also reads the resolved ack to seed the row's goal. If the ack never arrives, `sessions.changed` fills it in.
- **Ordering.** A result's goal is written only if its `updatedAt` is newer than the row's current `goal.updatedAt` and the `goalId` matches, or the row has no goal. This is the Control UI's rule.

### 8.3 Operation IDs (`lib/goals.ts`)
- `opId = nanoid(21)` and `issuedAtMs = Date.now()` are built once per user intent, and stored in `pending[sessionKey].params`.
- Retry resends the stored `params` unchanged.
- The pending entry is dropped on success, and on any gateway *rejection* that isn't retryable. It is kept on network errors and timeouts.
- Receipts live 24 h on the gateway, which is far longer than a retry window.

### 8.4 Capability gating

```ts
const on = gatewayClient.supports('session-goal-start-v1')
        && gatewayClient.hasMethod('sessions.goal.update')
        && gatewayClient.hasMethod('sessions.goal.clear')
const canWrite = grantedScopes.includes('operator.write')
const eligible = eligibleSessionKey(conv.sessionKey)  // new chats ('' key) are eligible
```

### 8.5 Error handling
Errors map through `classifyGoalError`, which uses `details.reason`/`details.code` first and the message text second (the gateway may reword messages):

| Gateway signal | Class | UI |
|---|---|---|
| `UNAVAILABLE` + `details.reason:"goal-session-busy"` | busy | e.busy |
| message "requires an idle local session with recoverable history" | ineligible | e.ineligible |
| `details.reason:"goal-rebound"`, "Session changed or was removed", "Session changed before its Goal update" | rebound | refresh the row + e.rebound |
| `details.reason:"operation-conflict"` | conflict | new opId, retry once |
| `details.reason:"capacity"` | generic | e.generic |
| "Goal is being admitted; retry the same request." | — | auto-retry once after 500 ms with the same params |
| anything else | generic | e.generic + Retry |

### 8.6 Performance
- One timer per visible chip (60 s) for the elapsed label.
- `refreshRecent` is at most once per run end, limit 50.

### 8.7 Migration
None. `Session.goal` is optional. The local `message.goal` flag only lives on in-memory messages.

## 9. Test plan

**Unit tests** (`src/lib/__tests__/goals.test.ts`):

`parseGoal`:
- a full record;
- a missing optional field;
- an unknown status is kept but mapped to idle;
- non-objects and `null` return null;
- a numeric string timestamp is accepted.

`goalView`:
- every status → label, tone and icon (§5.2);
- elapsed: 0m, 59m, 1h 0m, 26h 3m.

`availableActions`:
- **active:** idle gives Pause, Edit, Mark done, Clear; not idle keeps the same set (none of them runs a turn).
- **paused:** idle gives Resume, Edit, Mark done, Clear; not idle drops Resume.
- **blocked:** Continue is primary; not idle drops Continue.
- **budget_limited:** Keep going.
- **complete:** Start a new goal and Clear only.
- **offline:** none.
- **no write:** none.

`buildStartParams`:
- has no `thinking`;
- intent `{kind, version:1, issuedAtMs}`;
- `idempotencyKey` = opId;
- rejects an objective that is empty or over 16,000;
- normalises NFC (so a decomposed "é" becomes composed before sending).

`buildUpdateParams`:
- `edit` requires `objective`;
- pause, resume, complete: an empty `note` is omitted, and a note is trimmed and capped at 2000.

`classifyGoalError`: every row of §8.5, including a structured `details` object nested in `gatewayError`.

`eligibleSessionKey`:
- `agent:main:dashboard:uuid` ✓;
- `…:subagent:…` ✗, cron ✗, `:heartbeat` ✗;
- `''` ✓ (a new chat).

**Manual QA** (isolated gateway profile, 2026.9.4):
1. New chat: Set goal "List three facts about Mars, then mark the goal complete". The user bubble has a Goal label, the reply streams, and the chip goes Pursuing → Goal done (via the agent's `update_goal`) without a reload.
2. Set thinking to High, then start a goal. The gateway run uses high (check `sessions.list` `thinkingLevel`), and there is no error about overrides.
3. Pause, then check the chip. Resume with a note: a turn runs, and the reply appears with no visible "Continue…" user message.
4. Ask the agent to do something impossible (a missing env var) until it blocks. The chip turns amber, the note shows, and Continue with a note resumes it.
5. Start a goal while a reply is streaming: the button is disabled. Force the call from devtools: e.busy shows.
6. Kill the network mid-Pause, restore it, then Retry: the gateway returns `replayed:true`, and the chip is correct.
7. Type `/new`: the chip returns to Set goal.
8. Open two JoaxClaw windows (main and pop-out) on the same chat. Pause in one, and the other updates through `sessions.changed`.
9. On a phone at 390px: row 2 scrolls, the popover is a bottom sheet, the tap targets are ≥40px, and the textarea doesn't zoom.
10. On a 2026.7 gateway: no control, no marker, no column.
11. With a read-only token: the chip is visible and read-only.

## 10. Rollout
- No flag. It is gated on the capability plus the methods (§8.4). Older gateways show nothing.
- Ships after PRD 01. It is independent of 02 and 03.
- It lands in the same header as PM B's chat export (`⋯` menu). Coordinate the order of the header controls: model, thinking, **goal** | Files, Display, ⋯, pop-out. Goal sits with the chat's *settings*, before the right-hand utility group.

## 11. Risks and open questions

| # | Item | Owner decision? |
|---|---|---|
| Q1 | **No goal lines in the thread.** The plan wanted "Goal paused" and "Agent marked the goal done" lines so the history reads correctly later. The gateway doesn't record them (§2.2 fact 3), so any lines would be client-only and would vanish on reload. Recommendation: no thread lines. The chip, the popover and the Sessions column carry the state. Alternatively, ask upstream to write transcript markers. | **yes** |
| Q2 | **Labels "Goal done" and "Budget reached"** instead of the Control UI's "Goal achieved" and "Goal unmet". Recommendation: ours (plain language). | yes |
| Q3 | **Tier-1 notification when a goal turns blocked** (PWA only). Recommendation: follow-up, not in v1. | yes |
| R1 | When agent-tool goal changes are broadcast is unverified. FR-10's refresh-on-final covers it. | no |
| R2 | After a reload, the objective's user bubble loses its "Goal" label. The transcript may carry an `intent` marker, but this is unverified. The label is cosmetic. | no |
| R3 | Header width: with the Files drawer open, a desktop header could crowd. The chip truncates at 150px and the title shrinks first. Covered in QA. | no |
| R4 | The capability is advertised on 2026.9.4. Whether 2026.8 gateways advertise `session-goal-start-v1` (the methods say "since 2026.8") is **unverified**. We gate on the capability, so a 2026.8 gateway without it just shows nothing. | no |
| R5 | `issuedAtMs` more than 5 min ahead of the gateway clock is rejected as `invalid`. A laptop with a skewed clock would hit it. We show e.generic with the message, which is rare and understandable. | no |

## 12. Milestones

| PR | Contents | Size |
|---|---|---|
| 04-a | `lib/goals.ts` + tests, `Session.goal`, `store/goals.ts`, `chat.sendGoalStart`, GoalControl with start/view/pause/resume/clear (desktop) | M |
| 04-b | Blocked/Continue, budget/Keep going, Edit, Mark done/Start a new goal; retry/replay handling; phone sheet | S–M |
| 04-c | Chat-list marker (desktop + phone), Sessions Goal column, the refresh-on-final fallback, the Goal label on the user bubble | S |
