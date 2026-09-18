# PRD 07: Meetings

> **Status:** Draft for owner approval · **Author:** PM B · **Date:** 2026-09-18
> **Phase:** 3 (build step 6) · **Effort:** L (about a week, in 3 PRs)
> **Gateway:** library ≥ 2026.8 (`transcripts.list`/`get`); status, checklist and download ≥ 2026.9 (`transcripts.status`/`export`). Joining needs one of the external meeting plugins (`@openclaw/google-meet`, `@openclaw/teams-meetings`, `@openclaw/zoom-meetings`).
> **Depends on:**
> - [06-plugin-catalog](06-plugin-catalog.md), for `installAndRestart` (installing the meeting plugins).
> - [05-chat-export](05-chat-export.md), for the `saveBytesAs` / `shareOrDownload` helpers, and for tool calls in history, which the join status reads.
> - [01-shared-groundwork](01-shared-groundwork.md): `Section`, `Toggle`, `Card`, `Pill` + `stateTone`, `EmptyState`, `FilterTab`, `Overlay`, `BottomSheet`, `CommandHint`, `hasMethod()` / `useGatewaySupport`, `connectionSeq`.
> **Decision already made:** recording meetings is in scope.

---

## 1. Summary

**Problem.** Your gateway can already take meeting notes:
- The Google Meet, Teams and Zoom plugins send an agent into a call as a browser participant.
- The gateway keeps the captions and a summary in its transcript library.
- A Discord bot can auto-record a voice channel.

JoaxClaw shows none of this. To use it today you need the CLI and a shell on the gateway host.

**Outcome.** A **Meetings** section where you:
- finish a short setup checklist once;
- paste a meeting link and send an agent in to take notes ("Record a meeting"), and stop it;
- read the summary and transcript of any past meeting, download them, or open a chat about them;
- optionally auto-record a Discord voice channel.

**Solution.**
- A new `store/meetings.ts` reads the gateway's transcript library (`transcripts.status`/`list`/`get`/`export`). The gateway has no transcript events, so the store polls while it's visible or a recording is live.
- **Joining goes through an agent.** The gateway has no join RPC. The plugins' own gateway methods are documented but unnamed for Meet, and the plugin code isn't in the gateway package, so we can't verify them. JoaxClaw sends the agent a precise instruction to call `google_meet` / `teams_meetings` / `zoom_meetings` with `action: "join"` and `mode: "transcribe"`, and reads the tool result from that chat.
- If a plugin's methods show up in hello-ok, a later PR can switch to calling them directly.
- Plugins install through PRD 06's install-and-restart flow. Capture settings and Discord auto-start are written with `config.patch` (admin), with the host command offered otherwise.

**Important correction for the owner.** "Recording" here means **captions plus a summary**, not an audio or video file.
- The docs say the browser joins "persist completed caption rows and a derived summary" and do "not … create an audio/video recording" (`docs/plugins/meeting-plugins.md`).
- Teams and Zoom "do not … capture audio/video recordings".
- Notes depend on the platform showing captions.
- The UI says "notes" and "transcript", never "recording" as a file.

---

## 2. Background and evidence

### 2.1 How the app behaves today

| Area | Evidence | Implication |
|---|---|---|
| Nothing about meetings | No `transcripts.` calls in `src/` | New section. |
| Navigation | `NavSection` union at `App.tsx:49`. NavRail groups at `NavRail.tsx:9–26`. BottomNav primary items at `BottomNav.tsx:19–23`, More groups at `:26–40` | Add `'meetings'`. |
| Deep links | `joax:navigate` handler (`App.tsx:161–170`) takes `{ section, convId }`. `pushUrlToNavigate` (`lib/webPush.ts:200`) | Meetings can be a navigate target. |
| Push categories | Closed gateway set: `approvalRequested, agentFinished, agentQuestion, humanMentioned, scheduledTaskFailed, backgroundTaskFailed` (`lib/webPush.ts:48–51`) | **Correction:** there's no meeting push category. Alerts use the local `notify()` (PWA, app hidden) only. |
| Agent hand-off | `sendViaAgent(prompt, onOpenChat)` (`lib/agentPrompt.ts`) always uses the **default** agent and always navigates | **Gap:** Record needs `{ agentId, title, navigate: false }`. |
| Agent picker | `AgentPicker` in `DashboardView.tsx:223` | Reuse (extract to `components/common` or keep importing). |
| Plugin install | `ChannelPluginSetup` pattern (`ChannelsPanel.tsx:695–790`) → `installAndRestart` (PRD 06) | Reuse. |
| Save a file | `lib/saveFile.ts` (PRD 05) | Download Markdown/JSONL. |
| Remote detection | `useIsRemoteGateway()` (`store/connection.ts`; memory `remote-gateway-localhost-pitfall`) | Checklist copy. |
| Scopes | `gatewayClient.grantedScopes` (`gateway.ts:141`) | Admin-only switches. |
| Reconnect | `gatewayClient.connectionSeq` (`gateway.ts:145,350`) | Reload on reconnect. |
| Dashboard | `DashboardView.tsx` panels: `RightPanel` (`:879`), `ActiveSection`, `CronsSection`, … | A small "Recent meetings" section. |
| Tool calls in history | Lost on reload today (PRD 05) | The join status must work from live events, and survive a reload once PRD 05 PR 1 lands. |

### 2.2 What the gateway offers

Scopes come from `dist/method-scopes-tKV11oMS.mjs`. Schemas come from `dist/transcripts-M-a_ANB8.mjs` (source `packages/gateway-protocol/src/schema/transcripts.ts`, all closed objects). Handlers are in `dist/transcripts-BzXJGPO2.mjs`.

| Method / tool | Scope | Since | Params → result | Used for |
|---|---|---|---|---|
| `transcripts.status` | read | 2026.9 | `{}` → `{ enabled, providers[{ providerId, pluginId?, name, availability: enabled\|disabled\|unavailable\|unknown, sourceKinds?, canStart?, canStop?, canImport?, autoStart? }], configuredSources[{ source, title?, sessionId?, state: disabled\|armed\|not-active\|unknown, activeSelectors[], startDiagnostic? }], active: Summary[], latestTranscript, omitted }` | Checklist, live recordings, Discord auto-start health |
| `transcripts.list` | read | 2026.8 | `{ limit? (1–200, default 50), cursor?, query? (≤256), providerId?, accountId?, agentId?, startedAfter?, startedBefore? }` → `{ sessions: Summary[], nextCursor }` | Library |
| `transcripts.get` | read | 2026.8 | `{ selector, includeUtterances?, limit? (1–100), cursor?, query? }` → `{ session, summary?, utterances?, nextCursor }` | Detail: summary, transcript pages |
| `transcripts.export` | read | 2026.9 | `{ selector, format: "markdown"\|"jsonl" }` → `{ selector, filename, mimeType, encoding: "base64", data, sizeBytes (≤ 4194304) }` | Download |
| `config.get` / `config.patch` | read / **admin** | ≤2026.7 | existing | `transcripts.enabled`, `transcripts.autoStart`, `plugins.entries.<id>.config` |
| `plugins.list` / `plugins.install` / `gateway.restart.request` | read / admin / admin | ≤2026.7 | see PRD 06 | Plugin checklist rows |
| Tool `google_meet` | agent | plugin ≥ 2026.4.20 | `action: join\|leave\|status\|setup_status\|transcript\|…`, `url`, `mode: agent\|bidi\|transcribe`, `transport: chrome\|chrome-node\|twilio`, `sessionId` … | Join/leave/status (`docs/plugins/google-meet.md`, `google-meet/tool-and-modes.md`) |
| Tool `teams_meetings` / `zoom_meetings` | agent | plugin ≥ 2026.7.2 | `join, leave, status, transcript, speak` | Same (`docs/plugins/teams-meetings.md`, `zoom-meetings.md`) |
| Tool `transcripts` | agent | 2026.8 | `start, stop, status, import, summarize, list, show` | Discord start/stop, **Summarize** (`dist/openclaw-tools-Bo9W_tg_.mjs`) |

