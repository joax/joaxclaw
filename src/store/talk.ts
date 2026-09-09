// Talk-mode store: drives a realtime voice conversation over the gateway's Talk API.
// The gateway owns the voice pipeline (VAD, barge-in, turn-taking); this orchestrates the
// session RPCs, consumes the `talk.event` stream, runs the interaction state machine,
// wires the audio engine (mic → appendAudio, agent audio → playback), and — because the
// relay delegates it — drives the agent consult behind `brain: agent-consult` (see the
// consult contract below). src/lib/TALK.md has the full protocol and the Phase-1 scope.

import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { TalkAudio } from '../lib/talkAudio'

export type VisualizerStyle = 'orb' | 'bars' | 'radial' | 'blob'
const VIZ_KEY = 'joaxclaw-talk-visualizer'
function loadViz(): VisualizerStyle {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(VIZ_KEY) : null
  return v === 'bars' || v === 'radial' || v === 'blob' ? v : 'orb'
}

export type TalkPhase =
  | 'idle' | 'connecting' | 'listening' | 'user_speaking'
  | 'thinking' | 'speaking' | 'tool_running' | 'error'

// Pure interaction-state transition (unit-tested), keyed to the gateway's *typed*
// event names (`talkEvent.type`) — see readEventKind() for how the flat relay
// envelope is normalized onto them. `role` distinguishes user vs agent transcripts.
// Unhandled events leave the phase unchanged.
//
// Two transitions deliberately live outside this function: `session.ready` is start()'s
// capture gate rather than a phase change, and the return to `listening` comes from the
// playback queue draining (the realtime relay has no dependable end-of-speech event).
export function nextPhase(phase: TalkPhase, evt: string, role?: 'user' | 'assistant'): TalkPhase {
  switch (evt) {
    // A user transcript is the only speech-onset signal this transport offers — the
    // realtime relay never sends `speechStart` (only the transcription relay does).
    case 'transcript.delta':   return role === 'user' ? 'user_speaking' : phase
    case 'transcript.done':    return role === 'user' ? 'thinking' : phase
    // The agent is composing; audio usually trails the first text by a second or two.
    case 'output.text.delta':
    case 'output.text.done':   return phase === 'speaking' ? phase : 'thinking'
    case 'output.audio.delta': return 'speaking'
    case 'tool.call':
    case 'tool.progress':      return 'tool_running'
    case 'tool.result':
    case 'tool.error':         return phase === 'tool_running' ? 'thinking' : phase
    case 'session.error':      return 'error'
    case 'session.closed':     return 'idle'
    default:                   return phase
  }
}

export interface TalkProvider {
  id: string
  label: string
  configured: boolean
  modes: string[]
  brains: string[]
  models?: string[]
  voices?: string[]
}
export interface TalkCatalog {
  modes: string[]
  transports: string[]
  brains: string[]
  // Providers are split by role: realtime (speech-to-speech), speech (TTS for stt-tts),
  // and transcription (STT). A provider's key lives at talk.providers.<id>.apiKey.
  realtime?: { providers: TalkProvider[] }
  speech?: { providers: TalkProvider[] }
  transcription?: { providers: TalkProvider[] }
}

// Providers usable for a given mode. Phase 1 supports `realtime` (gateway-relay).
export function providersForMode(catalog: TalkCatalog | null, mode: string): TalkProvider[] {
  if (!catalog) return []
  if (mode === 'realtime') return catalog.realtime?.providers ?? []
  if (mode === 'stt-tts') return catalog.speech?.providers ?? []
  if (mode === 'transcription') return catalog.transcription?.providers ?? []
  return []
}

// Each mode needs a specific transport (confirmed against the live gateway):
// realtime → gateway-relay (browser session); stt-tts → managed-room (not in Phase 1).
export function transportForMode(mode: string): string {
  return mode === 'stt-tts' ? 'managed-room' : 'gateway-relay'
}

