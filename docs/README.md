# JoaxClaw docs

Architecture notes and reusable concepts for future reference. Deeper, code-adjacent
notes also live next to the code they describe (e.g.
[src/lib/LOCAL_ENGINES.md](../src/lib/LOCAL_ENGINES.md),
[src/lib/TEAMS.md](../src/lib/TEAMS.md)).

| Doc | What it covers |
|---|---|
| [secret-refs.md](./secret-refs.md) | The `SecretRef` credential-indirection pattern — secrets as literal strings **or** `{ source, provider, id }` references; UI rules (never render the object, edit literals only, round-trip refs untouched). Read before touching any credential/API-key field. |
| [branding.md](./branding.md) | Logo assets, the `<img>` usage pattern, which surfaces use the logo vs. lucide icons, and "emoji placeholders aren't branding". |

## Conventions

- Notes are focused markdown: a short "why", a **key files** table with relative
  links, and (where useful) a status/TODO section to resume from.
- When a fix reveals a *repo-wide concept* (not just a one-off), capture the concept
  here rather than only fixing the call site — the next surface will hit the same
  thing.