**Summary** (one list entry) = `{ selector, sessionId, title?, providerId, providerName?, source: { providerId, kind?, accountId?, guildId?, channelId?, meetingUrl?, … }, startedAt, stoppedAt?, active, utteranceCount, participants[], hasSummary, summarySource?: model\|heuristic, overview? (≤280), agentId, updatedAt, lastUtteranceAt, activeSubscription }`.
- There is no duration field. Compute it from `stoppedAt − startedAt`.

**Stored summary** = `{ generatedAt, overview, decisions[], actionItems[], risks[], participants[], source?, model?, markdown, utteranceCount }`.

**Utterance** = `{ sequence, text, id?, startedAt?, endedAt?, speakerId?, speakerLabel?, final? }`.

**Limits and errors (verified).**
- Page size default 50, max 100; list max 200.
- Export is capped at exactly **4,194,304 bytes** (4 MiB) of inline base64.
- Errors are `INVALID_REQUEST` with `details.type`:
  - `transcript_invalid_cursor`: "Invalid transcript cursor; restart pagination with the current filters."
  - `transcript_session_not_found`: "Transcript not found; refresh the library and use its full selector."
  - `transcript_result_too_large`
  - `transcript_export_too_large`: "Transcript exceeds the download limit; use a local transcript export.", with `maxBytes` = 4194304
- A non-admin whose operator role hides sessions gets `FORBIDDEN` "The transcript archive includes sessions hidden by your operator role; ask a Gateway administrator for archive access."
- Anything else: `UNAVAILABLE` "The transcript archive could not be read. Check Gateway diagnostics and retry."

**Events.** There are none for transcripts: `GATEWAY_EVENTS` in `dist/server-methods-list-Bm-R-rqW.mjs` has no `transcripts.*`. The Control UI refreshes by re-requesting. We poll (8.2).

**Config** (`dist/zod-schema-Q1KXOooO.mjs`, `dist/config-qnAcplqt.mjs`):
- `transcripts: { enabled?: boolean (default true), autoStart?: [{ providerId, whenOccupied?, sessionId?, title?, accountId?, guildId?, channelId?, meetingUrl? }] }`.
- Only one `whenOccupied` entry is allowed per account and guild.
- `discord-voice` needs `guildId` and `channelId`, plus `accountId` when there are several voice-capable accounts.
- With `whenOccupied`, the source stays open for 30 s after the last person leaves (`docs/cli/transcripts.md`).

**Transcript provider IDs:** `google-meet`, `teams`, `zoom`, `discord-voice`. The aliases `googlemeet`/`meet`, `teams-meetings`/`msteams`, `zoom-meetings` are accepted. Meeting providers attach to an active bot session and need no `autoStart` entry.

**CLI:** `openclaw transcripts list | show <session> | path <session> [--transcript]`. **There is no `export` subcommand**, even though the doc summary mentions export (`dist/register.transcripts-D0LD53YJ.mjs`). So the "over 4 MiB" fallback points at `path`, not `export`. This corrects the plan.

### 2.3 Do the meeting plugins have gateway methods of their own? (the plan's open question)

- **The plugin code isn't in the gateway package.** `dist/extensions/` has no google-meet, teams-meetings or zoom-meetings code. They ship only as npm/ClawHub packages.
- The bundled official catalog (`dist/official-external-plugin-bundled-catalogs-rSrC65bZ.mjs`) lists:
  - `google-meet`: npm `@openclaw/google-meet`, **no ClawHub spec**, no contracts listed, host ≥ 2026.4.20.
  - `teams-meetings`: ClawHub + npm, contracts `tools: ["teams_meetings"]`, `transcriptSourceProviders: ["teams"]`, host ≥ 2026.7.2.
  - `zoom-meetings`: ClawHub + npm, `tools: ["zoom_meetings"]`, `transcriptSourceProviders: ["zoom"]`, host ≥ 2026.7.2.
- **Docs say Teams and Zoom do register gateway methods:** "Gateway methods use `teamsmeetings.*`" and "Gateway methods use `zoommeetings.*`" (`docs/plugins/teams-meetings.md:41`, `zoom-meetings.md:41`). Their node commands are `teamsmeetings.chrome` and `zoommeetings.chrome`. For Google Meet, no doc names gateway methods; only the node command `googlemeet.chrome` is documented. The CLI root help lists `googlemeet`, `teamsmeetings` and `zoommeetings` command groups (`dist/cli-startup-metadata.json`).
- **Conclusion:** the methods probably exist for Teams and Zoom, and possibly for Meet, but their **names, params and scopes can't be verified** from this package.
  - **v1 joins through the agent tool.** It's documented, verified by tool name, and works for all three.
  - PR 3 adds **runtime discovery**: after the plugins install, scan `features.methods` for the `googlemeet.` / `teamsmeetings.` / `zoommeetings.` prefixes and log them. A follow-up switches to direct calls once the names are confirmed on a live gateway.
  - **Unverified: check during implementation** by installing `@openclaw/zoom-meetings` on an isolated profile and reading hello-ok `features.methods` and the plugin's `openclaw.plugin.json` / `registerGatewayMethod` calls in `node_modules/@openclaw/zoom-meetings`.

### 2.4 Plugin facts that shape the UX (from the docs)

- **Modes:** `agent` (**the plugin default**: live transcription goes to the agent, and it speaks back through TTS), `bidi` (a realtime voice model), and `transcribe` (observe-only, no virtual audio). The plan's "Take notes only (the default)" must therefore **pass `mode: "transcribe"` explicitly**.
- **Virtual audio** is required only for `agent` and `bidi`: BlackHole on macOS, PipeWire-Pulse on Linux.
- **Where Chrome runs:** on the gateway host, or on a paired node (`chromeNode.node`; the node must allow `browser.proxy` and `<platform>.chrome`). **Not on the laptop running JoaxClaw** unless that laptop is the host or a paired node.
- **Display name.** `google_meet` has no display-name parameter; the name is the Google account signed into the host's Chrome profile. Teams and Zoom use the plugin config `chrome.guestName`. **Correction:** the plan's per-join "Name shown in the call" field isn't possible. It becomes a per-plugin setting for Teams and Zoom (admin, `config.patch plugins.entries.<id>.config.chrome.guestName`), and an explanation for Meet.
- **Manual steps:** the tool returns a `manualAction` for sign-in, lobby admission, device permission, Teams tenant sign-in or email verification, and Zoom passcode, CAPTCHA or browser-join-disabled. The instruction is to complete the step in the same OpenClaw Chrome profile and retry. **The shape of `manualAction` is unverified**; read it from a live tool result during PR 2.
- **Setup check:** `openclaw googlemeet setup [--json]`, `openclaw teamsmeetings setup`, `openclaw zoommeetings setup`. There's also `google_meet action: setup_status`.
- **Consent:** "There is no automatic consent announcement when the plugin joins a call" (`docs/plugins/google-meet.md:16`). The docs also say "Only join meetings where the operator is authorized… Tell participants when local policy or consent rules require disclosure".
- **Transcribe-mode storage:** `docs/plugins/meeting-plugins.md` says browser joins "in all three modes" persist caption rows and a summary, then adds "An explicitly selected `transcribe` session retains its bounded live-caption tail without writing durable rows." We read that as applying when `transcripts.enabled` is false, but it's ambiguous. **Unverified: check in PR 2** that a `transcribe` join appears in `transcripts.list`. If it doesn't, the default mode must become `agent`, which needs virtual audio (open question Q2).
- **Discord** (`docs/channels/discord/voice-transcripts.md`):
  - `voice.autoJoin` doesn't record; use `transcripts.autoStart` with `whenOccupied: true`.
  - Requirements: the Connect permission, the `GuildVoiceStates` intent, and an audio STT model (`tools.media.audio`).
  - "Tell participants that the bot captures and stores transcripts before enabling it."
  - Summaries aren't posted to Discord.