// Where a provider's API key lives depends on the mode, and the namespaces are not
// interchangeable: realtime Talk resolves keys from `talk.realtime.providers.<id>`
// (falling back to `models.providers.<id>.apiKey`, which is why a provider can already
// read as configured with no `talk` block at all). The generic `talk.providers.<id>`
// bucket is a different place, and writing a realtime key there has no effect.
export function providerKeyPath(mode: string): string {
  return mode === 'realtime' ? 'talk.realtime.providers' : 'talk.providers'
}

// How a final user transcript reaches the agent. `provider-direct` (the gateway default)
// leaves it to the realtime model to decide whether to call `openclaw_agent_consult` — and
// when it decides not to, it answers from its own head or, worse, promises to check and
// then says nothing: there is no tool call, so nothing ever consults the agent.
// `force-agent-consult` makes the gateway route every finished user turn to the agent
// itself (it stops the provider auto-answering and synthesizes the consult).
export type ConsultRouting = 'provider-direct' | 'force-agent-consult'

export function consultRoutingPatch(routing: ConsultRouting): unknown {
  return { talk: { realtime: { consultRouting: routing } } }
}

export function providerKeyPatch(mode: string, providerId: string, apiKey: string | null): unknown {
  const entry = { [providerId]: { apiKey } }
  return mode === 'realtime' ? { talk: { realtime: { providers: entry } } } : { talk: { providers: entry } }
}

export interface TalkTranscriptLine { id: string; role: 'user' | 'assistant'; text: string; final: boolean }

// One action the agent took during the call (a tool call + its lifecycle) — the
// transparency feed.
export interface TalkActivity {
  id: string
  name: string
  args?: string
  status: 'running' | 'done' | 'error'
  result?: string
  error?: string
  progress?: string
  ts: number
}

export interface TalkConfig {
  mode: string
  transport: string
  brain: string
  provider?: string
  voice?: string
  agentId?: string   // which agent answers (agent-consult); undefined = gateway default
}

interface TalkState {
  phase: TalkPhase
  sessionId: string | null
  error: string | null
  muted: boolean
  micLevel: number
  agentLevel: number
  transcript: TalkTranscriptLine[]
  toolActivity: string | null
  activity: TalkActivity[]
  catalog: TalkCatalog | null
  config: TalkConfig
  // The gateway's `talk.realtime.consultRouting`. null until read from the gateway.
  consultRouting: ConsultRouting | null
  visualizer: VisualizerStyle

  setVisualizer: (v: VisualizerStyle) => void
  fillFrequencies: (kind: 'mic' | 'agent', out: Uint8Array<ArrayBuffer>) => boolean
  loadCatalog: () => Promise<void>
  setConfig: (patch: Partial<TalkConfig>) => void
  setProviderKey: (providerId: string, key: string) => Promise<boolean>
  setConsultRouting: (routing: ConsultRouting) => Promise<boolean>
  start: () => Promise<void>
  stop: () => Promise<void>
  toggleMute: () => void
  interrupt: () => void
}

