# PRD 08: Skills library (team skills)

> **Status:** Draft for owner approval, **with a blocking finding** · **Author:** PM B · **Date:** 2026-09-18
> **Phase:** 3 (build step 7) · **Effort:** S spike, then M (2–3 days) if the spike passes
> **Gateway:** `skills.library.*` since 2026.8 (read: `operator.read`; save/mutate/import/upload/activate: `operator.write`).
> **Depends on:** [01-shared-groundwork](01-shared-groundwork.md): `Popover` + `MenuRow`, `Pill`, `Toggle`, `EmptyState`, `hasMethod()`. [06-plugin-catalog](06-plugin-catalog.md) is not required.
> **Decision already made:** single-user gateway. Team skills only, nothing about profiles in the UI, and mentions deferred.

---

## 0. The finding that decides this PRD (read first)

**As JoaxClaw connects today, it can't create, edit, import, enable, disable, roll back or transfer any library skill, team or personal.** It can only list and read them, and (on an admin connection) attach existing ones to a chat.

Why, verified in the gateway source:

1. **Every write needs a Gateway profile.**
   - `saveSkillLibrary`, `mutateSkillLibrary`, `importSkillLibrary` and `uploadSkillLibrary` all call `requireSkillLibraryProfile` first (`dist/skills-library-0dDcYsl-.mjs`).
   - That function throws `SKILL_LIBRARY_IDENTITY_REQUIRED`: "Sign in with a durable Gateway profile to use a personal skill library. Shared-token administrators can use workspace skills." when there's no profile (`dist/selection-DjBjJdzP.mjs`).
   - `resolveSkillLibraryActor` sets `write: Boolean(profile) && permits("operator.write")`. Admin scope doesn't help.
2. **Team skills can only be made by transferring a personal one.**
   - `save` always inserts `owner_profile_id: <actor>, shared: 0`.
   - `mutate { action: "transfer" }` sets `owner_profile_id = null` and needs admin: "Transfer to team ownership requires a Gateway administrator."
   - So even a team skill starts life under a profile.
3. **JoaxClaw gets no profile.**
   - The gateway gives shared-token and password operators the built-in `gateway-owner` profile only when the client isn't "ephemeral": `ownerProfileExpected = shouldTrackPresence && shouldUseGatewayOwnerProfile(…)`, where `shouldTrackPresence = !isEphemeralGatewayClient(client)` (`dist/message-handler-BBAGn2rf.mjs`, `dist/github-user-identity-D1LIz6kl.mjs`).
   - Ephemeral means mode `cli`, `backend` or `probe` (`dist/message-channel-MQsF-tJM.mjs`).
   - **JoaxClaw connects as `clientId: 'gateway-client'`, `mode: 'backend'`** (`src/lib/gateway.ts:285–286`). That's why it's profile-less.
   - OpenClaw's own Control UI, on the same shared token, *does* get `gateway-owner`, which is why the library works there.
4. **New chats don't pick up library skills either.** Default selections are seeded only when the session's creator has a profile (`seedSkillLibrarySelection`: `if (!authority.profileId) return []`). A chat started from JoaxClaw starts with no library skills, even enabled team ones.

What does work without a profile:
- `skills.library.list` / `read` (read scope). An admin sees every entry; others see team-owned and shared entries.
- `skills.library.activate` attach, detach and refresh on a session, for an **admin** connection (session authorisation is bypassed for admins; attach only needs read visibility).
- Caveat: if `gateway.roles` is configured, a profile-less caller gets an empty role ceiling, so it can't even read.

