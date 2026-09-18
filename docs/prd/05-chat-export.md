# PRD 05: Chat export

> **Status:** Draft for owner approval · **Author:** PM B · **Date:** 2026-09-18
> **Phase:** 2 (build step 4, alongside chat goals) · **Effort:** M (the plan said S–M; the history fix makes it M)
> **Gateway:** OpenClaw 2026.9.4, read from source. Works on any gateway with `chat.history` (≤2026.7).
> **Depends on:** [01-shared-groundwork](01-shared-groundwork.md): `Popover` + `MenuRow` (`components/ui/Popover.tsx`), `Overlay`, `BottomSheet`, `Pill`, `EmptyState`, `gatewayClient.hasMethod()`.
> **Decisions already made:** chat export is in scope, and its entry point is a ⋯ menu at the END of the chat header (the goal control from PRD 04 sits before it).

---

## 1. Summary

**Problem.** You can't get a conversation out of JoaxClaw. To keep it, share it, or drop it into a notes vault, you have to copy messages one by one. The gateway has no chat export. Its `transcripts.*` methods cover meeting recordings, not chats (see PRD 07). There is also a long-standing bug that makes any export incomplete: **when a chat is reopened or reloaded, every tool call disappears** (memory note `chat-history-loses-tool-calls`, reported 2026-07-29).

**Outcome.** From the chat header's ⋯ menu, or from a chat's row in the chat list, you can save the whole conversation as a Markdown file (or JSON for tooling), copy it as Markdown, or share it from a phone. The export includes tool calls, folded into `<details>` blocks. It reads the full history from the gateway, not only what's on screen.

