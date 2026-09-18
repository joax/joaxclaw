# QA checklist — PRD 07 Meetings
Source: docs/prd/07-meetings.md · Engineer: Eng 4 · Milestones: **PR 1 (Library)** and **PR 2 (Setup and recording)** in sprint; PR 3 (Discord auto-record, guest-name edit, direct-method spike) **out of sprint**
Depends on: PRD 06 `installAndRestart` (PR 2 plugin rows), PRD 05 `saveBytesAs` / `shareOrDownload` + tool calls in history (PR 1 download; PR 2 join status after reload), PRD 01 primitives.
Fixtures: `src/lib/__tests__/fixtures/sprint/meetings.ts` (gateway shapes from 2026.9.4 source). Hello lists: `fixtures/sprint/helloFeatures.ts`.
Legend: **[U]** unit test (vitest, src/lib/__tests__) · **[R]** code review · **[M]** manual app check (desktop + 390px phone)

Items tagged **(PR 3 · out of sprint)** only need to be absent or stubbed without breaking anything; they are not accepted in this sprint.

## FR-1 Visibility and capability gating (PR 1)
- [ ] **07-FR1.a** [U] Given `hasMethod('transcripts.list') === false` (2026.6.5 hello, `METHODS_2026_6_5`), when the nav renders, then there is no Meetings item in NavRail, in BottomNav → More, and no "Recent meetings" Dashboard section. _(PRD §5.1.1, §7 FR-1, §5.5 "Gateway < 2026.8")_
- [ ] **07-FR1.b** [U] Given a 2026.9.4 hello (`METHODS_2026_9_4`), then `transcripts.list/get/export/status` are all reported supported and the Meetings item is shown. _(§8.3)_
- [ ] **07-FR1.c** [U] Given `transcripts.list` advertised but not `transcripts.status` (2026.8 variant: 2026.9.4 list minus `transcripts.status`, `transcripts.export`), then the checklist uses the fallback (`config.get` → `transcripts.enabled !== false` + `plugins.list`), the Download control is **not rendered**, and pending join rows resolve from the tool result alone (no `active` matching). _(§7 FR-1, §5.5 "Gateway 2026.8", §8.2)_
- [ ] **07-FR1.d** [U] Given `transcripts.status` returns `ERR_UNKNOWN_METHOD_STATUS` at runtime (advertised list lied / stale), then the method is marked unsupported (existing `isUnknownMethodError` path in gateway.ts) and the store switches to the fallback without an error banner. _(§8.3)_
- [ ] **07-FR1.e** [R] Gating uses `hasMethod()` / `useGatewaySupport` from PRD 01 — no hard-coded version compares. _(§8.3)_
- [ ] **07-FR1.f** [R] `NavSection` union in `src/App.tsx` gains `'meetings'`; NavRail GROUP_1 order is Dashboard · Chats · Talk · **Meetings** · Memory (`Video` icon); BottomNav More → "Workspace" group lists Meetings next to Memory; the BottomNav primary bar is unchanged. _(§5.1.1–2, §6)_

## FR-2 Library (PR 1)
- [ ] **07-FR2.a** [U] When Meetings opens, then `transcripts.list` is called with exactly `{ limit: 50 }` (no `query`/`providerId` keys when empty — the params object is closed, and `providerId: ""` fails validation). _(§7 FR-2, §5.3 C1)_
- [ ] **07-FR2.b** [U] Given `LIST_RESULT_PAGE1` (`nextCursor` non-null), then "Load more" is shown; pressing it sends `{ limit: 50, cursor: LIST_NEXT_CURSOR }` with the **same** filters and appends rows; given `nextCursor: null` "Load more" is hidden. _(FR-2)_
- [ ] **07-FR2.c** [U] Given a search term, then `query` is sent (trimmed, ≤ 256 chars — longer input is truncated or blocked client-side) and the cursor is dropped (first page). Changing the provider filter also drops the cursor. _(FR-2; gateway cursor is scoped to all filters)_
- [ ] **07-FR2.d** [U] Given `ERR_INVALID_CURSOR` (or `ERR_INVALID_CURSOR_LIBRARY`, same `details.type`), then the list reloads from page 1 with the current filters (matching on `details.type`, not message). _(FR-2)_
- [ ] **07-FR2.e** [U] Row rendering: title, or "{Provider} meeting" when `title` is absent (`SESSION_ZOOM_HEURISTIC_UNTITLED`); meta line `{provider} · {date} · {duration} · {n} people` (`row.meta`). Provider label prefers `providerName`, falls back to `providerLabel(providerId)`. _(§5.3 C1, §5.6)_
- [ ] **07-FR2.f** [U] Pills: **Recording** (accent, pulsing dot) when `active`; **No speech** (neutral) when `utteranceCount === 0 && !active` (`SESSION_TEAMS_NO_SPEECH`); nothing on a normal finished row. _(§5.3 C1)_
- [ ] **07-FR2.g** [U] Provider `FilterTab`s: All · Google Meet · Teams · Zoom · Discord, showing only providers present in the loaded sessions (plus All). Selecting one sends `providerId` with the **canonical** id (`google-meet`, `teams`, `zoom`, `discord-voice`) — the list filter is an exact match. _(§5.2)_
- [ ] **07-FR2.h** [U] `durationLabel(startedAt, stoppedAt?)` parses **ISO strings** (not ms): under 1 min, "42 min" (`SESSION_MEET_DONE`), over 1 h (`SESSION_OVER_ONE_HOUR`), live (no `stoppedAt` → elapsed/"live"). Unparseable dates render no duration instead of `NaN`. _(§9.1)_
- [ ] **07-FR2.i** [U] `providerLabel(id)` maps `google-meet`→Google Meet, `teams`→Teams, `zoom`→Zoom, `discord-voice`→Discord, and the aliases (`googlemeet`, `meet`, `teams-meetings`, `microsoft-teams`, `msteams`, `zoom-meetings`); unknown ids (e.g. `manual-transcript`) fall back to `providerName` or the raw id. _(§2.2 provider ids)_
- [ ] **07-FR2.j** [M] The list refreshes when the `active` set in `status` changes, and every 60 s while visible. _(§8.2)_