### 2.5 How the Control UI does it

**Meetings page** (`dist/control-ui/assets/meetings-page-CiBS_GuJ.js`, strings in `en-transcripts-DNPf1XIy.js`):
- Title "Meetings" / "Meeting notes and transcripts across this gateway."
- Filters for title, provider, account, agent and date (with the hint "Dates use UTC…"). First page / Next page.
- A reader with **Summary** and **Transcript** tabs:
  - "Check the transcript before relying on decisions or action items."
  - "Model-generated notes" vs "Notes extracted using text heuristics"
  - "No stored summary is available. Reading this page does not generate one."
  - "Search within this transcript", "Load more", "Read from beginning"
- Downloads: "Download Markdown", "Download JSONL", with "Preparing download…" and "Download failed. No partial file was downloaded. Try again, or use the Transcripts CLI for exports over the browser limit."
- Empty state: "Your meeting notes, together" + "Set up meeting transcripts".
- Access: "Transcript access is restricted".
- RPC calls: `list {limit: 50, …}`, `get {selector}`, `get {selector, includeUtterances: true, query, cursor, limit: 50}`, `export {selector, format}`.

**Settings → Communications → "Meeting capture"** (`config-page-DeK4LMrX.js`):
- "Choose which sources can save meeting notes on this Gateway."
- "Auto-start sources", "Enable transcript storage", "Capture health", and the source states Enabled / Disabled / Armed / Not active / Unknown.
- "Armed: a capture subscription is registered. This does not confirm audio is being received or saved."
- "Recording is opt-in. Joining voice is not recording…"

**What it doesn't have:** a "join a meeting" button. OpenClaw's own UI leaves joining to agents and the CLI. So our Record flow is a JoaxClaw addition.

### 2.6 Prior art

