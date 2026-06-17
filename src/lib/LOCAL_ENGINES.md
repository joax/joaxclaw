# Local LLM engines — architecture notes

How JoaxClaw detects and health-checks **local** LLM inference engines (Ollama, LM
Studio, vLLM, llama.cpp, LocalAI, Jan, KoboldCpp, …) and surfaces them in the cron
**isolation** panel. Generalized from the original Ollama-only implementation.

## Why "isolation"?

A local engine generally serves **one request at a time per model** — a new request
preempts the in-flight one. If scheduled CRON jobs and interactive chats share one
engine instance, a job firing mid-conversation cancels the active session
("last request wins"). The fix is a **second, isolated instance** for background work:

- **Main** instance → interactive chats & agents
- **CRON** instance → background scheduled jobs (jobs target it via a `<engine>-cron/` model prefix)

They share model files on disk but have separate request/GPU queues. This is the
Ollama `ollama` (:11434) / `ollama-cron` (:11435) convention, generalized to any engine.

## Detection — mirrors the gateway

We deliberately mirror the gateway's own `model-preflight.runtime` logic so the UI
agrees with what the gateway will actually do:

- **Local host** = loopback / `0.0.0.0` / `::1` / `*.local` / private IPv4 (10/8, 172.16–31, 192.168/16). See `isLocalHost()`.
- **Health path** = `/api/tags` for `api: "ollama"`, else `/models` (OpenAI-compatible). See `healthUrl()`.

Three detection sources (in [localEngines.ts](./localEngines.ts)):

| Source | Function | When |
|---|---|---|
| **Config** | `detectFromConfig(providers)` | Always. Reads `models.providers` (from `config.get`); keeps providers whose `baseUrl` host is local and whose `api` maps to a probe family (`ollama` or `openai`). |
| **Default ports** | `detectByPort(existing)` | **Local gateway only.** Probes known engine default ports not already in config (LM Studio 1234, vLLM 8000, llama.cpp/LocalAI 8080, Jan 1337, KoboldCpp 5001). |
| **Cron companion** | `detectByPort` → `CRON_COMPANIONS` | **Local gateway only.** Probes the Ollama `:11435` cron convention even when it isn't a declared provider. |

Engines are then `groupEngines()`'d into `{ main, cron }` pairs (cron = provider id
ending in `-cron`, or a detected companion).

### Engine registry

`KNOWN_ENGINES` in [localEngines.ts](./localEngines.ts): `{ id, label, api, defaultPort, basePath }`.
`api` is the probe family — `'ollama'` (path `/api/tags`) or `'openai'` (base `/v1`, path `/models`).

## Health status

`checkInstance(inst, gatewayIsLocal)` → `'up' | 'down' | 'unknown'`:

- Reachable when the gateway is local, **or** the instance host is non-loopback (a LAN IP we can reach).
- Remote gateway + loopback instance → **`unknown`** (Ollama/engine runs on the server; we can't probe it from the client). Never reported as `down`.

Probing runs in the **Electron main process** (`ollama:probe` IPC, [electron/main/index.ts](../../electron/main/index.ts)) — not the renderer — so it isn't CORS-bound and can reach remote/LAN hosts. The IPC takes a **full health URL** (caller builds it via `healthUrl()`).

## Key files

| File | Role |
|---|---|
| [localEngines.ts](./localEngines.ts) | Engine registry, local-host classification, detection (config / port / cron companion), grouping, probing. |
| [../components/crons/LocalEnginesPanel.tsx](../components/crons/LocalEnginesPanel.tsx) | The generalized cron isolation panel (one card per engine: Main/CRON health, isolation status, setup hints). Polls every 6s. |
| [../components/crons/CronsView.tsx](../components/crons/CronsView.tsx) | Mounts `<LocalEnginesPanel jobs={jobs} />` in the cron sidebar. |
| [ollamaHealth.ts](./ollamaHealth.ts) | Older Ollama-specific helpers — still exports `gatewayHost`/`isLocalGateway` (generic, reused widely) and the Ollama `resolveOllamaUrl` used by Settings. `checkOllama` is now unused (dead, safe to remove later). |
| [electron/main/index.ts](../../electron/main/index.ts) | `ollama:probe` IPC (full-URL probe). |

## Job isolation logic (in `LocalEnginesPanel`)

For an engine group with a **config** cron provider:
- `contendingJobs` = jobs whose model prefix === the **main** provider id (should move to cron)
- `isolatedJobs` = jobs whose model prefix === the **cron** provider id
- A detected-only cron (running service, not a provider) shows a hint to add a `<engine>-cron` provider, since jobs can only target a configured provider.

## Status / TODO (resume here)

Done:
- Config + default-port + Ollama-cron-companion detection, generalized across engines.
- Generalized main-process probe (full URL, `/api/tags` vs `/v1/models`).
- New `LocalEnginesPanel` replacing the Ollama-only panel.
- Validated on a local gateway (only Ollama up → shown correctly; other engines absent → no false positives).

Deferred:
- **Settings → "Ollama Endpoints" card is still Ollama-only.** It edits per-connection
  `connection.ollamaUrls.{main,cron}` overrides. To generalize, move to a per-provider
  URL map (e.g. `connection.engineUrls: Record<providerId, string>`) and render a row per
  detected engine. Touches: `GatewayView.tsx` (OllamaEndpointsCard), `store/connection.ts`
  (`setOllamaUrls` → `setEngineUrl`), `types.ts` (`GatewayConnection`).
- **Remote-gateway liveness** for non-loopback instances relies on the engine being on a
  client-reachable host; loopback-on-server stays `unknown`. A gateway-side probe RPC would
  fix this (no such RPC exists today; the gateway only probes during cron preflight).
- **Cron-companion ports** are hardcoded for Ollama only (`:11435`). Other engines rely on a
  declared `<engine>-cron` provider.
- `checkOllama` in `ollamaHealth.ts` is dead — remove when convenient.
