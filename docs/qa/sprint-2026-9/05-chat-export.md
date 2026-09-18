# QA checklist — PRD 05 Chat export
Source: docs/prd/05-chat-export.md · Engineer: Eng 3 · Milestones: PR 1 `fix(chat): restore tool calls on reload` (**merged**, #79 — items tagged *merged — regression only*), PR 2 `feat(chat): export` (in progress)
Legend: **[U]** unit test (vitest, src/lib/__tests__) · **[R]** code review · **[M]** manual app check (desktop + 390px phone)
Fixture: `src/lib/__tests__/fixtures/sprint/chatExport.ts` (9.4 `chat.history` tail page, paging walk, 6.5 variant, error frames, `chat.message.get`, `session.message`).

## PR 1 — history mapping (merged — regression only)
State as merged: `src/lib/historyMessages.ts` (`extractToolCalls`, `toolResultUpdate`, `applyToolResults`, `mergeFinalToolCalls`, `historyMessageId`), wired in `src/store/chat.ts` (`toChatMessages` :572, `ingestSessionMessage` :1228, `reconstructSubThreads` :619, `HISTORY_LIMIT = 500` :566). The PRD's `mapHistoryMessages(raw, { sessionKey, activeRun })` does **not** exist; checks below target what shipped, and gaps vs the PRD are marked **GAP**.

- [ ] **05-FR1.a** [U] Given `EXPORT_HISTORY_MESSAGES` (fixture), when mapped by `toChatMessages`, then the assistant row `ev-0004` carries `call_acme01` and `call_glob02` (`web_fetch`) with `args` = JSON of `arguments`. _(§7 FR-1; merged — regression only)_
- [ ] **05-FR1.b** [U] Given `toolResult` rows `ev-0005` / `ev-0006`, when mapped, then `call_acme01` is `status: 'done'` with `result` = the 22,539-char text (not truncated), and `call_glob02` is `status: 'error'` with `error: 'fetch failed: 403 Forbidden (https://globex.example/pricing)'`. _(FR-1, FR-2; merged — regression only)_
- [ ] **05-FR1.c** [M] Given a local 2026.9.4 gateway (isolated profile) where an agent ran 3 tools, one failing, when the app reloads (Ctrl+R) and the chat is reopened, then 3 tool cards show and the failing one is red. _(§9.2 step 1)_
- [ ] **05-FR2.a** [U] Given a `toolResult` whose `toolCallId` matches no call, when mapped, then no row is emitted and no call changes (`applyToolResults` returns the same objects). _(FR-2; merged — regression only)_
- [ ] **05-FR2.b** [U] Given a call with no result that is NOT the last entry, then its status is `done`. _(FR-2; merged — regression only)_
- [ ] **05-FR2.c** [U] **GAP** Given `EXPORT_HISTORY_RESPONSE` (`sessionInfo.hasActiveRun: true`, last call `call_hool08` with no result), when mapped, then `call_hool08` is `running`; given `EXPORT_HISTORY_RESPONSE_IDLE`, it is `done` with result `Hooli: $31 per seat per month.`. Merged code always emits `done` (no `activeRun` input). _(FR-2, §9.1 historyMessages #8)_
- [ ] **05-FR3.a** [U] Given `TOOL_CALL_SPELLINGS[0..1]` (`toolCall`+`arguments`, `tool_use`+`input`), then both map to a `ToolCall` with ids `v1`, `v2`. _(FR-3; merged — regression only)_
- [ ] **05-FR3.b** [U] **GAP** Given `TOOL_CALL_SPELLINGS[2..5]` (`toolUse`, `tool_call`, `TOOLCALL`; ids in `toolUseId`, `tool_call_id`, `toolCallId`, `tool_use_id`), then each maps with id `v3`…`v6`. Merged `extractToolCalls` returns `[]` for 2–4 and a random nanoid for 5 (verified against the fixture). _(FR-3, §9.1 #3–#4)_
- [ ] **05-FR3.c** [U] **GAP** Given `TOOL_RESULT_ROLE_SPELLINGS` (`toolResult`, `tool_result`, `tool`, `function`; id in `toolCallId` or `tool_call_id`), then each pairs to its call. Merged `toolResultUpdate` only accepts `role === 'toolResult'` + `toolCallId`. _(PRD §2.2 l.57, FR-3)_
- [ ] **05-FR3.d** [U] Given a string `arguments` (`'{"a":1}'`), then `args` is kept verbatim; given no id, a generated id is used. _(merged — regression only)_
- [ ] **05-FR4.a** [U] Given `SESSION_MESSAGE_TOOL_CALL`, when `ingestSessionMessage` runs for an open conversation, then the message is appended with `call_hool08`; given `SESSION_MESSAGE_TOOL_RESULT` next, then `call_hool08` is patched in place (`result` set) and no row is appended. _(FR-4; merged — regression only)_
- [ ] **05-FR4.b** [R] `ingestSessionMessage` uses `p.messageId` as the row id so the same entry arriving twice is recognised (`decideIngest`). _(merged — regression only)_
- [ ] **05-FR5.a** [M] Given a parent chat that spawned a sub-agent, when reloaded, then `reconstructSubThreads` shows the child thread with its tool calls and no `sessions_spawn` card inside it. _(FR-5, §9.2 step 2)_
- [ ] **05-FR5.b** [R] `reconstructSubThreads` calls `chat.history` with `limit: HISTORY_LIMIT` (not the gateway default 200). _(§2.1 l.30; merged — regression only)_
- [ ] **05-PR1.a** [U] An assistant message with only tool calls (fixture `ev-0017`) is kept, not filtered as empty. _(§9.1 #9; merged — regression only)_
- [ ] **05-PR1.b** [U] `sessions_yield` whose `message` arg was stripped (`ev-0012`, arguments `{ sessionKey }` only) maps without throwing. _(§9.1 #10)_
- [ ] **05-PR1.c** [U] Audio blocks and `MediaPaths`/`MediaTypes` still extract as attachments; a bare unclosed `<think>` assistant row is still dropped. _(§9.1 #11–#12)_
- [ ] **05-PR1.d** [U] **GAP** Nested tool activity (`role: 'custom'`, `customType: 'openclaw.nested-tool.v1'`, fixture `ev-0014`: `toolCall` block + `toolResult` BLOCK in one row) yields `call_nest07` (`read`, done). Merged `toChatMessages` drops every non-user/assistant row. _(PRD §2.2 l.53)_
- [ ] **05-PR1.e** [U] `historyMessageId` reads `__openclaw.id` (history rows have no top-level `id`). _(merged — regression only)_
- [ ] **05-PR1.f** [R] `mergeFinalToolCalls` keeps live calls (with results) and only adds calls the stream never reported, excluding `sessions_spawn`. _(merged — regression only)_
- [ ] **05-PR1.g** [U] **GAP** A real captured 2026.9.4 `chat.history` fixture at `src/lib/__tests__/fixtures/chat-history-2026.9.4.json` exists and maps. Not added in PR 1; the sprint fixture is source-derived, not captured. _(§9.1 #13)_
- [ ] **05-PR1.h** [R] CHANGELOG has the reload fix under **Fixed**. _(§10 l.577)_

## FR-15 — history load page size (PR 1 scope)
- [ ] **05-FR15.a** [R] `loadSessionMessages` sends `chat.history` `{ sessionKey, limit: 500 }` (Q2 default). _(FR-15; merged — regression only)_
- [ ] **05-FR15.b** [R] **GAP** `Conversation` gains `historyHasMore?: boolean` and `historyTotal?: number`, set from the response's `hasMore` / `totalMessages`. Not present in `src/lib/types.ts`. _(§8.1 l.462)_
- [ ] **05-FR15.c** [M] **GAP** Given a chat whose reload response has `hasMore: true`, the thread top shows exactly "Earlier messages aren't loaded. Export reads the whole chat." (`MessageThread.tsx`); absent when `hasMore` is false/absent. Not implemented. _(FR-15)_

## FR-6 — reading the whole history (`chatHistoryReader.ts`)
- [ ] **05-FR6.a** [U] `nextPageParams` first call returns `{ sessionKey, limit: 1000, maxChars: 500000 }` with **no `offset`** (a 2026.6.5 gateway rejects `offset` — `ERROR_OFFSET_ON_2026_6_5`). _(§9.1 reader #1; Gateway contract GC-3)_
- [ ] **05-FR6.b** [U] Given `PAGING_PAGE_A` (`hasMore: true, nextOffset: 10`), the next params carry `offset: 10`; given `PAGING_PAGE_B` (`nextOffset: 18`), `offset: 18` (matches `PAGING_REQUESTS`, modulo `limit`). _(reader #2)_
- [ ] **05-FR6.c** [U] Given `PAGING_PAGE_C` (`hasMore: false`, no `nextOffset`), paging stops. _(reader #3)_
- [ ] **05-FR6.d** [U] Given `HISTORY_RESPONSE_2026_6_5` (no `hasMore`/`nextOffset`/`totalMessages`), paging stops after one page and `pagingSupported: false`. _(reader #4, §5.5 Older gateway)_
- [ ] **05-FR6.e** [U] Given `hasMore: true` but `nextOffset` missing or `<=` the current offset, the reader stops with an error (never loops). _(Control UI behaviour, §2.3)_
- [ ] **05-FR6.f** [U] Given pages A, B, C (newest first), the assembled raw list is oldest first and equals `PAGING_EXPECTED_TEXTS` (26 rows): the replayed record 7 appears on B and C but each of its two rows (commentary + final, both `__openclaw.id: 'ev-07'`) appears exactly once. A plain `Set` of ids fails this (drops the commentary row). _(FR-6, reader #5)_
- [ ] **05-FR6.g** [U] Given a later page with a different `totalMessages` (`PAGING_PAGE_B_CHANGED`) or `sessionId` (`PAGING_PAGE_B_NEW_SESSION`), the read restarts once; if it changes again, it fails with "This chat changed while it was being read. Try again." _(§8.5 Stability)_
- [ ] **05-FR6.h** [U] `readFullHistory` returns `{ raw, total, truncatedCount, activeRun, unavailable, pagingSupported }`; `total` = first page `totalMessages`; `activeRun` = `sessionInfo.hasActiveRun`. _(§8.1 l.463)_
- [ ] **05-FR6.i** [U] `onProgress` is called after each page; progress = consumed offset / `totalMessages` (raw records), not row count (rows < records; see Ambiguities A1). _(§5.2 A.2)_
- [ ] **05-FR6.j** [U] Aborting the `signal` stops paging; no further `chat.history` request is sent. _(§5.5 Reading → Cancel, §8.4)_
- [ ] **05-FR6.k** [R] The reader never sends `messageId`, `cursor`, `maxBytes`, or `sessionId`. _(§8.4, §8.5)_
- [ ] **05-FR6.l** [M] A chat with >1,000 messages → Export → count, progress bar, first and last message present in the file. _(§9.2 step 4)_

## FR-7 / FR-8 — Markdown (`chatExport.ts`)
- [ ] **05-FR7.a** [U] `toMarkdown` output starts `# Pricing research`, then a meta line `agent: researcher · model: ollama/qwen3.6:35b · session: agent:researcher:main-7f3a · exported 18 Sep 2026, 10:55`, then `---`. _(§5.4, chatExport #1)_
- [ ] **05-FR7.b** [U] Given `sessionInfo.hasActiveRun: true`, the line `> Still running when exported: the last reply may be incomplete.` follows the meta line; absent for `EXPORT_HISTORY_RESPONSE_IDLE`. _(§5.4, FR-13, #11)_
- [ ] **05-FR7.c** [U] User rows are labelled `**You** · 18 Sep 10:41`; assistant rows `**researcher** · …`; the Slack row `ev-0016` is labelled `**Maria (Slack)**` (top-level `senderLabel`). _(§5.4 l.279, #2)_
- [ ] **05-FR7.d** [U] Every tool call is one `<details><summary>🔧 {name} · {argSummary(args)} · done|error</summary>` … `</details>`; count of `<details` equals count of `</details>`. _(FR-7, #3)_
- [ ] **05-FR7.e** [U] The body is args as a ```` ```json ```` block, then `Result:` and the result through `toolResultView` (text as ```` ```text ````, else JSON). _(§5.4 l.282)_
- [ ] **05-FR7.f** [U] `call_glob02` has `error` in the summary and `Error:` before the body. _(#4)_
- [ ] **05-FR7.g** [U] `LONG_RESULT_TEXT` (22,539 chars) is cut to 20,000 chars + `…(shortened in export)`. _(#8)_
- [ ] **05-FR7.h** [U] `REPLY_WITH_FENCES` (contains ```` ``` ```` and ```` ```` ````) and the exec result (` ``` `) are emitted with a fence longer than any fence inside (`fenceFor`). _(FR-7, #7)_
- [ ] **05-FR7.i** [U] `sessions_spawn` summary names the sub-agent (`sub-agent · …`, from `label`/`agentId`); the child transcript is not inlined. _(§5.4 l.285)_
- [ ] **05-FR7.j** [U] Attachments are listed as `*Attachments: …*`; the image block (`omitted: true, bytes: 48213`, no data/url) is listed by name/type, never embedded; a block with `url` becomes a link. _(§5.4 l.287, #9)_
- [ ] **05-FR7.k** [U] Gateway markers `...(truncated)...` and `[chat.history omitted: message too large]` are kept verbatim; `countTruncated(EXPORT_HISTORY_MESSAGES)` = 2 (`EXPECTED_TRUNCATED_COUNT`), including the oversized `toolResult` row that has no `toolCallId`. _(§5.4 l.288, FR-13, #10)_
- [ ] **05-FR7.l** [U] A compaction marker (`role: 'system'`, `__openclaw.kind: 'compaction'`) does not render as a user/assistant message; a first-row reset marker (`RESET_MARKER_ROW`) produces "History starts at a reset on {date}.". _(R2)_
- [ ] **05-FR8.a** [U] Tools off → no `<details>` for tools. _(FR-8, #5)_
- [ ] **05-FR8.b** [U] Reasoning on → `<details><summary>Reasoning</summary>` with the thinking text before the reply of `ev-0004`; off (default) → no thinking text anywhere. _(FR-8, #6)_
- [ ] **05-FR8.c** [U] Timestamps off → no ` · 18 Sep 10:41` suffix. _(§5.2 A.3)_
- [ ] **05-FR8.d** [R] Include options persist per device in `localStorage`, every access in try/catch; defaults Tool calls on, Reasoning off, Timestamps on. _(§5.2 A.3, FR-8)_
- [ ] **05-FR8.e** [U] `exportFilename('Pricing research', 2026-09-18, 'md')` = `pricing-research-2026-09-18.md`; unicode/odd characters slugged; empty slug → `chat-2026-09-18.md`. _(#12)_

## FR-9 — JSON
- [ ] **05-FR9.a** [U] `toJson(raw, meta)` pretty-prints `{ exportedAt, sessionKey, title, agentId, totalMessages, messages }` (`EXPECTED_JSON_ENVELOPE`); `JSON.parse(out).messages` deep-equals the raw input (oldest first, unmodified). _(FR-9, #13)_
- [ ] **05-FR9.b** [M] With JSON selected the Include checkboxes are ignored and the note "JSON has every message exactly as the gateway sent it." shows. _(§5.2 A.3, §5.6)_

## FR-10 / FR-11 / FR-12 — save, share, copy (`saveFile.ts`)
- [ ] **05-FR10.a** [U] With `window.api.file.saveAs` present, `saveBytesAs(name, bytes, type)` calls it with `(name, base64(UTF-8 bytes))`. _(FR-10, saveFile #1)_
- [ ] **05-FR10.b** [U] Bridge `{ ok: true, path }` → dialog shows `Saved to {path}` (success tone); `{ ok: false, canceled: true }` → nothing shown, dialog stays open; `{ ok: false, error }` → danger box `Couldn't save the file: {error}`. _(FR-10, §5.2 A.5)_
- [ ] **05-FR10.c** [U] No bridge → Blob download via `<a download>`, object URL revoked later. _(saveFile #2)_
- [ ] **05-FR10.d** [U] Bytes over 32 MiB (`SAVE_MAX_BYTES`) are refused with "This chat is too large to save from the app (over 32 MB)." _(§8.5)_
- [ ] **05-FR10.e** [R] `saveHostFileAs` now calls `saveBytesAs`; existing `fileContent.test.ts` still passes unchanged. _(§8.1 l.465)_
- [ ] **05-FR11.a** [U] `navigator.canShare({ files })` true → `navigator.share({ files: [File], title })`. _(FR-11, #3)_
- [ ] **05-FR11.b** [U] share rejects with `AbortError` → no download, nothing shown. _(#4)_
- [ ] **05-FR11.c** [U] canShare false/absent, or share rejects with another error → download and `Downloaded {filename}`. _(FR-11, #5)_
- [ ] **05-FR12.a** [M] Copy as Markdown (dialog/sheet) writes the same text as the file; the button reads "Copied" for 1.5 s. _(FR-12)_
- [ ] **05-FR12.b** [M] Clipboard blocked → "Couldn't copy. Use Save instead." _(FR-12)_
- [ ] **05-FR12.c** [M] Menu Copy: row shows spinner + "Copying…", then "Copied" 1.5 s; read failure → "Couldn't read the chat" in danger text for 3 s; the menu closes only after the result shows. _(§5.2 B)_
- [ ] **05-FR12.d** [M] Paste into a GitHub issue: tool calls fold. _(§9.2 step 7)_

## FR-13 — honest gaps (dialog states)
- [ ] **05-FR13.a** [M] Reading: "Reading messages…" before the first page, then "Reading 1,240 messages…" (`totalMessages`, `toLocaleString`) with `ProgressTrack`; Save…/Share disabled until done; options usable while reading. _(§5.5, §5.2 A.2)_
- [ ] **05-FR13.b** [M] Truncated rows → warning "{n} long messages were shortened by the gateway." _(§5.5)_
- [ ] **05-FR13.c** [M] Active run → dialog note "This chat is still running. The file has what exists so far." _(§5.5)_
- [ ] **05-FR13.d** [M] No paging → warning "Only the latest {n} messages could be read." _(§5.5 Older gateway)_
- [ ] **05-FR13.e** [M] Unavailable sentinel row present → warning "The gateway can't show this chat's full history (it's too large). The file will contain what it returned." (export still allowed). _(§5.5; see A3)_
- [ ] **05-FR13.f** [M] Read error → danger box "Couldn't read this chat from the gateway: {message}. Try again." with **Try again**; `{message}` is the gateway's `error.message` (unwrapped from the JSON the client throws), and a partial read is never saved. _(§5.5, §8.4)_
- [ ] **05-FR13.g** [M] Empty chat (`EMPTY_HISTORY_RESPONSE`) → "This chat has no messages yet."; Save/Share and Copy disabled. _(§5.5)_
- [ ] **05-FR13.h** [M] Kill the gateway mid-read → read error + Try again; restart → Try again succeeds. _(§9.2 step 9)_

## FR-14 — entry points
- [ ] **05-FR14.a** [M] Desktop header: 26px `MoreHorizontal` (13px icon) trigger after the pop-out/Return button, `triggerStyle` icon variant; menu = 01 `Popover` + `MenuRow`: "Export chat…", "Copy as Markdown". _(§5.1.1, FR-14)_
- [ ] **05-FR14.b** [M] Phone (390px): trigger (16px icon) at the end of header row 1 after `DisplayMenu`; menu shows "Share…" instead of "Export chat…" when `navigator.canShare` supports files, else "Export chat…". _(§5.1.1)_
- [ ] **05-FR14.c** [M] Desktop chat-list row hover shows a 4th `RowBtn` (`Download`, 11px, title and aria-label "Export chat") before Delete; it opens the dialog without opening the chat. _(§5.1.3, §5.2 D; Q1)_
- [ ] **05-FR14.d** [M] Phone `MobileChatList` ⋮ menu: Rename, **Export**, Delete (in that order); opens the share sheet for that row's `sessionKey`. _(§5.1.2)_
- [ ] **05-FR14.e** [R] No `sessionKey` (unsaved new chat) → ⋯ entries hidden (header and rows). _(§5.5, FR-14)_
- [ ] **05-FR14.f** [M] Disconnected/reconnecting → ⋯ items disabled with tooltip "Connect to the gateway to export"; empty chat → disabled with "This chat has no messages yet". _(§5.5)_
- [ ] **05-FR14.g** [M] Pop-out window has the same ⋯ and dialog. _(§5.5, §9.2 step 11)_
- [ ] **05-FR14.h** [R] Dialog is 480px `Overlay` rendered as a sibling of the chat pane (#74), title `Export "{title}"`; phone uses 01 `BottomSheet` (`animate-slide-up`, drag handle, safe-area) titled `Share "{title}"`, switched by `useIsNarrow()`. _(§5.2 A.1, C.1, §8.1)_
- [ ] **05-FR14.i** [M] Preview shows the first ~40 lines in a mono `<pre>` with FilePreview styling. _(§5.2 A.4)_

## Copy strings (§5.6) — [R] each present verbatim
- [ ] **05-COPY.a** Menu: `More` (trigger aria-label/title), `Export chat…`, `Copy as Markdown`, `Copying…`, `Copied`, `Couldn't read the chat`, `Share…`, `Connect to the gateway to export`, `This chat has no messages yet`.
- [ ] **05-COPY.b** Rows: `Export chat` (desktop title), `Export` (phone menu).
- [ ] **05-COPY.c** Dialog: `Export "{title}"`, `Share "{title}"`, `Format`, `Markdown`, `JSON`, `Include`, `Tool calls, folded`, `Reasoning`, `Timestamps`, `JSON has every message exactly as the gateway sent it.`
- [ ] **05-COPY.d** Status: `Reading {n} messages…`, `Reading messages…`, `{n} long messages were shortened by the gateway.`, `This chat is still running. The file has what exists so far.`, `Only the latest {n} messages could be read.`, `The gateway can't show this chat's full history (it's too large). The file will contain what it returned.`, `Couldn't read this chat from the gateway: {message}. Try again.`
- [ ] **05-COPY.e** Buttons/results: `Try again`, `Save…`, `Share`, `Copy as Markdown`, `Copied`, `Cancel`, `Saved to {path}`, `Downloaded {filename}`, `Couldn't save the file: {message}`.
- [ ] **05-COPY.f** File/other: `Still running when exported: the last reply may be incomplete.`, `You`, `…(shortened in export)`, `History starts at a reset on {date}.`, `This chat changed while it was being read. Try again.`, `This chat is too large to save from the app (over 32 MB).`, `Couldn't copy. Use Save instead.`
- [ ] **05-COPY.g** Thread line: `Earlier messages aren't loaded. Export reads the whole chat.`
- [ ] **05-COPY.h** No toasts anywhere (all feedback inline). _(§5.8)_

## Accessibility and keyboard (§5.7)
- [ ] **05-A11Y.a** [R] Trigger is `<button aria-label="More" aria-haspopup="menu" aria-expanded={open}>`.
- [ ] **05-A11Y.b** [M] Menu rows are `role="menuitem"`; Up/Down move, Enter activates, Esc closes and returns focus to the trigger.
- [ ] **05-A11Y.c** [M] Dialog traps focus; Esc closes; primary button is Save… (desktop) / Share (phone).
- [ ] **05-A11Y.d** [R] Status line is `aria-live="polite"` and carries the count and Copied / Saved to… results.
- [ ] **05-A11Y.e** [R] Format control is a radio group (`role="radiogroup"` + `role="radio"`/`aria-checked`, or native radios).
- [ ] **05-A11Y.f** [M] Phone tap targets ≥ 40px; desktop row button has title and aria-label.
- [ ] **05-A11Y.g** [M] Screen reader (Orca/VoiceOver) announces the menu and dialog. _(§9.2 step 12)_

## Design book (§6) — [R]
- [ ] **05-DS.a** Only tokens listed in §6; tints via `color-mix(... 10–12%, transparent)`; warning = truncation/still running, danger = failures.
- [ ] **05-DS.b** Segmented format control reuses the ExtensionsView Skills/Plugins styling; icons lucide `MoreHorizontal`, `Download`, `Copy`, `Share2` at 11–16px; `Btn` primary/outline/ghost `sm`.

## Gateway contract (must honour; per 2026.9.4 source unless noted)
- [ ] **05-GC-1** [R] `chat.history` needs `operator.read` (dist/method-scopes-tKV11oMS.mjs:1818) and is advertised; no feature gate, but a `FORBIDDEN "missing scope: operator.read"` (`ERROR_MISSING_READ_SCOPE`) surfaces as the read error.
- [ ] **05-GC-2** [R] Params are a closed schema (sessions-rlbLHLas.mjs:1560): only `sessionKey, agentId, cursor, limit(1–1000), maxBytes(≥1024), offset(≥0), pendingBefore, inputRunIds, messageId, sessionId, maxChars(1–500000)`. Any other key → `INVALID_REQUEST "invalid chat.history params: at root: unexpected property '<key>'"`.
- [ ] **05-GC-3** [U] 2026.6.5 accepts only `sessionKey, agentId, limit, maxChars` (schema-KBhSSPA3.js:2696): the first page must not send `offset` (not even 0). Offsets are only sent after a response carried `nextOffset`.
- [ ] **05-GC-4** [R] `limit` counts visible (projected) rows; `totalMessages`, `offset`, `nextOffset` count **raw transcript records** (handler :241–247). Rows returned ≤ records; progress uses offsets.
- [ ] **05-GC-5** [U] Response: `hasMore`/`totalMessages` present on every 9.4 tail/offset page; `nextOffset` only when `hasMore`; `offset` echoed only when sent; all absent on 6.5 (chat-DOMgZOP2.js:1846).
- [ ] **05-GC-6** [U] Row id is `__openclaw.id` (no top-level `id`); several rows can share one id (commentary fallback + final of one record, session-transcript-readers:1561) and the gateway can replay the oldest record on the next page (handler :249) — dedupe must be per-occurrence, not a Set.
- [ ] **05-GC-7** [U] Tool calls persist as `type: 'toolCall'` + `arguments`; results as separate `role: 'toolResult'` rows with `toolCallId`, `toolName`, `isError`, `content[]`. Nested activity is a `role: 'custom'` row with a `toolCall` block and a `type: 'toolResult'` block.
- [ ] **05-GC-8** [U] Text/thinking cut at `maxChars` with `\n...(truncated)...` and `__openclaw.truncated: true, reason: 'display-cap'`; tool payloads exempt (except `details.diff`). A row > 131,072 bytes becomes `{ role, timestamp, content:[{type:'text',text:'[chat.history omitted: message too large]'}], __openclaw:{ id, seq, …, truncated:true, reason:'oversized' } }` — **toolCallId/toolName/isError and all tool blocks are lost**. Count truncation from `__openclaw.truncated`, not only by string match.
- [ ] **05-GC-9** [R] Images/audio/video blocks arrive with `data`/`blob`/`path` removed, `omitted: true`, `bytes` estimate, and only http(s)/`/media/…` URLs kept (session-transcript-readers:1384); export never sees base64.
- [ ] **05-GC-10** [U] Transient read errors are `UNAVAILABLE` with `retryable: true, retryAfterMs: 250` ("session history is rebuilding; retry shortly", "session changed while reading history; reload the conversation"). The reader should retry these (or treat as a restart), not fail the export on the first one.
- [ ] **05-GC-11** [R] `sessionInfo.hasActiveRun` (always set, handler :837) drives "still running"; `sessionInfo.activeLeafEntryId`, top-level `sessionId` and `deltaCursor` are available for the stability check.
- [ ] **05-GC-12** [R] A page is ≤ 6 MiB (server-constants :7) < 25 MiB frame; the client's default 30 s request timeout applies per page — a remote 6 MiB page must fit or the reader passes a longer timeout.
- [ ] **05-GC-13** [R] `chat.message.get` (Q5, optional): `{ sessionKey, agentId?, messageId (= __openclaw.id), maxChars? ≤ 2e6 }` → `{ ok, message?, unavailableReason?: 'not_found'|'oversized'|'not_visible' }`; oversized placeholders cannot be recovered through it.
- [ ] **05-GC-14** [R] `session.message` payload = `{ sessionKey, agentId?, message, messageId?, messageSeq?, senderIsOwner?, …session snapshot }`; delivered only on a connection subscribed via `sessions.subscribe` (operator.read).
- [ ] **05-GC-15** [R] Commentary-phase assistant rows with only tool calls are dropped by the gateway (session-transcript-readers:1807) — their `toolResult` rows still arrive and are unmatched (dropped by the mapper, still in JSON export).

## Regression (must not break)
- [ ] **05-REG.a** [U] `historyMessages.test.ts` passes unchanged (or extended, never weakened).
- [ ] **05-REG.b** [U] `fileContent.test.ts` passes; `saveHostFileAs` behaviour unchanged (native dialog under Electron, Blob download in PWA).
- [ ] **05-REG.c** [M] Live streaming still shows tool calls with results; the final frame never wipes them (`mergeFinalToolCalls`).
- [ ] **05-REG.d** [M] Question cards / reaction actions / script cards on reloaded OLD messages stay non-interactive (`isLast && !streaming`); `ScriptJobDock` does not re-adopt dead jobs from reloaded tool calls. _(R1)_
- [ ] **05-REG.e** [M] Header does not overflow at 390px after adding ⋯ (row 1: back, emoji, title, Files, DisplayMenu, ⋯); goal control (PRD 04) sits before ⋯.
- [ ] **05-REG.f** [M] Opening a chat on a remote gateway still shows the loading state immediately (`loadingHistory`), with `limit: 500`.
- [ ] **05-REG.g** [M] Channel (Slack) live message appears with its tool calls without reload. _(§9.2 step 3)_
- [ ] **05-REG.h** [R] Export opens no subscription; `sessions.subscribe` renewal on `connectionSeq` unchanged (#75).
- [ ] **05-REG.i** [M] Remote gateway over Tailscale: steps 05-FR1.c and 05-FR6.l pass. _(§9.2 step 10)_

## Ambiguities / untestable
- **A1 (l.152, l.296, l.416 FR-6)** "Reading 1,240 messages…" from `totalMessages` and "the file contains all 1,240 entries" — `totalMessages` counts raw transcript records, including hidden ones (heartbeats, NO_REPLY, runtime context) and record-level duplicates; the file will have a different row count. FR-6 as written is untestable; test "every row of every page, deduped" instead, and progress by offset.
- **A2 (l.416)** "dedupe by message `id` / `__openclaw.id`" — ids are not unique per row (one record can project to 2 rows with the same `__openclaw.id`). Needs per-occurrence dedupe (as the Control UI does) or a (id, index-in-record) key.
- **A3 (l.65, l.300)** The "transcript unavailable" sentinel is effectively unreachable in 9.4 (only when a *placeholder* exceeds 128 KiB, handler :113). The real "too large / rebuilding" case is an `UNAVAILABLE` error. The warning state is hard to trigger manually.
- **A4 (l.304)** "If paging fields are absent (no `hasMore`), export uses the single page" — true only if the first request omits `offset`; otherwise 2026.6.5 fails the request. PRD §5.2 A.2 says "offset 0 → nextOffset", which reads as sending `offset: 0`.
- **A5 (l.497)** Stability: "restart the read once" vs the Control UI, which fails immediately and also re-checks the tail (`limit: 1`, comparing `deltaCursor` and `activeLeafEntryId`) after the last page. Which checks count as "changed"? A running chat changes `totalMessages` on every new row — exporting while running (l.302) may therefore always fail the stability check.
- **A6 (l.399 FR-2)** "`running` when it is the final entry and hasActiveRun" — "final entry" of the history or final call of the last assistant message? A trailing `toolResult`-less call followed by a user row?
- **A7 (l.277)** Heading from `convDisplayName` (`ChatView.tsx:166`) — it's a closure inside the component, not importable by pure `chatExport.ts`; the caller must pass the title.
- **A8 (l.246)** Meta line model "from the message `model` or `sessionInfo`" — messages carry `provider` + `model` separately (`ollama` / `qwen3.6:35b`); the example shows `ollama/qwen3.6:35b`. Which message (last assistant?) and whether per-message model changes are shown is unspecified.
- **A9 (l.160)** "Saved to ~/Downloads/…" — the bridge returns an absolute path (`/home/<user>/Downloads/…`); whether to abbreviate `~` is unspecified.
- **A10 (l.165)** Menu "Copy as Markdown" "runs the same read with the saved defaults" and "the menu stays open until the result shows" — for a 1,000+ message remote chat the menu may stay open for seconds; no Cancel defined. Also clipboard write after a long async read may be refused by the browser (user-activation expired) — FR-12's blocked copy message then applies; untestable in node.
- **A11 (l.297 vs l.14/FR-14)** Empty chat disables the ⋯ items "with the same tooltip", but emptiness needs a loaded conversation; from a chat-list row (not loaded) it is unknown until read.
- **A12 (l.285)** "summary names the sub-agent (\"sub-agent · researcher-2\")" — `sessions_spawn` args have `label`, `taskName`, `agentId`; which one is the name is unspecified.
- **A13 (l.287)** "Attachments are listed as `*Attachments: name, name*`" — gateway image blocks carry no file name (only `mimeType`, `bytes`); what "name" is for them is unspecified.
- **A14 (l.279, R3)** Channel sender field is marked unverified; source shows a top-level `senderLabel` on user rows (session-transcript-readers:61,100). Resolved, but PRD still says unverified.
- **A15 (l.575–576)** "verified on 2026.9.4" and "Unverified whether 2026.7 history carried toolResult messages" — no 2026.7/8 build is available to QA; only 6.5 (no paging) and 9.4 were checked.
- **A16 (l.525)** Test #13 requires a fixture "captured from a local gateway"; capturing needs a running gateway, which this QA pass must not touch. Untestable here.
