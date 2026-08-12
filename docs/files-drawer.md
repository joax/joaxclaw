# Files — seeing what the gateway's agents write

Agents produce files: reports, summaries, exports, generated media. On a **remote
gateway** those files land on the *host's* disk, invisible to the app — the user is told
"I wrote the report to `~/report.md`" and has no way to read it. This is the surface that
closes that gap: **artifact cards** where a file is produced, a **drawer** listing what
exists, and a real way to get the bytes out.

**Status: P0 + P1 built.** Artifact cards, the four-level viewer, Save As, the pop-out
window, the drawer, and the `host.files.*` RPCs all ship. P2/P3 are still plans.

**Read-only.** The models are the editors of these documents; the app is the viewer.
Write-back is deliberately out of scope (see [Read-only, and why](#read-only-and-why)).

## The gap (probed against a live 2026.6.5 gateway, 2026-08-12)

The gateway has **no general file API**. `files.*`, `fs.*`, `workspace.*`, `media.list`,
`sessions.files.*` all return `unknown method`; the HTTP port serves only the Control UI.
The one built-in is `agents.files.list/get`, allow-listed to the bootstrap set
(`AGENTS/SOUL/TOOLS/IDENTITY/USER/HEARTBEAT/MEMORY.md`) — but its payload includes the
agent's absolute `workspace` path, which is a free, plugin-less way to learn *where* to
look:

```jsonc
{ "agentId": "main", "workspace": "/home/joaxap/.openclaw/workspace",
  "files": [ { "name": "MEMORY.md", "path": "…", "size": 1408, "updatedAtMs": … } ] }
```

What already exists on our side of the wire:

| Piece | Where | Note |
| --- | --- | --- |
| Host-side file read | `host.readMedia` (joaxclaw-fs ≥0.11.4) | Reads **any** host path → base64 data URL. Verified reading `MEMORY.md` (`application/octet-stream`); also resolves a bare filename via the host-side `find`. 32 MB one-shot cap. |
| Directory listing precedent | `memory.list` / `memory.read` | Lists `.md` in a dir + reads as text — the shape `host.files.*` generalises. |
| Local/remote branch | `resolveMediaDataUrl()` (`WorkspaceMedia.tsx`) | RPC when remote, Electron `file:*` when local. |
| Markdown rendering | `MarkdownContent.tsx` | react-markdown + GFM + workspace media + `DiffView`. |
| File-type presentation | `lib/attachments.ts` | Extension → label / icon key / accent colour, for every type we'd show. |
| Missing-plugin flow | `RemotePluginNotice` | "Install via agent", as used by Teams / Processes / Memory. |

Missing: **listing**, **a place to put it**, and **an export path** — there is no
save-to-disk IPC at all today.

## Prior art (what everyone converged on)

| Product | Shape |
| --- | --- |
| Claude Artifacts | Inline card → side panel preview, download in the panel header, "Download all artifacts (N)" per chat |
| Manus | Chat is the narrative; "View all files in this task" opens the sandbox file browser |
| OpenHands | Embedded VS Code + file explorer/diff in the right pane — per-file **download is still an open request** (issue #7751) |
| Copilot / VS Code | Markdown as the interchange format: preview, then save as a real file |

The convergent pattern is **provenance + recall + export**: a card where the file was
produced, one panel listing everything, and a real way out. Nobody ships a general file
manager. The failure mode to avoid is OpenHands': a browser you can look at but can't get
files out of.

## The model

An **artifact** is a host path with provenance:

```text
path        absolute path on the GATEWAY host
name        basename
kind        from classifyKind() — 'image' | 'video' | 'audio' | 'file'
origin      { sessionKey, messageId, toolCallId }   // null for drawer-discovered files
size, mtime from the listing (P1) or the read (P0)
```

Everything else is derived. The path is the whole identity, which is what lets a pop-out
window survive a reload and be re-opened from history.

## Four levels of zoom

One preview component, four framings:

1. **Card** — under the message: icon, name, size, a teaser line.
2. **Drawer preview** — right panel, chat still visible. The everyday case.
3. **Full view** — expand; the file takes the whole content area.
4. **Own OS window** — pop-out.

The pop-out reuses the chat pop-out machinery verbatim: `createChatWindow()`
([electron/main/index.ts:191](../electron/main/index.ts#L191)) opens a frameless
BrowserWindow loading the *same* renderer with `?popout=chat&session=…`, and
[main.tsx:51-57](../src/main.tsx#L51-L57) mounts a different root from that query. A file
window is `file:popOut` → the same window factory keyed by path → `?popout=file&path=…`
→ `<FilePopout>`. `chat:popoutInfo` already hands a new window the active gateway
connection, so a file window on a remote gateway **re-fetches its own bytes over its own
socket** — nothing is piped between windows.

**Mobile/PWA** has no Electron windows: the same URL opens as a browser tab
(`window.open('/?popout=file&path=…')`), and on a phone level 3 is the top of the ladder —
the drawer becomes a sheet. The component is shared.

**"Open in my editor" is local-gateway-only.** On a remote gateway the file is on another
machine, so that action must be Save-As-then-open. Label it that way rather than silently
behaving differently depending on where the gateway runs — the recurring
[remote-gateway](./remote-gateway.md) trap.

## The markdown models actually write

GFM only recognises a table when the delimiter row directly follows the header. Models
routinely write a long table as **one header up top, then per-section runs of rows**:

```markdown
| Test ID | Test case | Priority |
| --- | --- | --- |

## Global chrome (19 tests)

| GC-01 | Logo returns home | P0 |
```

Parsed strictly — by remark-gfm, and by GitHub — that's a header-only table followed by
a *paragraph of pipes*, so a 19-row test plan renders as one run-on line. The document is
what's malformed, but this app exists to read documents models wrote, so
`lib/markdownRepair.ts` re-attaches an orphan run to the last header whose **column count
it matches**, dropping the now-empty header table it borrowed from. It's conservative:
fenced code is untouched, a column-count mismatch is left alone, and a well-formed
document parses identically before and after (asserted in the tests by running the same
parser `MarkdownContent` uses).

It lives in `MarkdownContent`, so chat gets the same repair — models write these tables
into replies too.

## Read-only, and why

The viewer does not write back. Editing would need a `host.files.write` RPC — a
materially larger security surface than read (see [Security](#security)) — and it isn't
what this feature is for: the documents are authored by models, and the way to change one
is to ask. Revisit only if a concrete workflow demands it, and give it its own scope.

## Detection (P0) — how the app learns a file was written

The classification already exists, duplicated in two places: `detectKind()`
([AssistantMessage.tsx:689](../src/components/chat/AssistantMessage.tsx#L689)) and
`kindOf()` ([lib/activityLabels.ts](../src/lib/activityLabels.ts)) both return
`'file-write'` for `write_file|create_file|str_replace|patch_file|edit_file|write|edit`.
The path extraction exists too — `toolSummary()`
([AssistantMessage.tsx:727](../src/components/chat/AssistantMessage.tsx#L727)) reads
`a.path ?? a.file_path ?? a.filename ?? a.target_file`. P0 is: lift that into a shared
`lib/artifacts.ts`, emit an artifact per `file-write` call, render a card.

**Known gap:** a heredoc or redirect inside `bash` (`cat > report.md <<'EOF'`) is not a
`file-write` tool call and won't be caught. A cheap regex over the bash command
(`>\s*(\S+\.\w+)`) covers most of it; the drawer (P1) covers the rest by listing the
workspace regardless of how a file got there. Don't over-fit the heuristic — the drawer is
the real answer.

## RPC contract (joaxclaw-fs ≥ 0.12.0)

`fs.*` is **reserved by the gateway** — plugin methods must live under an app-owned
namespace (`host.*`), or they're silently rejected as `unknown method`.

```text
host.files.roots {}                          → { roots: [{ id, label, path, agentId? }] }
host.files.list  { root, subdir? }           → { entries: [{name,path,size,mtimeMs,isDir}], dir, truncated }
host.files.read  { path, encoding?, offset?, length? }
                                             → { path, size, mediaType, encoding, content, eof }
```

All `operator.read`. Absence is detected by the existing `unknown method` probe →
`RemotePluginNotice`.

**Roots are computed host-side**, not accepted from the client: `<stateDir>/workspace`,
each `<stateDir>/agents/<id>/workspace` that exists, and `<stateDir>/media`. The client
picks one by id and can only walk downward from it, so listing can never be aimed at,
say, `~/.ssh`.

**`read` deliberately accepts any absolute path** — the app opens files an agent named
in chat, which legitimately live outside the roots (a repo, `/tmp`), and `host.readMedia`
has always read arbitrary paths, so restricting `read` would break the feature without
removing the capability. Listing is where the boundary belongs; the denylist (below) is
what `read` adds.

`read` is **chunked** (`offset`/`length`, 4 MiB per call, `eof` reports whether more
remains), which retires `host.readMedia`'s 32 MB one-shot cap: the viewer previews the
first 1 MiB and Save As pulls the rest. A capped UTF-8 read decodes with `stream: true`
so a split multi-byte character is withheld rather than turned into `U+FFFD`.

## Phasing

- **P0 — done, no plugin needed.** Artifact cards + the four-level viewer, reading through
  `host.readMedia` (remote) / `file:read` (local), plus Save As. Works against a plugin as
  old as 0.11.4, and against no plugin at all on a local gateway.
- **P1 — done.** `host.files.roots/list` + chunked `read`; the drawer, "new since you last
  looked". Needs joaxclaw-fs ≥ **0.12.0** on the host — a two-sided deploy (plugin update
  *and* an app rebuild). Without it the drawer shows the install notice and cards still work.
  The per-session filter did not ship: chat already scopes by conversation through the
  cards, so the drawer stays the "everything on the host" view.
- **P2 — routes out.** Save to a memory connection (a generated `.md` landing in the
  Obsidian vault is the natural home), zip "Download all (N)", send to a channel.
- **P3 — sharing proper (optional).** A public link via the joaxclaw.ai Vercel site. This
  is the only piece that's a genuinely new system (auth, storage, expiry) — deliberately
  last.

## Security

`operator.read` already implied "read any file on the host" via `host.readMedia`, so this
doesn't widen the grant — but it does make it routine, which is worth being deliberate
about on a gateway exposed over Tailscale. What the plugin enforces:

- **Roots allow-list** for listing — computed host-side; the client names a root by id.
- **No traversal, no symlink escape** — `subdir` is resolved and re-checked against the
  root, and each entry's `realpath` must still be inside it (a symlink pointing out is
  dropped, not followed).
- **Denylist on read**, root or not: `openclaw.json*`, `credentials*`, `auth.json`,
  `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, and the `.ssh` / `.gnupg` / `.aws` /
  `.config/gcloud` trees. This is a real tightening over `host.readMedia`, which has none.
- **Caps** — 500 entries per listing, 4 MiB per read chunk.
- **Dotfiles skipped** in listings — plumbing, not output.

Verified with an isolated harness that stubs the plugin SDK against a synthetic state
dir (27 checks, including the traversal, symlink, and denylist cases) rather than by
restarting a live gateway.

## Key files

| File | Role |
| --- | --- |
| `src/lib/artifacts.ts` | Artifact extraction from tool calls + `previewMode` classification |
| `src/lib/fileContent.ts` | Reading a host file (local Electron fs vs `host.files.read` vs `host.readMedia` fallback), base64 ↔ bytes, Save As |
| `src/lib/filePopout.ts` | Pop-out URL + the Electron/browser branch |
| `src/store/files.ts` | Drawer state, roots/listing, plugin probe, "new since" |
| `src/components/files/FilePreview.tsx` | The one viewer, used at all four zoom levels (also exports `FileGlyph`) |
| `src/components/files/FileDrawer.tsx` | The right panel |
| `src/components/files/FilePopout.tsx` | Root of a pop-out file window |
| `src/components/chat/ArtifactStrip.tsx` | In-message cards (sibling of `ScriptJobCard`) |
| `electron/main` `file:saveAs`, `file:popOut` | Save dialog + `createFileWindow()` |
| `plugins/joaxclaw-fs` `host.files.*` | Host-side roots + listing + chunked read (≥ 0.12.0) |

The cards are rendered from the message's tool calls, **not** inside `ToolCallsBlock` —
so they survive Basic mode, where the technical trail is hidden. `previewMode` and the
`file-write` detection deliberately mirror the vocabularies already encoded in
`detectKind()` (`AssistantMessage`) and `kindOf()` (`activityLabels`).

## See also

- [remote-gateway.md](./remote-gateway.md) — the local-vs-remote seam this reuses.
- [memory-tab.md](./memory-tab.md) — the precedent for browsing host-local content over
  the WS, and for the plugin-absent notice.
