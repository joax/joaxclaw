# Product requirements: catching up to OpenClaw 2026.9

Detailed PRDs for the features in the [2026.9 feature plan](https://claude.ai/artifact/MXHdJiDnh7eBX3AEqQdVsp). They're written against the app as built and against the OpenClaw 2026.9.4 gateway source, and they follow JoaxClaw's design language: theme tokens, the `components/ui` primitives, and the banner, strip, drawer and menu patterns. Every PRD uses the same structure:
- summary
- evidence
- goals
- user stories
- UX spec with desktop and phone wireframes, every state and exact copy
- design-book conformance
- requirements with acceptance criteria
- technical design
- test plan
- rollout
- risks and open questions
- milestones

| # | PRD | Status | Depends on |
|---|---|---|---|
| 01 | [Shared groundwork](01-shared-groundwork.md): shared UI primitives in `components/ui`, `Strip`/`StripBar`, `BottomSheet`, `CommandHint`, `stateTone`, `hasMethod`, `expectRestart` | Draft | — |
| 02 | [Gateway updates](02-gateway-updates.md): availability for every connection, the automatic-update countdown and Hold, update in place with live progress, results, history | Draft | 01 |
| 03 | [Background tasks](03-background-tasks.md): a Background strip replacing Scripts, a task drawer, a Dashboard section, tray counts, a push deep link | Draft | 01 |
| 04 | [Chat goals](04-chat-goals.md): a header button that becomes a status chip with a popover, a chat-list marker, a Sessions column | Draft | 01 |
| 05 | [Chat export](05-chat-export.md): fixes tool calls lost on reload first, then Markdown/JSON export from the header ⋯ menu | Draft | 01 |
| 06 | [Plugin catalog](06-plugin-catalog.md): Browse with views, categories and a detail pane, and one install → restart → verify flow | Draft | 01 |
| 07 | [Meetings](07-meetings.md): setup checklist, Record a meeting (through an agent), the library, Discuss in a new chat, Discord auto-record | Draft | 01, 06 |
| 08 | [Skills library](08-skills-library.md): team skills; **blocked** until a trial of the connection-mode change passes | Draft · blocked | 01 |

## Findings that changed the plan
- **Tool calls are lost on reload because of the app, not the gateway.** `chat.history` carries them as `toolCall` blocks with `arguments`, and their results as separate `toolResult` rows. The loader only accepted `tool_use` + `input`, and it dropped result rows (05).
- **Suggested-task cards can't appear in JoaxClaw.** The gateway offers `suggest_task` only to its own operator UIs (03).
- **`gateway.restart.request` exists** (admin). Plugin installs can restart the gateway automatically (06).
- **Meetings produce notes (captions and a summary), not audio recordings** (07).
- **Team skills need a signed-in profile,** which JoaxClaw's `backend` connection mode never gets (08).
- **Update notices reach every connection** (the hello snapshot and the `update.available` event), and JoaxClaw discarded them (02).

Each PRD ends with its own open questions for the product owner.
