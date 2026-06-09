# Teams — architecture notes

## Source-of-truth boundary

| On disk | TypeScript type | Role |
|---|---|---|
| `<id>.team.json` | `TeamBlueprint` | **Source of truth** — edit this to change a team |
| `<id>.md` | `ProcessDef` (serialized) | Execution artifact — always re-derivable from the blueprint |
| `<id>.revisions.json` | `TeamRevision[]` | Append-only save history (capped at 20) |

`TeamBlueprint` is the only durable model. The compiled `.md` is a projection:
`buildTeamProcessDef(bp, path)` can regenerate it at any time. When the user edits
the execution graph directly, `blueprint.graphCustomized === true` flags the divergence.
A Build-tab save always recompiles from the blueprint and clears the flag.

Never treat the graph editor as the source of truth. It is a viewport into the compiled
artifact, not an editor for the blueprint.

## Branching

Branching is stored in `TeamBlueprint.routes?: TeamRoute[]` — it is a first-class
blueprint field, not a graph-editor feature. The compiler produces the multi-edge
decision graph from the routes. The `ProcessDef` graph model handles both linear and
branching teams with the same node types: decision nodes reuse the `handoff` type with
multiple outgoing conditional edges.

**Skip-style routes** are supported. A branch can jump from member A directly to member
C, leaving B with no incoming edge in the compiled graph. Validation uses forward
reachability from `start` rather than raw edge counts:

- **Linear teams** (no routes): every node must be reachable from `start`.
- **Branching teams**: only `end` must be reachable; unreachable nodes are allowed because
  skip-style routes intentionally leave some members unreachable on certain execution paths.

See `teamValidation.ts` for the BFS implementation.

## Graph save durability

`saveCompiledDef` in `store/teams.ts`:
1. Writes the `.md` — returns `false` on failure.
2. Marks `blueprint.graphCustomized = true` and updates `blueprint.updatedAt`.
3. Appends a revision snapshot (same cadence as a blueprint save).
4. Persists both the blueprint and the revision file before updating in-memory state.
5. Returns `false` if any critical write fails.

The UI (`TeamsView.tsx → handleGraphSave`) checks the return value and shows an error
banner on failure. It does not call `onUpdated` when the save failed.

## The compiled process model

`ProcessDef` (`processParser.ts`) is the runtime format consumed by `processesStore`.
It contains the execution DAG (`graph`), the controller agent id, and a markdown `body`.

`processCompiler.ts` (`compileProcessToJob`, `buildLaunchPrompt`) reads only the graph —
it knows nothing about `TeamBlueprint`. This is intentional: once compiled, linear and
branching teams are indistinguishable to the runtime. The controller receives edges with
conditions and follows them; branching is just routing logic in the graph.

## Invariants to preserve

- **Branching state lives in `routes`, never in the compiled `.md`.**
- **`buildTeamProcessDef` is the single compilation entry point.** Linear and branching
  compilers are dispatched from there; both paths must pass the full test suite.
- **Validation uses reachability for branching teams**, not raw edge counts. Do not
  revert to an incoming-edge check — it breaks skip-style routing.
- **`graphCustomized` is cleared only by recompiling from the blueprint.** Never clear
  it without also regenerating the `.md`.
- **Any new `GraphNode` type** must be handled in `processCompiler.ts`'s `buildLaunchPrompt`
  or the controller will silently ignore those nodes at runtime.