## FR-3 Reader (PR 1)
- [ ] **07-FR3.a** [U] When a row opens, then `transcripts.get` is called with `{ selector }` only (`GET_PARAMS_SUMMARY`). _(FR-3)_
- [ ] **07-FR3.b** [U] Header: title, provider, date and time, duration, participants; actions **Discuss in a new chat**, **Download ▾** (Markdown / JSONL), and **Summarize** only when `!hasSummary`. _(§5.3 C2)_
- [ ] **07-FR3.c** [U] Summary tab (default): Overview, then Decisions, Action items, Risks, Participants as lists; empty sections are omitted. Footnote: `source === 'model'` → "Model-generated notes · check the transcript before relying on decisions or action items."; `'heuristic'` → "Notes extracted from the text, without a model."; `source` absent → no provenance line. _(§5.3 C3)_
- [ ] **07-FR3.d** [U] Given `SUMMARY_LEGACY_MARKDOWN_ONLY` (empty `overview`, empty arrays, `generatedAt: ""`), then the reader renders the `markdown` instead of empty sections. _(gateway fills defaults, dist/read-D2MLpeDR.mjs:60)_
- [ ] **07-FR3.e** [U] Given `GET_RESULT_NO_SUMMARY` (no `summary` key), then "No summary yet." and the **Summarize** button show. _(§5.3 C3, §5.5)_
- [ ] **07-FR3.f** [U] When the Transcript tab opens, then `get { selector, includeUtterances: true, limit: 50 }` is sent — `limit` is **always** present (never the legacy request). Load more sends `cursor: nextCursor`. _(FR-3, §8.6)_
- [ ] **07-FR3.g** [U] Transcript search sends `query` and drops the cursor; clearing the search also restarts from page 1. _(§5.3 C4)_
- [ ] **07-FR3.h** [U] Given `GET_RESULT_UTTERANCES_EMPTY`, then "Nothing was said, or captions were off." is shown. _(§5.6 reader.noUtterances)_
- [ ] **07-FR3.i** [U] Utterances without `speakerLabel` / `startedAt` render text only (`UTTERANCES_PAGE1[2]`), no "undefined". _(Utterance optional fields)_
- [ ] **07-FR3.j** [U] While the session is `active`, the Transcript tab refetches every 10 s and shows "Live" beside the tab; polling stops when `active` becomes false or the reader closes. _(§5.3 C4)_
- [ ] **07-FR3.k** [U] Given `ERR_SESSION_NOT_FOUND`, then the reader shows an error and the list reloads. Given `ERR_RESULT_TOO_LARGE`, then the reader shows an error (and may retry with a smaller `limit`). _(§8.5)_
- [ ] **07-FR3.l** [M] Phone (<768px): list is full screen; tapping a row pushes the reader with a back arrow; back returns to the list at the same scroll position. _(§5.2)_

## FR-4 Download (PR 1)
- [ ] **07-FR4.a** [U] When Markdown/JSONL is chosen, then `transcripts.export { selector, format: 'markdown' | 'jsonl' }` is called and `data` is base64-decoded to a `Uint8Array` in one pass and passed to `saveBytesAs(filename, bytes, mimeType)` (desktop) / `shareOrDownload` (phone) with the gateway's **exact** `filename` and `mimeType` (e.g. `text/markdown;charset=utf-8`). _(FR-4, §5.3 C5)_
- [ ] **07-FR4.b** [U] `EXPORT_RESULT_UTF8` round-trips: decoded bytes → UTF-8 text equals `EXPORT_UTF8_EXPECTED_TEXT` (no `atob` string written directly). _(§8.6)_
- [ ] **07-FR4.c** [U] Status copy: "Preparing download…" while pending; then "Saved to {path}" (desktop, path returned) or "Downloaded {filename}". _(§5.3 C5)_
- [ ] **07-FR4.d** [U] Given `ERR_EXPORT_TOO_LARGE` (`details.type: 'transcript_export_too_large'`, `maxBytes: 4194304`), then the danger box shows "This transcript is over 4 MB, so it can't be downloaded from the app. On the gateway host, run:" + `CommandHint` with `openclaw transcripts path {selector} --transcript` and Copy. _(FR-4, §5.5)_
- [ ] **07-FR4.e** [U] Any other export failure → "Download failed. No partial file was saved. Try again."; no file is written. _(§5.5)_
- [ ] **07-FR4.f** [U] Download is hidden (not disabled) when `transcripts.export` is unsupported. _(FR-1, §8.3)_