const DEFAULT_CONFIG: TalkConfig = { mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult' }

// ── the consult contract (why Talk needs more than the session RPCs) ─────────────
//
// The realtime relay does NOT run the agent for us. When the voice model calls
// `openclaw_agent_consult`, the gateway parks the provider on a "working" placeholder
// (that's the `tool.progress` frame), forwards the tool call to the owning client, and
// then waits for *that client* to run the consult and submit the result. A client that
// only renders the tool call leaves the provider waiting forever — the call goes silent
// at "Working…". So this round-trip is mandatory, not an enhancement:
//
//   tool.call openclaw_agent_consult
//     → talk.client.toolCall            starts a chat run on the agent session
//     → watch `chat` events for runId    until state=final (the answer text)
//     → talk.session.submitToolResult    { result: text } → the voice speaks it
//
//   tool.call openclaw_agent_control     ("are you still working?", "stop that")
//     → talk.session.steer               → submitToolResult with the steer result
const CONSULT_TOOL = 'openclaw_agent_consult'
const CONTROL_TOOL = 'openclaw_agent_control'
// The consult RPC returns as soon as the agent run is acknowledged, not when it answers.
const CONSULT_START_TIMEOUT_MS = 60000
// How long to wait for the agent's answer before handing the provider an error, so the
// voice says something instead of going quiet.
const CONSULT_TIMEOUT_MS = 120000

// Which agent session the voice consults. `talk.session.create` resolves an omitted key
// to the agent's main session but never reports which key it picked — and
// `talk.client.toolCall` rejects a mismatch ("relay session belongs to another agent
// session"), so we always send an explicit key and reuse that exact string.
export function talkSessionKey(agentId?: string): string {
  return agentId ? `agent:${agentId}:main` : 'main'
}

// Tool args arrive as an object from the typed event, but a provider may hand the relay
// the raw JSON string it generated.
export function parseToolArgs(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') {
    try { return JSON.parse(args || '{}') as Record<string, unknown> } catch { return {} }
  }
  return args && typeof args === 'object' ? args as Record<string, unknown> : {}
}

// The agent's answer as the chat `final` event carries it: a plain `text`, or content
// blocks to be joined.
export function readRunText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const m = message as { text?: unknown; content?: unknown }
  if (typeof m.text === 'string') return m.text.trim()
  if (!Array.isArray(m.content)) return ''
  return m.content
    .map(b => {
      const block = b as { type?: unknown; text?: unknown } | null
      return block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean).join('\n\n').trim()
}

// The gateway wraps request errors as Error(JSON.stringify({code,message,details})). Pull
// out the human-readable talkIssue/message so the UI shows "… provider not configured"
// instead of a JSON blob.
export function talkErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  try {
    const obj = JSON.parse(raw.replace(/^Error:\s*/, ''))
    return String(obj?.details?.talkIssue?.message ?? obj?.message ?? raw)
  } catch { return raw }
}

// Audio engine + event unsubscribe live outside the store (not React/serializable state).
let audio: TalkAudio | null = null
let unsubEvents: (() => void) | null = null
// The agent session this call consults — chosen at start(), replayed on every
// talk.client.toolCall (the gateway rejects any other key for this relay session).
let sessionKey: string | null = null
// Consults in flight, callId → the agent run behind it. Doubles as the de-dupe guard:
// the relay can re-emit a tool call (a forced consult racing the provider's own).
const consults = new Map<string, { runId?: string; cancel?: () => void }>()
// Resolved by the `session.ready` event; start() waits on it before opening the mic.
let resolveReady: (() => void) | null = null
// Debounces the end of agent speech — see scheduleDrainCheck().
let drainTimer: ReturnType<typeof setTimeout> | null = null

// How long to wait for `session.ready` before opening the mic anyway.
const READY_TIMEOUT_MS = 6000
// How long the playback queue must stay empty before we call the agent's turn over.
const DRAIN_GRACE_MS = 400

function cancelDrain(): void {
  if (drainTimer) { clearTimeout(drainTimer); drainTimer = null }
}

// Hanging up mid-consult must also stop the agent run it started — otherwise the turn
// keeps running (and writing to the session) after the call is over.
function cancelConsults(): void {
  for (const [, run] of consults) {
    if (run.runId && sessionKey) {
      void gatewayClient.request('chat.abort', { sessionKey, runId: run.runId }).catch(() => {})
    }
    run.cancel?.()
  }
  consults.clear()
}

// Drop the local session: audio engine, event subscription, pending waiters. Used by
// stop() and by `session.closed`, which means the gateway already tore its side down.
async function teardown(): Promise<void> {
  cancelDrain()
  cancelConsults()
  sessionKey = null
  resolveReady = null
  await audio?.stop()
  audio = null
  unsubEvents?.()
  unsubEvents = null
}

