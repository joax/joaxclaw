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
| **Cron companion** | `detectByPort` → `CRON_COMPANIONS` | Probes each engine's `<default port>+1` (the Ollama `:11434→:11435` convention, generalized) for an isolated instance even when it isn't a declared provider. Runs locally and, via the plugin, against a remote host. |

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
| [ollamaHealth.ts](./ollamaHealth.ts) | Now just `gatewayHost`/`isLocalGateway` (generic, reused widely). The old Ollama-specific `checkOllama`/`resolveOllamaUrl` were removed — probing lives in `localEngines.ts`. |
| [electron/main/index.ts](../../electron/main/index.ts) | `ollama:probe` IPC (full-URL probe) and `ollama:fetch` IPC (full-URL GET returning the body, capped) — the local, non-CORS-bound side of liveness + model listing. |

## Job isolation logic (in `LocalEnginesPanel`)

For an engine group with a **config** cron provider:
- `contendingJobs` = jobs whose model prefix === the **main** provider id (should move to cron)
- `isolatedJobs` = jobs whose model prefix === the **cron** provider id
- A detected-only cron (running service, not a provider) shows a hint to add a `<engine>-cron` provider, since jobs can only target a configured provider.

## Per-engine URL overrides

`GatewayConnection.engineUrls?: Record<string, string>` (in `types.ts`) maps an engine
instance **key** (provider id, or `<engine>:<port>` for port-detected) → a client-reachable
URL. Set via `connection.setEngineUrl(gatewayUrl, key, url)` (empty url clears it). Used by
`checkInstance(inst, gatewayIsLocal, overrideUrl?)` — the override takes precedence over the
config baseUrl, which is how a remote gateway's loopback engines become reachable (point the
override at a tailnet/LAN URL; see the Help → Gateways page).

Both surfaces apply overrides:
- **Settings → Local LLM** ([../components/gateway/LocalEnginesCard.tsx](../components/gateway/LocalEnginesCard.tsx)) — one editable row per detected engine with **live reachability feedback** (Checking… / Reachable / Unreachable / Unknown) on mount, on edit-commit, and via a Re-check button.
- **Crons → Local LLM Engines panel** — reads `connection.engineUrls` and passes the override into `checkInstance`.

## Status / TODO (resume here)

Done:
- Config + default-port + cron-companion detection, generalized across all known engines.
- Generalized main-process probe (full URL, `/api/tags` vs `/v1/models`).
- `LocalEnginesPanel` (crons) replacing the Ollama-only panel.
- **Settings "Local LLM" tab** (was "Ollama") with `LocalEnginesCard`: per-engine URL overrides (`engineUrls` / `setEngineUrl`) + live probe feedback. Removed `OllamaEndpointsCard`/`OllamaUrlRow`/`WhyTwoOllamasOverlay` and `connection.ollamaUrls`/`setOllamaUrls`.
- Validated on a local gateway (only Ollama up → shown correctly; other engines absent → no false positives).
- **Remote-gateway liveness via the `joaxclaw-fs` plugin.** `engines.probe` / `engines.fetch` (host-side, SSRF-guarded to local-engine hosts) let the app check liveness and read model lists for engines on a *remote* gateway's loopback/LAN. `checkInstance` / `detectByPort` route through them when the gateway is remote and no client-reachable override is set (`probeStatus(url, viaGateway)` in [localEngines.ts](./localEngines.ts)); engines show `unknown` only when the plugin isn't installed. Default-port discovery also runs on the remote host. Verified end-to-end against a live gateway (probe up/down, SSRF rejects, real Ollama model list). See [../../plugins/joaxclaw-fs/README.md](../../plugins/joaxclaw-fs/README.md).
- **Per-engine model lists in the Settings card.** Each reachable engine fetches and shows its served models (count + expandable list). `fetchEngineModels()` / `parseModelIds()` in `localEngines.ts` are gateway-aware: local engines use the `ollama:fetch` main-process IPC (not CORS-bound), remote engines use `engines.fetch`. Ollama `/api/tags` (`models[].name`) and OpenAI-compatible `/models` (`data[].id`) both parse. Covered by `__tests__/localEngines.test.ts`.
- **Removed dead Ollama-only code** — `checkOllama`/`resolveOllamaUrl` are gone from `ollamaHealth.ts`, which now only holds `gatewayHost`/`isLocalGateway`.
- **Model picker lists each engine's installed models.** `ModelPicker` merges live engine models (via `fetchEngineModels`, gateway-aware) with config-declared ones, so a pulled-but-undeclared model is still selectable (tagged `installed`); the provider routes by name.
- **Cron-companion detection generalized to every engine.** `CRON_COMPANIONS` is now derived from `KNOWN_ENGINES` at `<default port>+1` (`CRON_PORT_OFFSET`), so isolated instances are auto-detected for LM Studio / vLLM / llama.cpp / Jan / KoboldCpp, not just Ollama. No offset collides with another engine's main port; unused ports just probe `down`.

Deferred:
- (none specific to local engines — see the project roadmap for larger features like curated per-channel policy.)
