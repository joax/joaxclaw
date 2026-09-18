# PRD 01: Shared UI groundwork

| | |
|---|---|
| **Status** | Draft for approval · 18 Sep 2026 |
| **Owner** | PM A |
| **Plan section** | "Shared groundwork, done once at the start of Phase 1" (feature plan, build step 1) |
| **Baseline** | `main` @ 374064e (0.26.1 + #77) · gateway OpenClaw 2026.9.4 |
| **Depends on** | nothing |
| **Depended on by** | 02 Gateway updates, 03 Background tasks, 04 Chat goals, and PM B's 05–08 |
| **Effort** | S–M (about 2 days), in 2 PRs |

This is a technical PRD. It has no visible change of its own. Its job is to pin down **exactly** which shared pieces PRDs 02–08 may import, with their props and behaviour, so that four features built in parallel end up looking like one app.

---

## 1. Summary

**Problem.** Every feature in the 2026.9 plan needs a popover, a card, a pill, an empty state, a strip or a "does this gateway have it?" check. Today each of those exists only as a private copy inside one view. Some of the copies have already drifted apart:

- The plan's state-colour rule is accent = working, amber = needs you, red = failed, green = done. The code breaks it in three places:
  - `ScriptJobDock` colours a *running* script amber (`src/components/chat/ScriptJobDock.tsx:118`).
  - The Sessions table colours *running* green (`src/components/sessions/SessionsView.tsx:53`).
  - The chat list's running dot is green (`src/components/chat/ChatView.tsx:823`).
- ScriptJobDock and ScriptJobCard draw their own 3px bar (`ScriptJobDock.tsx:174-178`, `ScriptJobCard.tsx:74-78`) instead of the one `ProgressTrack`.
- The bottom sheet is copied twice (`layout/BottomNav.tsx:77-96`, `monitor/SystemMonitorHUD.tsx:207-215`).

**Outcome.** One `components/ui/` kit that 02–08 import. Moving code into it changes nothing visible. One pure `stateTone` mapping for state colours. Two new capability checks, `gatewayClient.hasMethod()` and `hasEvent()`.

**Solution.** Move the private primitives into `components/ui/` without changing how they look. Add a shared `Strip` (with a `StripBar` that keeps one strip open at a time and becomes a chip row on a phone), built from ProgressCardDock's layout. Move ProgressCardDock onto it as the proof. Add `hasMethod`/`hasEvent` on top of the `features` list hello-ok already gives us. Add an "expected restart" hook so the reconnect overlay can say *why* the gateway went away. PRD 02 (updates) and PM B's plugin catalog both need that.

## 2. Background and evidence

### 2.1 What exists today (as built)

| Piece | Where it lives now | Notes |
|---|---|---|
| `useClickOutside`, `triggerStyle`, `menuStyle` | `chat/ChatHeaderControls.tsx:14-39` | `menuStyle` is right-anchored, `zIndex:100`, `minWidth:220`, `maxHeight:320` |
| `MenuRow` | `chat/ChatHeaderControls.tsx:197-214` | checkmark when `selected`; hover background is `--bg-primary` |
| `CheckRow` | `chat/ChatHeaderControls.tsx:279-303` | used by DisplayMenu |
| `Section` | `settings/SettingsView.tsx:302-311` | surface card, uppercase 12px header, `p-4` body |
| `Toggle` | `settings/SettingsView.tsx:336-366` | `role="switch"`, 46×26 on a phone, 36×20 on desktop |
| `Card` | `gateway/GatewayView.tsx:508-517` | like Section, but the header sits on `--bg-elevated` with `p-3` |
| `EmptyState` | `extensions/ExtensionsView.tsx:389-396` | icon is hard-coded to `Puzzle`, 36px at opacity .3 |
| `TriggerChip`, `KeyStatusBadge` | `extensions/ExtensionsView.tsx:365-371, 463-479` | pills with 12–13% tints, radius 999, 10px text |
| `FilterTab` | `chat/ChatView.tsx:775-789` | pill tab with an optional `· count` |
| `Overlay` | `gateway/ChannelsPanel.tsx:905-935` | modal at z-40/50, Escape closes it; no `role="dialog"` |
| `CopyBtn` | `gateway/DevicesPanel.tsx:38-49` | copy icon that turns into a check for 1.2 s |
| Bottom sheet | `layout/BottomNav.tsx:77-96`, `monitor/SystemMonitorHUD.tsx:207-215` | `animate-slide-up`, drag handle, z 60/61, safe-area padding |
| Drawer sizing | `files/FileDrawer.tsx:17, 45-64` | 380px `<aside>`; `position:fixed; inset:0` on a phone |
| One-line strip | `chat/ProgressCardDock.tsx:28-71` | chevron · label · headline · `ProgressTrack` · mono count |

Capability data is already on the client, just not exposed:

- `GatewayClient.features` is **private** (`src/lib/gateway.ts:130`). It is filled from hello-ok at `gateway.ts:349` and cleared on every new socket (`gateway.ts:206`).
- `supports(capability)` is public (`gateway.ts:530-532`).
- `advertisesMethod()` exists but is tri-state (`src/lib/gatewayPolicy.ts:44-48`). It returns `undefined` when there is no list.
- The gateway builds `features.methods` from every core method whose spec isn't marked `advertise:false`, plus every plugin method (`dist/method-scopes-tKV11oMS.mjs` `listCoreAdvertisedGatewayMethodNames`; `dist/server-plugins-BgRb-rux.mjs`).
- The 23 methods marked `advertise:false` include `sessions.get`, `push.web.*` and `chat.inject`. None of the `tasks.*`, `taskSuggestions.*`, `update.*` or `sessions.goal.*` methods is marked `advertise:false`, so for those an **absent entry reliably means "not supported"**.
- `features.events` is built from `GATEWAY_EVENTS` (`dist/server-methods-list-Bm-R-rqW.mjs`), which includes `task`, `task.suggestion`, `update.available`, `update.run.changed` and `progressCard.changed`.

The reconnect overlay has one hard-coded explanation, "reloading to apply your change — this happens after adding or enabling a channel" (`layout/ReconnectOverlay.tsx:37-41`). It gives up after `RECONNECT_MAX_ATTEMPTS = 12` with a 5 s backoff cap (`store/connection.ts:20, 315`), so about 52 s in total. A gateway update or a plugin install can take longer than that (see PRD 02 §2.2).

### 2.2 Prior art
Design systems such as Radix and Headless UI settle on the same small set of primitives: popover, dialog, sheet and switch, each with focus management built in. Moving these pieces into one place is how their keyboard behaviour gets fixed once. `Overlay` and the popovers have no focus trap or `aria-*` today.

## 3. Goals / Non-goals

**Goals**
- G1. Extract the listed primitives with pixel-identical output at their current call sites.
- G2. Give later PRDs a stable, documented API: `Popover`/`MenuRow`, `Card`/`Section`, `Toggle`, `EmptyState`, `Pill`, `FilterTab`, `Overlay`, `BottomSheet`, `SidePanel`, `CommandHint`, `Strip`/`StripBar`.
- G3. Define state colours once (`lib/stateTone.ts`).
- G4. `gatewayClient.hasMethod(name)` / `hasEvent(name)`, plus a React hook that re-evaluates on reconnect.
- G5. `expectRestart()` on the connection store, so the reconnect overlay can say why the gateway went away and wait long enough for it to come back.

**Non-goals**
- Recolouring the Sessions table or the chat-list running dot. That is flagged in §11 and left to the owner. 03 recolours only what it replaces.
- Moving `ContextBar` onto `Strip`. It is a multi-field row that wraps, it has no expanded body, and it only appears when Display → Context is on (`ChatView.tsx:623-625`). §11 has this as an open question.
- Any new visual pattern.

## 4. Users and jobs

- *As an engineer on 02–08*, I import one popover, one pill and one strip, and the result already matches the app.
- *As the owner*, I see the same pill mean the same thing in the chat, the drawer, the Dashboard and the tray.

## 5. UX specification

There is no new screen. Two behaviours are new and user-visible once later PRDs use them:

**Strip coordination (desktop).** Strips inside one `StripBar` open in place. Opening one closes whichever other strip is open. A strip whose feature has nothing to show renders nothing (hidden when empty).

```
┌─ Chat header ───────────────────────────────────────────────────────────────┐
├─────────────────────────────────────────────────────────────────────────────┤
│ Context 20,135 / 232,000 tokens  ▬▬▬───── 9%        (ContextBar, unchanged) │
├─────────────────────────────────────────────────────────────────────────────┤
│ ›  Progress   Compare the three pricing pages      ▬▬▬▬▬▬───────  2/3      │  Strip
├─────────────────────────────────────────────────────────────────────────────┤
│ ⌄  Background 2 running · 1 needs you                           ● ● ●      │  Strip (open)
│    …body rendered in place, max-height 40vh, scrolls…                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                              message thread                                  │
```

**Strip coordination (phone, <768px).** The same strips collapse into **one** horizontal chip row under the header. Tapping a chip opens that strip's body in a `BottomSheet`. The row hides when no strip has anything to show.

```
┌──────────────────────────────────────┐
│ ←  🤖 Pricing research      📁  ⚙    │  header row 1
│ [qwen3.6 ▾] [Adaptive ▾] [◎ Goal]   │  header row 2
├──────────────────────────────────────┤
│ (Plan 2/3) (Background 2 · 1 ⚠)  →  │  StripBar chip row, scrolls sideways
├──────────────────────────────────────┤
│              thread                  │
└──────────────────────────────────────┘
tap "Background" ↓
┌──────────────────────────────────────┐
│               ───                    │  drag handle
│  Background                    ✕     │
│  …strip body…                        │
└──────────────────────────────────────┘
```

**Expected restart.** When a flow calls `expectRestart({ reason, detail })` just before an action that restarts the gateway, the overlay shows that reason as its heading and detail line instead of the channel text. It keeps retrying for up to `untilMs` (default 5 min) instead of about 52 s.

### Copy

| Key | String |
|---|---|
| Overlay heading (default, unchanged) | "Reconnecting to gateway…" |
| Overlay body (default, unchanged) | "The gateway is reloading to apply your change — this happens after adding or enabling a channel. It usually comes back in a few seconds. Hang tight; we'll reconnect automatically." |
| Overlay heading (expected restart) | `reason`, from the caller, e.g. "Gateway is updating" (PRD 02) |
| Overlay body (expected restart) | `detail`, from the caller |
| `CommandHint` lead-in | "On the gateway host, run" |
| `CommandHint` copy button title | "Copy command" / "Copied" |
| `BottomSheet` close button aria-label | "Close" |
| Strip chevron title | "Show {label}" / "Hide {label}" |

### Keyboard and accessibility (applies to every consumer)
- `Popover`:
  - The trigger has `aria-haspopup="menu"` and `aria-expanded`.
  - Escape closes it and returns focus to the trigger.
  - Arrow Up/Down move between `MenuRow`s (`role="menuitem"`, or `menuitemradio` when `selected` is set).
- `Overlay` and `BottomSheet`:
  - They are `role="dialog"`, `aria-modal="true"`, and labelled by their title.
  - Focus moves to the first focusable element and is trapped inside.
  - Escape closes them.
  - The backdrop click keeps working.
- `Strip`: its button has `aria-expanded` and `aria-controls` pointing at the body id. The phone chip has the same.
- `Toggle`: keeps `role="switch"` and `aria-checked`, and gains `disabled`.
- Motion: `animate-slide-up` already honours `prefers-reduced-motion` (`src/index.css:121`). `animate-pulse-dot` and `animate-spin` do not. Add a reduced-motion rule for `.animate-pulse-dot` and `.animate-pulse` (the running dots and the indeterminate `ProgressTrack`). Leave spinners alone; they carry meaning.

## 6. Design-book conformance

| Rule | How 01 meets it |
|---|---|
| Tokens only, never hard-coded colours | Every extracted primitive already uses `var(--…)`. The one exception is `Toggle`'s white knob (`#fff`), which becomes `var(--accent-fg)`. |
| Tints via `color-mix` at 8–22% | `Pill` fixes the tint at **13%**, which is `KeyStatusBadge`'s value (`ExtensionsView.tsx:466`). The existing pills use 12%, 13% and 15%. |
| One bar | `Strip` takes an optional `track` and renders `ProgressTrack` (`ui/ProgressTrack.tsx`). No component may draw its own bar. |
| One set of state colours | `lib/stateTone.ts` (§8.2) is the only place that maps a state to a colour. |
| No toasts | Nothing is added. `CommandHint` gives inline feedback (the "Copied" check). |
| Strips: one line, open in place, hidden when empty, one open at a time, chips on a phone | `StripBar` enforces all five. |
| Dialogs above a transformed panel render as siblings (#74) | `Overlay` and `BottomSheet` render through a portal to `document.body`. |
| **New pattern introduced** | **The phone strip chip row.** The plan requires it (integration rule 2), but nothing in the app does it yet: ProgressCardDock renders a full-width strip on a phone today. It is built from existing pieces (`FilterTab`'s pill shape plus `BottomSheet`). |

## 7. Functional requirements

**FR-1 Extraction with no visual change.** Given each current call site, when it switches to the `ui/` import, then its rendered DOM styles are identical. The manual check is side-by-side screenshots of: the chat header menus, Settings sections and toggles, Gateway cards, the Extensions empty list, the Channels add dialog, the chat-list filter, and the phone More sheet.

**FR-2 `hasMethod`.**
- Given hello-ok listed `tasks.list`, when `gatewayClient.hasMethod('tasks.list')` is called, then it returns `true`.
- Given the method was absent from the list, or a call this connection made came back "unknown method", then it returns `false`.
- Given no hello-ok list at all (a pre-2026.7 gateway), then it returns `false`.
- It is reset on every new socket, as `features` already is.

**FR-3 `hasEvent`.** Same rules, against `features.events`.

**FR-4 Reactive gating.** Given a component uses `useGatewaySupport({ methods: ['tasks.list'] })`, when the app reconnects to a different or upgraded gateway, then the component re-renders with the new answer. Implementation: the connection store exposes `connectionSeq` and the hook subscribes to it.

**FR-5 StripBar exclusivity.** Given two strips in one `StripBar`, when strip B opens, then strip A closes. When the chat changes (the `StripBar` is keyed by conversation id), then all strips close.

**FR-6 Hidden when empty.** Given a strip gets `visible={false}`, then it renders nothing. On a phone its chip also disappears, and the whole chip row disappears when no chip is visible.

**FR-7 Phone presentation.** Given `useIsNarrow()` is true, when the user taps a chip, then the strip's `body` opens in a `BottomSheet` titled with the strip's label. Nothing expands in place.

**FR-8 ProgressCardDock on Strip.** Given a session with a progress card, then the dock renders through `Strip` with the same label, headline, track and count as today, and opens in place on desktop.

**FR-9 Expected restart.**
- Given a caller ran `expectRestart({ reason, detail, untilMs, windowMs })`, when the socket drops within `windowMs` of that call (default 2 minutes), then the overlay shows `reason`/`detail`. Reconnect attempts continue until `untilMs` has passed (backoff capped at 5 s) instead of stopping at 12.
- Given a successful reconnect, or a manual "Stop trying", then the expectation clears.
- Given no drop within `windowMs`, then the expectation lapses.
- Given a caller runs `expectRestart` again (for example, PRD 02 re-arms it when an update reaches its `activating` phase), then the newer expectation replaces the older one.

**FR-10 CommandHint.** Given `CommandHint command="openclaw update"`, then it renders the lead-in text, the command in mono on `--bg-primary`, and a copy button. After a click the button shows a success check for 1.2 s.

## 8. Technical design

### 8.1 New and changed files

| Path | New/changed | Exports (the contract later PRDs rely on) |
|---|---|---|
| `src/components/ui/Popover.tsx` | new | `useClickOutside(onClose)`, `triggerStyle`, `menuStyle`, `Popover({ trigger, open, onOpenChange, align?: 'left'｜'right', width?, sheetOnNarrow?: boolean, title?, children })`, `MenuRow({ selected?, danger?, disabled?, icon?, onClick, children })`, `CheckRow`, `MenuHeading({children})`, `MenuDivider()` |
| `src/components/ui/Card.tsx` | new | `Card({ title, action?, children })` (GatewayView style), `Section({ title, children })` (SettingsView style) |
| `src/components/ui/Toggle.tsx` | new | `Toggle({ label, value, onChange, disabled?, description? })` |
| `src/components/ui/EmptyState.tsx` | new | `EmptyState({ icon: LucideIcon, label, hint?, compact? })`. `compact` means a 20px icon and `py-4`, for strips and the drawer. |
| `src/components/ui/Pill.tsx` | new | `Pill({ tone: StateTone ｜ 'neutral', icon?, children, title? })` |
| `src/components/ui/FilterTab.tsx` | new | `FilterTab({ label, count?, active, onClick })` |
| `src/components/ui/Overlay.tsx` | new | `Overlay({ title, width, headerColor?, onClose, footer?, children })`, portalled |
| `src/components/ui/BottomSheet.tsx` | new | `BottomSheet({ title?, onClose, children, maxHeight? = '80vh' })`, portalled, z 60/61 |
| `src/components/ui/SidePanel.tsx` | new | `SidePanel({ open, expanded, onClose, label, children })`. It carries FileDrawer's sizing: 380px, `position:fixed; inset:0` on a phone, full width when expanded, the same left shadow. |
| `src/components/ui/CommandHint.tsx` | new | `CommandHint({ command, lead? })`, plus a `CopyButton({ value })` extracted from DevicesPanel |
| `src/components/ui/Strip.tsx` | new | `StripBar({ children })`, `Strip({ id, visible, label, headline, tone?, track?: { pct: number｜null }, count?, trailing?, body?, chipLabel? })` |
| `src/lib/stateTone.ts` | new | `type StateTone = 'working'｜'needsYou'｜'failed'｜'done'｜'idle'`, `toneColor(t)`, `toneTint(t, pct = 13)` |
| `src/lib/gatewayPolicy.ts` | changed | `supportsMethod(features, unsupported, name): boolean`, `supportsEvent(features, name): boolean` (pure, tested) |
| `src/lib/gateway.ts` | changed | `hasMethod(name)`, `hasEvent(name)`. The private `features` stays private. |
| `src/lib/useGatewaySupport.ts` | new | `useGatewaySupport({ methods?, events?, capabilities?, scope? }) → { supported: boolean, admin: boolean }` |
| `src/store/connection.ts` | changed | adds `connectionSeq: number` (mirrored from `gatewayClient` on connect), `restartExpectation: { reason, detail?, untilMs, setAtMs } ｜ null`, `expectRestart(reason: string ｜ { reason, detail?, untilMs?, windowMs? })`, `clearRestartExpectation()` |
| `src/components/layout/ReconnectOverlay.tsx` | changed | reads `restartExpectation`, keeps the attempt counter but shows "until {time}" instead of "/12" |
| Call sites | changed | ChatHeaderControls, SettingsView, GatewayView, ExtensionsView, ChatView (FilterTab), ChannelsPanel, DevicesPanel, BottomNav, SystemMonitorHUD, FileDrawer, ProgressCardDock |

`Strip` visual spec, taken from `ProgressCardDock.tsx:29-53`:
- Row: `px-4 py-2 text-xs`, `--bg-elevated`, bottom border, gap 12px.
- Chevron: 12px, `--text-secondary`, rotates 90° when open, hidden when there is no `body`.
- Label: `--text-secondary`, no shrink. Headline: `--text-primary`, truncates.
- Track: `ProgressTrack` in a `flex: 0 1 160px; min-width:80px` slot, coloured by `toneColor(tone)`.
- Count: mono, same colour.
- `trailing`: an optional node such as state pips or a pill.
- Body: `px-4 pb-3`, `max-height:40vh`, scrolls.

The phone chip is `FilterTab`'s shape (radius 999, `3px 10px`, 12px text), tinted by `tone`, showing `chipLabel ?? label` and the count.

### 8.2 `stateTone`

```ts
// The one mapping from a state to a colour. Accent = working, warning = needs you,
// danger = failed, success = done. Every pill, strip, dot and tray label uses it.
toneColor('working')  → 'var(--accent)'
toneColor('needsYou') → 'var(--warning)'
toneColor('failed')   → 'var(--danger)'
toneColor('done')     → 'var(--success)'
toneColor('idle')     → 'var(--text-secondary)'
```

PRDs 02–04 each map their own domain states onto these five in their own pure lib (`lib/tasks.ts`, `lib/goals.ts`, `lib/gatewayUpdate.ts`). They never pick colours directly.

### 8.3 `hasMethod`

```ts
// gatewayPolicy.ts (pure)
export function supportsMethod(f: GatewayFeatures | undefined, unsupported: ReadonlySet<string>, m: string): boolean {
  if (unsupported.has(m)) return false
  return advertisesMethod(f, m) === true      // undefined (no list) counts as "no"
}
```

This deliberately differs from `clientSideGate`, which lets unknown methods be *tried* (`gatewayPolicy.ts:67-76`). `hasMethod` answers "should I show this feature?", and a feature is only shown when the gateway says it has it (integration rule 4). Only use it for methods that are advertised. For the few `advertise:false` methods (`sessions.get`, `push.web.*`), keep today's try-and-cache approach.

### 8.4 Expected restart
**Coordination with PRD 06.** PM B's plugin-catalog PRD (06 §8) independently describes `expectRestart(reason: string)` plus a `restartReason` field. This PRD is the one place it gets built. For compatibility, the signature accepts both forms: `expectRestart(reason: string | { reason, detail?, untilMs?, windowMs? })`, where a plain string means `{ reason }` with the defaults. 06 needs no change beyond importing it from here.

Only `ReconnectOverlay` and the reconnect scheduler read it. The scheduler (`store/connection.ts:297-322`) currently stops after `RECONNECT_MAX_ATTEMPTS`. With an active expectation it keeps going until `untilMs`. The overlay still offers "Stop trying & connect manually" (`ReconnectOverlay.tsx:60-62`).

### 8.5 Error handling, performance, migration
- Error handling: nothing new.
- Performance: portals mount only while open. `useGatewaySupport` reads synchronously from the client. There is no polling.
- Migration: none. No persisted state changes.

## 9. Test plan

**Unit tests** (`src/lib/__tests__/`, the only folder vitest includes):
- `gatewayPolicy.test.ts`, extended:
  - `supportsMethod`: listed → true; unlisted → false; `features` undefined → false; empty list → false; listed but cached as unknown → false.
  - `supportsEvent`: the same cases.
- `stateTone.test.ts`: all five tones map to their token; `toneTint` builds `color-mix(in srgb, var(--accent) 13%, transparent)`; an unknown value falls back to `idle`.
- `stripBar.test.ts` for the pure reducer `nextOpenStrip(current, toggledId)`: opening A from nothing gives A; opening B while A is open gives B; toggling A while A is open gives null; hiding the open strip gives null.
- `restartExpectation.test.ts` for the pure `shouldKeepReconnecting({ attempt, max, expectation, droppedAtMs, now })`: no expectation stops at 12; with an expectation it continues until `untilMs`; a drop later than `setAtMs + windowMs` ignores the expectation; re-arming replaces the old one.

**Manual QA**
1. Open every refactored screen on desktop and at 390px wide, and compare against screenshots taken on `main`.
2. Keyboard only:
   - Open the model menu with Enter, move with the arrow keys, close with Escape, and check that focus returns to the trigger.
   - Tab through the Channels add dialog and check that focus stays trapped inside it.
3. With a progress card showing, check the Progress strip is unchanged. On a phone, check it appears as a chip that opens a sheet.
4. Call `useConnectionStore.getState().expectRestart({reason:'Test', detail:'x', untilMs: Date.now()+120000})` from devtools, then stop the gateway for 90 s. Check that the overlay shows "Test" and reconnects instead of falling back to the connect screen.
5. Connect to a 2026.8 gateway and check that `gatewayClient.hasMethod('tasks.history')` is false and `hasMethod('tasks.list')` is true.

## 10. Rollout
Ships alone, behind no flag. Nothing to gate: it adds no gateway calls. Works on any gateway version.

## 11. Risks and open questions

| # | Item | Needs owner? |
|---|---|---|
| R1 | Moving the code can shift pixels, especially the `Toggle` knob colour and `Overlay` z-index once it's portalled. The screenshot pass in QA step 1 covers it. | no |
| Q1 | **Running colour elsewhere.** The Sessions table and the chat-list dot show "running" in green (`SessionsView.tsx:53`, `ChatView.tsx:823`), and the Dashboard's Active section uses accent. The plan's rule says accent. Should we recolour those two in 01 (small, but a visible change) or leave them? **Recommendation: recolour in 01, so that 03's pills and the chat list agree.** | **yes** |
| Q2 | **ContextBar on a phone.** It isn't a strip (it wraps and has no body). On a phone, should it become a "Context 9%" chip in the strip row (plan rule), or stay as its own row? **Recommendation: a chip, in a follow-up.** It's off by default, because it only shows with Display → Advanced → Context. | yes |
| R2 | `hasMethod` returns false for a plugin method the gateway only registers after startup. Plugin methods are included in hello-ok (`server-plugins-BgRb-rux.mjs`), so this only matters for hot-installed plugins, and reconnecting fixes it. | no |

## 12. Milestones

| PR | Contents | Size |
|---|---|---|
| 01-a | `ui/` extractions (Popover, Card/Section, Toggle, EmptyState, Pill, FilterTab, Overlay, BottomSheet, SidePanel, CommandHint), `stateTone`, call-site swaps, reduced-motion CSS | M |
| 01-b | `Strip`/`StripBar` + ProgressCardDock on Strip, `hasMethod`/`hasEvent`/`useGatewaySupport`, `connectionSeq` + `expectRestart` + overlay | S–M |