// ── reading a talk.event frame ──────────────────────────────────────────────────
//
// The gateway sends every event twice inside one frame: a flat envelope shaped for the
// relay transport (`type: "audio"`, data at the top level) and the authoritative typed
// event nested under `talkEvent` (`type: "output.audio.delta"`). The two use different
// vocabularies. We key behaviour off the typed name and read data from whichever level
// carries it — the envelope is not optional, because `audioDone` frames arrive with no
// `talkEvent` at all.

type Frame = Record<string, unknown>

// Flat envelope name → typed event name, for frames where the typed event is absent
// or where the envelope is the only thing that distinguishes two cases.
const ENVELOPE_KIND: Record<string, string> = {
  ready: 'session.ready',
  transcript: 'transcript.delta',
  partial: 'transcript.delta',
  audio: 'output.audio.delta',
  audioDone: 'output.audio.done',
  clear: 'output.audio.done',
  mark: 'output.audio.done',
  inputAudio: 'input.audio.delta',
  speechStart: 'turn.started',
  toolCall: 'tool.call',
  toolProgress: 'tool.progress',
  toolResult: 'tool.result',
  error: 'session.error',
  close: 'session.closed',
}

function nested(p: Frame): Frame { return (p.talkEvent ?? {}) as Frame }
function nestedPayload(p: Frame): Frame { return (nested(p).payload ?? {}) as Frame }

export function readEventKind(p: Frame): string {
  const typed = String(nested(p).type ?? '')
  if (typed) return typed
  const envelope = String(p.type ?? '')
  return ENVELOPE_KIND[envelope] ?? envelope
}

export function readRole(p: Frame, kind: string): 'user' | 'assistant' | undefined {
  const r = String(p.role ?? nestedPayload(p).role ?? '')
  if (r === 'user' || r === 'assistant') return r
  // Assistant text events carry no role of their own — the event name is the role.
  return kind.startsWith('output.') ? 'assistant' : undefined
}

function readText(p: Frame): string {
  const t = p.text ?? nestedPayload(p).text
  return typeof t === 'string' ? t : ''
}

function readFinal(p: Frame): boolean {
  return p.final === true || nested(p).final === true
}

function readAudio(p: Frame): string | null {
  return typeof p.audioBase64 === 'string' ? p.audioBase64 : null
}

// A caption line groups by turn and speaker. `talkEvent.id` cannot do this — it is
// unique per event (`<sessionId>:<seq>`), so grouping on it yields one line per
// fragment.
export function readLineId(p: Frame, role: 'user' | 'assistant' | undefined): string {
  const turn = String(nested(p).turnId ?? p.turnId ?? 'turn')
  return `${turn}:${role ?? 'user'}`
}

// `clear` means the provider is discarding buffered output (its own barge-in) rather
// than reaching the end of a stream, so the queued audio must be dropped.
function isDiscard(p: Frame): boolean {
  return p.type === 'clear' || nestedPayload(p).reason === 'clear'
}

function readToolId(p: Frame): string {
  return String(p.callId ?? nested(p).callId ?? p.itemId ?? nested(p).itemId ?? 'tool')
}

// Providers differ on whether a transcript event is a fragment or the whole utterance
// so far. Append fragments, but recognise a resend and replace instead, so a final
// event carrying the full text doesn't double the caption.
export function mergeTranscript(prev: string, next: string): string {
  if (!next) return prev
  if (!prev) return next
  if (next.startsWith(prev)) return next
  if (prev.endsWith(next)) return prev
  return prev + next
}
// Compact, display-safe rendering of tool args/results (objects → JSON, capped).
export function summarize(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = typeof v === 'string' ? v : (() => { try { return JSON.stringify(v) } catch { return String(v) } })()
  return s.length > 600 ? s.slice(0, 600) + '…' : s
}

