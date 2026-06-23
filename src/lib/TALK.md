# Talk mode — voice conversation + (later) a 3D avatar

Design notes for a real-time spoken-conversation mode: speak to your agent and hear it
reply, eventually through an expressive 3D avatar. **Status: planned** (not built yet).

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
