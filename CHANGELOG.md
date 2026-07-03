# Changelog

All notable changes to JoaxClaw are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.17.0] - 2026-07-03

### Added

- **Emoji reactions on chat messages.** Hover any message (yours or the assistant's) and a **＋** reveals a compact emoji picker; your reactions render as pills under the message and toggle off with a click. Reactions persist locally in an append-only log (`~/.openclaw/reactions/reactions.jsonl`) and survive restarts. (Personal annotations for now — the gateway emits no chat reaction events, so nothing is sent upstream.)
- **Model reactions read as a chip.** When a model reacts to a message via the channel `message` tool (`action: "react"`), it renders as a friendly **"Reacted 👍"** chip instead of a raw tool card — with a **"Reacting…"** state while in flight and a clear **"Couldn't react — …"** state (e.g. *Action react requires a target.*) on failure. This reflects the model's channel activity (the id is a channel message id), not an in-chat reaction.
- **Gateway update detection.** JoaxClaw now detects when the connected **OpenClaw gateway** has a newer version available and offers to update it — the same way it already does for the app and the `joaxclaw-fs` plugin. A slim **app-wide banner** ("OpenClaw *X* is available · the gateway is on *Y*") and the **Update** button in the Gateway view (now labelled **Update → *X*** when an update exists) run the existing agent-driven `openclaw update` + restart. Detection uses the gateway's own channel-aware `update.status`, so it respects your update channel (stable / beta / git checkout) rather than guessing.

## [0.16.0] - 2026-07-01

### Added

- **Provider logos across the model UI.** Each provider now shows its brand mark (monochrome, so it adapts to any theme) next to the model — in the chat top-bar model picker and throughout the **Models** tab (providers list, provider header, usage table). ~40 providers covered, with a clean fallback for the rest; compound provider ids like `ollama-cron` resolve to the right logo.
- **Redesigned Local Models screen** (Models → Local models). A clear two-column layout: **Available to install** on the left (compact rows with publisher avatar, capability + **input-modality** chips — text / image / audio / video — and an Install arrow) and **Installed** on the right with fixed-width, aligned **Memory** / **Provider** status pills. The engine selector is now a spacious, logo-led segmented control showing each engine (`ollama`, `ollama-cron`, …) with its URL.
- **RAM footprint bar for local models.** Each installed model shows a stacked bar of its memory footprint — model weights plus a context/KV-cache buffer — against the machine's RAM, or **VRAM when the model is loaded on the GPU**. While a model is loaded it uses the **real resident size and context** from Ollama, so a model loaded at a large context window reads its true footprint instead of an estimate; turns red if it would exceed the pool.
- **Richer plugin configuration forms.** The plugin **Configure** dialog now renders typed, grouped fields (API key, LLM settings, and behaviour settings) instead of only an API key — schema-driven when the gateway provides a plugin's config schema, curated otherwise, with the raw JSON editor still available.
- **Reminders — let an agent ping itself later.** An idle or waiting agent can schedule a self-ping (a message it writes to its future self) and cancel it when done, via the `joaxclaw-fs` plugin (**requires plugin ≥ 0.5.0**). Sessions waiting on a reminder show an **alarm-clock badge with a live countdown** in the Sessions view, and you can cancel it with one click.
- **Plugin update detection + one-click upgrade.** JoaxClaw now compares the installed `joaxclaw-fs` version against the latest published on npm and offers to upgrade — a slim **app-wide banner** (like the app-update banner) and an **Update** button on the plugin's row in Extensions. The upgrade runs the force-reinstall + gateway restart via an agent.
- **Unified chat list.** The chat sidebar is now a single, triage-friendly column, and Team/Process **sub-agent threads are labelled by their task** instead of a generic agent id.

### Fixed

- **Fixed the Azure provider logo**, which rendered faded/incorrect in a single color.
- **Sub-agent yields (threads) survive reconnect and reload** — a session yielded to a still-running sub-agent is correctly shown as live, and pending/running yields are reconstructed on reconnect and placed on the in-flight turn.

## [0.15.1] - 2026-07-01

### Fixed

- **The title bar's bottom border is continuous again.** Electron 43 (0.15.0) activated the native window-controls overlay on Linux/Wayland; its opaque region sat over the custom title bar, duplicating the app's own window buttons and cutting the bottom border under them. Every window already draws its own themed title bar, so the native overlay was removed — the border now runs edge to edge.
- **A live chat stays marked as running in the left list.** Opening a running session moved it from the green "Live Sessions" zone into a dated group and dropped its running cue. The conversation row now shows a green pulsing dot while its session is still running (or a message is streaming).

## [0.15.0] - 2026-07-01

### Added

- **Scalable theme management with import/export.** A dedicated **Themes** screen with a gallery (apply / duplicate / delete / import / export), a full editor (colors, base mode, radius, font, icon family), a **Backgrounds** editor, and a live preview. Themes are a portable **`.joaxtheme`** package (a zip): a versioned `theme.json` plus optional per-surface background images, so they're easy to share and reuse. The built-in themes now live as readable files in the repo and load as the single source of truth.
- **Theme background images.** Optional wallpapers behind the **app** and the **chat**, each with opacity, blur, and fit, packaged with the theme on export (recommended size shown in the picker). Image bytes live on disk, never in localStorage.
- **Curated art for every base theme** (royalty-free, no attribution): Midnight (indigo Milky Way / starfield), Ocean Dark (navy waves / dark water), Forest (dark pines / misty green), and Rose Light (pale peonies / white blossoms, tuned for the light theme).
- **Retro Terminal theme.** A new green-phosphor CRT terminal theme for night coders — green-on-near-black with amber highlights, a monospace font stack, and near-square corners.

### Changed

- Theme editing moved out of Settings into the new Themes screen; Settings keeps status-bar, zoom, and update options.

### Notes

- Base themes always load from the bundled repo files (only user-created themes persist), so updated presets and their backgrounds take effect on upgrade.

## [0.14.1] - 2026-06-30

### Changed

- **Smarter "model stopped responding" detection.** The stall indicator was a single flat timeout that false-alarmed while a slow local model loaded, during a model's pre-first-token reasoning, and when the *connection* (not the model) dropped. It's now phase-aware and heartbeat-aware: a generous **first-token budget** (model load / context encoding) vs a tighter **inter-token gap** once output is flowing; the gateway heartbeat distinguishes a dropped connection (**"reconnecting…"**) from a genuine model stall; and running tools, sub-agent runs, and Ollama prompt-token ingestion no longer count as a stall. Richer states — **"waiting for the model…"**, a genuine **stall**, or **"reconnecting…"** — replace the single binary alarm.

### Fixed

- **The red "model stopped" notice no longer contradicts the "waiting for the model" counter.** The chat message body had a second, independent stall detector on a flat 15-second timer, out of sync with the composer's indicator. Both surfaces now share one phase-aware detector, so they can't disagree.

## [0.14.0] - 2026-06-30

### Added

- **One-click gateway self-update.** An **Update** button in the Gateway view asks the connected agent to run `openclaw update` on the gateway host, then restarts the gateway (deferred, so the agent's turn finishes before the connection briefly drops). Because the agent always runs on the gateway host, this works for **local and remote** gateways alike.
- **Configurable Obsidian access for agents.** A new **Agent access** control in the Memory view — **Off / Read-only / Read & write** — governs the `obsidian-memory` skill the app writes for gateway agents. *Off* removes the skill (agents can't reach the vault), *Read-only* exposes list/read/search only (no write endpoints), and *Read & write* keeps full access. Defaults to read-write to preserve prior behavior. (Local-host scoped: the skill points agents at the vault's Local REST API on `localhost`.)
- **Team member titles on the flow graph.** Each member's title (e.g. **QA Manager**, **Senior Developer**) now shows on its node in the Team graph, with the underlying agent as a subtitle — so you can see what each member is meant to do at a glance. Titles stay correct even when the same agent is reused for several members.

### Changed

- **Native window shadow + rounded corners.** Upgraded **Electron 33 → 43** and switched the app's frameless windows (main, pop-out chat, About) from transparent to opaque, so the compositor draws a native drop shadow and rounded corners that match the rest of the desktop — JoaxClaw windows previously had neither on Linux. Native on macOS / Windows 11 / Linux-Wayland; Linux X11 falls back to square corners without a shadow. Removes the old CSS corner-clipping workaround.

### Notes

- The Electron 43 upgrade brings **Chromium 150 / Node 24**; dependency advisories were resolved (`npm audit` reports **0 vulnerabilities**).

## [0.13.0] - 2026-06-30

### Added

- **Pop-out chat windows.** Move a chat into its own window — and bring it back — so you can keep several conversations open side by side. Each pop-out connects to the same gateway and streams its session live and independently; it hides the sidebar and locks to that one chat, with a **Return** control (closing the window also returns the chat). The main window hides a chat while it's popped out and restores it on return ("move", not mirror). Along the way: the app windows now have **rounded corners**, and the chat header's Basic/Advanced switch and Reasoning / Actions / Context toggles are collapsed into a single compact **multi-select menu** so the header (especially in the narrow pop-out) stays uncluttered.
- **System-tray activity + About window.** The tray menu and tooltip now show how many **agents** and **teams** are running (click either to jump to that tab); the tray icon uses the app logo. A new **About JoaxClaw** tray item opens an About window with the app version, a **check-for-updates** button, links to the **GitHub repository** and **sponsorship/donations**, and copyright.

### Fixed

- **The delete button on Processes and Team blueprints is reachable again.** The trash button was rendered with an inline `opacity:0` that overrode its hover-reveal class, leaving it permanently invisible — so there was no way to delete a process or a team. The hover reveal now works (hover a row → trash → confirm).
- **Clean agent names instead of raw session keys.** A Team/Process sub-agent's opaque session key (`agent:<id>:subagent:<uuid>`) leaked verbatim into the chat title bar and as a `subagent · <uuid>` entry in the chat list, because the key parser only understood the legacy `<id>@<uuid>` form. Names now resolve consistently across the chat header, chat list, and Sessions view — your rename → the Team-derived name → the gateway's display name → the agent id parsed from the key — and existing conversations are fixed too, not just new ones.

### Notes

- CI: GitHub releases now self-trim to the **5 most recent** on each publish (older releases are removed; their git tags are kept), with an on-demand "Prune old releases" action.

## [0.12.5] - 2026-06-29

### Added

- **Readable names for Team-spawned sub-agents.** A Team/Process sub-agent is only known to the gateway by an opaque key (`agent:<id>:subagent:<uuid>`), which surfaced verbatim in the chat list, the Sessions view, and the dashboard. They now show a friendly name derived from the team and the controller's task label for that worker (e.g. **"Research Team · Web Searcher"**), persisted across reloads. Resolution order is your explicit rename → the team-derived name → the gateway's own display name → the key.

### Changed

- **Team graph now lays out loops and branches instead of a flat line.** The graph editor used a longest-path pass that collapsed any team with a feedback loop (or no entry node) into a single column. It's now a layered (Sugiyama-style) layout: cycles are detected and their back-edges drawn as arcs, columns are assigned left→right over the resulting DAG, and node order within each column is chosen to minimise edge crossings. A freshly-compiled team auto-arranges on open, while a manual arrangement is preserved.

### Fixed

- **Agents graph no longer hangs or renders as a tall, tiny sliver.** The hierarchy layout runs during render; its longest-path walk increased a node's level on every longer path, so a cyclic `allowedSubAgents` relationship (A→B→A, or an agent that lists itself) looped forever and froze the tab — and a stop-gap cap then flung cycle nodes far down the canvas, shrinking everything. It now places each agent at its shortest distance from a root: compact, and cycle-safe by construction.

## [0.12.4] - 2026-06-28

### Changed

- **Clearer bottom-nav labels — "Updates" is now where you'd expect.** The bottom of the left nav had a gear labeled **Settings** that actually opened the *gateway* connection view, while the app's real settings (themes, icons, status bar, app prefs, and **Updates**) hid behind a palette icon labeled **Theme**. They're now named for what they do: a **Gateway** item (server icon) for the connection/devices/channels, and a **Settings** item (gear icon) for the app settings — so the auto-update controls live under the conventional Settings gear.

### Fixed

- **Release installers now publish correctly.** GitHub now makes a published release immutable, so the release workflow — which published the release *before* attaching the `.deb`/`.dmg` — could no longer upload them, leaving the release with only GitHub's auto-generated *Source code* archives. The workflow now creates the release as a draft, attaches the installers to the draft, then publishes it. (0.12.3's installers never attached for this reason; **0.12.4 supersedes 0.12.3** and includes all of its changes.)

## [0.12.3] - 2026-06-28

### Added

- **Live action trail of sub-agent work in the Team/Process monitor.** The monitor previously showed a member's streamed text but not what it actually *did* — every tool call except `sessions_spawn` was dropped. The activity log now records each tool call the controller and its workers run, attributed to the emitting agent with a short argument summary (e.g. `🔧 research-worker: read_file (src/lib/foo.ts)`), and surfaces failures (`⚠ research-worker: bash failed`). The trail is capped so it stays bounded on tool-heavy runs.
- **Claude-style colored diffs for file edits in chat.** When the model modifies a file, the change renders as a rich diff instead of raw text/JSON — color-coded additions/deletions, old/new line numbers, a +N/−M summary, a unified⇄split toggle, collapse, and syntax highlighting. It's detected from every shape an edit arrives in: model-written ` ```diff ` blocks, gateway `<edit>`/`<write>` tags, edit tool-call args (`old_string`/`new_string`, `apply_patch`), and edit tool *results* that carry a unified patch.

### Changed

- **Native window controls (min/max/close) follow the app theme.** The OS-drawn title-bar buttons baked in their colors at window creation; they now re-tint to match the active theme. (Applies on Windows/macOS, where the OS draws the overlay; Linux uses the app's own title bar.)

### Fixed

- **Your theme selection persists across reloads.** `main.tsx` re-applied the default (dark) theme *after* the settings store had already restored your saved theme, so every reload reset it to dark. It now applies the saved theme, falling back to the default only on a fresh install.
- **Team/Process run progress survives a reload and a reconnect.** Runs were persisted only at launch (`stepsDone: 0`) and on completion, so reconnecting to a gateway mid-run — or reloading the app — showed the monitor as if the run had just started. Progress is now persisted on each advancing event (steps, `[PROGRESS]` markers, delegations) and mirrored to localStorage, so the monitor repaints the real progress instantly on reload while the gateway reconciles the rest on reconnect (a run that finished while the app was closed self-heals to done).
- **The Theme view no longer traps you while disconnected.** On the connect screen every section but Theme was disabled in the nav rail, so opening Theme left no way back to the connect screen. Dashboard stays clickable while disconnected and routes back.
- **Dashboard no longer treats team runs as processes.** Team runs share the processes store, so the dashboard double-listed running teams under "Active", counted them in the "processes running" chip, and mis-navigated to the Processes tab. Team runs are now split out by blueprint id — they appear only in the Teams section (→ Teams tab), with their own "teams running" chip. Drawer times also roll up through hours/days (2h 5m, 1d 3h, 2d ago) instead of large minute counts.
- **Monitor step marker no longer sticks on a handoff after a delegation.** The Team Progress marker used `i === stepsDone`, but the step list interleaves handoff/review transition nodes that `stepsDone` doesn't count — so a finished handoff held the marker while the next agent was already working. Transition nodes now read as done immediately and the marker follows to the next agent; the progress bar also reaches 100% instead of stalling at, e.g., 3/5.
- **Chat no longer looks stopped when an agent delegates.** This gateway ends the run with an empty `final` at the `sessions_yield` (the pause to wait for a sub-agent), then auto-resumes and streams the real answer in a later `final`. The client treated that first empty `final` as "done" and unsubscribed, so the resumed answer never arrived until you sent another message. An empty `final` while a sub-agent thread is still in flight is now treated as a yield boundary — the stream stays attached and the resumed answer comes through.
- **Reliable chat auto-scroll.** The auto-follow `ResizeObserver` attached on mount, but the empty-conversation state didn't render the scroll container, so it watched nothing and never re-attached when messages arrived — silently killing auto-scroll for that conversation. The container is now always mounted, and sending a message snaps to the bottom.
- **Reused agentId no longer breaks conditional routing in teams.** A branching team that used the same agentId for multiple members (e.g. `coder-worker` as both a Code and QA agent) compiled a corrupt graph — a route landed on every member sharing that id and feedback edges resolved to the first match, orphaning steps. Routes/branches now resolve to a unique member by role (with agentId kept as a backward-compatible fallback), so reused-agentId members are distinguishable. Existing unique-agentId routes are unchanged.

## [0.12.2] - 2026-06-27

### Added

- **Device pairing management (Settings → Devices).** Full lifecycle for the gateway's paired clients: approve/reject incoming pairing requests, view paired devices (expandable, with copyable `deviceId`/`publicKey` and a per-token table), and remove devices or rotate/revoke their tokens. The panel is read-only without `operator.admin`; destructive actions use inline confirms and a **last-admin-device** guard blocks locking yourself out of device management; the list live-updates via the gateway's `device.pair*` / `device.pairing.*` events. New `store/devices.ts`, `components/gateway/DevicesPanel.tsx`.
- **Inline sub-agent threads in advanced chat.** When the assistant spawns a sub-agent (`sessions_spawn`), it now appears as a Slack-style collapsible **thread** anchored at the spawn point — a chip showing the agent, a live status, and a one-line peek of what it's doing; expand it to watch the sub-agent's own reasoning, tool calls, and answer stream live. The sub-agent's frames are linked back to the run via each frame's `spawnedBy`, replacing the cold "waiting for session" hourglass that previously hid all of its work.

### Changed

- **Clearer "thinking" vs. answer in chat.** Reasoning no longer dumps fully expanded above the reply: it streams open only while the model is still thinking, then auto-collapses the instant the answer starts into a quiet **"Thought for Ns"** pill (tap to reopen). Reasoning extraction now also recognizes `<thinking>` / `<reasoning>` / `<thought>` (not just `<think>`), so more models that stream their reasoning as content get the tidy treatment.

### Fixed

- **Team/Process runs no longer falsely complete while a member is still working.** Completion was force-marked "done" by a 10-minute hard cap even when the session tree was still active, so any member that legitimately worked past it ended the whole flow early. The completion watcher now finishes a run **only** on a confirmed sustained-idle streak (never on the timer); the wall-clock is just a generous watcher lifetime (10 min → 2 h) that *pauses without completing* if reached while still active (re-arming on the controller's next `final`); and it counts `hasActiveSubagentRun`, so a yielding controller with live members still reads as busy.

### Notes

- Added a **Shared Workspace** field to the Teams builder as groundwork toward teams that edit a shared repository — members are spawned with a shared `cwd`, handoffs are filesystem-first, and steps are git-checkpointed. The app-side wiring is in place, but a member reliably editing the host repo still depends on a gateway-side spawn-runtime change and is **not complete yet**.

## [0.12.1] - 2026-06-26

### Added

- **Reusable teams — run a saved team against a per-run task.** A team blueprint is now a reusable design: a new **"Task for this run"** box supplies a concrete objective at launch, and member tasks / the output contract may use an `{objective}` placeholder that's substituted in (threaded through `buildLaunchPrompt`, recorded on the run, and shown in the monitor).
- **Agent-launchable team runs.** Agents can start a saved team via the `joaxclaw-fs` plugin's new **`teams.run`** method (`{ id, task, autorun? }`), which records a one-shot `<id>.runrequest.json`; the app polls for it, pre-fills the task, optionally auto-launches, and clears it (the app still owns prompt-building and the run monitor). Documented in the `teams-blueprint` skill (v2). **Requires `joaxclaw-fs` ≥ 0.4.0** on the gateway host.

### Fixed

- **Team runs no longer report "complete" after the first step.** This gateway emits no `waiting`/`delegating` chat state, so worker sub-sessions weren't linked to the run and a controller `final` (fired on every `sessions_yield`) ended it early. Runs now link workers via each frame's `spawnedBy` and complete **only** via the gateway idle-poll (`includeRoot=true`), so neither a controller nor a worker `final` ends the run prematurely; a worker error/abort no longer fails the whole run (controller-only).

### Plugin

- **`openclaw-joaxclaw-fs` 0.4.0** adds the `teams.run` gateway method (agent-launchable team runs). Published to npm via CI on the version bump.

## [0.12.0] - 2026-06-26

### Added

- **Built-in app auto-updater.** JoaxClaw now checks its own [GitHub Releases](https://github.com/joax/joaxclaw/releases) for a newer version — shortly after launch, every 6 hours, and on demand from **Settings → Updates** — and surfaces an app-wide banner when one is found, with the release notes one click away. From the banner you **Download** the right installer for your OS (with live progress) and then **Install**, with the handoff matched to the platform: on **Windows** the NSIS installer runs and the app restarts itself; on **macOS** the `.dmg` is mounted so you drop the new app into Applications; on **Linux** the `.deb` is installed via a graphical `pkexec` prompt (falling back to revealing the file). You can **Skip** a version or dismiss the banner, and turn the automatic check off entirely. Because the builds are unsigned, the flow is "download + assisted install" rather than fully silent on macOS/Linux — no code-signing required. New `electron/main/updater.ts`, `store/updater.ts`, and `components/layout/UpdateBanner.tsx`; semver-aware, so it never offers a downgrade and treats a finished release as newer than its own prerelease.
- **Team/Process runs survive an app restart.** A run executes on the gateway (independent of the app), so restarting the app no longer loses it: the in-flight run is persisted with its controller session key, and on reconnect the app **re-attaches** — re-routing the run's live events and reconciling completion against the gateway's live session tree (`sessions.list`). A run that finished while the app was closed is marked done; one still going keeps tracking. Previously a restart marked the run "Interrupted."
- **Zoom the whole app** with **Ctrl/⌘ +** and **Ctrl/⌘ −** (and **Ctrl/⌘ 0** to reset). Uses Electron's native frame zoom, so it scales everything — including inline-pixel styles a CSS font-size couldn't reach — and the level persists across restarts. Also exposed as a −/Reset/+ control under Settings → App for discoverability.
- **Chat "Basic" mode** — a friendlier presentation for run-of-the-mill users, toggled from a Basic | Advanced switch in the chat header (Advanced stays the default). Instead of tool-call cards, reasoning dumps, and a bare blinking cursor, Basic mode shows a calm plain-language activity trail while the assistant works — completed steps as a checklist (✓ Searched the web, ✓ Read files) with the current action live at the bottom (Running a command…, Working with a specialist…, Thinking…). The answer renders normally, with an opt-in **Details** disclosure to expand the full advanced view for any one message. While the model is working with no specific tool, the status rotates through ~85 playful "thinking" verbs (Frolicking…, Pontificating…, Reticulating…, Noodling…) in the spirit of Claude Code's spinner words. It's a presentation layer over the existing event stream — no gateway changes.
- **Extensions → Plugins now lists the gateway's full plugin registry**, not just plugins that already have a config entry. Previously a plugin that was enabled by default but unconfigured (e.g. `browser`, `canvas`, `openai`) was invisible; now every installed plugin shows with its enabled/disabled state and the all/enabled/disabled filter. Toggling or configuring a registry plugin adopts it into config; untouched ones are never written back (so the config isn't polluted with all ~90 stock plugins). The registry is read from the local CLI for a local gateway and from the gateway's own `plugins.list` when remote.

### Fixed

- **Chat reliably stays pinned to the bottom while content grows.** Auto-follow keyed off a hand-rolled signature of the last message's fields (content/reasoning/tool-call lengths + streaming flag), which missed growth it didn't enumerate — Basic-mode action steps, images finishing load, markdown reflow. It now watches the content box with a `ResizeObserver` and jumps to the bottom on any height change while the view is pinned, so streaming never drifts above the fold.
- **Teams/Processes runs no longer report "completed" while workers are still running.** The run tracker registered a spawned worker only if the `sessions_spawn` result carried `key`/`sessionKey`, but the gateway returns it as `childSessionKey` — so no workers were tracked, `_pendingSubSessions` stayed empty, and the Team Lead's `final` ended the run early (often within seconds, `stepsDone: 0`). It now reads `childSessionKey` and registers the awaited sub-session on `waiting`/`delegating`. As a robust safety net (event inference can still miss workers), when the controller finishes with no tracked workers the app now **asks the gateway which descendant sessions are still alive** (`sessions.list` → `parentSessionKey` + `status`/`hasActiveRun`) and completes the run only once the whole session tree is idle, bounded by a hard cap so a missed signal can't hang it.
- **A chat no longer hangs forever when a tool restarts the gateway.** Running something like `systemctl --user restart openclaw-gateway` kills the WebSocket mid-turn, so no `final` event ever arrived and the message spun indefinitely with a live Stop button. The app now detects the connection drop, finalizes the in-flight message, and shows a live notice on it — "The gateway connection dropped (it may be restarting) — reconnecting…" — that flips on its own to "Gateway restarted and is back online — send a message to continue." the moment the auto-reconnect succeeds.
- **Saving plugin/skill changes no longer fails with "Unrecognized keys" config errors.** The Extensions save wrote display/registry fields (`name`, `description`, `source`) into `plugins.entries.*` / `skills.entries.*`, which the gateway's strict config schema rejects; it now strips them and only persists genuine config keys. Untouched discovered skills (and registry plugins) are no longer written at all, so a single toggle doesn't rewrite the whole catalog.
- **Setting a model provider's API key no longer fails with a Base URL validation error.** In the plugin Configure form, leaving the optional **Base URL** field empty used to wipe the provider's endpoint; the gateway then merged the plugin's default empty `baseUrl` and rejected the whole patch (`models.providers.<id>.baseUrl: Too small: expected string to have >=1 characters`), so saving just an API key failed. The form now only writes Base URL when you actually type one and never clears an existing endpoint (use the Advanced tab to remove an override).
- The **"model stopped — send a message to continue"** banner no longer appears while the model is still ingesting the prompt. The staleness detector only watched content/reasoning/tool activity, so a long prompt ingest (which emits no output yet) tripped it even at, e.g., 84% / 481 tok/s; it now treats live prompt-token progress as activity and suppresses the banner while ingestion is advancing.
- **Slow local models no longer make the chat go silent.** `chat.send` was awaited with the default 30 s request timeout, so a local model that took longer than 30 s to produce its first token tripped the timeout, the message was marked not-streaming, and every indicator vanished (no "thinking…", no prompt bar, no Stop button) while the model kept generating. The turn's lifecycle is driven by the event stream, not by `chat.send`'s reply, so `chat.send` is now sent without a timeout (and not awaited) — the indicators and Stop button stay until the stream actually ends. The composer also re-enables immediately instead of locking for the whole turn.
- The chat **"Processing prompt…" bar no longer disappears** when Ollama goes a few seconds without printing a progress log line. It previously expired after a 4 s gap; it now persists through quiet gaps (the spinner keeps turning) and is cleared on the actual lifecycle — when prompt eval finishes or output starts — via a new `reset()` instead of a short idle timer.
- Model-pull progress no longer jumps backward or blanks out. Ollama announces layers incrementally (so the raw overall % drops when a new layer is discovered, and disappears during the manifest/verify phases); the download bar is now clamped to move only forward and keeps its last value through those phases, with a live downloaded-bytes readout (e.g. `3.4 / 8.2 GB`) so there's always feedback.

## [0.11.0] - 2026-06-25

### Added

- **Local model management (Models → Local models).** A new tab to manage models on a local **Ollama** engine: see installed models (size · params · quant · loaded), **pull a new model by name** with live download progress, **delete**, and **"Add to provider"** to register a model into the gateway config so agents/the picker can use it. Works on a **local *and* remote** gateway — it's routed through the `joaxclaw-fs` plugin's new `engines.pull` / `engines.pullStatus` / `engines.delete` methods (the plugin runs on the engine's host). Requires `joaxclaw-fs` ≥ 0.3.0. A **Discover** browser presents a curated, searchable catalog of popular models (publisher, capability badges — tools / vision / reasoning / code / embedding — and a size-per-variant picker) so you can pull without knowing exact names; anything else is still pullable via the free-text field. Each installed model expands to show **details** (family, parameters, quantization, context length, license) and can be **loaded/unloaded** from memory; downloads show an **overall** progress %. New `lib/modelManager.ts`, `lib/modelCatalog.ts`, `store/modelManager.ts`, `components/models/LocalModelsPanel.tsx`. (LM Studio's API can't download models, so it's a later, list-only phase.)
- **`joaxclaw-fs` 0.3.1** adds `engines.pull` (streamed Ollama pull → `pullId`, polled via `engines.pullStatus`, with overall %), `engines.delete`, `engines.show` (model details), and `engines.keepAlive` (load/unload).
- **Talk mode shows the agent's activity.** During a voice call, a collapsible **Agent activity** panel lists the actions the agent takes — each tool call with a live status (running / done / failed), inline progress, and expandable args + result — so it's transparent what's happening while you talk (e.g. "🔍 searching the web…"). Driven by the `tool.call` / `tool.progress` / `tool.result` Talk events into a per-call timeline in `store/talk.ts`.

## [0.10.0] - 2026-06-23

### Added

- **Talk mode (Phase 1) — voice conversation with your agent.** A new **Talk** tab: click to start, speak hands-free, and hear the agent reply, with a reactive **orb** (no avatar yet), live two-sided captions, mute, tap-to-interrupt (barge-in), and a tool-activity indicator. Built on the gateway's realtime **Talk** API — it owns VAD, barge-in, turn-taking and the agent "brain", so JoaxClaw is the client: mic → PCM16 (AudioWorklet, echo-cancelled) → `talk.session.appendAudio`, and `talk.event` (`speechStart` / `transcript.*` / `audio` / `tool.*`) drives an interaction state machine. Uses the `realtime` mode over the `gateway-relay` transport (works local *and* remote), and **requires a configured realtime voice provider** (e.g. Google Live Voice) — its key goes at `talk.providers.<id>.apiKey` on the gateway. ElevenLabs/Deepgram are transcription-only and can't drive realtime Talk; the `stt-tts` path needs a `managed-room` transport that's a later phase. The settings bar lists exactly which providers fit the mode and whether each has a key, and lets you **set the realtime provider's key inline** (written to `talk.providers.<id>.apiKey`). Four **switchable visualizers** (Orb, Bars equalizer, Radial spectrum, Blob) react to the live audio — FFT-driven for the bar styles via the audio engine's analyser, source-switched between your mic and the agent by state, persisted across sessions, and WebGL-free. A **"Talking to …" header** shows who actually answers — with `agent-consult` (the default) the realtime voice is a front-end and the reply comes from your **agent's model**; you can **pick which agent** answers and switch the **brain** (`agent-consult` / `direct-tools` / `none`). New `store/talk.ts`, `lib/talkAudio.ts`, `components/talk/TalkView.tsx`; design + roadmap in [src/lib/TALK.md](src/lib/TALK.md). Avatar, expressions, stt-tts, and a WebRTC transport are later phases.

### Fixed

- Native `<select>` dropdowns no longer flash white on open — `applyTheme()` now sets the document `color-scheme` to match the active theme (with a dark default for first paint), so Chromium renders native control popups in the right scheme app-wide.

## [0.9.0] - 2026-06-22

### Added

- **Open-sourced under MIT.** Added a `LICENSE` (MIT), a public [ROADMAP.md](ROADMAP.md), `CONTRIBUTING.md`, a `SECURITY.md`, and GitHub issue/PR templates; refreshed the README. Internal `docs/` architecture notes were removed (code-adjacent `src/lib/*.md` notes stay).
- **Schedule a team to run on a CRON job.** The CRON editor's Payload tab has a new **"Run a team"** kind — pick a configured team and the job fires its **Team Lead launch prompt** to the team's controller agent on schedule. Because the gateway runs the schedule and the agents, the team executes **unattended — no app needed**. Reuses the existing `buildLaunchPrompt` (same path as the manual Run button); the job is a normal `agentTurn` under the hood, with the team recognised again on edit so it pre-selects. (Note: the polished per-node run timeline only records while the app is watching, but the team runs fully either way and the controller/sub-agent sessions are logged on the gateway.)
- **Configure plugins from the app (incl. API keys).** The Extensions view previously only enabled/disabled plugins; each plugin now has a **Configure** action that opens a settings dialog. It surfaces the plugin's **API key** routed to the correct place in the gateway config — model providers → `models.providers.<id>.apiKey` (with an optional base-URL override), TTS providers → `messages.tts.providers.<id>.apiKey`, web-search plugins → `tools.web.search.apiKey` — plus an **Advanced** tab for the raw `plugins.entries.<id>` config (behaviour/`llm` gating). Keys can be literals or env-var `SecretRef`s (preserved read-only). All writes go through `config.patch`, so it works on **local and remote** gateways. Each plugin also shows a status badge — a green **Configured** check when its API key is set (literal or env `SecretRef`), or an amber **Needs key** when one is required but missing. New `lib/pluginConfig.ts` (curated key routing + completeness) + `PluginConfigModal`; curated paths validated against the gateway config schema, with unit tests.

### Fixed

- **Hardened the "Install via agent" script.** It used `openclaw plugins allow` — not a real subcommand, so it was a silent no-op (enabling relied entirely on `enabledByDefault`). The script now uses `openclaw plugins enable`, runs `install --force` so re-runs upgrade instead of failing, and adds an `openclaw plugins inspect` guard that aborts *before* the gateway restart if the plugin didn't register (so a failed install surfaces instead of a misleading "done"). Step output is kept visible for diagnosis. Same corrections applied to the plugin README and Help → Remote Teams. Verified end-to-end; covered by a regression test.

### Changed

- Release CI no longer uploads the `.deb`/`.dmg` as 90-day Actions artifacts — they're attached to the GitHub Release (separate storage), so the duplicate copies just consumed the account's Actions-storage quota.

## [0.8.0] - 2026-06-21

### Added

- **Per-channel policy editor.** Each configured channel's **Edit** dialog now has a **Policy** tab for the access + capability controls the gateway exposes under `channels.<id>`: **DM policy** (`pairing` / `allowlist` / `open` / `disabled`), a **DM/group allowlist** of sender IDs, **allow-bots**, **group policy**, and an **action-permissions** grid (what the agent may do on the platform — react, post, pin, moderate, roles, …). Policy can be set for the whole channel or **overridden per account or per group** (`channels.<id>.accounts.<id>` / `.groups.<id>`). Curated per provider (Telegram, Discord, Slack, Matrix, WhatsApp) from the gateway config schema; other channels keep using the Advanced raw editor. New `lib/channelPolicy.ts` + `ChannelPolicyEditor`; writes go through `config.patch` (with `replacePaths` for allowlist edits). Verified end-to-end against a live gateway.
- **Per-engine model lists in Settings → Local LLM.** Each reachable local engine now shows how many models it's serving, expandable to the full list. Works locally (via a new `ollama:fetch` main-process IPC, which isn't CORS-bound) and on a remote gateway (via the plugin's `engines.fetch`). Parses both Ollama (`/api/tags`) and OpenAI-compatible (`/models`) responses. New `fetchEngineModels()` / `parseModelIds()` in `lib/localEngines.ts`, with unit tests.
- **The model picker offers each engine's installed models.** Beyond the models declared in the gateway config, the picker now also lists models a local engine is actually serving (e.g. an Ollama model you pulled but never added to config), tagged `installed` and still selectable since the provider routes by name. Gateway-aware via `fetchEngineModels`, so it works on a remote gateway too. Used across the Agents, Agent editor, and CRON editor pickers.
- **Isolated cron-instance detection works for every engine, not just Ollama.** The "second instance on a companion port" convention (Ollama `:11434`→`:11435`) is now generalized to `<default port>+1` for all known engines (LM Studio, vLLM, llama.cpp/LocalAI, Jan, KoboldCpp), so the Local LLM Engines panel can flag an isolated instance and prompt for an `<engine>-cron` provider regardless of engine. Unused ports just probe down — no false positives.

### Fixed

- Deleting a channel (or removing an account) whose config contains arrays — now including policy **allowlists** — no longer fails the gateway's array-shrink guard: the store collects the block's array paths and passes them in `replacePaths`.

### Removed

- Dead Ollama-only helpers `checkOllama` / `resolveOllamaUrl` in `lib/ollamaHealth.ts` (which now only exports the widely-used `gatewayHost` / `isLocalGateway`).

## [0.7.1] - 2026-06-20

### Added

- **`joaxclaw-fs` plugin is published to npm** as [`openclaw-joaxclaw-fs`](https://www.npmjs.com/package/openclaw-joaxclaw-fs), so installing it on a gateway host is one command: `openclaw plugins install openclaw-joaxclaw-fs && openclaw plugins allow joaxclaw-fs`. A new CI workflow (`.github/workflows/publish-plugin.yml`) publishes the package automatically whenever its `package.json` version changes on `main`, version-guarded so unrelated pushes are a no-op (requires an `NPM_TOKEN` repo secret). The in-app Help → Remote Teams steps and the plugin README now lead with the npm install.

### Changed

- **"Install via agent" now installs the plugin from npm** instead of embedding its files as base64 in the chat message. The script handed to the host agent is now a short `openclaw plugins install openclaw-joaxclaw-fs` + allow + restart. This removed the renderer's dependency on the `teams:installScript` main-process IPC (and that IPC/preload bridge), eliminating the old "Restart JoaxClaw / No handler registered" failure mode. Offline hosts use the manual `--link` steps in Help → Remote Teams.

## [0.7.0] - 2026-06-20

### Added

- **Remote-gateway local-engine health & model listing.** The `joaxclaw-fs` plugin now exposes `engines.probe` and `engines.fetch` — host-side GETs that check a local LLM engine's liveness and read its model list **from the gateway host**. Previously, engines on a remote gateway's loopback/LAN showed as *unknown* because the app can only reach `localhost` on the client machine. The Local LLM Engines panel (Crons) and Settings card now route their probes through the plugin when the gateway is remote, and also discover engines on the host's default ports. Requested URLs are guarded to local-engine hosts only (loopback / `*.local` / private IPv4), so the methods can't be used as a general request proxy. New `probeStatus()` routing in `lib/localEngines.ts`; verified end-to-end against a live gateway.
- **Saved connections survive a `localStorage` reset.** Gateway connections are now mirrored to the file-based localstore (`~/.openclaw`-adjacent `~/.joaxclaw/store.json`) in addition to `localStorage`, and any missing ones are restored on startup (merged by URL). Previously an Electron `localStorage` reset (origin change, concurrent instances, profile corruption) could silently wipe them. New `restoreConnectionsFromBackup()` in `store/connection.ts`.

### Notes

- The `engines.*` probing requires the **updated `joaxclaw-fs` plugin** on the gateway host. Existing installs need to re-run **Install via agent** (remote Teams/Processes screen) or `openclaw plugins install --link ./plugins/joaxclaw-fs` + a gateway restart to pick up the new methods; until then remote engines stay *unknown* (no regression).

## [0.6.0] - 2026-06-19

### Added

- **Teams & Processes work over a remote gateway** via a new bundled gateway plugin, **`joaxclaw-fs`** ([plugins/joaxclaw-fs/](plugins/joaxclaw-fs/)). Team blueprints (`~/.openclaw/teams`) and process definitions/runs (`~/.openclaw/processes`) are files on the gateway host; the app used to read them only over local file IPC, so they were invisible on a remote gateway. The plugin registers `teams.*` and `processes.*` (read/write, operator-scoped) over the WebSocket. Both stores now probe for it and use an **RPC backend** when present (local *and* remote, incl. items authored by agents on the host), falling back to local files on a local gateway. Covers both features with one install.
- **"Install via agent"** — on a remote Teams/Processes screen, one click hands an agent on the gateway host a self-contained script (the plugin's files travel **base64-embedded inside the chat message** — no clone, npm, registry, or upload) that installs `joaxclaw-fs` and restarts the gateway. You just approve the command. A "Manual steps" path and Help → **Remote Teams** page document the same install.
- **Scoped channel routing** — agent bindings can now target more than the whole channel: a specific **account**, a **group/peer** (by id), a **Slack team**, or a **Discord guild**. A binding editor on each channel card builds the `match` and lists existing bindings with their scope; the gateway resolves the most specific match first (peer → guild → team → account → channel → default).
- **Multi-account channels** — add/name/remove additional accounts per channel (`channels.<id>.accounts.<id>`) and set the default account, directly from the channel card. Per-account credentials are editable via **Edit → Advanced**.
- **Secret-scan pre-commit gate** ([scripts/check-secrets.mjs](scripts/check-secrets.mjs)) — a dependency-free scanner runs first in the pre-commit hook over staged content and blocks commits containing keys/tokens/credentials (private keys, AWS/OpenAI/Google/GitHub/Slack/Stripe/etc., JWTs, `user:pass@` URLs, and the openclaw gateway-token format), with matches redacted in output. `npm run audit-secrets` scans every tracked file.

### Changed

- **Client hardware metrics are hidden when the gateway is remote.** GPU/CPU/RAM and the local-Ollama model list are read from the client machine (and `localhost:11434`), so they don't describe a remote gateway host. The status bar drops the GPU/RAM chips, and the System Monitor + dashboard Resources panel show a short "these are your client machine" note instead. New `useIsRemoteGateway()` selector in `store/connection.ts`.
- Teams and Processes now **re-load whenever the gateway (re)connects**, so the "install the plugin" notice re-probes and clears itself automatically after an install + gateway restart — no manual retry.
- Polished the team designer (graph editor + Teams view).
- Release workflow now creates the GitHub Release (with `CHANGELOG.md` notes) in a dedicated job that runs before the platform builds, so the notes can't be raced to an empty body by whichever build finishes first; the Linux/macOS jobs only upload their installer asset.

### Notes

- The `joaxclaw-fs` plugin ships in-repo and isn't published to a registry; remote installs use the in-app **Install via agent** flow or a manual `openclaw plugins install --link`. Publishing for one-command installs is a possible follow-up.

## [0.5.0] - 2026-06-17

### Added

- **Channel management (Settings → Channels)** — configure the messaging platforms the gateway talks on and assign each to an agent. Browse a catalog of ~33 openclaw channels; create one with first-class credential forms for the common channels (Telegram, Discord, Slack, WhatsApp, Feishu, SMS, QQ Bot) or a raw JSON5 editor (incl. env `SecretRef`s) for any other. Per-channel live status, enable/disable, Start/Stop/Logout runtime controls, and agent bindings (`bindings[]`). New `src/lib/channels.ts`, `src/store/channels.ts`, `src/components/gateway/ChannelsPanel.tsx`.
- **WhatsApp QR pairing in-app** — links over the gateway's `web.login.start` / `web.login.wait` RPCs (the same flow the official control-UI uses), rendering the QR as a PNG with auto-refresh and connection detection — no CLI shell-out, and it works for remote gateways.
- **Auto-reconnect with explanatory UI** — adding/enabling a channel makes the gateway reload and briefly drop the control-UI WebSocket. The app now silently retries with backoff and shows a `ReconnectOverlay` ("the gateway is reloading…") instead of bouncing to the connect screen, then restores the tab you were on. New `src/components/layout/ReconnectOverlay.tsx`; reconnect state in `src/store/connection.ts`.
- **Local LLM engine detection & isolation** — generalized the Ollama-only cron panel to any local engine (Ollama, LM Studio, vLLM, llama.cpp, LocalAI, Jan, KoboldCpp). Engines are discovered from gateway config providers and, on a local gateway, by probing default ports (+ the Ollama `:11435` cron convention). New `src/lib/localEngines.ts` + `src/components/crons/LocalEnginesPanel.tsx`. Architecture notes: [src/lib/LOCAL_ENGINES.md](src/lib/LOCAL_ENGINES.md).

### Changed

- `config.patch` writes that shrink the `bindings` array (unbind agent, delete channel) now pass `replacePaths: ['bindings']`, which the gateway requires for array-entry removal.
- `GatewayView` (Settings) remembers its active tab across remounts, so an auto-reconnect returns you to Channels rather than the Connection tab.
- `ollama:probe` IPC now takes a full health URL (`/api/tags` for Ollama, `/v1/models` for OpenAI-compatible engines) instead of an Ollama base URL.
- Removed the Ollama-specific `OllamaIsolationPanel` from `CronsView.tsx` in favor of the generalized `LocalEnginesPanel`.

### Notes / deferred (see src/lib/LOCAL_ENGINES.md)

- Generalize the Settings "Ollama Endpoints" override card to per-engine URLs (currently Ollama-only).
- Remote-gateway liveness for loopback instances stays `unknown` (would need a gateway-side probe RPC).

## [0.4.0] - 2026-06-10

### Added
- ESLint v10 (flat config) with `@typescript-eslint` and `eslint-plugin-react-hooks`
- `eslint.config.mjs` — TypeScript-aware rules; `react-hooks/rules-of-hooks` is an error, `exhaustive-deps` and unused vars are warnings
- Pre-commit hooks via `simple-git-hooks`: runs `lint → type-check → tests` on every commit; reinstalls automatically after `npm install`
- `lint` and `type-check` npm scripts
- `@vitest/coverage-v8` for coverage reporting (`npm test -- --coverage`)
- New test file `src/lib/__tests__/process.test.ts` — full coverage for `processParser`, `processCompiler`, and `processTemplate`
- Expanded `src/lib/__tests__/team.test.ts` — additional branch coverage across blueprint, compiler, and validation
- `coverage/` added to `.gitignore`

### Changed
- Test count: 59 → 138
- Statement coverage: 81.98% → 97.22%
- Branch coverage: 61.59% → 90.20%
- Function coverage: 94.64% → 100%

## [0.3.0] - 2026-06-09

### Added
- **Teams** — new Teams tab for composing and running multi-agent team workflows
- `TeamBlueprint` (`.team.json`) as the durable source of truth for team definitions; compiled `.md` is a derived artifact
- Native conditional branching in the blueprint (`routes`, `TeamRoute`, `TeamBranch`) with a visual route editor in the Build tab
- Skip-style branch routing — a route can jump over intermediate members; validation uses forward reachability (BFS) instead of raw edge counts
- Decision nodes in compiled graphs reuse the `handoff` type with multiple conditional outgoing edges — no new runtime node types needed
- Revision history for teams — every blueprint save and graph-tab save appends a snapshot (capped at 20); visible in the History tab
- Graph-tab saves are durable: appends revision, persists blueprint + revision file atomically, shows an error banner on failure
- Launch validation (`validateTeamForLaunch`) checks controller, members, route references, graph reachability, and smoke-tests the runtime compile path
- Export / import teams as `.team.json` bundles; import preserves compiled graph snapshot when present
- Dashboard Teams section — shows running/recent team runs with live status
- Chat input draft persistence — unsent text and attachments are saved per conversation and restored on return
- New app icons across all platforms (Linux, macOS, Windows, iOS, Android); tray icon updated
- `src/lib/TEAMS.md` — architecture reference for the team/process-builder source-of-truth boundary
- Process-builder skill updated to distinguish team-compiled process files from standalone process files

### Changed
- NavRail now includes a dedicated Teams entry (`UsersRound` icon)
- `saveCompiledDef` appends a revision snapshot and persists both blueprint and revision file before updating in-memory state
- Graph-tab save failure is now visible (error banner) rather than silent
- Revision list uses stable index keys to avoid duplicates when graph edits share a blueprint version number

### Fixed
- `computeRevisionSummary` now detects graph-edit and blueprint-regeneration transitions
- Process-builder skill validation checklist clarified: incoming-edge rule applies to standalone processes only; team branching graphs with skip routes are exempt

## [0.2.0] - 2026-06-08

### Added
- macOS universal DMG build (Intel + Apple Silicon) via GitHub Actions
- Unsigned — see README for first-launch instructions

### Changed
- GitHub Actions workflow now builds Linux DEB and macOS DMG in parallel

## [0.1.0] - 2026-06-08

First public release.

### Added

**Chat**
- Streaming assistant responses with reasoning block (auto-expands while streaming, collapses on completion)
- Tool call visibility with per-call status, duration, and expandable input/output
- Inline image, video, and audio rendering via markdown link syntax
- Audio player with format badge and source icons (Obsidian vault, Google Drive, Dropbox, remote)
- Image attachment support — paste, drag-drop, or file picker; images forwarded to vision models
- Voice recording input
- Message feedback (thumbs up / down) — persisted to `~/.openclaw/feedback/feedback.jsonl`; thumbs-down writes a memory note the agent reads next session
- Smooth scroll that tracks text streaming, tool call additions, and reasoning updates
- Instant jump to bottom on conversation load (no animation)
- `/compact` slash command for context compaction

**Dashboard**
- Quick-send card with agent picker (fixed dropdown clipping in scroll containers)
- Recent conversations list with last message preview
- Live system metrics panel (CPU, RAM, GPU via `systeminformation` + Ollama API)

**Agents**
- Agent grid with model, emoji, session count, and last-active time
- Subagent relationship display

**Sessions**
- Sortable, filterable session table
- Load any past session into chat for replay

**CRON Jobs**
- Job list with schedule description, model, last/next run time, and run history
- Inline run history with status, duration, token usage, and link to conversation
- **Ollama Isolation panel** — detects both Ollama instances (`:11434` main, `:11435` CRON), shows architecture diagram and contention warning, auto-expands when setup is needed

**Processes**
- Visual process graph builder with node types (agent turns, conditions, loops)
- Live execution monitor

**Models**
- Provider management (Ollama, OpenAI, Google, and more)
- Per-model token usage and cost tracking across sessions and CRON runs
- Model picker with live Ollama VRAM status

**Gateway Config**
- Monaco JSON editor for `openclaw.json`
- Gateway start/stop/restart controls
- Live Ollama model list with loaded status and VRAM usage

**Obsidian Integration**
- Vault detection and setup wizard
- File browser and graph view
- Memory panel

**Settings**
- Dark / light / custom themes with full CSS variable control
- Icon family selection (Lucide default)
- Status bar configuration

**Infrastructure**
- Linux `.deb` packaging via electron-builder
- GitHub Actions CI — builds and releases on version bump to `main`
- Ollama CRON isolation skill (`~/.openclaw/skills/ollama-cron-isolation/SKILL.md`)
- Updated `display-media` skill with audio player syntax and source badge documentation