## FR-12 Polling and reconnect (PR 1)
- [ ] **07-FR12.a** [U] While the Meetings view is visible, `transcripts.status` is polled every 10 s (15 s when phone layout); each tick calls `status` only. _(FR-12, §8.2)_
- [ ] **07-FR12.b** [U] When the view is hidden and there are no pending/active recordings, no timer runs; when a pending join exists, polling continues while hidden. Timer is cleared on unmount (no leaked intervals — fake timers). _(FR-12)_
- [ ] **07-FR12.c** [U] On `connectionSeq` change, status, plugins and list reload; the selected reader reloads. _(FR-12, §8.2)_
- [ ] **07-FR12.d** [U] On a 2026.8 gateway (no `status`), polling does not call `transcripts.status` at all. _(§5.5)_
- [ ] **07-FR12.e** [R] No `gatewayClient.on('transcripts.*')` listeners (there are no such events). _(§2.2 Events)_
- [ ] **07-FR12.f** [M] Offline/reconnecting: lists stay visible, greyed, with "Reconnecting…"; buttons disabled; everything reloads after reconnect. _(§5.5)_

## FR-13 Summarize (PR 1)
- [ ] **07-FR13.a** [U] Given `!hasSummary`, when Summarize is pressed, then `sendViaAgent` sends `Use the transcripts tool with action "summarize" and selector "<selector>". Reply "done" when finished.` with `navigate: false`, to **the session's owning agent** (`session.agentId`) when non-null, else the default agent. _(FR-13, §5.3 E — see Discrepancy: tool only lets the owning agent summarize)_
- [ ] **07-FR13.b** [U] Reader shows "Summarizing…" (accent) and polls `get { selector }` every 5 s; stops as soon as `summary` is present (`GET_RESULT_AFTER_SUMMARIZE`) and renders it; list row's `hasSummary` updates. _(FR-13)_
- [ ] **07-FR13.c** [U] After 2 min without a summary: "The summary is taking longer than expected." + **Open chat**; polling stops. _(§5.3 E, §5.6)_
- [ ] **07-FR13.d** [U] Summarize is disabled/hidden when capture is off (`status.enabled === false`) — the gateway does not register the transcripts tool then. _(dist/openclaw-tools-Bo9W_tg_.mjs:3293)_

## FR-14 Discuss in a new chat (PR 1)
- [ ] **07-FR14.a** [U] When pressed, a conversation is created with the chosen agent (default; small agent menu on the button); first message is `Here are the notes from "{title}" ({date}, {provider}). Its transcript selector is {selector}; use the transcripts tool to read the full transcript if you need it.` plus the summary `markdown`. _(FR-14, §5.3 F)_
- [ ] **07-FR14.b** [U] Markdown goes as attachment `notes-{date}.md` when `attachmentRejection` allows `text/markdown`; otherwise inlined. _(§5.3 F)_
- [ ] **07-FR14.c** [U] Without a summary, the message still contains title/date/selector (no "undefined"). _(edge)_
- [ ] **07-FR14.d** [M] After sending, the app navigates to the chat. _(§5.3 F)_

## FR-18 Dashboard and deep link (PR 1)
- [ ] **07-FR18.a** [U] Given ≥1 transcript, "Recent meetings" (in `RightPanel` and `MobileDashboard`) shows live row(s) first, then the last 3; "See all" opens Meetings. Hidden when the list is empty or `transcripts.list` unsupported. _(FR-18, §5.1.3)_
- [ ] **07-FR18.b** [U] Tapping a row dispatches `joax:navigate { section: 'meetings', selector }`; the `App.tsx` handler accepts `selector` and the meetings store opens it. _(§5.8)_
- [ ] **07-FR18.c** [R] `joax:navigate` without `selector` (existing `{ section, convId }` callers) still works. _(regression)_

## FR-5 Setup checklist (PR 2)
- [ ] **07-FR5.a** [U] `checklistState(status, plugins, capture, chromeCheck)` — cases: capture off; no plugins; one plugin disabled; complete; 2026.8 fallback inputs (no status). _(§9.1)_
- [ ] **07-FR5.b** [U] Complete ⇔ capture enabled **and** ≥1 meeting plugin enabled. Chrome and Discord never block. When complete the card collapses to "Setup ✓" which re-opens it. _(FR-5, §8.4, §5.2)_
- [ ] **07-FR5.c** [U] Item 1: ticked "Meeting notes are on" when `status.enabled`; otherwise "Meeting notes are off". _(§5.3 A1)_
- [ ] **07-FR5.d** [U] Item 2 plugin rows for `google-meet`, `teams-meetings`, `zoom-meetings`: state from `plugins.list` by `id` — **absent from the list ⇒ not installed** (`PLUGINS_LIST_NO_MEETING_PLUGINS`), `state: 'not-installed'` ⇒ not installed, `enabled && state === 'enabled'` ⇒ ready ("{name} plugin" + success tick), `enabled === false` / `state: 'disabled'` ⇒ "{name} plugin is off. Turn it on under Extensions.", `state: 'error'` ⇒ not ready (show `error`). Cross-check with `status.providers[].availability` (`unavailable` = not ready). _(§5.3 A2)_
- [ ] **07-FR5.e** [U] Missing + admin ⇒ **Install** → `installAndRestart({ source: 'official', pluginId })`; missing + not admin ⇒ `CommandHint` `openclaw plugins install @openclaw/<pkg>` (`google-meet`, `teams-meetings`, `zoom-meetings`) with Copy + **Install via agent**. Install is also withheld (command shown) when `plugins.list.mutationAllowed === false`. _(§5.3 A2, FR-7)_
- [ ] **07-FR5.f** [U] Item 3 Chrome: copy "Meetings run in Chrome on the gateway host or a paired node, not on this computer."; title "Chrome on {host}" where host comes from the connection URL. **Run setup check** sends via agent `openclaw googlemeet setup --json` (or `openclaw teamsmeetings setup` / `openclaw zoommeetings setup`) and opens the chat; the row then shows "Checked {time} · open chat" and a "Looks good" action; never auto-ticks. _(§5.3 A3)_
- [ ] **07-FR5.g** [U] Chrome check stored in `localStorage` keyed by gateway URL; every read/write in try/catch (throwing storage ⇒ row just shows unchecked). _(§5.3 A3, §8.7)_
- [ ] **07-FR5.h** [U] Item 4 "Auto-record a Discord channel" shown only when `status.providers` includes `discord-voice`; its **Set up** opens flow D **(PR 3 · out of sprint — in this sprint the row may be hidden or show the host command only)**. _(§5.3 A4)_
- [ ] **07-FR5.i** [U] Checklist refreshes on view open and on `connectionSeq`. _(§5.3 A)_
- [ ] **07-FR5.j** [M] Local gateway copy: "on this computer's gateway (Chrome must be signed in here)"; remote gateway names the host. _(§5.5, FR-17)_