export const useTalkStore = create<TalkState>((set, get) => ({
  phase: 'idle',
  sessionId: null,
  error: null,
  muted: false,
  micLevel: 0,
  agentLevel: 0,
  transcript: [],
  toolActivity: null,
  activity: [],
  catalog: null,
  config: DEFAULT_CONFIG,
  consultRouting: null,
  visualizer: loadViz(),

  setVisualizer(v) {
    try { localStorage.setItem(VIZ_KEY, v) } catch { /* ignore */ }
    set({ visualizer: v })
  },

  // Read the live FFT bins for the orb/bars/radial visualizers (called per frame by
  // the visualizer, not stored — avoids 60fps setState).
  fillFrequencies(kind, out) { return audio?.readFrequencies(kind, out) ?? false },

  async loadCatalog() {
    try {
      const cat = await gatewayClient.request<TalkCatalog>('talk.catalog', {})
      set({ catalog: cat })
      // Read how the gateway routes a finished user turn — the difference between the
      // agent answering and the voice model deciding on its own whether to ask it.
      try {
        const cfg = await gatewayClient.request<{ config?: { talk?: { realtime?: { consultRouting?: string } } } }>('talk.config', {})
        const routing = cfg.config?.talk?.realtime?.consultRouting
        set({ consultRouting: routing === 'force-agent-consult' ? 'force-agent-consult' : 'provider-direct' })
      } catch { /* older gateway: leave it unknown */ }
      // Default to the first configured provider for the current mode (prefer one with a key).
      const forMode = providersForMode(cat, get().config.mode)
      const pick = forMode.find(p => p.configured) ?? forMode[0]
      if (pick && !get().config.provider) {
        set(s => ({ config: { ...s.config, provider: pick.id, voice: pick.voices?.[0] } }))
      }
    } catch (e) { set({ error: String(e) }) }
  },

  setConfig(patch) { set(s => ({ config: { ...s.config, ...patch } })) },

  // Write a provider's API key, then refresh the catalog so `configured` flips. Works
  // local + remote via config.patch.
  async setProviderKey(providerId, key) {
    try {
      const snap = await gatewayClient.request<{ hash?: string }>('config.get', {})
      await gatewayClient.request('config.patch', {
        raw: JSON.stringify(providerKeyPatch(get().config.mode, providerId, key.trim() || null)),
        ...(snap.hash ? { baseHash: snap.hash } : {}),
      })
      await get().loadCatalog()
      return true
    } catch (e) { set({ error: talkErrorMessage(e) }); return false }
  },

  // Switch the gateway between "the voice model decides whether to ask your agent" and
  // "every turn goes to your agent".
  async setConsultRouting(routing) {
    const previous = get().consultRouting
    set({ consultRouting: routing })
    try {
      const snap = await gatewayClient.request<{ hash?: string }>('config.get', {})
      await gatewayClient.request('config.patch', {
        raw: JSON.stringify(consultRoutingPatch(routing)),
        ...(snap.hash ? { baseHash: snap.hash } : {}),
      })
      return true
    } catch (e) { set({ error: talkErrorMessage(e), consultRouting: previous }); return false }
  },

  async start() {
    if (get().phase !== 'idle' && get().phase !== 'error') return
    set({ phase: 'connecting', error: null, transcript: [], toolActivity: null, activity: [] })

    // Subscribe to the talk.event stream before creating the session.
    unsubEvents?.()
    unsubEvents = gatewayClient.on(frame => {
      if (frame.event !== 'talk.event') return
      handleTalkEvent(set, get, (frame.payload ?? {}) as Record<string, unknown>)
    })

    try {
      const { config } = get()
      // Bind the call to an agent session up front and keep the key: the consult RPC
      // needs this exact string, and the gateway never tells us which key it resolved.
      sessionKey = talkSessionKey(config.agentId)
      const res = await gatewayClient.request<{ sessionId: string }>('talk.session.create', {
        mode: config.mode,
        transport: transportForMode(config.mode),
        brain: config.brain,
        sessionKey,
        ...(config.provider ? { provider: config.provider } : {}),
        ...(config.voice ? { voice: config.voice } : {}),
      })
      const sessionId = res.sessionId
      set({ sessionId })

      // The relay answers `session.ready` only once its upstream provider session is
      // established (~400 ms). Audio appended before that is discarded, which costs
      // the start of the first utterance — so hold the mic until it lands, but don't
      // hang forever if a provider never signals.
      await Promise.race([
        new Promise<void>(resolve => { resolveReady = resolve }),
        new Promise<void>(resolve => setTimeout(resolve, READY_TIMEOUT_MS)),
      ])
      resolveReady = null

      audio = new TalkAudio({
        onAudioChunk: (audioBase64) => {
          const sid = get().sessionId
          if (sid) void gatewayClient.request('talk.session.appendAudio', { sessionId: sid, audioBase64 }).catch(() => {})
        },
        onMicLevel: (l) => set({ micLevel: l }),
        onAgentLevel: (l) => set({ agentLevel: l }),
        onPlaybackDrained: () => scheduleDrainCheck(set, get),
      })
      await audio.startCapture()
      set({ phase: 'listening' })
    } catch (e) {
      await teardown()
      set({ phase: 'error', error: talkErrorMessage(e) })
    }
  },

  async stop() {
    const sid = get().sessionId
    // Stop the mic before closing, so no appendAudio races the close.
    await teardown()
    // Close the session rather than only cancelling its turn: the gateway allows two
    // relay sessions per connection, and a cancelled turn keeps its slot for the
    // session's 30-minute TTL. A client that never closes can start Talk exactly
    // twice, then gets "Too many active realtime relay sessions" until it reconnects.
    if (sid) await gatewayClient.request('talk.session.close', { sessionId: sid }).catch(() => {})
    set({ phase: 'idle', sessionId: null, micLevel: 0, agentLevel: 0, muted: false, toolActivity: null })
  },

  toggleMute() {
    const muted = !get().muted
    audio?.setMuted(muted)
    set({ muted })
  },

  // Barge-in: stop the agent's current output and flush local playback.
  interrupt() {
    const sid = get().sessionId
    if (sid) void gatewayClient.request('talk.session.cancelOutput', { sessionId: sid }).catch(() => {})
    audio?.flushPlayback()
    set({ phase: 'listening', agentLevel: 0 })
  },
}))

