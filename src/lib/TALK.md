# Talk mode — voice conversation + (later) a 3D avatar

Design notes for a real-time spoken-conversation mode: speak to your agent and hear it
reply, eventually through an expressive 3D avatar. **Status: Phase 1 built** (voice loop +
reactive orb; no avatar yet). Code: `store/talk.ts`, `lib/talkAudio.ts`,
`components/talk/TalkView.tsx`. Phases 2–4 (avatar, expressions, WebRTC) are planned.

## The key insight: the gateway already owns the pipeline

OpenClaw has a first-class **Talk** subsystem — a complete realtime voice backend with
VAD, barge-in, and an "agent brain". JoaxClaw's job is a **Talk client + UX + avatar**,
*not* a STT→LLM→TTS pipeline. Latency, turn-taking, and provider plumbing are the
gateway's responsibility.

Config lives under `talk.*` (see `openclaw config schema`):
- `talk.realtime.mode`: `realtime` (OpenAI/Google realtime API) · `stt-tts` · `transcription`
- `talk.realtime.transport`: `webrtc` · `provider-websocket` · `gateway-relay` · `managed-room`
- `talk.realtime.brain`: `agent-consult` (the voice consults *your* agent — its tools/memory) · `direct-tools` · `none`
- `talk.realtime.provider`/`speakerVoice`, `talk.providers.<id>.apiKey` (openai/google/elevenlabs/inworld/minimax/xai)
- `talk.interruptOnSpeech`, `talk.silenceTimeoutMs`, `talk.speechLocale`

## RPC contract (over the existing gateway WebSocket)

Verified against the gateway protocol validators (`validateTalk*`).

**Session lifecycle**
- `talk.session.create({ mode?, transport?, brain?, provider?, model?, voice?, vadThreshold?, silenceDurationMs?, prefixPaddingMs?, reasoningEffort?, sessionKey?, ttlMs? })`
  → `{ sessionId, token, mode, transport, brain, provider?, model?, voice?, expiresAt?, relaySessionId?, roomUrl?, roomId? }`
- `talk.session.join({ sessionId, token })` → session detail incl. `recentTalkEvents` (reconnect/resume)
- `talk.session.appendAudio({ sessionId, audioBase64, timestamp? })` — stream mic audio (PCM16, base64)
- `talk.session.startTurn` / `endTurn` / `cancelTurn` `({ sessionId, turnId? })`
- `talk.session.cancelOutput({ sessionId, turnId?, reason? })` — **barge-in**: stop the agent's current speech
- `talk.ptt.start` / `stop` / `once` / `cancel` — push-to-talk control
- `talk.client.create` / `steer` / `toolCall`, `talk.config`, `talk.catalog` (providers/voices)

**Event stream** — `talk.event` frames, `type` ∈:
`speechStart` · `transcript` / `transcript.delta` / `transcript.done` · `transcription` ·
`audio` / `audioDone` · `tool.call` / `tool.progress` / `tool.result` · `error`

Map them to UI state: `speechStart`→user started (and barge-in trigger), `transcript.*`→live
captions, `audio`/`audioDone`→playback + visualizer + turn end, `tool.*`→activity chip,
`error`→error state.

## Phase 1 — the voice loop (no avatar)

Ship the full streaming loop behind a reactive **orb** first; prove latency + the Talk
integration before any 3D work.

```
Mic → AudioWorklet (PCM16 @24kHz) → talk.session.appendAudio ─► gateway Talk (VAD, brain:agent-consult)
UI state machine ◄── talk.event (speechStart, transcript.*, audio/audioDone, tool.*, error)
   └─ orb (mic level when listening, TTS level when speaking)
   barge-in: speechStart during SPEAKING → flush playback + talk.session.cancelOutput
```

- **Transport `gateway-relay`** (PCM16 base64 over the WS we already hold) — simplest, works
  local *and* remote, no WebRTC plumbing. `webrtc` is a later latency optimization.
- **`brain: agent-consult`** — talk to *your* agent, not a generic voice bot.
- Works for both `realtime` and `stt-tts` modes; the gateway abstracts it.