## FR-6 Capture switch (PR 2)
- [ ] **07-FR6.a** [U] Given `operator.admin` in `grantedScopes`, the "Turn on meeting notes" `Toggle` sends `config.patch { raw: JSON.stringify({ transcripts: { enabled: true } }), baseHash }` with a `baseHash` from a fresh `config.get`. _(FR-6)_
- [ ] **07-FR6.b** [U] Because a `transcripts.*` change **restarts the gateway** (no hot-reload rule; dist/config-reload-plan-CuYf6HEr.mjs:300), the switch calls `expectRestart` (PRD 01) before/with the patch and status reloads after the reconnect (`connectionSeq`), not immediately. _(Discrepancy D6)_
- [ ] **07-FR6.c** [U] Stale `baseHash` conflict ⇒ re-fetch `config.get` and retry once, then show the error. _(§8.5)_
- [ ] **07-FR6.d** [U] Not admin ⇒ "Ask an admin to run:" + `openclaw config set transcripts.enabled true` with Copy; no toggle. `ERR_MISSING_SCOPE_ADMIN_CONFIG_PATCH` is never produced by the UI (control not rendered). _(FR-6)_
- [ ] **07-FR6.e** [U] Capture off ⇒ **Record a meeting** disabled with title "Turn on meeting notes first"; library still lists old notes. _(§5.5)_

## FR-7 Plugin install (PR 2)
- [ ] **07-FR7.a** [U] Install calls PRD 06 `installAndRestart({ source: 'official', pluginId: 'google-meet' | 'teams-meetings' | 'zoom-meetings' })` (never `clawhub` for google-meet: it has no ClawHub spec). _(FR-7, R3)_
- [ ] **07-FR7.b** [M] The PRD 06 overlay shows "Restarting to finish installing Zoom meetings"; after reconnect the row ticks. _(§5.5)_

## FR-8 Record dialog and link detection (PR 2)
- [ ] **07-FR8.a** [U] `detectPlatform` over every `MEETING_LINKS` entry returns `expected` (meet / teams / zoom / null) — incl. URL-encoded Teams meetup-join, `teams.live.com/meet/…`, `zoom.us/j/…?pwd=`, `acme.zoom.us/j/…`, `zoom.us/my/…` ⇒ null, look-alike hosts (`evilzoom.us`, `zoom.us.evil.com`) ⇒ null, plain text ⇒ null, http vs https, trailing slash, missing scheme. _(FR-8, §9.1)_
- [ ] **07-FR8.b** [U] `normaliseMeetingUrl`: lowercases host, removes fragment; result for matching equals the gateway's stored form `origin + pathname` (`MEETING_LINKS[].sanitized`) — see D3 about Zoom `pwd`. _(§9.1)_
- [ ] **07-FR8.c** [U] Platform line under the field: "{platform} · plugin ready" / "{platform} · plugin not installed" + **Install**; unknown link: "This doesn't look like a Meet, Teams or Zoom link." _(§5.3 B2)_
- [ ] **07-FR8.d** [U] Join button enabled only when: known platform AND its plugin ready AND an agent chosen AND consent checked AND capture on AND `operator.write` granted. _(FR-8, §8.3)_
- [ ] **07-FR8.e** [U] Mode radio: **Take notes only** (default, `transcribe`) hint "Listens and keeps notes. Nothing is said in the call."; **Take part** (`agent`) hint "The agent can speak. Needs virtual audio on the Chrome host."; button reads "Join and take notes" / "Join and take part". _(§5.3 B4, §5.6)_
- [ ] **07-FR8.f** [U] Name line: Teams/Zoom "Joins as "{name}"" from `plugins.entries.<id>.config.chrome.guestName` (read via `config.get`; unset ⇒ plugin default); Meet: "Joins as the Google account signed in to Chrome on the gateway host." The **Change** action is **(PR 3 · out of sprint)**. _(§5.3 B6; see D8)_
- [ ] **07-FR8.g** [U] "Chrome runs on {host}, not on this computer." line present. _(§5.6 record.where)_
- [ ] **07-FR8.h** [M] Desktop: `Overlay`; phone: `BottomSheet`. Link field autofocused; Enter submits only when valid and consented. _(§5.3 B1, §5.7)_