// ── event handling (kept out of the store object for readability) ───────────────

type SetFn = (partial: Partial<TalkState> | ((s: TalkState) => Partial<TalkState>)) => void
type GetFn = () => TalkState

// Return to `listening` once the playback queue has run dry *and stayed* dry. Agent
// audio arrives in chunks that can lag playback slightly, and a momentary gap between
// them is not the end of a turn. This is the only reliable end-of-speech signal on the
// realtime relay: Google never emits `audioDone`, and `clear` can arrive mid-turn.
function scheduleDrainCheck(set: SetFn, get: GetFn): void {
  cancelDrain()
  drainTimer = setTimeout(() => {
    drainTimer = null
    if (audio?.isPlaying) return
    if (get().phase === 'speaking') set({ phase: 'listening', agentLevel: 0 })
  }, DRAIN_GRACE_MS)
}

// ── answering the relay's tool calls ────────────────────────────────────────────

// Give the provider its tool result back. Skipped once the call is over — there is no
// session left to answer, and the gateway would reject it anyway.
async function submitToolResult(get: GetFn, sessionId: string, callId: string, result: unknown): Promise<void> {
  if (get().sessionId !== sessionId) return
  await gatewayClient.request('talk.session.submitToolResult', { sessionId, callId, result }).catch(() => {})
}