**Recommendation.**
- **Step 1, a spike (S, ½–1 day):** switch JoaxClaw's connect mode from `backend` to `ui`, a non-ephemeral mode, so a token connection receives `gateway-owner`. Run the regression checks in 8.5.
- If the spike passes, build the library as specified below. "Create" publishes, then immediately transfers to Team, so the UI only ever says "Team" (the owner's decision).
- **If the spike fails, or the owner rejects the mode change, don't build the library.** As built it would be a read-only list with nothing in it and no way to add to it. Keep investing in the on-disk skills in Extensions → Skills. Notably, the gateway itself steers a single admin to "workspace" (on-disk) skills: `defaultTarget` is `"workspace"` for an admin unless several profiles exist (`resolveSkillLibraryPresentation`).

The rest of this document specifies the full feature, assuming the spike passes, and notes what changes if it doesn't.

---

## 1. Summary

**Problem.** Skills today are files on the gateway host (`~/.openclaw/skills/<slug>/`), managed in Extensions → Skills.
- They have no history: editing one overwrites it.
- They apply to every agent that loads them. There's no way to give one chat a particular skill, or a particular version of it.
- Remote editing is weak: `SkillMdModal` reads the file from *local* disk (`ExtensionsView.tsx:400–412`), so it doesn't work against a remote gateway.

**Outcome.**
- A **Library** segment next to Installed skills: versioned team skills, each with revisions you can restore, an on/off switch for new chats, an editor that detects conflicting edits, and import from ClawHub.
- A **Skills for this chat** popover, opened from a chip above the composer, that attaches or detaches library skills for one chat, pinned to a revision.

**Solution.**
- A `store/skillLibrary.ts` over `skills.library.list/read/save/mutate/import/activate`.
- A pure `lib/skillLibrary.ts` for parsing, error mapping and the revision label.
- The existing `SkillMdModal` is refactored to take its content from a source (a local file today, a library revision now), so viewing a library skill reuses it.
- The composer chip sits in the existing chip row above the input, where the "Sharing your profile" chip lives (`MessageInput.tsx:335–354`).
- Everything is gated on `hasMethod('skills.library.list')` and on the list result's `profileId` (non-null after the mode change).

---

## 2. Background and evidence

### 2.1 How the app behaves today

| Area | Evidence | Implication |
|---|---|---|
| Skills tab | `ExtensionsView.tsx:17,209–221`: `Tab = 'skills' \| 'plugins'`. The Skills tab shows `AppSkillsCard`, then the Active/Off `Group`s of `ExtRow`s. Data comes from `config.get` + `skills.status` (`store/extensions.ts:141–170`). | The Library becomes a sub-segment inside the Skills tab. |
| Browse | `SkillBrowser` (`components/extensions/SkillBrowser.tsx`) → `skills.search` / `skills.install` (installs to disk), using `installRef`, not `slug` (`lib/skillCatalog.ts:9–17`) | "Import to library" reuses the search, but the import takes `source: { kind: "clawhub", slug }` (8.3). |
| App-managed skills | `JOAXCLAW_MANAGED_SKILLS` (`lib/skillCatalog.ts:32–37`): ask-user, script-runner, teams-blueprint, process-builder, installed on connect (`App.tsx:175–178`) | They stay on disk. The library must not shadow their slugs. |
| Viewer | `SkillMdModal` (`ExtensionsView.tsx:400–460`) reads through `window.api.file.read(skill.filePath)`, which is **local disk only** | **Correction to the plan** ("viewing uses the existing SkillMdModal"): it needs a content-source refactor first. |
| Composer chip row | `MessageInput.tsx:335–354`: a pill chip ("Sharing your profile", `UserRound` 11px, `borderRadius: 999`, accent tint when on) above the input box | The skills chip joins this row. |
| Popover | `ChatHeaderControls.tsx` `menuStyle` / `MenuRow` → 01 `Popover` | The popover opens upward from the chip (`bottom: 100%`), like the emoji menu (`MessageInput.tsx:447`). |
| Connect identity | `gateway.ts:285–286` `CLIENT_ID = 'gateway-client'`, `CLIENT_MODE = 'backend'` | The blocking finding (§0). |
| Scopes | `REQUESTED_OPERATOR_SCOPES` and negotiation (`gateway.ts:372–387`); `grantedScopes` | Writes need `operator.write`; transfer needs `operator.admin`. |

### 2.2 What the gateway offers

Scopes come from `dist/method-scopes-tKV11oMS.mjs`. Params come from `dist/skill-library-BROWyxpw.mjs` (`packages/gateway-protocol/src/schema/skill-library.ts`, closed objects). Results come from the handlers in `dist/skills-library-0dDcYsl-.mjs` and `dist/selection-DjBjJdzP.mjs`; there are no TypeBox result schemas.

| Method | Scope | Since | Params → result | Used for |
|---|---|---|---|---|
| `skills.library.list` | read | 2026.8 | `{ sessionKey?, scope?: "mine"\|"team"\|"all" }` → `{ entries: Entry[], profileId\|null, multipleProfiles, defaultTarget: "personal"\|"workspace"\|"unavailable", canManageWorkspace, defaultSelectionLimit: 64, defaultSelectionNotice?, session?: { sessionKey, selections[], attachable: Entry[] } }` | Library list; chat selections |
| `skills.library.read` | read | 2026.8 | `{ skillId, revision?, sessionKey? }` → `{ entry, revisions: [{ revision, createdAt }], content (SKILL.md), files }` | Viewer, editor, revision picker |
| `skills.library.save` | write + **profile** | 2026.8 | `{ skillId?, expectedRevision: <64-hex> \| null, slug, content (≤1 MiB), files?[] }` → receipt | Create / edit |
| `skills.library.mutate` | write + **profile** (transfer: **admin**) | 2026.8 | `{ skillId, expectedRevision, action: share\|unshare\|transfer\|remove\|enable\|disable\|rollback, revision? }` → receipt | Enable/disable, remove, restore revision, make Team |
| `skills.library.import` | write + **profile** | 2026.8 | `{ slug, source: { kind: "clawhub", slug, version? } }` → receipt | Import from ClawHub |
| `skills.library.activate` | write (admin bypasses session auth) | 2026.8 | `{ sessionKey, action: attach\|detach\|refresh, skillId?, revision? }` → `{ sessionKey, selections[], sessionActivation: "next-turn" }` | Skills for this chat |
| `skills.library.upload` | write + **profile** | 2026.8 | begin/chunk/commit (256 KiB chunks) | ZIP upload: **out of scope** |

- **Entry** = `{ skillId (uuid), slug, name (s_<slug>_<hex>), ownerLabel ("Team" when owner null), description, ownerProfileId (null = team), authorProfileId, shared, enabled, removed, revision (64-hex), createdAt, updatedAt, canEdit }`.
- **Receipt** = `{ state: published\|unchanged\|removed, target: team\|personal, entry, sessionActivation: "new-sessions", nextAction }`.

**Errors.** `INVALID_REQUEST` with `details.code = "SKILL_LIBRARY_<CODE>"`, where the code is one of `INVALID_BUNDLE`, `NOT_FOUND`, `CONFLICT` (with `currentRevision`), `NAME_CONFLICT`, `FORBIDDEN`, `IDENTITY_REQUIRED`, `AUTHORITY_EXPIRED`, `POLICY_BLOCKED` or `LIMIT`. Key messages:
- CONFLICT: "Skill changed. Read the current revision and review your edit before saving again."
- A new skill needs `expectedRevision: null`.
- NAME_CONFLICT: `A skill named "<slug>" already exists in this library. Choose a different slug; existing skills were preserved.`
- LIMIT: "A session can select at most 64 library skills."
- Remove: "Removed skills cannot be edited or selected again; pinned revisions remain available to their sessions."
- Unshare on a team skill: FORBIDDEN "Team-owned skills cannot become personal through unshare."
- A literal secret in the bundle throws a plain `Error`, so the client only sees the generic `UNAVAILABLE "Unable to complete the skill library operation. Review the bundle or retry the request."`. The UI must hint at this (5.6).

**Security.** Save, import and upload run `scanProposalBundle`, the literal-secret check, and `evaluateSkillInstallPolicy`. A critical finding returns POLICY_BLOCKED "Skill security scan found critical issues. Review the instructions and support files before publishing.". An install-policy *warning* also blocks, because no acknowledgement path is passed.

**Limits.** 256 files, 1 MiB per file, 8 MiB per bundle, slug `^[a-z0-9][a-z0-9-]{0,62}$`, SKILL.md needs `name` + `description` (≤1024 characters), and 64 selections per session.

**Runtime.**
- Library skills are **never global**. They live only as per-session pins (`sessionEntry.skillLibrarySelections`).
- New sessions created by a profiled client are seeded with enabled own, team and shared skills, up to 64.
- Spawned sub-agents and cron runs inherit the pins.
- Pins load as source `openclaw-library`, and agent allowlists still apply.
- `activate` returns `"next-turn"`, so a reply that is already running keeps the old revision.

**Events.** There are none for the library. The only skills event is `skills.changed` (the on-disk watcher). The store refreshes after its own writes and on reconnect.

### 2.3 How the Control UI does it

**Skills page** (`dist/control-ui/assets/skills-page-*.js`; strings under `skillLibrary`):
- Segments "My skills" (only with a profile), "Team", "All libraries", "Agent & workspace". A single admin defaults to "Agent & workspace" (on-disk).
- Actions:
  - "Create skill", "Import skill"
  - Enable/Disable
  - "Share with team" / "Make private"
  - "Transfer to team" ("Transfer {slug} to team ownership? Team administrators will manage it.")
  - "Remove skill"
  - "Restore revision" with a "Retained revision" select
- Conflict copy: "This skill changed since you opened it. Your draft is preserved. Copy your changes, then close and reopen the skill to review the current revision before saving."
- Without a profile: "Sign in with a Gateway profile to create personal skills. Administrators can still create skills in the selected agent workspace." ZIP and ClawHub import are blocked.

**Chat capability menu:**
- Strings: "Selected for this session", "Add from your libraries", "Attach {name} · {owner}", "Selected revision {revision}", "Read selected revision", "Refresh revision", "Detach", "No managed skills selected.".
- After a change: "Skill selections updated for the next turn. An active turn keeps its current revision."
- It's hidden when the default target is "workspace" and there's nothing selected or attachable.

We take the chat menu's structure and its next-turn wording.

### 2.4 Prior art

- **Prompt and skill libraries** (ChatGPT custom GPTs, Claude Projects' instructions, Raycast AI presets) attach a reusable instruction set **per conversation or project**, with the attachment visible in the conversation chrome. *Lesson:* the per-chat attachment belongs next to where you type, and it has to be visible at a glance. The chip does both.
- **Versioned content stores** (Notion page history, Google Docs versions) show "restore this version" as a single action with a timestamp, never a hash. *Lesson:* show "rev 3f9a1c · 2 days ago" as the label and a date-first revision picker. Keep the hash secondary.

---

## 3. Goals / Non-goals

**Goals (if the spike passes)**
1. See the team library: each skill's current revision, whether it's on for new chats, and when it was last updated.
2. Create, edit (with conflict detection), import from ClawHub, turn on or off, restore an earlier revision, and remove team skills.
3. Attach or detach library skills to one chat, pinned to a revision, from the composer.
4. New chats started in JoaxClaw get the enabled team skills by default. That comes for free once JoaxClaw has a profile.

**Non-goals**
- Personal skills, sharing, profiles, or "My skills". The owner decided single-user.
- ZIP upload (`skills.library.upload`), and multi-file editing beyond SKILL.md (existing files are preserved on save).
- Mentions.
- Moving the app-managed skills (ask-user and the others) into the library.
- Replacing on-disk skills.

---

## 4. Users and jobs to be done

- **As the owner**, I want to improve a skill without losing the version that worked, and roll back if the new one is worse.
- **As the owner**, I want one chat to use a specific skill, like `release-notes` rev 3, without installing it for every agent.
- **As the owner**, I want to pull a ClawHub skill into my library to try it, without writing it to the host's skills folder.
- **As the owner**, when I edit a skill in two places, I want to be told rather than silently overwrite.

---

## 5. UX specification

### 5.1 Entry points and placement

1. **Gateway → Extensions → Skills → [Installed | Library].**
   - A secondary segmented control under the Skills/Plugins switch, in the same style (`ExtensionsView.tsx:171–187`), shown only when the library is usable (8.2).
   - The Library header actions replace Browse / Add skill with **Import from ClawHub** and **New skill**.
   - Justification: the library is another kind of skill, so it lives with skills. A new nav item would split one concept in two.
2. **Composer chip "Skills · N".**
   - It sits in the chip row above the input (`MessageInput.tsx:335`) and opens the **Skills for this chat** popover upward.
   - Justification (integration rule 1): things that need your action sit below the thread, next to the composer. Attaching a skill changes what *your next message* runs with, which is a composer concern, and the popover's "from your next message" wording says so.
   - Shown when the library is readable and the chat has a `sessionKey`. With 0 selections and nothing attachable, it's hidden, as the Control UI hides it.
   - Attaching needs `operator.write` plus a profile, or admin. Without that, the chip opens read-only (8.2).

### 5.2 Flows

**A. Browse the library**
- `list { scope: "all" }`. Because of "team only", the UI shows entries with `ownerProfileId === null` and hides any personal ones, which shouldn't exist on a single-user gateway (open question Q4).
- Rows are `ExtRow`-style:
  - title (slug), description;
  - meta "rev 3f9a1c · updated 2 days ago";
  - a `Toggle` for "On for new chats" (enable/disable);
  - row actions **View**, **Edit**, **Revisions ▾**, **Remove**.

**B. View**
- **View** opens `SkillMdModal` with `source = { kind: 'library', skillId, revision }`.
- The modal fetches `read`, shows the content, and a revision select in its header ("rev 3f9a1c · 12 Sep 14:02").

**C. Edit**
1. **Edit** opens the modal in edit mode: a `Textarea` (mono) over SKILL.md, plus **Save**.
2. Save sends `save { skillId, expectedRevision: <revision opened>, slug, content }`. Other files are passed through unchanged from `read.files`.
3. **CONFLICT** → a warning box: "This skill changed since you opened it. Your text is still here." with the buttons **Copy my text**, **Load latest** (reopens at `currentRevision`, keeping the draft in the clipboard) and **Overwrite** (resaves with `expectedRevision = currentRevision`).
4. **POLICY_BLOCKED** → a danger box with the gateway's reason.
5. **Generic UNAVAILABLE** → "Couldn't save. If the skill contains an API key or token, replace it with a placeholder or a secret reference and try again."
6. Success → "Saved · rev {short}" on the button for 2 s.

**D. New skill**
- **New skill** opens the same editor with a template (`---\nname: …\ndescription: …\n---`) and a **Slug** field (validated against the pattern).
- Save sends `save { expectedRevision: null, slug, content }`, then immediately `mutate { action: "transfer", expectedRevision: receipt.entry.revision }` so the skill becomes Team.
- If the transfer fails (not admin), the skill stays the owner's. The row then shows "Only you can use this until an admin makes it a team skill." (Q2).

**E. Import from ClawHub**
- **Import from ClawHub** opens the existing `SkillBrowser` search in **import mode**. Its button reads "Add to library" instead of "Install".
- The call is `import { slug: <local slug, editable, default result.slug>, source: { kind: "clawhub", slug: result.installRef, version? } }` (Q5 covers which identifier), then a transfer to Team.
- Blocked results show the gateway's reason.

**F. Revisions**
- **Revisions ▾** lists `read().revisions`, newest first ("12 Sep 14:02 · rev 3f9a1c · current").
- Picking an older one → **Restore this revision** → `mutate { action: "rollback", revision, expectedRevision: current }`.
- Copy: "Restoring makes this the current revision for new chats. Chats that pinned another revision keep it."

**G. Remove**
- Inline confirm ("Remove"/"Cancel", the existing `removeInline` pattern) → `mutate { action: "remove" }`.
- Note: "Chats that pinned it keep their revision."

**H. Skills for this chat**
1. Click the chip. `list { sessionKey }` loads `session.selections` and `session.attachable`.
2. The popover lists:
   - **In this chat:** `name · rev short` with **Remove**, and, when the library's current revision is newer, **Update to latest** (`activate refresh`).
   - **Add from your library…**: a searchable list of `attachable` team skills (click → `activate attach`).
3. Footer: "Changes apply from your next message." After any change it reads "Updated. A reply already running keeps its current skills."
4. The chip label is "Skills · {n}" (accent tint when n > 0), or "Skills" when there are none.
5. LIMIT → "A chat can use at most 64 library skills."

### 5.3 Wireframes

**Desktop: Extensions → Skills → Library**
```
┌ Extensions ─────────────────────────────────────────────────────────────── [↻] ┐
│ Skills teach agents how to do things · Plugins add tools & integrations.       │
│ [ Skills 14 | Plugins 9 ]                       🔍 Search…                      │
│ [ Installed | Library ]              [⤓ Import from ClawHub] [+ New skill]      │
│ ────────────────────────────────────────────────────────────────────────────── │
│ release-notes                                         On for new chats [●━]    │
│ Drafts release notes from merged PRs.                                          │
│ rev 3f9a1c · updated 2 days ago        [View] [Edit] [Revisions ▾] [Remove]    │
│ ────────────────────────────────────────────────────────────────────────────── │
│ sql-review                                            On for new chats [●━]    │
│ Reviews SQL for injection and index use.                                       │
│ rev 81be0d · updated today             [View] [Edit] [Revisions ▾] [Remove]    │
│ ────────────────────────────────────────────────────────────────────────────── │
│ meeting-followup                           (Off)      On for new chats [━○]    │
│ rev 5c20aa · 4 revisions               [View] [Edit] [Revisions ▾] [Remove]    │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Desktop: editor with a conflict**
```
            ┌ ✎ release-notes · rev 3f9a1c ─────────────────────────── ✕ ┐
            │ ⚠ This skill changed since you opened it. Your text is      │
            │   still here.  [Copy my text] [Load latest] [Overwrite]     │
            │ ┌──────────────────────────────────────────────────────────┐│
            │ │ ---                                                      ││
            │ │ name: release-notes                                      ││
            │ │ description: Drafts release notes from merged PRs.       ││
            │ │ ---                                                      ││
            │ │ When asked for release notes…                            ││
            │ └──────────────────────────────────────────────────────────┘│
            │                                      [Cancel] [Save]         │
            └──────────────────────────────────────────────────────────────┘
```

**Composer chip and popover (desktop and phone)**
```
│                 ┌ Skills for this chat ────────────────────┐ │
│                 │ IN THIS CHAT                             │ │
│                 │ release-notes · rev 3f9a1c      [Remove] │ │
│                 │ sql-review · rev 81be0d  [Update to latest]│
│                 │ ──────────────────────────────────────── │ │
│                 │ Add from your library…  🔍               │ │
│                 │   meeting-followup                       │ │
│                 │ ──────────────────────────────────────── │ │
│                 │ Changes apply from your next message.    │ │
│                 └──────────────────────────────────────────┘ │
│ (👤 Sharing your profile) (✦ Skills · 2)                     │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 📎  Message…                                     🎙  [➤] │ │
│ └──────────────────────────────────────────────────────────┘ │
```
On a phone the popover becomes a bottom sheet with the same sections. Rows are 40px tall.

### 5.4 States

| State | Behaviour |
|---|---|
| Gateway < 2026.8 | No Library segment, no chip (`hasMethod` false). |
| Library not writable (the spike not done or failed: `profileId === null`) | **Option 1, recommended:** hide both surfaces entirely. **Option 2:** show the Library read-only with an info line "Editing library skills from JoaxClaw isn't available on this connection. Use the gateway's web UI." Q1 decides. |
| `gateway.roles` configured and no read access | The list returns no entries, so the surfaces hide. |
| Loading | Skeleton rows / "Loading…" in the popover. |
| Empty library | `EmptyState` (faded `BookOpen`): "No team skills yet. Create one, or import one from ClawHub." |
| No attachable skills | Popover: "No library skills to add yet." with a link "Open the library" (`focusGatewayTab('extensions')` + the Library segment). |
| Write refused (FORBIDDEN, no write scope) | Edit, New, Import, Toggle, Remove and Restore are hidden. Rows show "Read-only on this connection." The chip popover is read-only (no Remove/Add). |
| Transfer refused (not admin) | See flow D. |
| Conflict | Flow C3. |
| Policy blocked | The gateway's reason in a danger box. |
| Removed skill still pinned in a chat | The popover row shows a "(Removed)" neutral pill and only **Remove**. |
| Pinned revision unavailable (NOT_FOUND on list with sessionKey) | Popover: "A pinned skill isn't available any more. Remove it to continue." with **Remove all unavailable** (detach each). |
| Offline / reconnecting | Controls disabled; reload on `connectionSeq`. |
| Remote vs local | Identical: every operation is an RPC. This fixes the viewer's local-disk limit for library skills. |
| Reply running | Popover footer: "A reply is running. Changes apply from your next message." |

### 5.5 Keyboard and accessibility

- The Installed/Library control is a radio group. The Toggle is `role="switch"` with the label "On for new chats".
- The chip is `aria-haspopup="dialog"` and announces "Skills for this chat, 2 attached".
- The popover traps focus. Its search is focused on open, and Esc closes and returns focus to the chip.
- The editor textarea has `aria-label="SKILL.md"`, and Ctrl/Cmd+S saves.
- The revision select's options read the date first.

### 5.6 UI copy

| Key | String |
|---|---|
| seg.installed | Installed |
| seg.library | Library |
| lib.import | Import from ClawHub |
| lib.new | New skill |
| lib.row.meta | rev {short} · updated {ago} |
| lib.row.revisions | {n} revisions |
| lib.toggle | On for new chats |
| lib.pill.off | Off |
| lib.view | View |
| lib.edit | Edit |
| lib.revisions | Revisions |
| lib.restore | Restore this revision |
| lib.restore.note | Restoring makes this the current revision for new chats. Chats that pinned another revision keep it. |
| lib.remove | Remove |
| lib.remove.note | Chats that pinned it keep their revision. |
| lib.empty | No team skills yet. Create one, or import one from ClawHub. |
| lib.readOnly | Read-only on this connection. |
| lib.unavailable | Editing library skills from JoaxClaw isn't available on this connection. Use the gateway's web UI. |
| lib.notTeam | Only you can use this until an admin makes it a team skill. |
| edit.slug | Slug |
| edit.slug.bad | Use lowercase letters, numbers and dashes (up to 63). |
| edit.save | Save |
| edit.saved | Saved · rev {short} |
| edit.conflict | This skill changed since you opened it. Your text is still here. |
| edit.copy | Copy my text |
| edit.loadLatest | Load latest |
| edit.overwrite | Overwrite |
| edit.nameTaken | A skill named "{slug}" already exists. Choose another slug. |
| edit.blocked | The gateway blocked this skill: {reason} |
| edit.genericFail | Couldn't save. If the skill contains an API key or token, replace it with a placeholder or a secret reference and try again. |
| import.button | Add to library |
| import.done | Added to the library |
| chip.none | Skills |
| chip.some | Skills · {n} |
| pop.title | Skills for this chat |
| pop.inChat | In this chat |
| pop.remove | Remove |
| pop.update | Update to latest |
| pop.add | Add from your library… |
| pop.noneToAdd | No library skills to add yet. |
| pop.openLibrary | Open the library |
| pop.footer | Changes apply from your next message. |
| pop.updated | Updated. A reply already running keeps its current skills. |
| pop.limit | A chat can use at most 64 library skills. |
| pop.removed | Removed |
| pop.unavailable | A pinned skill isn't available any more. Remove it to continue. |
| pop.removeUnavailable | Remove all unavailable |

### 5.7 Notifications and deep links

None. `focusGatewayTab('extensions')` gains an optional sub-target (`{ tab: 'skills', segment: 'library' }`) for the popover's "Open the library" link.

---

## 6. Design-book conformance

| Item | Used |
|---|---|
| Segments | Existing Skills/Plugins segment style, reused for Installed/Library |
| Rows | 01 `ExtRow` (from `ExtensionsView.tsx:307`), `Toggle` (01, from `ToggleSwitch` `:267`), `Pill` for Off/Removed |
| Modal | `SkillMdModal` shell (refactored to take a content source), with edit mode added |
| Popover | 01 `Popover` + `MenuRow` (`sheetOnNarrow` gives the phone bottom sheet), opening upward |
| Chip | The existing composer chip style (`MessageInput.tsx:343–348`: pill, 11px, accent tint when active) |
| Empty | 01 `EmptyState` |
| Feedback | Inline "Saved · rev" on the button; warning box for conflicts; danger box for blocks. No toasts. |
| State colours | accent = active/attached; warning = conflict; danger = blocked; neutral = off/removed |
| **New** | A *second* chip in the composer chip row. It's justified by integration rule 1 and it follows the existing chip exactly. No new visual primitive. |

---

## 7. Functional requirements

**FR-0: Spike gate.**
- *Given* JoaxClaw connects with mode `ui`, *when* `skills.library.list` runs on a shared-token connection, *then* `profileId === "gateway-owner"`, and `save` of a test skill succeeds.
- *Given* the spike's regression checks (8.5) all pass, *then* the mode change ships as its own PR before any library UI.

**FR-1: Visibility.**
- *Given* `hasMethod('skills.library.list')` and a non-null `profileId` (or Q1 option 2), *then* the Library segment and the composer chip are available.
- *Otherwise* they are hidden.

**FR-2: List.** *When* the Library opens, *then* `list { scope: "all" }` shows team entries (`ownerProfileId === null`), sorted by slug, with the revision short hash (first 6 characters), the updated time, and the enabled state.

**FR-3: Toggle.** *When* "On for new chats" changes, *then* `mutate { action: enable|disable, expectedRevision }` is sent. A CONFLICT reloads the row and retries once.

**FR-4: View.** *When* View is pressed, *then* `read { skillId }` feeds `SkillMdModal`. Picking a revision re-reads with `revision`.

**FR-5: Edit and conflict.**
- *When* Save is pressed, *then* `save` is sent with the opened revision as `expectedRevision`.
- *Given* CONFLICT, *then* the draft is kept and the three actions show.
- *Given* Overwrite, *then* save is retried with `details.currentRevision`.

**FR-6: Create as Team.**
- *When* a new skill saves, *then* `mutate transfer` follows.
- *Given* the transfer fails with FORBIDDEN, *then* the skill stays and the row shows the not-team note.

**FR-7: Import.** *When* "Add to library" is pressed on a ClawHub result, *then* `import` then `transfer` run. POLICY_BLOCKED shows the reason.

**FR-8: Restore.** *When* an older revision is restored, *then* `mutate rollback` is sent with that `revision`, and the row shows the new current revision.

**FR-9: Remove.** *When* removal is confirmed, *then* `mutate remove` is sent and the row disappears.

**FR-10: Chat attach/detach.**
- *Given* a chat with a `sessionKey`, *when* the popover opens, *then* `list { sessionKey }` supplies selections and attachable skills.
- Attach, detach and refresh call `activate` and update the chip count from the returned `selections`.

**FR-11: Next-turn semantics.** *Given* a streaming reply, *then* the popover footer says changes apply from the next message. Activation is never blocked.

**FR-12: Managed skills protected.** *Given* a new or imported slug in `JOAXCLAW_MANAGED_SKILLS`, *then* save is refused client-side: "That name is used by one of JoaxClaw's own skills."

**FR-13: Reconnect.** *On* a `connectionSeq` change, the library list and any open popover reload.

**FR-14: Viewer refactor.** `SkillMdModal` accepts `source: { kind: 'file', path } | { kind: 'library', skillId, revision? }`. Installed skills keep today's behaviour.

---

## 8. Technical design

### 8.1 Modules

| Path | New/changed | Purpose |
|---|---|---|
| `src/lib/gateway.ts` | Changed (spike PR) | `CLIENT_MODE = 'ui'` (from `'backend'`). Keep `CLIENT_ID`. **Check:** the device-signature payload includes `clientMode` (`gateway.ts:302`), so an already-paired device must still verify. The signature is computed per connect, so a mode change should be fine, but it must be tested against a paired device token. |
| `src/lib/skillLibrary.ts` | **New, pure** | Types; `parseList(res)`, `teamEntries(entries)`, `shortRev(rev)`, `readLibraryError(err) → { code, message, currentRevision? }`, `validateSlug(slug)`, `isManagedSlug`, `revisionLabel(rev, createdAt, current)`, `canWrite(listRes, scopes)`, `skillTemplate(slug)`. |
| `src/store/skillLibrary.ts` | **New** | `entries`, `profileId`, `usable`, `loading`, `error`, `busy`. Actions: `load`, `read`, `save`, `create`, `importFromClawHub`, `setEnabled`, `restore`, `remove`, `sessionState(sessionKey)`, `attach`, `detach`, `refresh`. Reloads on `connectionSeq`. |
| `src/components/extensions/ExtensionsView.tsx` | Changed | Installed/Library segment; library rows; `SkillMdModal` moved out. |
| `src/components/extensions/SkillMdModal.tsx` | **New file (moved)** | Content-source refactor, revision select, edit mode, conflict box. |
| `src/components/extensions/SkillBrowser.tsx` | Changed | A `mode: 'install' \| 'library'` prop; the button label and action. |
| `src/components/chat/ChatSkillsChip.tsx` | **New** | The chip and popover/sheet. |
| `src/components/chat/MessageInput.tsx` | Changed | Render `ChatSkillsChip` in the chip row. The row now shows if either chip shows. |

### 8.2 Capability gating

- Surfaces: `hasMethod('skills.library.list')` and `list().profileId !== null` (Q1). Probe once per connection (`list {}`), cached in the store.
- Writes: `operator.write` in `grantedScopes`. Transfer: `operator.admin`.
- Chat attach: `operator.write` (with a profile), or `operator.admin`. Otherwise the popover is read-only.

### 8.3 Import identifier

- `skills.library.import`'s `source.slug` is a free string (1–256). The plan assumed a ClawHub search result's `slug`.
- The existing install path deliberately uses the publisher-qualified `installRef`, because "several publishers can share one slug" (`lib/skillCatalog.ts:9–17`).
- **Unverified: check during implementation** whether `installSkillFromClawHub({ slug: source.slug })` accepts `@publisher/slug`. Look at `installSkillFromClawHub` in `dist/clawhub-DJyfzTkY.mjs`. Prefer `installRef` if it does, since it's safer.

### 8.4 Error handling

`readLibraryError` maps `details.code`. The copy follows 5.6. Unknown codes and `UNAVAILABLE` → the generic-save hint (the literal-secret case). `AUTHORITY_EXPIRED` → "Your connection's identity changed. Reconnect and try again."

### 8.5 Spike: the connect-mode change (the blocking step)

Run on an **isolated gateway profile** (memory `gateway-vs-project-scope`), with a shared token and with a paired device token.
1. `list {}` → `profileId: "gateway-owner"`, and `defaultTarget` is `"workspace"` (admin) or `"personal"`.
2. `save` → `transfer` → `list` shows `ownerLabel: "Team"`.
3. **Regression checks for everything that depends on `backend` mode:**
   - `resolveCanUseInternalRuntimeHandoff` (cron creation, `dist/cron-creator-authority-admission-*.mjs`): create, edit and run an automation from JoaxClaw's Automations view.
   - Approvals (`isTrustedApprovalRuntime` requires `backend`, but only with an approval-runtime token, which JoaxClaw doesn't send): approve an exec from the ApprovalsBanner.
   - `agentRuntimeIdentityToken` (backend only; not used by JoaxClaw).
   - chat send/stream, `sessions.subscribe` + `session.message`, `health` ping, scope negotiation (`gateway.ts:372–387`), device pairing, and the Talk realtime session.
4. **Presence:** JoaxClaw now appears in the gateway's presence list (Control UI "Instances"/clients). Acceptable, and arguably correct.
5. **New sessions:** a chat created from JoaxClaw gets enabled team skills pinned (`list { sessionKey }` shows selections).

If any check fails, stop, report, and fall back per §0.

### 8.6 Performance

- The list is small (tens of entries). `read` returns the full SKILL.md (≤1 MiB), shown in the modal as is.
- The popover fetches `list { sessionKey }` on open only.
- There's no polling.

### 8.7 Migration

None. The connect-mode change is invisible to the user, apart from new sessions being seeded.

---

## 9. Test plan

### 9.1 Unit tests (`src/lib/__tests__/skillLibrary.test.ts`)

- `parseList`: with and without `session`; missing optional fields.
- `teamEntries`: filters `ownerProfileId !== null`; keeps removed entries out.
- `shortRev`: 64-hex → 6 characters.
- `readLibraryError`: each of the 9 codes; `currentRevision` extraction; a non-library error → generic.
- `validateSlug`: valid; uppercase; leading dash; 64 characters; empty.
- `isManagedSlug`: every managed slug; case sensitivity.
- `revisionLabel`: current vs older; date-first format.
- `canWrite`: profile + write, no profile, no write scope, admin without profile (read and attach only).
- `skillTemplate`: front matter includes the name and a description placeholder.

Also:
- A store test: the create flow (save → transfer), the transfer-refused path, the conflict retry for the toggle.
- Connect test: `CLIENT_MODE` is `'ui'` in the connect frame (guards against regressions).

### 9.2 Manual QA script (after the spike passes)

1. Extensions → Skills → Library → empty state → New skill `release-notes` → Save → the row shows Team, rev, On.
2. Edit it in JoaxClaw and, at the same time, in the Control UI; save the Control UI first, then JoaxClaw → conflict → Load latest → re-apply → Save.
3. Restore the first revision → the rev changes back.
4. Toggle Off → new chats don't get it; toggle On → a new chat gets it (the chip shows "Skills · 1").
5. In an existing chat: chip → Add `release-notes` → footer → send a message → the agent follows the skill.
6. Update to latest after editing the skill; Remove from the chat.
7. Import a ClawHub skill → Team row; import one that the install policy flags → blocked reason.
8. Put an API key literal in a skill → the generic hint.
9. Read-only token → rows read-only, the popover can't attach.
10. Remote gateway: every step above.
11. 2026.7 gateway: no Library segment, no chip.

---

## 10. Rollout

- **PR 0 (spike → mode change)** ships alone, with a CHANGELOG line under Changed: "JoaxClaw now identifies as an app window to the gateway, so gateway features that need the owner's profile (such as the skills library) work." It's revertible on its own.
- Library PRs follow, gated on `hasMethod` + `profileId`.
- Gateways below 2026.8 see nothing new.

---

## 11. Risks and open questions

| # | Item | Owner? |
|---|---|---|
| Q1 | **Approve changing JoaxClaw's connect mode from `backend` to `ui`?** Without it, the library can't be used from JoaxClaw at all (§0). With it, the Library works fully and new chats get enabled team skills by default. If not approved: hide the feature (recommended) or show it read-only. | **Yes, blocking** |
| Q2 | "Team only": auto-transfer every new or imported skill to Team (recommended, so the UI never mentions ownership), or leave new skills with the owner profile (functionally the same on a one-person gateway). | **Yes** |
| Q3 | Is the library worth it for a single user at all? The gateway itself defaults a lone admin to on-disk "workspace" skills. The library's unique value is **revisions and per-chat pinning**. If you don't need those, defer this PRD and put the effort elsewhere. | **Yes** |
| Q4 | Should personal-owned entries (if any exist, e.g. created in the Control UI as `gateway-owner`) show in the Library? Recommendation: show them with no owner label, since there's only one person. | Yes |
| Q5 | The import identifier: `installRef` vs `slug` (8.3). | No (verify) |
| R1 | The mode change may affect gateway behaviour we haven't found. The 8.5 checklist is the mitigation. | No |
| R2 | Pins inherited by crons: an automation created from a chat with pinned skills carries them. That's desirable, but the Automations UI doesn't show it. | No |
| R3 | Channel sessions (Slack, WhatsApp) may not get seeded selections. Unverified: trace who fills `ctx.SessionCreation` in `get-reply`. | No |

---

## 12. Milestones and effort

| PR | Scope | Effort |
|---|---|---|
| 0 | **Spike + connect-mode change** (`CLIENT_MODE = 'ui'`), with the 8.5 regression checklist written up in the PR. Stop here if it fails or Q1 is "no". | S (½–1 d) |
| 1 | **Library segment.** `lib/skillLibrary.ts` + tests, `store/skillLibrary.ts`, the `SkillMdModal` move and content-source refactor, list, view, edit (conflicts), new (with transfer), revisions, enable, remove. | M (1.5–2 d) |
| 2 | **Import + Skills for this chat.** `SkillBrowser` library mode, `ChatSkillsChip` popover/sheet, managed-slug guard. | S–M (1 d) |