## FR-16 Consent (PR 2)
- [ ] **07-FR16.a** [U] Consent box always visible (warning tint): "The agent joins as a participant without announcing itself. Tell everyone in the call that it's taking notes." _(FR-16)_
- [ ] **07-FR16.b** [U] Real `<input type="checkbox">` with label "I'll tell participants"; Join disabled until checked; remembered for the session only (`sessionStorage`/memory, not `localStorage`). _(FR-16, §5.7, Q3)_

## FR-9 Join via agent (PR 2)
- [ ] **07-FR9.a** [U] `sendViaAgent(prompt, onOpenChat?, opts?: { agentId?, title?, navigate? })` is backwards compatible: existing 2-arg callers behave as before (default agent, navigates). Returns `convId`. _(§8.1)_
- [ ] **07-FR9.b** [U] With `navigate: false` the active conversation and section do **not** change (today `newConversation` sets `activeConvId` — must be preserved/restored). _(FR-9; src/store/chat.ts:733)_
- [ ] **07-FR9.c** [U] Join creates the conversation with the chosen `agentId`, title "Notes: {platform} · {time}". _(FR-9)_
- [ ] **07-FR9.d** [U] `buildJoinPrompt` text equals: `Use the \`<tool>\` tool with action "join", url "<link>", mode "<mode>". Do only this. Then reply with the tool's result exactly, including any status or manualAction, and nothing else. If the tool isn't available, say "MEETING_TOOL_MISSING".` — tool `google_meet` / `teams_meetings` / `zoom_meetings`; mode explicit (`transcribe` default). URL passed as entered (with `pwd`). _(§5.3 B7, §9.1)_
- [ ] **07-FR9.e** [U] A pending row appears immediately keyed by `convId` + normalised URL with `{ id, convId, url, platform, agentId, startedAt, phase }`; accent pulsing "Joining…" + **Open chat**; persisted in `sessionStorage` (try/catch) and restored on reload. _(FR-9, §8.1)_
- [ ] **07-FR9.f** [U] Send refused (`chat.send` error) ⇒ the pending row fails with the send error. _(§8.5)_

## FR-10 Join status (PR 2)
- [ ] **07-FR10.a** [U] `parseMeetingToolResult`: `TOOLCALL_ZOOM_JOIN_RUNNING` ⇒ `running`; `TOOLCALL_MEET_JOIN_OK` ⇒ `ok`; `TOOLCALL_MEET_JOIN_MANUAL` ⇒ `manual` with `manualAction.message`; `TOOLCALL_TEAMS_JOIN_ERROR` (status `error`) ⇒ `error` with `error` text; assistant text `MEETING_TOOL_MISSING` ⇒ `error`; `TOOLCALL_ZOOM_JOIN_PLAINTEXT` ⇒ `ok` with raw text. _(§9.1)_
- [ ] **07-FR10.b** [U] The store finds the tool call by `convId` + last assistant message `toolCalls[].name === <platform tool>`; running ⇒ "Joining…". _(FR-10)_
- [ ] **07-FR10.c** [U] Manual ⇒ warning row with the tool's text (`row.manual`) + "Do this in Chrome on {host}." + **Open chat**; `notify()` "Meeting needs you" / "{title}: {text}" fires only when the app is hidden, navigate target `{ section: 'meetings' }`. _(FR-10, §5.8)_
- [ ] **07-FR10.d** [U] OK ⇒ "Recording"; `matchActiveSession(pending, status.active)` matches by normalised `source.meetingUrl` (origin+pathname, see D3), picks newest `startedAt` when several (`STATUS_TWO_ACTIVE_SAME_URL`), and swaps the pending row for the real session (selector bound). `notify()` "Taking notes in {title}" when hidden. _(FR-10, §9.1)_
- [ ] **07-FR10.e** [U] OK and no `active` match within 3 min ⇒ warning "Joined, but no notes are arriving yet. Captions may be off in the meeting." _(§5.3 B8)_
- [ ] **07-FR10.f** [U] Error / sentinel ⇒ danger "Couldn't join: {text}" + **Open chat** + **Try again** (Try again reopens the dialog pre-filled or re-sends). _(FR-10)_
- [ ] **07-FR10.g** [U] After reload with no tool calls available in the chat (pre-PRD 05), the row shows "Status unknown · open chat". _(§8.2)_
- [ ] **07-FR10.h** [U] On 2026.8 (no `status`), OK resolves the row to "Recording" from the tool result alone (no 3-min warning). _(§5.5)_

## FR-11 Stop (PR 2)
- [ ] **07-FR11.a** [U] Stop on a JoaxClaw-started row sends in the same chat: `Use the \`<tool>\` tool with action "leave" for this meeting. Reply with the result only.`; row shows "Stopping…" (accent, no pulse) until that session's `active` is false in the next `status`/list. _(FR-11)_
- [ ] **07-FR11.b** [U] Stop on a recording not started here (found in `status.active`) sends the leave instruction, including the meeting URL, to the default agent in a new chat. _(FR-11)_
- [ ] **07-FR11.c** [M] After stop the row becomes a normal library entry and the summary appears once written. _(§5.3 B9)_