// Wait for one consult's agent run to finish and resolve with its reply. The run's
// progress arrives on the gateway's `chat`/`agent` streams (keyed by runId), not on the
// talk stream — the talk stream only carries the provider's side of the call.
function awaitRunText(set: SetFn, runId: string, callId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      fn()
    }
    const timer = setTimeout(() => settle(() => reject(new Error('The agent did not answer in time'))), CONSULT_TIMEOUT_MS)
    const unsub = gatewayClient.on(frame => {
      const p = (frame.payload ?? {}) as {
        runId?: string; state?: string; message?: unknown; errorMessage?: string
        stream?: string; data?: { name?: string; phase?: string }
      }
      if (p.runId !== runId) return
      // Tool steps the agent takes while answering — shown on the consult's activity row.
      if (frame.event === 'agent') {
        if (p.stream === 'tool' && p.data?.name) {
          const step = p.data.phase ? `${p.data.name} · ${p.data.phase}` : p.data.name
          set(s => ({ activity: s.activity.map(a => a.id === callId ? { ...a, progress: step } : a) }))
        }
        return
      }
      if (frame.event !== 'chat') return
      if (p.state === 'final') settle(() => resolve(readRunText(p.message) || 'The agent finished without a reply.'))
      else if (p.state === 'aborted') settle(() => reject(new Error(p.errorMessage ?? 'The agent run was cancelled')))
      else if (p.state === 'error') settle(() => reject(new Error(p.errorMessage ?? 'The agent run failed')))
    })
    const entry = consults.get(callId)
    if (entry) entry.cancel = () => settle(() => reject(new Error('The call ended before the agent answered')))
  })
}

// Run one `openclaw_agent_consult` end to end: start the agent run, wait for its reply,
// and hand it to the provider so the voice can speak it.
async function runConsult(set: SetFn, get: GetFn, callId: string, args: unknown): Promise<void> {
  const sessionId = get().sessionId
  const key = sessionKey
  if (!sessionId || !key || consults.has(callId)) return
  consults.set(callId, {})
  try {
    const started = await gatewayClient.request<{ runId?: string; idempotencyKey?: string }>('talk.client.toolCall', {
      sessionKey: key,
      relaySessionId: sessionId,
      callId,
      name: CONSULT_TOOL,
      args: parseToolArgs(args),
    }, CONSULT_START_TIMEOUT_MS)
    const runId = started.runId ?? started.idempotencyKey
    if (!runId) throw new Error('The gateway started no agent run for this consult')
    const entry = consults.get(callId)
    if (!entry) return                       // torn down while the RPC was in flight
    entry.runId = runId
    const text = await awaitRunText(set, runId, callId)
    set(s => ({ activity: s.activity.map(a => a.id === callId ? { ...a, status: 'done', result: summarize(text) } : a) }))
    await submitToolResult(get, sessionId, callId, { result: text })
  } catch (e) {
    const message = talkErrorMessage(e)
    set(s => ({ activity: s.activity.map(a => a.id === callId ? { ...a, status: 'error', error: message } : a) }))
    // Tell the provider it failed rather than leaving it parked on the placeholder —
    // a spoken "I hit an error" beats silence.
    await submitToolResult(get, sessionId, callId, { error: message })
  } finally {
    consults.delete(callId)
  }
}

