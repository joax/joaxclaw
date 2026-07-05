# Memory tab — pluggable memory/storage backends

The **Memory** tab manages the connections between the OpenClaw gateway's agents and
external memory/knowledge stores, and lets the user browse what's in them. Obsidian
is the first backend; the tab generalizes to many (local-to-server and cloud).

## What it is (and isn't)

- **Agents reach memory via OpenClaw skills.** Enabling a connection generates a
  `SKILL.md` on the gateway host that tells agents how to read/write that store with
  the tools they already have (file tools, or an HTTP endpoint + key). The tab does
  **not** invent a new agent runtime — it manages those skills.
- **The tab is a manager + a viewer.** Two jobs: (1) manage connections
  (add / configure / enable / set agent access / remove), (2) browse the stored
  content (notes, a graph, memory records, …).

## The model — a "Memory Connection"

Everything shown in the tab is a connection instance:

```text
id           stable unique id
providerId   'obsidian' | 'markdown' | … (see registry)
name         user label ("Personal", "Work notes")
enabled      on/off
access       off | read-only | read-write   → drives skill generation
config       provider-specific: { url, apiKey, path, space, … }
```

Providers are declared in a **registry** (`src/lib/memory/providers.ts`), the same
pattern as the channels catalog (`src/lib/channels.ts`). Each `MemoryProviderDef`
declares: `label`, `blurb`, `icon`, `location` (server-local | cloud), `viewer`
(graph | notes | items), the connect-form `fields`, a **skill builder**
(`buildSkill`), and — from P1's content increment — a browse **adapter**
(`test` / `list` / `read` / `graph?`). Adding a backend = a registry entry, not a new
screen.

## The location matrix (why a gateway plugin comes later)

Both the skill (agent-facing) and content browsing (app-facing) depend on where the
gateway and the backend live:

| | Skill (must be where agents run = gateway host) | App browses content |
| --- | --- | --- |
| **Local gateway** | app writes `~/.openclaw/skills/…` (today's Obsidian path) | app reaches `localhost` backends directly |
| **Remote gateway** | must install on the host — via a plugin or "via agent" | app can't reach the host's `localhost` → must proxy via the gateway |
| **Cloud backend** | skill embeds the cloud URL + key | app fetches the cloud API directly |

## Phasing

- **P1 (app-side, local gateway) — current work.** Connection model + provider
  registry; refactor Obsidian into one provider; a Connections manager (add / enable /
  agent-access / remove) across N providers; **Markdown folder** as the second
  provider (zero-dependency: a folder of `.md` on the server the agent reads/writes
  with file tools); content browsing for both (Obsidian graph, Markdown list). Uses
  the local skill-write path — correct on a local gateway; cloud backends also work.
  On a **remote gateway** the tab shows a "managed on the gateway host" notice and
  writes no skills (they'd land on the client, not the host) — remote is P3.
- **P2 — content viewer.** Provider-appropriate browsing + search (graph / list /
  pages), richer previews.
- **P3 — remote + server-local, hardened.** A `joaxclaw-memory` gateway plugin that
  (a) writes/manages the skill files **on the host** and (b) exposes
  `memory.list/search/read` RPCs so the app can browse server-local content over the
  WS regardless of where the gateway runs. This is also where credential handling is
  hardened (SecretRefs / MCP OAuth-scoped tokens instead of plaintext keys in
  `SKILL.md`). See [the memory-backends research](#see-also).

## Known weakness we're deliberately deferring

Today (and in P1) the generated skill embeds the backend URL + **API key in
plaintext**, and "read-only" is enforced only by what the skill's prose advertises —
not a real capability gate. P3's plugin (and, where a backend offers it, an
MCP/OAuth-scoped token with `memory:read` / `memory:write` scopes) is where this gets
fixed. Candidate backends and the transport/scoping analysis are in the memory
research (Cognee, Mem0/OpenMemory, Logseq, Graphiti, Qdrant, MCP reference server).

## Key files

| File | Role |
| --- | --- |
| `src/lib/memory/types.ts` | Connection + provider-def + adapter types |
| `src/lib/memory/providers.ts` | The provider registry (obsidian, markdown, …) + skill builders |
| `src/lib/memory/adapters/` | Per-provider content adapters (`obsidian` REST/graph, `markdown` files) |
| `src/store/memory.ts` | The unified memory store — connections, per-provider skill sync, browse, + `useObsidianVaults()` compat selector. Migrates old Obsidian vaults on first load. |
| `src/components/memory/MemoryView.tsx` | The Memory tab — Connect / Manage / Browse |
| `src/components/obsidian/ForceGraph.tsx` | Graph renderer, reused for graph-viewer providers |
| `electron/main` `memory:writeSkill/removeSkill(slug, …)` | Generic local skill writer; `file:*` handlers now expand `~` |

The old `src/store/obsidian.ts` + `ObsidianView.tsx` were removed; the two views that
read Obsidian vaults (Agent map, Process collaboration) now use `useObsidianVaults()`.

## See also

- Memory-backends research (four-category survey + MCP-vs-skill-file transport
  analysis) — the basis for which backends to add and how P3 should harden credentials.
- [remote-gateway.md](./remote-gateway.md) — the local-vs-remote seam this reuses.