## FR-15 Discord auto-record — (PR 3 · out of sprint)
- [ ] **07-FR15.a** [U] (PR 3) Save appends `{ providerId: 'discord-voice', guildId, channelId, accountId?, title?, whenOccupied }` via `config.patch` (growth, no `replacePaths`); empty optional strings are **omitted** (zod `min(1)`, `AUTOSTART_INVALID_EMPTY_TITLE`). Triggers a gateway restart (D6).
- [ ] **07-FR15.b** [U] (PR 3) Removal sends `replacePaths: ['transcripts.autoStart']` (`PATCH_AUTOSTART_REMOVE`).
- [ ] **07-FR15.c** [U] (PR 3) Duplicate `whenOccupied` for the same account + guild (`AUTOSTART_DUPLICATE_GUILD_ENTRY`) is rejected client-side: "There's already an auto-record channel for this server."
- [ ] **07-FR15.d** [U] (PR 3) `mapSourceState`: `armed`→"Waiting for people", `not-active`→"Idle", `disabled`→"Off", `unknown`→(defined copy), `startDiagnostic` `start-failed` / `admitted-start-failed` / `id-conflict` → danger. There is no gateway hint string (D9).
- [ ] **07-FR15.e** [R] (PR 3) Consent line "Tell people in the channel that the bot captures and stores transcripts before you turn this on."; non-admin shows JSON + `openclaw config set transcripts.autoStart '[…]'`.

## FR-17 Remote gateway (PR 2)
- [ ] **07-FR17.a** [U] Host for all "{host}" copy comes from the connection URL; no code path reads local Chrome, local files, or probes localhost. _(FR-17; memory remote-gateway-localhost-pitfall)_

## UX states (§5.5) — every state
- [ ] **07-ST.1** [U] First load: 5-row list skeleton + checklist skeleton.
- [ ] **07-ST.2** [U] Empty library (`LIST_RESULT_EMPTY`): `EmptyState` (faded `Video`) "No meeting notes yet. Record a meeting, or set up Discord auto-record."
- [ ] **07-ST.3** [U] Search empty: "No meetings match "{query}"."
- [ ] **07-ST.4** [U] Capture off — see 07-FR6.e. (PR 2)
- [ ] **07-ST.5** [U] No plugin — dialog platform line with Install; Join disabled. (PR 2)
- [ ] **07-ST.6** [M] Plugin installing — PRD 06 overlay. (PR 2)
- [ ] **07-ST.7** [U] Pending join, Manual action, Recording (live duration + Stop), Stopping, Join failed — see FR-9…FR-11. (PR 2)
- [ ] **07-ST.8** [U] No summary / Summarizing — see FR-3.e, FR-13.
- [ ] **07-ST.9** [U] Export too large / Export failed — see FR-4.d/e.
- [ ] **07-ST.10** [U] `ERR_ARCHIVE_FORBIDDEN` (FORBIDDEN) on list ⇒ `EmptyState` "Your connection can't read the meeting archive. Ask a gateway admin for access."; Record stays available.
- [ ] **07-ST.11** [U] `ERR_MISSING_SCOPE_READ` (also `FORBIDDEN`, but `details.code === 'MISSING_SCOPE'`) is distinguished from the archive-role FORBIDDEN (e.g. via `readMissingScope`) and not shown as the archive-restricted copy.
- [ ] **07-ST.12** [U] `ERR_ARCHIVE_UNAVAILABLE` ⇒ "Couldn't read the meeting archive: {message}" + Try again. _(§8.5)_
- [ ] **07-ST.13** [U] No admin — capture toggle, Install replaced by host commands with Copy and "Do it via agent"/"Install via agent" where available. (PR 2)
- [ ] **07-ST.14** [M] Offline / reconnecting — see FR-12.f.
- [ ] **07-ST.15** [U] Gateway 2026.8 / < 2026.8 — see FR-1.
- [ ] **07-ST.16** [M] Remote vs local gateway copy — see FR-5.j.

## Copy (§5.6) — exact strings
- [ ] **07-CP.1** [R] Page/nav/filters: "Meetings", "Record a meeting", "Search meetings…", "All / Google Meet / Teams / Zoom / Discord". (PR 1)
- [ ] **07-CP.2** [R] Reader: "Discuss in a new chat", "Download", "Markdown", "JSONL", "Preparing download…", "Saved to {path}", "Downloaded {filename}", "Summary", "Transcript", "Live", "Decisions / Action items / Risks / Participants", model/heuristic notes, "No summary yet.", "Summarize", "Summarizing…", "The summary is taking longer than expected.", "Search this transcript", "Load more", "Nothing was said, or captions were off.", too-large and export-failed strings. (PR 1)
- [ ] **07-CP.3** [R] Empty/access: `empty.library`, `empty.search`, `access.restricted`; Dashboard "Recent meetings", "live". (PR 1)
- [ ] **07-CP.4** [R] Setup: "Setup", "Setup ✓", "Meeting notes are on/off", "Turn on meeting notes", "Ask an admin to run:", "{name} plugin", "{name} plugin · not installed", "{name} plugin is off. Turn it on under Extensions.", "Install", "Chrome on {host}", `setup.chrome.where`, "Run setup check", "Checked {time} · open chat", "Looks good", "Auto-record a Discord channel", "Set up". (PR 2)
- [ ] **07-CP.5** [R] Record: all `record.*` keys incl. consent strings, "Join and take notes" / "Join and take part". (PR 2)
- [ ] **07-CP.6** [R] Rows: "Joining…", "Recording", "Stopping…", "Stop", "Open chat", "Do this in Chrome on {host}.", "Couldn't join: {text}", "Try again", `row.noNotes`, "No speech", `row.meta`. Notifications: "Meeting needs you", "{title}: {text}", "Taking notes in {title}". (PR 2)
- [ ] **07-CP.7** [R] UI never says "recording" as a file / audio (only the live pill "Recording"); uses "notes" and "transcript". _(§1, §6)_
- [ ] **07-CP.8** [R] (PR 3 · out of sprint) `discord.*` strings.