- **Fireflies and Otter** send a visible bot named after the product. Fireflies adds an opt-out model: a pre-meeting email, an in-call chat message, and optionally an audio notice ([Fireflies consent guide](https://guide.fireflies.ai/articles/7003995379-Recording+Consent+and+Meeting+Compliance+in+Fireflies:+Opt-In,+Opt-Out,+and+Controls)). *Lesson:* the participant name in the call *is* the disclosure. Make the name meaningful ("OpenClaw notes") and remind the user to announce.
- **Granola** has no bot and shows participants nothing; "it relies on you… to do that", and it offers optional chat and watermark notices ([Granola consent docs](https://docs.granola.ai/help-center/consent-security-privacy/getting-consent)). Granola, Otter and Fireflies all face consent class actions. *Lesson:* our plugins also join silently, so the consent reminder must be unmissable at the moment of joining, not buried in settings.
- **All three** put **Summary first, transcript second**, and a "chat with this meeting" action. *Lesson:* match that order. "Discuss in a new chat" is our equivalent.

---

## 3. Goals / Non-goals

**Goals**
1. See every meeting the gateway captured, with summary, decisions, action items and transcript; download as Markdown or JSONL.
2. Record a Meet, Teams or Zoom call in a few seconds: paste a link, pick an agent, join; see it live, and stop it.
3. A setup checklist that shows what's missing and fixes it in place where possible (capture switch, plugin install), with a host command otherwise.
4. Discord voice auto-record (admin).
5. "Discuss in a new chat" hands the notes to an agent.
6. Consent is always in view when joining.

**Non-goals**
- Audio or video recording files (the plugins don't make them).
- Scheduling or calendar-driven auto-join.
- Creating meetings (`google_meet create`).
- Twilio dial-in.
- Speaking in the meeting from JoaxClaw (`speak`).
- Importing external transcripts (`transcripts import`).
- Editing summaries.
- Deleting transcripts (there's no RPC for it).
- Chrome sign-in from JoaxClaw: it happens on the gateway host's screen.
- A meeting push category (the gateway's set is closed).

---

## 4. Users and jobs to be done

- **As the owner**, before a call I want to paste the link and have an agent join and take notes, so I can focus on the conversation.
- **As the owner**, after a call I want the decisions and action items first, and the transcript when I need to check something.
- **As the owner**, I want to ask an agent to follow up on a meeting (draft the email, file the tickets) without copying anything.
- **As the owner of a Discord server**, I want a voice channel noted automatically whenever people are in it.
- **As the owner on a remote gateway**, I want to understand that Chrome runs over there, and what to do when the agent is stuck in a lobby.
- **As a participant's host**, I need to be told to announce the notetaker, because the software won't.

---

## 5. UX specification

### 5.1 Entry points and placement

1. **NavRail → Meetings** (`Video` icon), in the first group after Talk: Dashboard · Chats · Talk · **Meetings** · Memory.
   - It's grouped with Talk because both are real-time voice features. The nav rail is where OpenClaw's own UI puts Meetings (a sidebar tab), and meetings aren't a chat setting, so they don't belong in the chat.
   - Hidden when `hasMethod('transcripts.list') === false`.
2. **Phone:** BottomNav → More → Workspace group → **Meetings**, next to Memory (`BottomNav.tsx:32–34`). The primary bar stays at 5 items.
3. **Dashboard:** a **Recent meetings** section (the last 3, plus any live recording) in `RightPanel` / `MobileDashboard`, shown only when there is at least one transcript. Tapping a row opens it in Meetings.
4. **Gateway → Extensions:** nothing new. The meeting plugins install from the checklist through PRD 06's flow.

### 5.2 The Meetings screen

- **Desktop:** a list column (340px) and a reader, the same split as Processes and Teams (`WIREFRAMES.md §1`).
  - The list's header holds "Meetings", a **Record a meeting** primary button, and a search box.
  - Under it, provider `FilterTab`s: All · Google Meet · Teams · Zoom · Discord (only those present).
- **Phone:** the list is full screen and a row pushes the reader. **Record** is a primary button in the header.
- **Setup checklist:** while setup is incomplete (8.4), it's a `Card` at the top of the list column. Once complete it collapses into a "Setup ✓" row that opens it again.

### 5.3 Flows

**A. Setup checklist.** All items are read from `transcripts.status` and `plugins.list`, refreshed when the view opens and on reconnect.

1. **Meeting notes are on.** Tick when `status.enabled`.
   - Off and admin: `Toggle` "Turn on meeting notes" → `config.patch { transcripts: { enabled: true } }` (with `baseHash` from `config.get`).
   - Off and not admin: "Ask an admin to run: `openclaw config set transcripts.enabled true`" with Copy.
2. **A meeting plugin is installed.** One row each for Google Meet, Teams and Zoom, with state from `plugins.list` by id (`google-meet`, `teams-meetings`, `zoom-meetings`) and `status.providers[].availability`.
   - Installed and enabled: success tick.
   - Disabled: "Turn on under Extensions".
   - Missing and admin: **Install** → `installAndRestart({ source: "official", pluginId })` (PRD 06).
   - Missing and not admin: the command `openclaw plugins install @openclaw/<pkg>` with Copy, plus **Install via agent**.
   - The item is satisfied when at least one plugin is ready.
3. **Chrome is ready on the gateway host.** This can't be read over RPC.
   - Copy: "Meetings run in Chrome on the gateway host or a paired node, not on this computer." On a remote gateway, add the host: "…on {host}".
   - **Run setup check** sends the platform's setup command through an agent, `openclaw googlemeet setup --json` (or `teamsmeetings` / `zoommeetings`), and opens that chat.
   - The row then shows "Checked {time} · open chat". It never auto-ticks, since the output is written for agents. The user can mark it done ("Looks good").
   - Stored per gateway URL in `localStorage`, wrapped in try/catch.
4. **Optional: Auto-record a Discord channel.** Shown only when `status.providers` includes `discord-voice`. **Set up** opens flow D.

**B. Record a meeting**
1. **Record a meeting** opens a dialog (an `Overlay` on desktop, a bottom sheet on a phone).
2. **Meeting link:** pasting a link detects the platform (`lib/meetings.ts detectPlatform`):
   - `meet.google.com/…` → Google Meet;
   - `teams.microsoft.com/l/meetup-join/…` or `teams.live.com/meet/…` → Teams;
   - `zoom.us/j/…` or `*.zoom.us/j/…` → Zoom.

   The line under the field shows the platform and the plugin state ("Google Meet · plugin ready", "Zoom · plugin not installed · **Install**"). An unknown link shows "This doesn't look like a Meet, Teams or Zoom link."
3. **Agent:** `AgentPicker`, defaulting to the default agent.
4. **What should it do?**
   - **Take notes only** (`transcribe`, the default) — "Listens and keeps notes. Nothing is said in the call."
   - **Take part** (`agent`) — "The agent can speak. Needs virtual audio on the Chrome host."
5. **Consent:**
   - A warning-tinted box: "The agent joins as a participant without announcing itself. Tell everyone in the call that it's taking notes."
   - A required checkbox: "I'll tell participants". It is remembered for the session only (Q3).
6. **Name shown in the call** (read-only info):
   - Teams/Zoom: "Joins as "{guestName}"" with **Change** (admin; edits `plugins.entries.<id>.config.chrome.guestName`).
   - Meet: "Joins as the Google account signed in to Chrome on the gateway host."
7. **Join and take notes:**
   - `sendViaAgent(prompt, { agentId, title: "Notes: {platform} · {time}", navigate: false })` (the extended helper, 8.1).
   - The dialog closes, and a **pending recording** row appears at the top of the list with an accent `animate-pulse-dot` and "Joining…".
   - The prompt (built by `lib/meetings.ts buildJoinPrompt`) is:
     > Use the `zoom_meetings` tool with action "join", url "<link>", mode "transcribe". Do only this. Then reply with the tool's result exactly, including any status or manualAction, and nothing else. If the tool isn't available, say "MEETING_TOOL_MISSING".
8. **Status from the chat.** The store watches that conversation's assistant message for the meeting tool call:
   - **Running** → "Joining…".
   - **Result with a manual action** → a warning row: "Waiting in the lobby: admit "OpenClaw notes"", or the tool's own text. The action is **Open chat**. Tell the user where to act: "Do this in Chrome on {host}".
   - **Result OK** → "Recording" (accent, pulsing dot). The store then matches `transcripts.status.active[]` by `source.meetingUrl` (normalised) and swaps the pending row for the real session.
   - **Error, or `MEETING_TOOL_MISSING`** → a danger row: "Couldn't join: {text}" with **Open chat** and **Try again**.
   - **No `active` match within 3 minutes of an OK result** → a warning row: "Joined, but no notes are arriving yet. Captions may be off in the meeting."
9. **Stop:**
   - The row's **Stop** button sends, in the same chat: "Use the `<tool>` tool with action "leave" for this meeting. Reply with the result only."
   - The row shows "Stopping…" until the session's `active` flips to false (next poll).
   - Then the row becomes a normal library entry, and its summary appears once written (the gateway writes it on leave).

**C. Library and reader**
1. The list shows `transcripts.list { limit: 50, query?, providerId? }` with "Load more" (`nextCursor`). A row has:
   - the title (or "{Provider} meeting");
   - provider · date · duration · N people;
   - a pill: **Recording** (accent, pulsing) when `active`, **No speech** (neutral) when `utteranceCount === 0 && !active`. Nothing when it's a normal finished meeting.
2. **Reader header:** the title, provider, date and time, duration and participants, with the actions **Discuss in a new chat**, **Download ▾** (Markdown / JSONL) and, when `!hasSummary`, **Summarize**.
3. **Summary tab** (default):
   - Overview, then Decisions, Action items, Risks, Participants, as simple lists.
   - Footnote "Model-generated notes · check the transcript before relying on decisions or action items." (or "Notes extracted from the text, without a model." for `heuristic`).
   - No summary: "No summary yet." plus the **Summarize** button (flow E).
4. **Transcript tab:**
   - `get { selector, includeUtterances: true, limit: 50, cursor? }`, rendered as speaker label · time · text, with **Load more**.
   - A search box sends `query` (and resets the cursor).
   - While `active`, it refreshes every 10 s with "Live" beside the tab.
5. **Download:** `export { selector, format }` → `saveBytesAs(filename, base64ToBytes(data), mimeType)` on desktop, or `shareOrDownload` on a phone. Status: "Preparing download…", then "Saved to {path}" or "Downloaded {filename}".

**D. Discord auto-record (admin)**
- Overlay fields:
  - **Server ID**, **Voice channel ID** (text, digits);
  - **Bot account** (select, shown only when more than one Discord account exists; read from `channels.status` for `discord`);
  - **Title** (optional);
  - **Only while people are in the channel** (Toggle, default on → `whenOccupied: true`).
- The consent line: "Tell people in the channel that the bot captures and stores transcripts before you turn this on."
- Save: `config.get` → append to `transcripts.autoStart` → `config.patch { transcripts: { autoStart: [...existing, entry] } }`. On removal, pass `replacePaths: ["transcripts.autoStart"]` (the array-shrink rule, memory `config-patch-array-shrink`).
- The list of configured sources shows `status.configuredSources[].state`, mapped:
  - `armed` → "Waiting for people" (accent);
  - `not-active` → "Idle";
  - `disabled` → "Off";
  - `startDiagnostic` `start-failed` → danger, with the gateway's hint.
- Not admin: the dialog shows the JSON entry and `openclaw config set transcripts.autoStart '[…]'` with Copy.

**E. Summarize**
- `sendViaAgent("Use the transcripts tool with action "summarize" and selector "<selector>". Reply "done" when finished.", { navigate: false })`.
- The reader shows "Summarizing…". The store polls `get` until `summary` is present (up to 2 min), then shows it.
- On timeout: "The summary is taking longer than expected. Open chat".

**F. Discuss in a new chat**
- Creates a conversation with the chosen agent (default agent; a small agent menu on the button).
- Sends a first message: "Here are the notes from "{title}" ({date}, {provider}). Its transcript selector is {selector}; use the transcripts tool to read the full transcript if you need it." plus the summary `markdown`, attached as `notes-{date}.md` when attachments allow `text/markdown` (`attachmentRejection`, `lib/gatewayPolicy.ts`), otherwise inlined.
- Then it navigates to the chat.

### 5.4 Wireframes

**Desktop: Meetings with the checklist and a live row**
```
┌─NavRail─┬──────────── Meetings ──────────────────┬──────────────────── Reader ───────────────────────┐
│ ▣ Dash  │ Meetings            [● Record a meeting]│ Weekly product sync                               │
│ 💬 Chats │ 🔍 Search meetings…                     │ Google Meet · Mon 14 Sep 10:00 · 42 min · 5 people │
│ 🎙 Talk  │ All  Meet  Teams  Zoom  Discord         │ [Discuss in a new chat] [Download ▾]              │
│▶📹 Meet  │ ┌ Setup ───────────────────────────── ┐│ ──────────────────────────────────────────────── │
│ 🧠 Memory│ │ ✓ Meeting notes are on               ││ [Summary]  Transcript                             │
│ ─────── │ │ ✓ Google Meet plugin                 ││ Agreed to ship the pricing page Thursday and move │
│ 🤖 Agents│ │ ○ Zoom plugin  not installed [Install]││ the onboarding survey to next sprint.             │
│ …       │ │ ○ Chrome on gw-host  [Run setup check]││ Decisions                                         │
│         │ │   Runs on the gateway host, not here. ││  • Pricing page ships Thursday                    │
│         │ └─────────────────────────────────────── ┘│  • Survey moves to sprint 38                      │
│         │ ● Design review          (Recording)     │ Action items                                      │
│         │   Google Meet · 12 min         [Stop]    │  • Update the pricing copy                        │
│         │ ⚠ Customer call  Waiting in the lobby:   │  • Draft survey questions                         │
│         │   admit "OpenClaw notes"   [Open chat]   │ Model-generated notes · check the transcript      │
│         │ ─────────────────────────────────────    │ before relying on decisions or action items.      │
│         │ Weekly product sync                      │                                                   │
│         │   Meet · Mon 14 Sep · 42 min · 5 people  │                                                   │
│         │ Customer call: onboarding                │                                                   │
│         │   Zoom · Fri 11 Sep · 28 min · 3 people  │                                                   │
│         │            [ Load more ]                 │                                                   │
└─────────┴──────────────────────────────────────────┴───────────────────────────────────────────────────┘
```

**Desktop: Record dialog**
```
            ┌──────────────────── Record a meeting ──────────────────── ✕ ┐
            │ Meeting link                                                 │
            │ [ https://zoom.us/j/81234567890?pwd=…                      ] │
            │ Zoom · plugin ready                                          │
            │ Agent       [ 🤖 main ▾ ]                                     │
            │ What should it do?                                           │
            │ (•) Take notes only   Listens and keeps notes.               │
            │ ( ) Take part         Can speak. Needs virtual audio.        │
            │ Joins as "OpenClaw notes"                        [Change]    │
            │ ┌──────────────────────────────────────────────────────────┐ │
            │ │ ⚠ The agent joins without announcing itself. Tell        │ │
            │ │   everyone in the call that it's taking notes.           │ │
            │ │   ☐ I'll tell participants                               │ │
            │ └──────────────────────────────────────────────────────────┘ │
            │ Chrome runs on gw-host, not on this computer.                │
            │                              [Cancel] [Join and take notes]  │
            └──────────────────────────────────────────────────────────────┘
```

**Phone: list, reader, record sheet**
```
┌──────────────────────────────┐ ┌──────────────────────────────┐ ┌──────────────────────────────┐
│ Meetings           [● Record]│ │ ← Weekly product sync        │ │            ───               │
│ 🔍 Search meetings…          │ │ Meet · Mon 14 Sep · 42 min   │ │ Record a meeting             │
│ All Meet Teams Zoom →        │ │ [Discuss] [Download ▾]       │ │ [ paste a meeting link     ] │
│ ● Design review (Recording)  │ │ [Summary] Transcript         │ │ Google Meet · plugin ready   │
│   Meet · 12 min      [Stop]  │ │ Agreed to ship the pricing…  │ │ Agent [ main ▾ ]             │
│──────────────────────────────│ │ Decisions                    │ │ (•) Take notes only          │
│ Weekly product sync          │ │  • Pricing page ships Thu    │ │ ( ) Take part                │
│   Meet · Mon · 42 min        │ │ Action items                 │ │ ⚠ Tell everyone in the call… │
│ Customer call: onboarding    │ │  • Update the pricing copy   │ │ ☐ I'll tell participants     │
│   Zoom · Fri · 28 min        │ │                              │ │ [   Join and take notes    ] │
└──────────────────────────────┘ └──────────────────────────────┘ └──────────────────────────────┘
```

**Dashboard: Recent meetings (right panel)**
```
│ RECENT MEETINGS                        See all │
│ ● Design review   Meet · live                  │
│   Weekly product sync   Mon · 42 min           │
│   Customer call   Fri · 28 min                 │
```

### 5.5 States

| State | Behaviour |
|---|---|
| First load | List skeleton (5 rows). Checklist skeleton. |
| Empty library | `EmptyState` (faded `Video` icon): "No meeting notes yet. Record a meeting, or set up Discord auto-record." |
| Search empty | "No meetings match "{query}"." |
| Capture off | Checklist item 1 unticked. The Record button is disabled, titled "Turn on meeting notes first". The library still shows old notes. |
| No plugin | The Record dialog shows the platform line with Install. The Join button is disabled until the plugin is ready. |
| Plugin installing | The PRD 06 overlay: "Restarting to finish installing Zoom meetings". |
| Pending join | Accent pulsing row "Joining…" with Open chat. |
| Manual action | Warning row with the tool's text and "Do this in Chrome on {host}". |
| Recording | Accent pulsing pill "Recording", live duration, Stop. |
| Stopping | "Stopping…" (accent, no pulse). |
| Join failed | Danger row, with Try again and Open chat. |
| No summary | "No summary yet." + Summarize. |
| Summarizing | "Summarizing…" (accent). |
| Export too large | Danger box: "This transcript is over 4 MB, so it can't be downloaded from the app. On the gateway host, run: `openclaw transcripts path {selector} --transcript` to find the file." with Copy. |
| Export failed | "Download failed. No partial file was saved. Try again." |
| Access restricted (`FORBIDDEN`) | The library shows `EmptyState` "Your connection can't read the meeting archive. Ask a gateway admin for access." Record stays available: joining doesn't need the archive. |
| No admin | Capture toggle, Install, guest name Change and Discord Save are replaced by host commands (with Copy) and **Do it via agent** where one exists. |
| Offline / reconnecting | Lists stay visible and greyed, with a "Reconnecting…" line. Buttons are disabled. Everything reloads on `connectionSeq`. |
| Gateway 2026.8 | Library only (`list`/`get`). No checklist status (`transcripts.status` missing): the checklist falls back to `plugins.list` + `config.get` for `transcripts.enabled`. No Download (hidden). No live detection from `active` (pending rows resolve on the tool result alone). |
| Gateway < 2026.8 | The Meetings nav item is hidden. |
| Remote gateway | The Chrome location line always names the gateway host. Setup check runs on the host through the agent. |
| Local gateway | The same copy: "on this computer's gateway (Chrome must be signed in here)". |

### 5.6 UI copy

| Key | String |
|---|---|
| nav.meetings | Meetings |
| page.title | Meetings |
| page.record | Record a meeting |
| page.search | Search meetings… |
| filter.all / meet / teams / zoom / discord | All / Google Meet / Teams / Zoom / Discord |
| setup.title | Setup |
| setup.done | Setup ✓ |
| setup.capture | Meeting notes are on |
| setup.capture.off | Meeting notes are off |
| setup.capture.turnOn | Turn on meeting notes |
| setup.capture.cmd | Ask an admin to run: |
| setup.plugin.ready | {name} plugin |
| setup.plugin.missing | {name} plugin · not installed |
| setup.plugin.off | {name} plugin is off. Turn it on under Extensions. |
| setup.plugin.install | Install |
| setup.chrome | Chrome on {host} |
| setup.chrome.where | Meetings run in Chrome on the gateway host or a paired node, not on this computer. |
| setup.chrome.check | Run setup check |
| setup.chrome.checked | Checked {time} · open chat |
| setup.chrome.ok | Looks good |
| setup.discord | Auto-record a Discord channel |
| setup.discord.setUp | Set up |
| record.title | Record a meeting |
| record.link | Meeting link |
| record.link.bad | This doesn't look like a Meet, Teams or Zoom link. |
| record.platform.ready | {platform} · plugin ready |
| record.platform.missing | {platform} · plugin not installed |
| record.agent | Agent |
| record.mode | What should it do? |
| record.mode.notes | Take notes only |
| record.mode.notes.hint | Listens and keeps notes. Nothing is said in the call. |
| record.mode.part | Take part |
| record.mode.part.hint | The agent can speak. Needs virtual audio on the Chrome host. |
| record.name.teamsZoom | Joins as "{name}" |
| record.name.change | Change |
| record.name.meet | Joins as the Google account signed in to Chrome on the gateway host. |
| record.consent | The agent joins as a participant without announcing itself. Tell everyone in the call that it's taking notes. |
| record.consent.check | I'll tell participants |
| record.where | Chrome runs on {host}, not on this computer. |
| record.join | Join and take notes |
| record.join.part | Join and take part |
| row.joining | Joining… |
| row.recording | Recording |
| row.stopping | Stopping… |
| row.stop | Stop |
| row.openChat | Open chat |
| row.manual | {text} |
| row.manual.where | Do this in Chrome on {host}. |
| row.failed | Couldn't join: {text} |
| row.retry | Try again |
| row.noNotes | Joined, but no notes are arriving yet. Captions may be off in the meeting. |
| row.noSpeech | No speech |
| row.meta | {provider} · {date} · {duration} · {n} people |
| reader.discuss | Discuss in a new chat |
| reader.download | Download |
| reader.download.md | Markdown |
| reader.download.jsonl | JSONL |
| reader.preparing | Preparing download… |
| reader.saved | Saved to {path} |
| reader.downloaded | Downloaded {filename} |
| reader.summary | Summary |
| reader.transcript | Transcript |
| reader.live | Live |
| reader.decisions / actions / risks / participants | Decisions / Action items / Risks / Participants |
| reader.modelNote | Model-generated notes · check the transcript before relying on decisions or action items. |
| reader.heuristicNote | Notes extracted from the text, without a model. |
| reader.noSummary | No summary yet. |
| reader.summarize | Summarize |
| reader.summarizing | Summarizing… |
| reader.summarizeSlow | The summary is taking longer than expected. |
| reader.searchTranscript | Search this transcript |
| reader.loadMore | Load more |
| reader.noUtterances | Nothing was said, or captions were off. |
| reader.tooLarge | This transcript is over 4 MB, so it can't be downloaded from the app. On the gateway host, run: |
| reader.exportFailed | Download failed. No partial file was saved. Try again. |
| empty.library | No meeting notes yet. Record a meeting, or set up Discord auto-record. |
| empty.search | No meetings match "{query}". |
| access.restricted | Your connection can't read the meeting archive. Ask a gateway admin for access. |
| discord.title | Auto-record a Discord channel |
| discord.server | Server ID |
| discord.channel | Voice channel ID |
| discord.account | Bot account |
| discord.titleField | Title (optional) |
| discord.occupied | Only while people are in the channel |
| discord.consent | Tell people in the channel that the bot captures and stores transcripts before you turn this on. |
| discord.save | Save |
| discord.state.armed | Waiting for people |
| discord.state.idle | Idle |
| discord.state.off | Off |
| discord.state.failed | Couldn't start: {hint} |
| discord.cmd | Not an admin connection. Run this on the gateway host: |
| dash.title | Recent meetings |
| dash.live | live |
| notify.manual.title | Meeting needs you |
| notify.manual.body | {title}: {text} |
| notify.started | Taking notes in {title} |

### 5.7 Keyboard and accessibility

- The list is a `role="listbox"` (Up/Down, Enter opens). The reader tabs are a `role="tablist"`.
- The Record dialog: the link field is autofocused; Enter submits when valid and consent is checked.
- The consent checkbox is a real `<input type="checkbox">` with a label.
- Live states: the pill text carries the meaning, and the pulse respects reduced motion (static dot).
- The transcript is a list of `<p>` elements with the speaker in `<strong>`. Search results announce "{n} matches" politely.

### 5.8 Notifications and deep links

- **Local `notify()`** (PWA, app hidden) fires:
  - when a pending join reports a manual action ("Meeting needs you");
  - when a join succeeds ("Taking notes in {title}").

  The `navigate` target is `{ section: 'meetings' }`. There's no web push: the gateway's categories are fixed (`lib/webPush.ts:48`).
- **Deep link:** `joax:navigate { section: 'meetings', selector? }`. The handler at `App.tsx:161` gains `selector`, which the meetings store opens. The Dashboard rows use it.

---

## 6. Design-book conformance

| Item | Used |
|---|---|
| Nav | `NavRail` item + BottomNav More item; `NavSection` gains `'meetings'` |
| Layout | List + reader split (Processes/Teams precedent, `WIREFRAMES.md §1`); phone push navigation |
| Primitives | 01 `Card` (checklist), `Section`, `Toggle` (capture, Discord), `FilterTab` (providers, reader tabs), `Pill`, `EmptyState`, `Overlay` (Record, Discord); `Btn`; `Input`; `ProgressTrack` (not needed) |
| Bottom sheet | 01 `BottomSheet` for the phone Record sheet |
| State colours (via 01 `stateTone`) | accent = working (Joining, Recording, Summarizing, pulsing dot `animate-pulse-dot`); warning = needs you (manual action, consent box, no notes arriving); danger = failed (join failed, start-failed); success = done (checklist ticks) |
| Feedback | Inline rows and boxes; no toasts |
| Admin fallbacks | 01 `CommandHint` (host command + Copy, the `ChannelPluginSetup` pattern); "Install via agent" / "Do it via agent" (`sendViaAgent`) |
| Copy | "notes", "transcript", "Record a meeting"; never implies an audio file |
| Icons | lucide `Video` (nav), `Mic` (Discord), `CircleDot` (recording), `Download`, `MessageSquarePlus` |
| **New** | (1) A **new nav section**, justified by a new top-level object (meetings) that isn't a chat or a setting; OpenClaw's own UI gives it a sidebar tab. (2) A **consent checkbox** at join time: stronger than the design book's usual inline line, deliberately, because the plugins join silently and consent is a legal exposure (2.6). |

---

## 7. Functional requirements

**FR-1: Visibility.**
- *Given* `hasMethod('transcripts.list')` is false, *then* the Meetings nav item and the Dashboard section are hidden.
- *Given* it's true but `transcripts.status` isn't advertised, *then* the checklist uses the fallback sources and Download is hidden.

**FR-2: Library.**
- *When* Meetings opens, *then* `list { limit: 50 }` loads, rows show title / provider / date / duration / participants, and **Load more** follows `nextCursor`.
- *Given* a search, *then* `query` is sent and the cursor resets.
- *Given* `transcript_invalid_cursor`, *then* the list reloads from page 1.

**FR-3: Reader.**
- *When* a row opens, *then* `get { selector }` loads the summary.
- *When* Transcript opens, *then* `get { selector, includeUtterances: true, limit: 50 }` loads, with Load more on `nextCursor`. An explicit `limit` is always sent, to avoid the legacy 2000-utterance mode.

**FR-4: Download.**
- *When* Markdown or JSONL is chosen, *then* `export` is called and the base64 `data` is decoded and saved with the gateway's `filename` and `mimeType`.
- *Given* `transcript_export_too_large`, *then* the too-large box shows the `transcripts path` command.

**FR-5: Checklist.** *Given* `status.enabled`, the plugin states and the stored Chrome check, *then* each item renders its state and one action. The checklist collapses when capture is on and at least one plugin is ready.

**FR-6: Capture switch.**
- *Given* admin, *when* "Turn on meeting notes" is toggled, *then* `config.patch { transcripts: { enabled: true } }` is sent with a fresh `baseHash`, and status reloads.
- *Given* not admin, *then* the command shows instead.

**FR-7: Plugin install.** *When* Install is pressed, *then* `installAndRestart({ source: "official", pluginId })` runs (PRD 06), and the item updates after the reconnect.

**FR-8: Link detection.** *Given* a pasted URL, *then* `detectPlatform` returns `meet | teams | zoom | null` per 5.3 B2, and the Join button is enabled only for a known platform with its plugin ready, an agent chosen, and consent checked.

**FR-9: Join via agent.**
- *When* Join is pressed, *then* a new conversation is created with the chosen agent and titled "Notes: {platform} · {time}".
- The join prompt (with the explicit `mode`) is sent without navigating away.
- A pending row appears, keyed by `convId` and the normalised URL.

**FR-10: Join status.**
- *Given* the watched conversation's meeting tool call is running, *then* the row shows Joining.
- *Given* its result contains a manual action, *then* the row shows it (warning), and `notify()` fires if the app is hidden.
- *Given* an OK result and an `active` transcript whose `source.meetingUrl` matches, *then* the row becomes Recording, bound to that selector.
- *Given* an error result or `MEETING_TOOL_MISSING`, *then* the row shows the failure.

**FR-11: Stop.**
- *When* Stop is pressed on a JoaxClaw-started recording, *then* a leave instruction is sent in its chat, and the row shows Stopping until `active` is false.
- *Given* a recording JoaxClaw didn't start (found in `status.active`), *then* Stop sends the leave instruction to the default agent in a new chat, including the meeting URL.

**FR-12: Polling.** *While* the Meetings view is visible, *or* any recording is pending or active, *then* `transcripts.status` is polled every 10 s (15 s on a phone). *Otherwise* no polling. On a `connectionSeq` change, everything reloads.

**FR-13: Summarize.**
- *Given* `!hasSummary`, *when* Summarize is pressed, *then* the summarize instruction goes through an agent and the reader polls `get` every 5 s for up to 2 minutes.

**FR-14: Discuss in a new chat.**
- *When* pressed, *then* a conversation opens with the chosen agent, and its first message contains the title, date, selector and summary Markdown (as an attachment when allowed, otherwise inline).

**FR-15: Discord auto-record.**
- *Given* admin and `discord-voice` in providers, *when* the form saves, *then* `transcripts.autoStart` gains `{ providerId: "discord-voice", guildId, channelId, accountId?, title?, whenOccupied }`.
- Removing an entry sends `replacePaths: ["transcripts.autoStart"]`.
- The gateway's "one `whenOccupied` entry per account and guild" rule is checked client-side first, with the error "There's already an auto-record channel for this server."

**FR-16: Consent.**
- *Given* the Record dialog, *then* the consent box is always visible, and Join stays disabled until "I'll tell participants" is checked.
- *Given* the Discord form, *then* its consent line is visible.

**FR-17: Remote gateway.** The Chrome location copy names the gateway host (from the connection URL). Nothing reads or probes local Chrome.

**FR-18: Dashboard.** *Given* at least one transcript, *then* Recent meetings shows the live row(s) and the last 3. Tapping opens Meetings with that selector.

---

## 8. Technical design

### 8.1 Modules

| Path | New/changed | Purpose |
|---|---|---|
| `src/lib/meetings.ts` | **New, pure** | `detectPlatform(url)`, `normaliseMeetingUrl(url)`, `PLATFORMS` (plugin id, tool name, transcript provider id, npm spec, setup command), `buildJoinPrompt / buildLeavePrompt / buildSummarizePrompt / buildDiscussMessage`, `parseMeetingToolResult(toolCall) → { kind: 'running'\|'ok'\|'manual'\|'error', text }`, `matchActiveSession(pending, active[])`, `durationLabel(startedAt, stoppedAt?)`, `checklistState(status, plugins, capture, chromeCheck)`, `autoStartEntry(form)`, `validateAutoStart(entries, entry)`, `providerLabel(id)`, `mapSourceState(state, diagnostic)`. |
| `src/store/meetings.ts` | **New** | State: `status`, `sessions`, `nextCursor`, `query`, `provider`, `selected`, `detail`, `utterances`, `pending[]` (joins started here: `{ id, convId, url, platform, agentId, startedAt, phase, text?, selector? }`, persisted in `sessionStorage`, so a reload keeps them until they resolve), `busy`. Actions: `load`, `loadMore`, `open(selector)`, `loadUtterances`, `download(format)`, `record(form)`, `stop(row)`, `summarize`, `discuss`, `setCapture`, `saveAutoStart`, `removeAutoStart`. Polling timer. `connectionSeq` watcher. |
| `src/lib/agentPrompt.ts` | Changed | `sendViaAgent(prompt, onOpenChat?, opts?: { agentId?, title?, navigate? })`, backwards compatible. Returns `convId`. |
| `src/store/chat.ts` | Changed (small) | Export a selector `watchToolCalls(convId, name)`, or have the meetings store subscribe to the chat store and read the conversation's latest assistant `toolCalls`. No new chat behaviour. |
| `src/components/meetings/MeetingsView.tsx` | **New** | Page, list, reader. |
| `src/components/meetings/SetupChecklist.tsx`, `RecordDialog.tsx`, `DiscordAutoRecordDialog.tsx`, `MeetingReader.tsx` | **New** | |
| `src/components/dashboard/DashboardView.tsx` | Changed | `RecentMeetingsSection`. |
| `src/App.tsx`, `layout/NavRail.tsx`, `layout/BottomNav.tsx` | Changed | Nav item; `joax:navigate` `selector`. |
| `src/components/common/AgentPicker.tsx` | Moved from `DashboardView.tsx:223` | Shared by the Dashboard and Record. |

### 8.2 Data flow

- **Load on open, and on `connectionSeq` change:**
  - `transcripts.status` (2026.9) or the fallback: `config.get` → `transcripts.enabled !== false`, and `plugins.list`.
  - `plugins.list`.
  - `transcripts.list`.
- **Polling:** there are no events, so a 10 s timer runs only under FR-12's conditions and stops on unmount or when nothing is live. Each tick fetches `status` only. The list refreshes when the `active` set changes (a meeting started or stopped) or every 60 s while visible.
- **Join status:**
  - The store subscribes to `useChatStore` and, for each pending join, finds the conversation by `convId` and the last assistant message's `toolCalls` whose `name` is the platform tool.
  - Live tool events already populate `status`, `result` and `error` (`chat.ts:267–320`).
  - After a reload, the PRD 05 fix restores them from history. Until then, a pending row whose chat has no tool calls shows "Status unknown · open chat".
- **Reconnect:** `gatewayClient.on` listeners aren't needed (no events). The `connectionSeq` watcher reloads, and pending rows survive via `sessionStorage`.

### 8.3 Capability gating

| Feature | Gate |
|---|---|
| Section | `hasMethod('transcripts.list')` |
| Checklist status, Download | `hasMethod('transcripts.status')`, `hasMethod('transcripts.export')` |
| Capture switch, Discord save, guest-name change, Install | `grantedScopes.includes('operator.admin')`; otherwise the command |
| Record | at least one meeting plugin enabled (`plugins.list`), capture on, a `sendViaAgent`-able agent (`operator.write` for `chat.send`) |
| Direct join (future) | `features.methods` includes a `<prefix>.join`-like method, confirmed by the spike (2.3) |

### 8.4 Checklist completeness rule

Complete when capture is enabled AND at least one meeting plugin is `enabled`. Chrome and Discord are informative: they never block collapsing, because they can't be verified over RPC.

### 8.5 Error handling

- Map `details.type` to the copy in 5.6. `FORBIDDEN` → the restricted state. `UNAVAILABLE` → "Couldn't read the meeting archive: {message}" with Try again.
- `config.patch` conflicts (a stale `baseHash`) → re-fetch and retry once, then show the error.
- Agent chat failures (send refused) → the pending row fails with the send error.

### 8.6 Performance and limits

- **Export:** ≤4 MiB of base64 in one frame (~5.6 MB on the wire), which is fine under the 25 MiB frame limit. Decode with `atob` into a `Uint8Array` in one pass; this is the same bytes-to-save path as PRD 05.
- **Transcript paging:** 50 per page (max 100). Never request without `limit`, because the legacy mode returns up to 2000 utterances capped at 25 MiB.
- **List paging:** 50 per page.
- **Polling cost:** one small `status` call every 10 s while visible. None when hidden, unless a join is pending.

### 8.7 Migration

None. `pending` lives in `sessionStorage` only. The Chrome-check timestamp lives in `localStorage` keyed by gateway URL.

---

## 9. Test plan

### 9.1 Unit tests (`src/lib/__tests__/meetings.test.ts`)

**`detectPlatform`**
- `meet.google.com/abc-defg-hij`
- a Teams meetup-join link (URL-encoded)
- `teams.live.com/meet/…`
- `zoom.us/j/123?pwd=`
- `acme.zoom.us/j/…`
- `zoom.us/my/…` (null: not a join link; verify against the docs' accepted patterns)
- plain text → null
- http vs https, and trailing slashes

**`normaliseMeetingUrl`** — strips tracking query params except Zoom `pwd`, lowercases the host.

**`buildJoinPrompt`** — includes the tool name, `action "join"`, the URL, the explicit `mode`, and the sentinel.

**`parseMeetingToolResult`**
- running
- plain OK
- a JSON result with `manualAction` (fixture to capture in PR 2)
- `isError`
- sentinel text
- unknown shape → `ok` with raw text

**`matchActiveSession`** — match by the normalised `source.meetingUrl`; no match; two actives, pick the newest `startedAt`.

**`durationLabel`** — under 1 min, 42 min, over 1 h, live (no `stoppedAt`).

**`checklistState`**
- capture off
- no plugins
- one plugin disabled
- complete
- the 2026.8 fallback inputs

**`autoStartEntry` / `validateAutoStart`**
- required IDs
- digits only
- duplicate `whenOccupied` per guild/account
- `accountId` required when there are several accounts

**`mapSourceState`** — all 4 states, plus the diagnostics.

**Store tests** (a mocked gateway and chat store)
- The polling start/stop conditions.
- Reload on `connectionSeq`.
- Pending → Recording on a status match.
- The export-too-large mapping.

### 9.2 Manual QA script

Use an isolated profile, a 2026.9.4 gateway, and a test Google Workspace account. Never the owner's live gateway (memory `gateway-vs-project-scope`).
1. Meetings with nothing installed: the checklist shows capture on, 3 plugins missing, and Chrome unknown.
2. Install the Zoom plugin from the checklist: the overlay, then the tick.
3. Run the setup check: a chat opens with the `zoommeetings setup` output. Press "Looks good".
4. Record a Zoom meeting (your own test meeting) in Take notes only. Expect "Joining…", then the lobby manual action, admit from the Zoom host, then Recording. Speak for 2 minutes.
5. Transcript tab while live: utterances refresh.
6. Stop: Stopping, then a library entry with the summary. Confirm a `transcribe` join produced durable notes (the 2.4 check). If not, record the finding for Q2.
7. Download Markdown and JSONL (desktop Save dialog; PWA share and download).
8. Discuss in a new chat: the agent answers with the notes as context.
9. Summarize on an entry without a summary (import one via the CLI `transcripts` tool): Summarizing, then the summary.
10. Turn capture off with an admin token, and on again. Repeat with a read-only token: the command shows.
11. Discord auto-record on a test server: save, Waiting for people, join the voice channel, speak, leave, then an entry appears.
12. Remote gateway over Tailscale: the copy names the host, and the join still works.
13. Kill the gateway while recording: the reconnect overlay, then everything reloads and the row resolves from `status`.
14. A 2026.8 gateway: library only, no Download, and a fallback checklist.
15. Direct-method spike: after installing each plugin, dump `features.methods` filtered by the meeting prefixes into the connection log, and record the method names in this PRD.

---

## 10. Rollout

- Gated per method (8.3). 2026.8 gets the library; 2026.9 gets everything.
- Ships after PRD 06 (install flow) and PRD 05 PR 1 (tool calls in history), which makes join status survive a reload.
- **CHANGELOG:** say plainly that notes come from meeting captions and that no audio file is made.

---

## 11. Risks and open questions

| # | Item | Owner? |
|---|---|---|
| Q1 | **"Recording" means notes, not audio.** Is the captions-plus-summary result what you want? If you expected an audio file, the plugins can't do that today. | **Yes** |
| Q2 | Default mode "Take notes only" (`transcribe`) assumes transcribe joins are saved to the library (ambiguous in the docs, 2.4). If they aren't, the default must be "Take part" (`agent`), which needs virtual audio on the host. Decide after the PR 2 check. | **Yes** (after spike) |
| Q3 | The consent checkbox is required on every join (recommended) vs once per session vs never (the line only). | **Yes** |
| Q4 | Nav placement: first group after Talk (recommended) vs the "Agent system" group. | Yes |
| Q5 | Should JoaxClaw set the Teams/Zoom guest name to "OpenClaw notes" by default at plugin install? That's a disclosure improvement, but it writes config. | Yes |
| R1 | The meeting plugins' gateway methods are unverified (2.3). Joining through an agent costs one model turn per join/leave, and depends on the agent following instructions. | No |
| R2 | The `manualAction` shape is unverified. The parser falls back to showing the raw text. | No |
| R3 | The Google Meet plugin isn't on ClawHub (npm only). `plugins.install { source: "official", pluginId: "google-meet" }` must resolve through npm. `ChannelPluginSetup` already relies on this path for npm-only channels (Slack), but verify it for google-meet in QA. | No |
| R4 | Chrome sign-in and lobby handling happen on the host's screen. On a headless remote host, Meet may need `googlemeet auth login`. The setup check surfaces this, but can't fix it. | No |
| R5 | Polling instead of events: up to 10 s of lag on state changes. Acceptable. | No |

---

## 12. Milestones and effort

| PR | Scope | Effort |
|---|---|---|
| 1 | **Library.** `lib/meetings.ts` (pure parts) + tests, `store/meetings.ts` (read side, polling), `MeetingsView` list + reader + download + Discuss + Summarize, nav item, Dashboard section, deep link. | M (2–2.5 d) |
| 2 | **Setup and recording.** Checklist (capture switch, plugin rows via PRD 06, Chrome check), `sendViaAgent` options, `RecordDialog`, pending-join tracking, manual actions, Stop, `notify()`. Includes the transcribe-storage and `manualAction` checks. | M+ (2.5 d) |
| 3 | **Discord auto-record, guest name, direct-method spike.** Discord dialog and source health; Teams/Zoom guest-name edit; log the plugin method discovery. | S (1 d) |
