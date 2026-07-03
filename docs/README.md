# JoaxClaw docs

Architecture notes and reusable concepts for future reference. Deeper, code-adjacent
notes also live next to the code they describe (e.g.
[src/lib/LOCAL_ENGINES.md](../src/lib/LOCAL_ENGINES.md),
[src/lib/TEAMS.md](../src/lib/TEAMS.md)).

| Doc | What it covers |
| --- | --- |
| [remote-gateway.md](./remote-gateway.md) | Local vs remote gateway operations — branch on `useIsRemoteGateway()`; prefer a WS RPC, else run on the host via an agent, else degrade honestly. Read before adding any gateway-affecting button/feature. |

## Conventions

- Notes are focused markdown: a short "why", a **key files** table with relative
  links, and (where useful) a status/known-gaps section.
- When a fix reveals a *repo-wide concept* (not just a one-off), capture the concept
  here rather than only fixing the call site — the next surface will hit the same
  thing.