## Accessibility and keyboard (§5.7)
- [ ] **07-A11Y.1** [M] List is `role="listbox"`: Up/Down move, Enter opens. Reader tabs are `role="tablist"` / `role="tab"` with `aria-selected`.
- [ ] **07-A11Y.2** [U] Pill text carries meaning; `animate-pulse-dot` becomes a static dot under `prefers-reduced-motion`.
- [ ] **07-A11Y.3** [R] Transcript is `<p>` per utterance with speaker in `<strong>`; search result count "{n} matches" in a polite live region.
- [ ] **07-A11Y.4** [M] Record overlay/sheet traps focus and closes on Escape; consent checkbox reachable by keyboard.

## Phone (<768px)
- [ ] **07-PH.1** [M] 390px: list full-screen, reader pushed, header "Record" primary button, filter tabs scroll horizontally, no horizontal page scroll.
- [ ] **07-PH.2** [M] Record uses `BottomSheet`; Download uses `shareOrDownload`; polling interval 15 s.

## Gateway contract (verified against 2026.9.4 source)
- [ ] **07-GC.1** [R] `transcripts.list` / `transcripts.get` (since 2026.8) and `transcripts.export` / `transcripts.status` (since 2026.9) all need `operator.read`, all advertised in hello-ok; none exist in 2026.6.5. _(dist/method-scopes-tKV11oMS.mjs:2802,2808,2871,2877)_
- [ ] **07-GC.2** [R] All four param objects are **closed** (unknown keys ⇒ `INVALID_REQUEST "invalid transcripts.<m> params: …"`); `transcripts.status` params must be `{}`; `get.limit` ≤ 100, `list.limit` ≤ 200.
- [ ] **07-GC.3** [R] All timestamps (`startedAt`, `stoppedAt`, `updatedAt`, `lastUtteranceAt`, utterance times, `summary.generatedAt`) are ISO strings; `agentId` / `lastUtteranceAt` may be `null`; `summary.generatedAt` may be `""`.
- [ ] **07-GC.4** [R] `selector` format `YYYY-MM-DD/<id>`; pass back verbatim (never rebuilt from `sessionId`).
- [ ] **07-GC.5** [R] `source.meetingUrl` is origin+pathname only (query/fragment stripped) and omitted for non-http(s).
- [ ] **07-GC.6** [R] Library errors: `INVALID_REQUEST` + `details.type` ∈ {`transcript_invalid_cursor`, `transcript_invalid_filter`, `transcript_session_not_found`, `transcript_result_too_large` (maxBytes 1048576), `transcript_export_too_large` (maxBytes 4194304)}; archive-role denial `FORBIDDEN` (no details); others `UNAVAILABLE`.
- [ ] **07-GC.7** [R] Export `mimeType` includes `;charset=utf-8`; `filename` is gateway-built; `sizeBytes` ≤ 4194304.
- [ ] **07-GC.8** [R] No transcript events — status by polling only.
- [ ] **07-GC.9** [R] `transcripts.status.providers` includes `manual-transcript` always and meeting providers only once their plugin is installed; `configuredSources[].startDiagnostic` is an enum (`starting | retrying | id-conflict | admitted-start-failed | start-failed | ended`), no hint text.
- [ ] **07-GC.10** [R] `plugins.list` (read) omits uninstalled meeting plugins unless the hosted catalog curates them; `plugins.install { source: 'official', pluginId }` (admin) works for all three ids; `config.patch` (admin) takes `{ raw, baseHash?, replacePaths? }`; any `transcripts.*` config change restarts the gateway.
- [ ] **07-GC.11** [R] The `transcripts` agent tool exists only when `transcripts.enabled !== false`; `summarize`/`stop` require the owning agent (`session.agentId`, or `main` when the session has no owner).

## Regression
- [ ] **07-RG.1** [U] Existing `sendViaAgent(prompt, onOpenChat)` callers (joaxclaw-fs install, gateway update) unchanged: default agent, navigates.
- [ ] **07-RG.2** [U] `joax:navigate { section, convId }` still opens chats; unknown `section` values still ignored.
- [ ] **07-RG.3** [M] NavRail/BottomNav: all existing items present and in order; BottomNav primary bar unchanged; Memory still reachable.
- [ ] **07-RG.4** [M] Dashboard renders unchanged when `transcripts.list` unsupported or library empty.
- [ ] **07-RG.5** [U] AgentPicker extracted to `components/common/AgentPicker.tsx` (if moved) still works on the Dashboard.
- [ ] **07-RG.6** [U] No polling timers remain after leaving Meetings with nothing live (no extra `transcripts.status` calls in other sections).
- [ ] **07-RG.7** [R] Chat store: no behaviour change besides the read-only tool-call selector; `newConversation` default behaviour (sets active conv) unchanged for other callers.
- [ ] **07-RG.8** [U] `npm test`, `npx tsc -p tsconfig.web.json --noEmit`, eslint pass.