// `openclaw_agent_control` is how the voice relays "how's it going?" / "stop that" into
// the running consult. The gateway applies it but leaves the tool call for us to answer.
async function runControl(set: SetFn, get: GetFn, callId: string, args: unknown): Promise<void> {
  const sessionId = get().sessionId
  if (!sessionId) return
  const parsed = parseToolArgs(args)
  const text = typeof parsed.text === 'string' ? parsed.text : ''
  const mode = typeof parsed.mode === 'string' ? parsed.mode : undefined
  try {
    if (!text) throw new Error('Voice control request carried no text')
    const result = await gatewayClient.request('talk.session.steer', {
      sessionId,
      ...(sessionKey ? { sessionKey } : {}),
      text,
      ...(mode ? { mode } : {}),
    })
    set(s => ({ activity: s.activity.map(a => a.id === callId ? { ...a, status: 'done', result: summarize(result) } : a) }))
    await submitToolResult(get, sessionId, callId, result)
  } catch (e) {
    const message = talkErrorMessage(e)
    set(s => ({ activity: s.activity.map(a => a.id === callId ? { ...a, status: 'error', error: message } : a) }))
    await submitToolResult(get, sessionId, callId, { error: message })
  }
}

function handleTalkEvent(set: SetFn, get: GetFn, p: Record<string, unknown>) {
  const kind = readEventKind(p)
  const role = readRole(p, kind)

  // Phase machine.
  const phase = nextPhase(get().phase, kind, role)
  if (phase !== get().phase) set({ phase })

  switch (kind) {
    case 'session.ready':
      resolveReady?.()
      resolveReady = null
      break

    case 'output.audio.delta': {
      const b64 = readAudio(p)
      if (b64) { cancelDrain(); audio?.enqueue(b64) }
      break
    }

    case 'output.audio.done':
      // Discard queued audio when the provider is clearing its own output; otherwise
      // let the queue play out and let the drain check close the turn.
      if (isDiscard(p)) audio?.flushPlayback()
      scheduleDrainCheck(set, get)
      break

    case 'transcript.delta':
    case 'transcript.done':
    case 'output.text.delta':
    case 'output.text.done': {
      const id = readLineId(p, role)
      const text = readText(p)
      const final = readFinal(p)
      if (!text && !final) break
      set(s => {
        const lines = [...s.transcript]
        const i = lines.findIndex(l => l.id === id)
        if (i >= 0) lines[i] = { ...lines[i], text: mergeTranscript(lines[i].text, text), final: final || lines[i].final }
        else lines.push({ id, role: role ?? 'user', text, final })
        return { transcript: lines.slice(-50) }
      })
      break
    }

    case 'tool.call': {
      const id = readToolId(p)
      const name = String(nestedPayload(p).name ?? p.name ?? 'tool')
      const args = nestedPayload(p).args ?? p.args
      set(s => ({
        toolActivity: name,
        activity: [...s.activity, { id, name, args: summarize(args), status: 'running' as const, ts: Date.now() }].slice(-40),
      }))
      // The relay is waiting on *us* to answer these two — see the consult contract above.
      if (name === CONSULT_TOOL) void runConsult(set, get, id, args)
      else if (name === CONTROL_TOOL) void runControl(set, get, id, args)
      break
    }

    case 'tool.progress': {
      const id = readToolId(p)
      const np = nestedPayload(p)
      const msg = np.status ?? np.phase ?? np.message ?? p.message
      set(s => ({ activity: s.activity.map(a => a.id === id ? { ...a, progress: msg != null ? String(msg) : a.progress } : a) }))
      break
    }

    case 'tool.result':
    case 'tool.error': {
      const id = readToolId(p)
      const np = nestedPayload(p)
      const isErr = kind === 'tool.error' || np.isError === true || np.error != null
      const out = summarize(np.result ?? np.error ?? p.result)
      set(s => ({
        toolActivity: null,
        activity: s.activity.map(a => a.id === id
          ? { ...a, status: isErr ? 'error' : 'done', result: isErr ? undefined : out, error: isErr ? out : undefined }
          : a),
      }))
      break
    }

    case 'session.error': {
      const np = nestedPayload(p)
      set({ error: String(np.message ?? p.message ?? 'Talk error') })
      break
    }

    // The gateway already tore its side down — release ours without an RPC.
    case 'session.closed':
      void teardown()
      set({ sessionId: null, micLevel: 0, agentLevel: 0, toolActivity: null })
      break
  }
}