**To build**
- `store/talk.ts` — session lifecycle over the RPCs; subscribes to `talk.event`; exposes the
  state machine, transcript, and audio level.
- **Mic capture** — `getUserMedia` (echo-cancelled stream → AEC, so the agent never hears
  itself) + an **AudioWorklet** → downsample to PCM16 @ 24 kHz → `appendAudio`. (The existing
  voice input is MediaRecorder webm blobs — not reusable for streaming.)
- **Playback** — decode `audio` events → Web Audio queue with a small jitter buffer; flush on
  barge-in.
- `components/talk/TalkView` — centered orb + state label + two-sided live captions + controls
  (mute, end, push-to-talk hold, captions toggle).
- **Orb visualizer** — a CSS/Motion "Siri orb" (**no WebGL**, so it's immune to Electron GPU
  fallback and doubles as the avatar's degradation fallback). Switch its audio source
  **mic↔TTS** by state; encode state on **motion + colour + label** (WCAG); honour
  `prefers-reduced-motion`.
- **Settings** — provider/voice from `talk.catalog`, mode, eagerness (`silenceDurationMs` /
  semantic VAD), "interrupt while speaking" toggle, captions toggle.
- **Latency HUD** (debug) — time-to-first-audio + turn timings.

**Interaction state machine** (drive from `talk.event`)
```
idle → connecting → listening → user_speaking → thinking → speaking → listening
                         ▲            │ (speechStart)        │ (audioDone)
              (cancelOutput+flush) ───┴── interrupted ◄──────┘ (speechStart = barge-in)
   + tool_running (sub-state), muted, error
```

**UX rules (from research)**
- **Click-to-start → hands-free + server VAD + auto barge-in**, with a **push-to-talk hotkey**
  fallback. No wake word.
- **False-interrupt prevention is the make-or-break** (the #1 complaint about ChatGPT voice):
  AEC + the gateway's `interruptOnSpeech` + an "interrupt while speaking" toggle + mute; don't
  treat backchannels ("mm-hmm") as interrupts.
- **Latency masking** — the orb is always animating during `thinking`; optional short spoken
  filler. Never dead-still.
- **Captions** — two-sided, streaming partials, finalised on `transcript.done`, persisted.
- **Tool calls** — light inline chip ("🔍 Searching…"); non-blocking; user can still interject.
- **Lifecycle** — unambiguous Mute (session stays, agent may keep talking) + End; auto-reconnect
  with a visible state; fall back to text chat on failure.

## Later phases

- **Phase 2 — avatar.** `@pixiv/three-vrm` (VRM; **not Ready Player Me — RPM shut down Jan 2026**)
  + `@react-three/fiber` (v9). Lip-sync from the streaming audio via **met4citizen/HeadAudio**
  (AudioWorklet, MFCC→Oculus visemes, ~50 ms, MIT) with an AnalyserNode RMS→`jawOpen` fallback,
  plus a Web Audio `DelayNode` to align mouth↔sound. Bundle one optimised default VRM; detect GPU
  acceleration and degrade to the orb if software-rendered.
- **Phase 3 — expressions.** LLM emits a discrete emotion tag → VRM expression presets
  (`happy/sad/…`); rely on VRM `overrideMouth: blend` to resolve emotion-vs-viseme conflict on the
  mouth. Idle aliveness: randomised blink (~1.8 s, 120 ms), breathing (sine+Perlin ~14 bpm),
  micro-saccades + head-lag gaze, low-freq head sway. "Thinking" = in-character gaze-aside beat,
  **not** a spinner.
- **Phase 4 — `webrtc` transport** for lowest latency; full-duplex polish.

## Provider / mode / transport matrix (verified via `talk.catalog`)

`talk.catalog` splits providers by role, and **mode dictates transport**:

| Mode | Provider list (`catalog.*.providers`) | Transport | Notes |
|---|---|---|---|
| `realtime` | `catalog.realtime.providers` (e.g. Google "Live Voice", `supportsBrowserSession`) | `gateway-relay` | **Phase 1.** Speech-to-speech; needs a realtime key. |
| `stt-tts` | `catalog.speech.providers` (TTS, e.g. Google 30 voices) | **`managed-room`** | Needs a WebRTC-room client we haven't built — later phase. |
| `transcription` | `catalog.transcription.providers` (Deepgram, **ElevenLabs**) | `gateway-relay` | STT only, not a conversation. |

So **ElevenLabs is a transcription (STT) provider here — it can't drive realtime Talk**, and
provider keys live at **`talk.providers.<id>.apiKey`** (a different namespace from
`messages.tts.providers.<id>.apiKey` that the general TTS feature uses). `providersForMode()` /
`transportForMode()` in `store/talk.ts` encode this; Phase-1 UI offers `realtime` only.

## Decisions / open items

- **Transport:** start `gateway-relay` (simplicity + remote); revisit `webrtc` if relay latency
  disappoints.
- **Provider/key:** a `realtime` provider (openai/google) needs `talk.providers.<id>.apiKey`
  (the plugin Configure modal already manages these); otherwise run `stt-tts` with existing
  providers. Phase 1 should handle both.
- **Confirm at build:** exact `audio` event encoding for `gateway-relay` (PCM16 sample rate),
  and the `talk.ptt.*` param shapes (not in the validator `.d.ts`).

## References

- Avatar: VRM (`@pixiv/three-vrm`), `@react-three/fiber` v9, met4citizen/HeadAudio (lip-sync),
  met4citizen/TalkingHead (alt). RPM is discontinued.
- UX precedents: ChatGPT Advanced Voice, Gemini Live, Sesame, Inworld — converged on
  click-to-start + hands-free VAD + barge-in; false-interrupt guards are the differentiator.

---

# Research: fully-offline voice (local STT + local TTS)

**Question:** the brain can already be local (Ollama via `models.providers.<id>.baseUrl`), but
the Talk *voice* still calls a cloud provider (the OpenAI quota error). Can Talk run fully
offline? **Short answer: partially today, and the pieces exist — but the realtime `talk.*`
loop is cloud-only in the current client. The pragmatic target is `stt-tts` mode driven by
local engines the gateway already ships.** (Researched 2026-07-27.)

## What's already local vs cloud

| Layer | Config namespace | Local option available? |
|---|---|---|
| Brain (LLM) | `models.providers.<id>.baseUrl` + `.apiKey` | **Yes** — Ollama/LM Studio/vLLM/llama.cpp (already used) |
| General TTS / transcription | `messages.tts.providers.<id>` | **Yes** — `sherpa-onnx-tts` (offline TTS), `openai-whisper` (local STT) exist in the provider list (`pluginConfig.ts:46`) |
| **Realtime Talk voice** | `talk.providers.<id>.apiKey` | **No** — cloud only (openai/google/elevenlabs/deepgram/inworld/minimax/xai); the client writes **only** `apiKey`, and `talk.catalog` provider objects have **no** `baseUrl`/`endpoint` field |

Key implication: the gateway **can** host in-process offline voice engines (sherpa-onnx + local
Whisper) — just in the `messages.tts.*` namespace, not (yet, as far as the client knows) wired
into the realtime `talk.*` conversation loop. The gateway is **not vendored** in this repo, so
whether an undocumented gateway-side `talk.*` local option / `baseUrl` exists must be confirmed
against a live gateway (`openclaw config schema` + `talk.catalog`).

## The realtime-vs-stt-tts split (this is the crux)

- **`realtime`** = speech-to-speech models (OpenAI Realtime, Google Live). Fully-local equivalents
  exist but are the *least* mature part of the ecosystem (Kyutai Moshi/Unmute, LocalAI/Speaches
  `/v1/realtime`). Emulating the OpenAI Realtime WebSocket locally is bleeding-edge.
- **`stt-tts`** = separate local STT + local TTS with the LLM brain in the middle. This is the
  **realistic offline path** — and it maps onto the local engines the gateway already lists.
  Caveat: `stt-tts` uses the `managed-room` transport, whose WebRTC-room client **is not built**
  in Phase 1 (only `gateway-relay` is). So enabling offline Talk likely means client transport
  work, not just flipping a provider.

## Two candidate architectures

**A. Local engines inside the gateway's Talk pipeline (preferred if supported).**
Run Talk in `stt-tts` mode with local STT (whisper) + local TTS (sherpa-onnx / Kokoro / Piper)
selected as the speech/transcription providers. Cleanest — reuses the gateway pipeline, VAD,
barge-in. **Blocked on two unknowns:** (1) does `talk.catalog` surface the local engines in its
`speech`/`transcription` buckets? (2) does the client need the unbuilt `managed-room` transport,
or can `stt-tts` run over `gateway-relay`?

**B. OpenAI-compatible local server shim.**
Run **Speaches** or **LocalAI** on localhost exposing `/v1/audio/transcriptions` + `/v1/audio/speech`
(and possibly `/v1/realtime`). Point a Talk provider's base URL at it. **Blocked on:** Talk
providers expose no `baseUrl` in the client/catalog today — needs a gateway-side override to exist,
or a client change to write one. Feasible only if the gateway accepts a custom talk endpoint.

**C. Bespoke client-side pipeline (fallback, fully under app control).**
Bypass the gateway Talk subsystem: mic → local VAD (Silero) → local STT → chat LLM (local) →
local TTS → speaker, with interrupt-on-speech. Pattern: **RealtimeVoiceChat** (KoljaB) — browser ⇄
WS backend, RealtimeSTT → Ollama → RealtimeTTS, ~500 ms latency, real barge-in. Or **Pipecat**.
Most work, but no dependency on gateway Talk capabilities.

## Recommended local stack (2026, pragmatic)

- **STT:** faster-whisper (GPU int8) or Kyutai STT 1B (native **semantic VAD** → best turn-taking);
  whisper.cpp / Moonshine for CPU-only; NVIDIA Parakeet if English/European-only + max throughput.
- **TTS:** **Kokoro-82M** (fast, clean, Apache-2.0, no cloning) is the sweet spot; **Piper** for
  near-zero compute; **Chatterbox** (MIT) if expressive/voice-cloning is wanted; XTTS-v2 heaviest +
  license-restricted.
- **Orchestration shim:** **Speaches** ("Ollama for STT/TTS": faster-whisper + Kokoro/Piper, exposes
  `/v1/audio/*` **and** `/v1/realtime`) — the closest single match for architecture B.
- **Turn-taking matters more than raw ms:** perceived latency is dominated by end-of-turn detection
  — prioritize semantic VAD over shaving transcription delay.

**Latency/hardware:** CPU-only is feasible but turn-based, ~1–2 s+ perceived. A consumer NVIDIA GPU
(3090/4090) with faster-whisper + Kokoro/Chatterbox reaches ~500 ms with barge-in. VRAM ≈ STT 1–3 GB
+ TTS 1–6 GB + the Ollama model.

## Decisive next step (cheap, unblocks everything)

Probe the **live gateway** (fits the repo's established "probe the real gateway" methodology):
1. `talk.catalog` → do the `speech`/`transcription` buckets list local engines (sherpa-onnx, whisper)?
2. `openclaw config schema` for `talk.*` → is there any `baseUrl`/`endpoint`/local-provider key the
   client doesn't currently write?
3. Does `stt-tts` run over `gateway-relay`, or does it require `managed-room` (unbuilt)?

Those three answers pick the architecture: **A** if the catalog already exposes local engines,
**B** if a talk baseUrl override exists, **C** otherwise.

## Sources (local voice stacks)

STT: whisper.cpp, faster-whisper, whisper-streaming, Moonshine, Vosk, NVIDIA Parakeet, Kyutai STT.
TTS: Piper, Kokoro (kokoro-onnx), Coqui XTTS-v2, StyleTTS2, Chatterbox, Kyutai TTS/Moshi.
Servers: Speaches (speaches.ai), LocalAI (localai.io/features/openai-realtime), openedai-speech,
whisper.cpp server. Realtime/orchestration: Kyutai Moshi/Unmute, RealtimeVoiceChat, Pipecat,
LiveKit Agents. (Ollama has **no** native audio yet — issues #11021 TTS, #15807 realtime — keep
the LLM in Ollama, STT/TTS in a separate local server.)