## Discrepancy key (PRD vs 2026.9.4 source, referenced above)
- **D3** Stored `source.meetingUrl` = `origin + pathname` (`dist/source-locator-BSjIr0Fk.mjs:10`). PRD §9.1 "keep Zoom `pwd`" would never match `status.active`. Match on origin+pathname and keep the full URL only for the join prompt.
- **D5** `plugins.list` lists an uninstalled official plugin only when catalog metadata (featured/order) exists (`dist/management-service-a9oXcryo.mjs:791-796`). The bundled meeting entries have none, so "missing" usually means "absent from the list".
- **D6** A `transcripts.*` config change has no reload rule, so it defaults to **restart** (`dist/config-reload-plan-CuYf6HEr.mjs:300,378`). The only exception is autoStart title-only edits (`:369`).
- **D8** Google Meet **does** have `chrome.guestName` (default "OpenClaw Agent", used on the signed-out guest screen, `docs/plugins/google-meet/config.md:39`). It has no per-join tool param.
- **D9** `startDiagnostic` has no hint string.
- **Owner rule** `transcripts` tool `summarize`/`stop` works only for the owning agent (`dist/openclaw-tools-Bo9W_tg_.mjs:2926-2933`).

## Ambiguities / untestable
1. **PRD 07:30 / 75 / 131 / 743 — transcribe-mode storage.** `docs/plugins/meeting-plugins.md:49` is ambiguous, but `docs/cli/transcripts.md:421-423` resolves it: explicit `transcribe` "does not write durable rows **while this setting is false**". So transcribe joins are stored when capture is on; the PR 2 live check should still confirm (plugin code is external).
2. **PRD 128 / 774 (R2) — `manualAction` shape "unverified".** Docs give `manualAction: { reason, message }` plus `browser.{nodeId,targetId,browserUrl}` (`docs/plugins/google-meet.md:131`, `google-meet/oauth-and-artifacts.md:268`). The Teams/Zoom shape is undocumented. The parser should read `manualAction.message` first, then fall back to raw text.
3. **PRD 268 "Waiting in the lobby: admit "OpenClaw notes""** — the name is not fixed. Teams/Zoom/Meet `chrome.guestName` defaults to "OpenClaw Agent" (`google-meet/config.md:39`), and "OpenClaw notes" only appears if Q5 is adopted. Show the tool's own text instead.
4. **PRD 280 / 474 "N people"** — `participants` holds speaker labels from captions, not attendees. With 0 speakers, "0 people" reads badly; the copy for that case isn't defined.
5. **PRD 305 / 511 "with the gateway's hint"** — `startDiagnostic` is an enum with no hint text (PR 3).
6. **PRD 303 mapping** covers `armed`/`not-active`/`disabled` and `start-failed`, but not the `unknown` state or the `starting`, `retrying`, `id-conflict`, `admitted-start-failed` and `ended` diagnostics (PR 3).
7. **PRD 237 / 416 local vs remote copy** — §5.3 A3 says "not on this computer", but §5.5 local says "on this computer's gateway (Chrome must be signed in here)". These contradict each other for a local gateway, and it's unclear which string `setup.chrome.where` should use there.
8. **PRD 257 / 769 (Q3) consent persistence** — §5.3 says it's remembered for the session, but Q3 recommends every join. The decision is still open, so the test expectation is undefined.
9. **PRD 597 (FR-11) Stop for sessions not started here** — "leave" needs the plugin session to be identified. The transcript `sessionId` is not necessarily the plugin session id, and the tool param names for leave (`sessionId`? `url`?) are unverified. Discord sessions need `transcripts stop` by the owning agent instead.
10. **PRD 599 (FR-12)** says to poll "while the view is visible". It's unclear whether that means document visibility or the section being mounted and selected. It's also undefined whether the reader's 10 s transcript refresh and the Summarize 5 s poll count toward the "no polling when hidden" rule.
11. **PRD 212 / 618 Dashboard "last 3"** — it's unclear whether that means 3 in addition to the live rows or 3 total. The data source is unclear too: a separate `list {limit: 3}` or the shared store.
12. **PRD 239** — "Checked {time} · open chat" needs the chat id of the setup-check conversation to be stored too, but §8.7 only mentions the timestamp.
13. **PRD 413 (2026.8 fallback)** — without `status` there's no `providers`, so the plugin rows rely on `plugins.list` alone. That's fine, but `plugins.list` may not list uninstalled meeting plugins at all (D5).
14. **PRD 208–211 vs 49 — "Memory"** is `NavSection` `'obsidian'` in code. The PRD names it only by label, so this is fine but easy to misread.
15. **PRD 694** — `zoom.us/my/…` "verify against the docs": the docs accept only `zoom.us/j/...` and `<sub>.zoom.us/j/...` (`meeting-plugins.md:21`), so `/my/` ⇒ null is correct. Personal-link rooms therefore can't be recorded (accepted limitation).
16. **Untestable in CI:** real joins, lobby admission, caption availability, Chrome sign-in, Discord occupancy, and the plugin gateway-method spike (PRD 120, 752). All are manual [M] on an isolated profile only.