**Solution.** This PRD's research found the root cause of the tool-call bug: **the gateway does return tool calls, and JoaxClaw throws them away.** `chat.history` keeps assistant tool-call blocks as `type: "toolCall"` with `arguments`, and tool results as separate `role: "toolResult"` messages. The app's loader only accepts `type: "tool_use"` with `input` (Anthropic's wire spelling), and it drops every `toolResult` message. So the first PR fixes the loader in a new pure `lib/historyMessages.ts`. That fixes the reload bug everywhere (diffs, question cards, script cards, sub-agent threads) and gives export complete data. The next PR adds `lib/chatExport.ts` (pure: messages → Markdown or JSON), a paging reader, a new ⋯ header menu, the export dialog, and row-menu entries. Saving uses a generalised save helper: the Electron `file:saveAs` bridge on desktop, and the Web Share API with a download fallback in the PWA.

---

## 2. Background and evidence

### 2.1 How the app behaves today

| Area | Evidence | What it means for this feature |
|---|---|---|
| History loader | `src/store/chat.ts:1166` `loadSessionMessages` calls `chat.history` with only `{ sessionKey }` (`chat.ts:1187`) | No `limit` is sent, so the gateway default of **200** entries applies (see 2.2). Long chats open truncated, and nothing pages back. |
| Tool-call extraction | `chat.ts:559–572` `extractToolCalls` keeps blocks where `b.type === 'tool_use'` and reads `b.input` | The gateway sends `type: "toolCall"` with `arguments`, so nothing matches. **This is the reload bug.** |
| Message mapping | `chat.ts:577–610` `toChatMessages` keeps only `role === 'user' \| 'assistant'` | `toolResult` messages are dropped, so results, errors and status are gone even once calls are recognised. The comment at `chat.ts:574–576` says so explicitly. |
| Sub-agent threads | `chat.ts:620–665` `reconstructSubThreads` reuses `extractToolCalls` | Threads come back after a reload but without their tool calls. It also calls `chat.history` without a limit. |
| Live events | `chat.ts:267–320` builds `ToolCall`s from `agent` events (`stream: "tool"`, `phase: start/result`, `toolCallId`, `args`, `result`, `isError`) | The live path is correct. That's why tool calls show while streaming and vanish on reload. |
| `ToolCall` type | `src/lib/types.ts:85–94` `{ id, name, args?, result?, status, durationMs?, error?, pluginId? }` | The target shape for both history and export. |
| Readable tool calls | `src/lib/toolCall.ts:193` `argSummary`, `:151` `toolResultView` | Export reuses these for `<details>` summary lines, so export and chat describe a call the same way. |
| Chat header (desktop) | `src/components/chat/ChatView.tsx:531–622`: emoji, title, session chip, `ModelSelect`, `ThinkingSelect`, then `ml-auto` Files, `DisplayMenu`, pop-out/Return | The ⋯ trigger goes last, after pop-out. |
| Chat header (phone) | `ChatView.tsx:481–529`: two rows. Row 1 is back, emoji, title, Files, `DisplayMenu`; row 2 is model and thinking | The ⋯ trigger goes at the end of row 1. |
| Desktop chat-list row | `ChatView.tsx:803–857` `ChatRow`: on hover it shows three `RowBtn` icons (Rename, Pop out, Delete) at `:850–852` | **Correction to the plan:** there is no desktop "row menu". See 5.1 for the decision. |
| Phone chat-list row | `src/components/chat/MobileChatList.tsx:139–166`: a persistent ⋯ (`MoreVertical`) that opens a small menu with Rename and Delete | Export is added here as a third item. |
| Save bridge | `electron/main/index.ts:561–572` `file:saveAs(name, base64)` opens a native Save dialog and writes the bytes; exposed at `electron/preload/index.ts:101` | Reusable as is. |
| Save helper | `src/lib/fileContent.ts:206` `saveHostFileAs(path, name)` reads a *host file*, then uses `saveAs` or falls back to a Blob download | Coupled to reading a host file. Export needs the save half on its own (see 8.1). |
| Teams export | `src/store/teams.ts:404–423` builds a Blob and clicks an `<a download>` | **Correction to the plan:** Teams does *not* use `file:saveAs`. |
| Share sheet | `navigator.share` appears nowhere in `src/` | New code. |
| Clipboard | `FilePreview.tsx:59`, `DiffView.tsx:115` use `navigator.clipboard.writeText` with inline "copied" feedback | Same pattern for "Copy as Markdown". |

### 2.2 What the gateway offers

| Method / event | Scope | Since | Params → result | Used for | Source |
|---|---|---|---|---|---|
| `chat.history` | operator.read | ≤2026.7 | `{ sessionKey, agentId?, limit? (1–1000, default **200**), offset?, messageId?, cursor?, maxChars? (1–500000, default **8000**), maxBytes?, … }` → `{ sessionKey, sessionId, messages[], offset?, nextOffset?, hasMore?, totalMessages?, deltaCursor?, sessionInfo, defaults, … }` | Loading a chat; reading the whole history for export | `dist/sessions-rlbLHLas.mjs` (`ChatHistoryParamsSchema`); handler `dist/chat-history-handler-DpOELHcj.mjs` (`handleChatHistoryRequest`, `max = Math.min(1000, limit ?? 200)`); `CHAT_HISTORY_MAX_ENTRIES = 1e3` in `dist/chat-history-constants-C-H8nkgi.mjs` |
| `chat.message.get` | operator.read | ≤2026.7 | `{ sessionKey, agentId?, messageId }` → the same display projection, "without the lightweight history truncation cap" | Optional: getting a message's full text when history truncated it | `dist/method-scopes-tKV11oMS.mjs`; `docs/gateway/protocol/rpc-session-control.md:37` |
| `session.message` (event) | subscribers of `sessions.subscribe` | ≤2026.7 | `{ sessionKey, message, messageId?, … }`, where `message` has the same shape as a history entry | Already handled by `ingestSessionMessage` (`chat.ts:1226`). It gets the same mapper fix. | memory `session-subscription-per-connection` |

**How tool calls and results appear in history (verified).**
- The projection in `dist/session-transcript-readers-BZjuw2hz.mjs` (`projectChatDisplayMessagesWithState`) keeps tool blocks. When it rebuilds nested tool activity it emits `content: [call, { ...result, role: "toolResult" }]`.
- The gateway's own content helper `dist/chat-display-projection.canvas-hWMu3XQA.mjs` (`src/chat/tool-content.ts`) accepts every spelling: `isToolCallContentType` matches `toolcall | tool_call | tooluse | tool_use`, and `isToolResultContentType` matches `toolresult | tool_result`.
- The ID can be in any of `id | tool_call_id | toolCallId | tool_use_id | toolUseId` (`TOOL_USE_ID_FIELDS`).
- Arguments are in `arguments` or `input` (`stripPrivateToolCallContextForDisplay` handles both).
- The persisted form is `type: "toolCall"` + `arguments`. Tool results are messages with `role: "toolResult"` (or `tool_result`/`tool`/`function`) carrying `toolCallId`/`toolName` (`sanitizeChatHistoryMessage`, `preserveExactToolPayload`).
- `sessions_yield` calls have their private `message` argument stripped for display.

**Truncation and size limits (verified).**
- Text and thinking blocks are cut at `maxChars` (default 8000) with a trailing `\n...(truncated)...` (`truncateChatHistoryText`).
- **Tool payloads are exempt** from `maxChars`: `preserveExactToolPayload` covers tool block types and `toolResult`/`tool` roles (`sanitizeChatHistoryContentBlock`, `sanitizeChatHistoryMessage`).
- A single message over 128 KiB (`CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES = 131072`) is replaced whole by `"[chat.history omitted: message too large]"`, with `__openclaw.truncated: true, reason: "oversized"`. That drops its tool blocks too.
- A page is capped at `maxChatHistoryMessagesBytes = 6291456` (6 MiB, `dist/server-constants-*.mjs`). The oldest messages are dropped first, and `nextOffset` accounts for it, so paging skips nothing.
- The whole transcript can come back as `"[chat.history unavailable: transcript too large to display; the full history is preserved on disk]"`.
- Tool-result `details` are reduced to an allow-list (diff, browserTab, approval reviews, and so on).
- **History starts at the latest reset.** Compactions and resets appear as synthetic `role: "system"` rows with `__openclaw.kind: "compaction" | "reset"`. Messages before an in-session reset aren't reachable by `offset` paging. That's unverified in full, but it is how `readLatestActiveBoundaryMetadata` reads.
- One edge case: assistant messages tagged `phase: "commentary"` that hold only tool calls look to be dropped by `shouldDropAssistantHistoryMessage`. This affects OpenAI Responses/Codex-style providers and is **unverified**; check it with a Codex-backed agent during QA.

**Paging (verified).** Offsets count back from the newest entry. The first call uses `offset` 0 (or none). The response carries `hasMore`, `nextOffset` and `totalMessages` (`resolveChatHistoryNextOffset`). You keep calling with `offset: nextOffset` while `hasMore`. `offset` can't be combined with `messageId`, and `cursor` can't be combined with either (the handler rejects both combinations).

### 2.3 How the Control UI does it

OpenClaw's own UI has two export paths (`dist/control-ui/assets/`):

1. **"Conversation as Markdown"**, a session action (`copy-markdown`, `control-ui-boot-shared-CVhtgdUv.js`).
   - It pages the whole history exactly the way this PRD proposes: `chat.history` with `limit: 1000, maxChars: 500000, offset`, looping on `nextOffset` while `hasMore`.
   - It checks that `sessionId` and `totalMessages` stay the same across pages. If they change, it fails with "Conversation changed while copying. Try again."
   - It copies to the clipboard only.
2. **`/export-session`** (alias `/export`), plus the **Export chat** run control.
   - It downloads `chat-<agent>-<timestamp>.md` with `text/markdown` (`control-ui-boot-shared-BZN8j_mN.js`).
   - It exports only the messages already loaded.
3. **Shared Markdown builder.** Both use the same builder: `# Chat with <agent>`, then `## You | <agent> | Tool (time)`, with **text only**.
   - Tool arguments and results aren't written out.
   - `NO_REPLY` rows, empty user rows and synthetic "missing tool result" rows are filtered out.
   - Separately, each tool card has its own "copy as markdown" that writes `**Tool:**`, `### Tool input` (JSON) and `### Tool output`.
4. **Loading history.** The Control UI loads chats with `limit: 80, maxBytes: 262144` and loads older pages on demand with `limit: 1000, offset`. Its renderer builds tool cards from `toolCall` blocks (`args ?? arguments ?? input`) and pairs `toolResult` rows by id. That confirms the shape our loader should read.

We copy its paging and its session-stability check, and match its voice ("You", the agent's name) and filename shape. We go further by folding tool calls into the file. Its tool-card Markdown layout (input JSON, then output) is the model for our `<details>` body.

### 2.4 Prior art

- **ChatGPT** exports a single chat to Markdown or PDF from the conversation's ⋯ menu or the Share button. Account-wide export is a separate emailed ZIP ([chatgptexporter guide](https://www.chatgptexporter.com/en/blog/how-to-export-chatgpt-to-markdown)). *Lesson:* per-chat export lives in the chat's own ⋯ menu, and bulk export is a different feature. We ship the per-chat one only.
- **Third-party ChatGPT exporters** exist mainly because the built-in export drops structure (code, tool output). *Lesson:* tool calls folded in `<details>` are the difference that matters, and Markdown with `<details>` renders in GitHub, Obsidian and our own `FilePreview`.
- **Slack and Discord** exports are JSON-first, for tooling. *Lesson:* offer JSON as the second format, containing the gateway's raw messages.

---

## 3. Goals / Non-goals

**Goals**
1. Reopening or reloading a chat shows its tool calls again, with results and error state. This fixes the July bug at its root.
2. Export any chat, including a long one, as Markdown with tool calls folded, or as raw JSON.
3. Save through the native dialog on desktop, the share sheet on a phone (or a download), or copy to the clipboard.
4. Be honest about gaps: truncated or omitted messages, and a still-running turn.

**Non-goals**
- Bulk export of all chats, or an account backup.
- Embedding images or attachments. They're listed by name, with a link when there is one.
- PDF or HTML output.
- Importing chats back in.
- Exporting meeting transcripts (PRD 07 does that through `transcripts.export`).
- A gateway-side export method.

---

## 4. Users and jobs to be done

- **As the owner**, when a research chat produces something worth keeping, I want to save it as a Markdown file in my notes vault, so the reasoning and the sources (tool calls) stay with the result.
- **As the owner on my phone**, I want to share a chat to another app (Notes, Mail, Files) without going through a desktop.
- **As the owner**, I want to paste a chat into a GitHub issue, with tool calls folded so the issue stays readable.
- **As the owner**, when I reopen yesterday's chat, I want to see what the agent actually ran, not just its prose. This is the reload bug.
- **As a developer**, I want the raw JSON of a chat to debug an agent or feed a script.

---

## 5. UX specification

### 5.1 Entry points and placement

1. **Chat header ⋯ menu (new).**
   - A 26px icon trigger (`MoreHorizontal`, 13px on desktop, 16px on phone). On desktop it sits after the pop-out/Return button. On a phone it sits at the end of header row 1, after `DisplayMenu`.
   - Justification: rule 1 says the chat's own controls live in the header. The owner decided that the ⋯ menu sits at the header's end and that goals (PRD 04) sit before it.
   - The menu is the 01 `Popover` with `MenuRow`s. It is the only new header control this PRD adds, so the header doesn't grow any further.
   - Contents in v1:
     - **Export chat…**
     - **Copy as Markdown**
     - on a phone, **Share…** in place of "Export chat…" when `navigator.canShare` supports files
     - The pop-out button stays where it is in v1. Moving it into this menu is open question Q3.
   - Later features can add items here (for example "Rename"); this PRD doesn't.
2. **Phone chat list:** `MobileChatList` ⋯ menu gets **Export** between Rename and Delete. It opens the same export sheet.
3. **Desktop chat list.** There is no row menu to add to (`ChatView.tsx:850–852`). Recommendation: add a fourth hover `RowBtn` (`Download`, 11px, title "Export chat") before Delete.
   - Why not a new row ⋯ menu: hover buttons are the established desktop row pattern, and a menu for one extra action would be a new pattern.
   - This is flagged as **Q1** for the owner.
4. **Not added:** a Dashboard "Recent" shortcut, or a keyboard-only global command. There is no command palette.

### 5.2 Flows

**A. Export from the header (desktop)**
1. Click ⋯ → **Export chat…**. The menu closes and the Export dialog opens: an `Overlay`, 480px wide, rendered as a sibling of the chat pane (#74 lesson).
2. The dialog immediately starts reading history: `chat.history` pages of 1000 (`limit: 1000`, `maxChars: 500000`), offset 0 → `nextOffset` while `hasMore`.
   - The status line shows "Reading 1,240 messages…" (from `totalMessages`) with a `ProgressTrack` for `read/total`.
   - Options are usable while it reads. **Save…** stays disabled until reading finishes.
3. Options:
   - **Format:** Markdown | JSON, a segmented control in the style of the `ExtensionsView` Skills/Plugins segment.
   - **Include:** Tool calls (on) · Reasoning (off) · Timestamps (on). JSON ignores these and writes raw messages.
   - Option choices are remembered per device in `localStorage` (wrapped in try/catch).
4. Preview: the first ~40 lines of the file, in a mono `<pre>` with the `FilePreview` styling.
5. **Save…** calls the `saveBytesAs` helper (see 8.1). On desktop the native Save dialog opens with the default name `pricing-research-2026-09-18.md`.
   - Result shown inline under the buttons: "Saved to ~/Downloads/pricing-research-2026-09-18.md" (success tone).
   - A cancelled dialog shows nothing and the export dialog stays open.
   - Save errors show in a danger box.
6. **Copy as Markdown** in the dialog footer copies the same text; the button reads "Copied" for 1.5 s.

**B. Copy from the menu.** ⋯ → **Copy as Markdown** runs the same read with the saved defaults, without a dialog. While reading, the menu row shows a spinner and "Copying…"; then "Copied" for 1.5 s. If the read fails, the row shows "Couldn't read the chat" in danger text for 3 s. The menu stays open until the result shows, then closes.

**C. Phone: share**
1. ⋯ → **Share…**. A bottom sheet (`animate-slide-up`, drag handle, `safe-area-inset`) holds the same options and a short preview. It reads history the same way.
2. **Share** calls `navigator.share({ files: [File], title })` when `navigator.canShare({ files })` is true.
   - Otherwise it falls back to a Blob download with the text "Downloaded pricing-research-2026-09-18.md".
   - An `AbortError` (user dismissed the sheet) shows nothing.
3. **Copy** is available in the same sheet.

**D. From a chat-list row.** This is the same dialog or sheet, keyed to that row's `sessionKey`. It doesn't open the chat. It needs only the session key and title, not a loaded conversation.

### 5.3 Wireframes

**Desktop: header with ⋯ and the menu open**
```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ 🤖 Pricing research  agent:researcher:m…  [◈ qwen3.6 ▾][🧠 Adaptive ▾]   [🗀][⚙ Basic ▾][↗][⋯]│
├──────────────────────────────────────────────────────────────────────── ┌───────────────────┐
│ Context ▓▓▓▓▓▓░░░░░░  41k / 128k                                        │ ⤓ Export chat…    │
├──────────────────────────────────────────────────────────────────────── │ ⧉ Copy as Markdown│
│                                                                         └───────────────────┘
```

**Desktop: export dialog (reading, then ready)**
```
            ┌──────────────── Export "Pricing research" ─────────────── ✕ ┐
            │ Format    [ Markdown | JSON ]                                │
            │ Include   ☑ Tool calls, folded   ☐ Reasoning   ☑ Timestamps  │
            │                                                              │
            │ Reading 1,240 messages…  ▓▓▓▓▓▓▓▓░░░░░░  620/1,240   Cancel  │
            │ ┌──────────────────────────────────────────────────────────┐ │
            │ │ # Pricing research                                       │ │
            │ │ agent: researcher · model: ollama/qwen3.6:35b · …        │ │
            │ │                                                          │ │
            │ │ **You** · 10:41                                          │ │
            │ │ Research what the three competitors charge…              │ │
            │ │ **researcher** · 10:42                                   │ │
            │ │ <details><summary>web_fetch · acme.com/pricing</summary> │ │
            │ └──────────────────────────────────────────────────────────┘ │
            │ ⚠ 3 long messages were shortened by the gateway.             │
            │                         [Copy as Markdown] [Cancel] [Save…]  │
            └──────────────────────────────────────────────────────────────┘
```

**Desktop: chat-list row on hover**
```
│ 🤖 Pricing research           [✎][↗][⤓][🗑] │
│    Research what the three competitors…       │
```

**Phone: header menu and share sheet**
```
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ ←  🤖 Pricing research  🗀 ⚙ ⋯ │   │            ───                │
│ [◈ qwen3.6 ▾][🧠 Adaptive ▾]   │   │ Share "Pricing research"      │
├──────────────┬────────────────┤   │ Format  [ Markdown | JSON ]   │
│              │ ⤴ Share…       │   │ ☑ Tool calls  ☐ Reasoning     │
│              │ ⧉ Copy as Mark…│   │ Reading 214 messages… ▓▓▓░░   │
│              └────────────────┤   │ ┌───────────────────────────┐ │
│  (thread)                     │   │ │ # Pricing research        │ │
│                               │   │ │ **You** · 10:41 …         │ │
│                               │   │ └───────────────────────────┘ │
│                               │   │ [ Copy ]          [ Share ]   │
└───────────────────────────────┘   └───────────────────────────────┘
```

**Phone: chat-list row menu**
```
│ 🤖  Pricing research      10:42  ⋮ │
│     Research what the three…  ┌──────────┐
│                               │ ✎ Rename │
│                               │ ⤓ Export │
│                               │ 🗑 Delete │
│                               └──────────┘
```

### 5.4 Output format (Markdown)

```markdown
# Pricing research

agent: researcher · model: ollama/qwen3.6:35b · session: agent:researcher:main-7f3a · exported 18 Sep 2026, 10:55
> Still running when exported: the last reply may be incomplete.        ← only when a run is active

---

**You** · 18 Sep 10:41

Research what the three competitors charge…

**researcher** · 18 Sep 10:42

<details><summary>🔧 web_fetch · acme.com/pricing · done</summary>

```json
{ "url": "https://acme.com/pricing" }
```

Result:

```text
Acme Pro is $29 / seat …
```

</details>

Acme charges $29 per seat…

*Attachments: screenshot.png*
```

Rules:
- The heading is the chat's display name, taken from `convDisplayName` (`ChatView.tsx:163`), so the export uses the same name the list shows.
- The meta line holds the agent, the model (from the message `model` or `sessionInfo`), the session key and the export time.
- Speaker labels: user → **You**; assistant → the agent name. A channel message (Slack, WhatsApp) uses the sender label when the history carries one. **Unverified:** the exact sender field. Check `__openclaw` and `senderLabel` on channel user messages in a live `chat.history`.
- Tool calls:
  - Each is one `<details>` with `<summary>` set to `name · argSummary(args) · done|error`.
  - The body is `args` as JSON, then the result through `toolResultView` (text if there is some, else JSON). Results are capped at 20,000 characters, with a `…(shortened in export)` marker.
  - Errors use `error` in the summary and "Error:" before the body.
  - The 🔧 glyph in the summary is file content, not UI.
- `sessions_spawn` / `sessions_yield` calls: the summary names the sub-agent ("sub-agent · researcher-2"). Child transcripts are NOT inlined in v1 (open question **Q4**).
- Reasoning, when included, is a `<details><summary>Reasoning</summary>` block before the reply.
- Attachments are listed as `*Attachments: name, name*`. A URL becomes a link; base64 data is never embedded.
- Gateway truncation markers (`...(truncated)...`, `[chat.history omitted: message too large]`) are kept verbatim, and counted for the dialog notice.

**JSON:** `{ exportedAt, sessionKey, title, agentId, totalMessages, messages: <raw chat.history messages, oldest first> }`, pretty-printed. The raw messages are exactly what the gateway returned, without the app's mapping, so the file is useful for debugging.

### 5.5 States

| State | Behaviour |
|---|---|
| Reading | "Reading N messages…" with a `ProgressTrack` (the count comes from `totalMessages`; before the first page: "Reading messages…"). Cancel stops paging and closes. |
| Empty chat | "This chat has no messages yet." The Save/Share and Copy buttons are disabled. The ⋯ menu items are disabled with the same tooltip. |
| Unsaved new chat (no `sessionKey`) | The ⋯ menu entries are hidden: there's nothing on the gateway to read. |
| Read error | Danger box: "Couldn't read this chat from the gateway: <message>. Try again." with a **Try again** button. A partial read is never saved. |
| Transcript unavailable (sentinel) | Warning box: "The gateway can't show this chat's full history (it's too large). The file will contain what it returned." Export still allowed. |
| Truncated / omitted messages | Warning line: "N long messages were shortened by the gateway." (Q5 covers fetching them in full.) |
| Still running | Meta line in the file (5.4). Dialog note: "This chat is still running. The file has what exists so far." Detected from `sessionInfo.hasActiveRun`. |
| Disconnected / reconnecting | The ⋯ items are disabled with the tooltip "Connect to the gateway to export". An in-progress read that loses the connection shows the read error with Try again. |
| Older gateway | `chat.history` exists on all supported gateways. If paging fields are absent (no `hasMore`), export uses the single page and warns "Only the latest N messages could be read." |
| No read scope | Can't happen for a working chat (`chat.history` needs `operator.read`, as does opening the chat). If the call is refused, the read error applies. |
| Remote vs local | No difference: the read goes over the WebSocket, and the file is saved on the device running JoaxClaw. |
| Pop-out window | Same header ⋯, same dialog. |
| Save cancelled | Nothing shown. |
| Share unsupported | Download fallback, with an inline "Downloaded <file>." |

### 5.6 UI copy

| Key | String |
|---|---|
| header.more.title | More |
| menu.export | Export chat… |
| menu.copy | Copy as Markdown |
| menu.copy.busy | Copying… |
| menu.copy.done | Copied |
| menu.copy.failed | Couldn't read the chat |
| menu.share | Share… |
| menu.disabled.offline | Connect to the gateway to export |
| menu.disabled.empty | This chat has no messages yet |
| row.export.title | Export chat |
| row.menu.export | Export |
| dialog.title | Export "{title}" |
| sheet.title | Share "{title}" |
| dialog.format | Format |
| dialog.format.md | Markdown |
| dialog.format.json | JSON |
| dialog.include | Include |
| dialog.include.tools | Tool calls, folded |
| dialog.include.reasoning | Reasoning |
| dialog.include.time | Timestamps |
| dialog.json.note | JSON has every message exactly as the gateway sent it. |
| dialog.reading | Reading {n} messages… |
| dialog.reading.unknown | Reading messages… |
| dialog.truncated | {n} long messages were shortened by the gateway. |
| dialog.running | This chat is still running. The file has what exists so far. |
| dialog.partialPaging | Only the latest {n} messages could be read. |
| dialog.unavailable | The gateway can't show this chat's full history (it's too large). The file will contain what it returned. |
| dialog.error | Couldn't read this chat from the gateway: {message}. Try again. |
| dialog.retry | Try again |
| dialog.save | Save… |
| dialog.share | Share |
| dialog.copy | Copy as Markdown |
| dialog.copied | Copied |
| dialog.cancel | Cancel |
| dialog.saved | Saved to {path} |
| dialog.downloaded | Downloaded {filename} |
| dialog.saveError | Couldn't save the file: {message} |
| file.running | Still running when exported: the last reply may be incomplete. |
| file.you | You |

### 5.7 Keyboard and accessibility

- The ⋯ trigger is a `<button aria-label="More" aria-haspopup="menu" aria-expanded>`.
- Menu rows are `role="menuitem"` (01's `MenuRow` provides this). Up/Down moves between rows, Enter activates, and Esc closes and returns focus to the trigger.
- The dialog traps focus. Esc closes it (the `Overlay` already binds Esc, `ChannelsPanel.tsx:908–912`). The primary button is **Save…** / **Share**.
- The status line is `aria-live="polite"`, so the count and the "Copied" / "Saved to…" results are announced.
- The segmented format control is a radio group.
- Phone tap targets are at least 40px. The desktop row button carries a title and an aria-label.

### 5.8 Notifications and deep links

None. Export is a foreground action with inline feedback. There are no toasts (per the design book).

---

## 6. Design-book conformance

| Item | Used | Notes |
|---|---|---|
| Tokens | `--bg-surface`, `--bg-elevated`, `--border`, `--text-primary/secondary`, `--accent`, `--danger`, `--warning`, `--success`, `--radius` | Tints via `color-mix(... 10–12%, transparent)`, as in `PluginBrowser.tsx:54,60`. |
| Popover / menu | 01 `Popover` + `MenuRow` (extracted from `ChatHeaderControls.tsx:27–38,209–228`) | The ⋯ menu. |
| Trigger | `triggerStyle` icon variant | Matches the Files and pop-out buttons (1px border, 13px icon). |
| Dialog | 01 `Overlay` (from `ChannelsPanel.tsx:905`) | Rendered as a sibling (the #74 rule). |
| Bottom sheet | 01 `BottomSheet` (extracted from the BottomNav "More" sheet) | `animate-slide-up`, drag handle, safe-area, portalled. |
| Segmented control | The Skills/Plugins segment in `ExtensionsView.tsx:171–187` | Reused styling. |
| Progress | `ProgressTrack` | Reading progress. |
| Buttons | `Btn` primary/outline/ghost, `sm` | |
| Feedback | Inline states, "Copied" on the button | No toasts. |
| State colours | warning = needs your attention (truncation, still running), danger = failed | Same as other PRDs. |
| Icons | lucide `MoreHorizontal`, `Download`, `Copy`, `Share2` at 11–16px | |
| **New** | None visually. The ⋯ header trigger is new but built only from existing primitives. The `saveBytesAs` helper is new code, not a new pattern. | |

---

## 7. Functional requirements

**FR-1: Tool calls survive a reload.**
- *Given* a chat where the agent called `web_fetch` and `exec`,
- *when* the app reloads and the chat is reopened,
- *then* both calls appear on the assistant message that made them, with status `done`, and the same `args` and `result` the live view showed. A failed call shows status `error` with its error text.

**FR-2: Tool results pair to calls.**
- *Given* history in which a `role: "toolResult"` message follows an assistant message with `toolCall` blocks,
- *when* it is mapped,
- *then* each result attaches to the call with the same `toolCallId`. An unmatched result is dropped. A call with no result shows `done` when a later assistant message exists, and `running` when it is the final entry and `sessionInfo.hasActiveRun` is true.

**FR-3: Every block spelling is accepted.**
- *Given* tool-call blocks typed `toolCall`, `tool_call`, `toolUse` or `tool_use` (case-insensitive), with args in `arguments` or `input` and ids in any `TOOL_USE_ID_FIELDS` field,
- *then* they all map to `ToolCall`.

**FR-4: Live-ingested messages use the same mapper.**
- *Given* a `session.message` carrying an assistant message with `toolCall` blocks,
- *then* `ingestSessionMessage` appends it with its tool calls, and a following `toolResult` message updates the matching call instead of being dropped.

**FR-5: Sub-agent threads keep their tool calls.**
- *Given* a reloaded parent chat,
- *then* `reconstructSubThreads` shows the child's tool calls (excluding `sessions_spawn`).

**FR-6: The whole history is read.**
- *Given* a chat with `totalMessages` = 1,240,
- *when* export runs,
- *then* the app pages `chat.history` with `limit: 1000` until `hasMore` is false, and the file contains all 1,240 entries, oldest first, without duplicates (dedupe by message `id` / `__openclaw.id`).

**FR-7: Markdown is well-formed.**
- *Given* any mapped chat,
- *then* `toMarkdown()` produces a heading, a meta line, and one section per message. Every `<details>` opened is closed. Fenced blocks use a fence longer than any fence inside the content.

**FR-8: Include options apply.**
- *Given* "Tool calls" is off, *then* no `<details>` for tools appear.
- *Given* "Reasoning" is on, *then* reasoning appears folded.
- The options persist per device.

**FR-9: JSON is raw.**
- *Given* JSON format, *then* the file contains the gateway's messages unmodified, plus the export envelope.

**FR-10: Desktop save.**
- *Given* the Electron app, *when* Save… is pressed, *then* `window.api.file.saveAs(name, base64)` is called with UTF-8 bytes. On `{ ok: true, path }` the dialog shows "Saved to {path}"; on `{ canceled: true }` it shows nothing.

**FR-11: Phone share.**
- *Given* the PWA and `navigator.canShare({ files: [file] })` is true, *when* Share is pressed, *then* `navigator.share` is called with the file.
- *Given* canShare is false or share throws a non-abort error, *then* the app falls back to a download and shows "Downloaded {filename}".

**FR-12: Copy.**
- *When* Copy as Markdown is pressed, *then* the same Markdown is written to the clipboard and the control shows "Copied" for 1.5 s. If the clipboard is blocked, it shows "Couldn't copy. Use Save instead."

**FR-13: Honest gaps.**
- *Given* any message contains the gateway truncation marker or the omitted placeholder, *then* the dialog shows the count.
- *Given* `sessionInfo.hasActiveRun`, *then* the file carries the still-running line.

**FR-14: Entry points.**
- The header ⋯ has Export chat… and Copy as Markdown on desktop, and Share… on a phone with share support.
- The desktop row has an Export button; the phone row menu has Export.
- All are hidden for a chat without a `sessionKey` and disabled while disconnected.

**FR-15: History load fetches more than 200.**
- *Given* a chat longer than 200 entries, *when* it is opened, *then* `loadSessionMessages` requests `limit: 500` (Q2), and the thread's top shows "Earlier messages aren't loaded. Export reads the whole chat." when `hasMore` is true. (Infinite scroll is out of scope.)

---

## 8. Technical design

### 8.1 Modules

| Path | New/changed | Purpose |
|---|---|---|
| `src/lib/historyMessages.ts` | **New, pure** | `mapHistoryMessages(raw, { sessionKey, activeRun? }) → ChatMessage[]`, together with the moved `extractText`, `extractReasoning`, `extractAttachments` and `extractModel`, and new `extractToolCallBlocks` and `pairToolResults`. Accepts every spelling (FR-3). |
| `src/store/chat.ts` | Changed | `toChatMessages` becomes a thin wrapper over `mapHistoryMessages`. `extractToolCalls` is deleted. `reconstructSubThreads` uses the new extractor. `loadSessionMessages` sends `limit: 500` and keeps `hasMore`/`totalMessages` on the `Conversation`. `ingestSessionMessage` handles `toolResult` payloads by patching the matching call in place. |
| `src/lib/types.ts` | Changed | `Conversation` gains `historyHasMore?: boolean`, `historyTotal?: number`. |
| `src/lib/chatHistoryReader.ts` | **New** | `readFullHistory(sessionKey, { onProgress, signal }) → { raw[], total, truncatedCount, activeRun, unavailable, pagingSupported }`. Pages with `limit: 1000`, `maxChars: 500000`, and dedupes. It lives in lib, but calls `gatewayClient`. The paging arithmetic is split into a pure `nextPageParams()` for tests. |
| `src/lib/chatExport.ts` | **New, pure** | `toMarkdown(messages, meta, opts)`, `toJson(raw, meta)`, `exportFilename(title, date, ext)` (slugified, e.g. `pricing-research-2026-09-18.md`), `fenceFor(text)`, `countTruncated(raw)`. |
| `src/lib/saveFile.ts` | **New** | `saveBytesAs(name, bytes, mediaType)` (bridge → Blob download) and `shareOrDownload(name, bytes, mediaType, title)`. `fileContent.ts saveHostFileAs` is refactored to call `saveBytesAs`, with no behaviour change. |
| `src/components/chat/ChatMoreMenu.tsx` | **New** | The ⋯ trigger and menu, used in both header layouts. |
| `src/components/chat/ExportChatDialog.tsx` | **New** | The dialog (desktop, `Overlay`) and the bottom sheet (phone), switched by `useIsNarrow()`. |
| `src/components/chat/ChatView.tsx` | Changed | Mount `ChatMoreMenu` in both headers; add the `onExport` row button to `ChatRow`; pass `onExport` on `ChatItem`s. |
| `src/components/chat/MobileChatList.tsx` | Changed | Add an Export item to the row menu. |
| `src/components/chat/MessageThread.tsx` | Changed | The "Earlier messages aren't loaded" line (FR-15). |

### 8.2 Data flow

- **Reload:** `chat.history` → `mapHistoryMessages` → the conversation's messages. It walks entries in order and keeps a `Map<toolCallId, ToolCall>` for the calls on the current assistant turn. A `toolResult` entry updates the matching call (`result`, or `error` when `isError`/`details.status === 'error'`), then is dropped as a row.
- **Live:** unchanged. The live path is already right, and the mapper only runs on history and `session.message`.
- **Export:** `readFullHistory` → raw pages (newest page first, since offsets count back from the tail), assembled oldest first → `mapHistoryMessages` (for Markdown) or raw (for JSON) → `chatExport` → `saveBytesAs` / `shareOrDownload` / clipboard.
- **Reconnect:** export holds no subscription. A connection drop rejects in-flight requests, and the dialog shows the read error with Try again. `sessions.subscribe` renewal on `connectionSeq` is already handled by the sessions store (#75).

### 8.3 Capability gating

- `chat.history` is available everywhere, so there is no feature gate.
- The ⋯ menu appears whenever a `sessionKey` exists.
- Paging degrades gracefully when the response has no `hasMore`.
- `navigator.share` is feature-detected. `window.api.file.saveAs` is detected the same way `saveHostFileAs` does it.

### 8.4 Error handling

- Gateway errors are shown as their message (reusing `errText`).
- `INVALID_REQUEST "offset and messageId cannot be used together"` can't happen, because we never send `messageId`.
- A drop mid-read aborts via `AbortController`.
- Save bridge errors surface `res.error`.

### 8.5 Performance and size limits

- **Page size.** 1000 entries per page, with `maxChars: 500000` so text isn't cut at 8000. `maxBytes` isn't sent, so the gateway's own page byte cap applies. The gateway still enforces its 128 KiB-per-message cap.
- **Frame size.** The server caps a page at 6 MiB (`maxChatHistoryMessagesBytes`), which is under the default 25 MiB frame limit (`gatewayClient.maxPayload`), so a page always fits. The byte cap may return fewer than 1000 entries. Paging handles that, because `nextOffset` is computed after the cap.
- **Stability.** As the Control UI does, record `sessionId` and `totalMessages` from the first page. If a later page reports different values, restart the read once. If they change again, fail with "This chat changed while it was being read. Try again."
- **Scale.** At 1,240 messages, expect 2 requests and a few MB of JSON. The Markdown is built in one pass (string array join).
- **Save.** The desktop bridge takes base64, which adds ~33% over IPC. That is fine at the tens-of-MB scale (`SAVE_MAX_BYTES` is 32 MiB, `fileContent.ts:18`). Refuse above 32 MiB with "This chat is too large to save from the app (over 32 MB)."
- **Reload.** `limit: 500` instead of the default 200 increases the payload on a remote gateway by up to 2.5×. Q2 decides the number.

### 8.6 Migration

No stored data changes. The only visible change is that tool calls appear on reload. Old chats benefit immediately, since the data was always on the gateway.

---

## 9. Test plan

### 9.1 Unit tests

**`src/lib/__tests__/historyMessages.test.ts`**
1. `toolCall` + `arguments` maps to a `ToolCall` with JSON `args`.
2. `tool_use` + `input` still maps (regression).
3. `toolUse`, `tool_call`, `TOOLCALL` casing is accepted.
4. An id taken from `toolCallId`, `tool_use_id` or `id`.
5. A `toolResult` message pairs by `toolCallId` → `status: done`, `result` text.
6. A `toolResult` with `isError` → `status: error`, `error` text.
7. A result for an unknown id is ignored, with no row emitted.
8. The final call with no result and `activeRun` → `running`; the same without `activeRun` → `done`.
9. An assistant message with only tool calls is kept (not filtered as empty).
10. `sessions_yield` with a stripped `message` arg doesn't crash.
11. Audio and MediaPaths attachments still extract (a moved-code regression).
12. A bare unclosed `<think>` message is still dropped.
13. Fixture: a real 2026.9.4 `chat.history` response captured from a local gateway (add under `src/lib/__tests__/fixtures/chat-history-2026.9.4.json`).

**`chatExport.test.ts`**
1. The heading and meta line.
2. User/assistant labels.
3. A tool call becomes a closed `<details>` with a summary from `argSummary`.
4. An error call.
5. Tools off → no `<details>`.
6. Reasoning on.
7. Content containing ```` ``` ```` gets a longer fence.
8. A result over 20k characters is shortened with a marker.
9. Attachments are listed, not embedded.
10. The truncation count.
11. The still-running line.
12. `exportFilename` slugs unicode and odd characters and falls back to `chat-<date>.md`.
13. JSON round-trips the raw messages unchanged.

**`chatHistoryReader.test.ts`** (`nextPageParams`, pure)
1. The first page.
2. Follows `nextOffset`.
3. Stops at `hasMore: false`.
4. Stops when there is no paging info.
5. Dedupe across overlapping pages (`replayOldestRecord` can repeat one entry).

**`saveFile.test.ts`**
1. Uses the bridge when present.
2. Blob fallback.
3. Share when `canShare`.
4. `AbortError` → no fallback.
5. Other error → download.

### 9.2 Manual QA script

1. On a local 2026.9.4 gateway, in an isolated profile (per `gateway-vs-project-scope`), have an agent run 3 tools, one of them failing. Reload the app (Ctrl+R) and reopen the chat. **Expect** 3 tool cards, the failing one red.
2. Open a chat with a sub-agent spawn and reload. **Expect** the thread with its tool calls.
3. Slack channel chat: a live inbound message appears, and its tool calls show without a reload.
4. A chat with more than 1,000 messages (generate one with a script) → Export → **Expect** the count, the progress bar, and every message in the file (check the first and last).
5. Save on Linux, macOS and Windows; cancel the dialog; save into a read-only folder (expect the error box).
6. PWA on iOS Safari and Android Chrome → Share → Notes / Files; then a desktop browser PWA with no file share → download.
7. Copy as Markdown from the menu → paste into GitHub → the tool calls fold.
8. Export while the agent is mid-reply → the still-running line.
9. Kill the gateway mid-read → the error with Try again; restart → Try again succeeds.
10. Remote gateway over Tailscale: same as steps 1 and 4.
11. Pop-out window: the ⋯ menu works.
12. Screen reader (Orca/VoiceOver): the menu and the dialog announce correctly.

---

## 10. Rollout

- There is no gateway gate. `chat.history` with the tool-block shape has been verified on 2026.9.4.
- **Older gateways (2026.7/8):** the spelling tolerance (FR-3) covers either shape. **Unverified:** whether 2026.7 history carried `toolResult` messages. Check on a 2026.7 install during QA; if absent, calls show `done` without results, which is still better than today.
- **Ship order:** the history fix first (PR 1, fix only, CHANGELOG under **Fixed**), then export (PR 2).
- No feature flag. The fix is a strict improvement, and export is additive.

---

## 11. Risks and open questions

| # | Item | Needs owner? |
|---|---|---|
| Q1 | The desktop row gets a 4th hover button (recommended) instead of a new row ⋯ menu. | **Yes** |
| Q2 | Reload page size: 500 (recommended), 1000, or keep 200 plus a "Load earlier" button. It's a trade between completeness and payload on a remote gateway. | **Yes** |
| Q3 | Should pop-out move into the new ⋯ menu to declutter the header? Recommendation: not in this PRD. Revisit after goals land. | Yes (later) |
| Q4 | Inline sub-agent transcripts in the export? Recommendation: v2, with a "Include sub-agents" option. | Yes |
| Q5 | For truncated messages, fetch full text via `chat.message.get` (one call each)? Recommendation: yes if at most 20 are truncated, otherwise keep the markers. | No (engineering) |
| R1 | Showing historical tool calls re-enables tool-derived UI on old messages: question cards, reaction actions, script cards. They must stay non-interactive when not `isLast`. `QuestionCard` already gates on `isLast && !streaming`, but `ScriptJobDock` parses transcripts; check it doesn't re-adopt dead jobs. | No |
| R2 | Messages before the latest in-session reset (`/reset`, `/new` in the same session) may not be reachable by paging, so the export starts at the reset. The file says "History starts at a reset on {date}." when the first row is a `kind: "reset"` marker. | No |
| R4 | Commentary-phase tool-only messages (Codex/OpenAI Responses providers) may be dropped by the gateway, so those tool calls can't be restored. This is a gateway limit and can't be fixed in the app. | No |
| R3 | Channel sender labels are unverified (5.4). | No |

---

## 12. Milestones and effort

| PR | Scope | Effort |
|---|---|---|
| 1 | **fix(chat): restore tool calls on reload.** `lib/historyMessages.ts` + tests + fixture; `chat.ts` wiring (load, ingest, threads); `limit` on reload + the "earlier messages" line. | M (1.5–2 d) |
| 2 | **feat(chat): export.** `saveFile.ts` (with the `saveHostFileAs` refactor), `chatHistoryReader.ts`, `chatExport.ts` + tests; `ChatMoreMenu`, `ExportChatDialog`, row entries (desktop + phone). | M (2 d) |
| — | Depends on 01 for `Popover`/`MenuRow`/`Overlay`. If 01 slips, PR 2 can import the private copies and switch later. | |
