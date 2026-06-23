// Talk-mode store: drives a realtime voice conversation over the gateway's Talk API.
// The gateway owns the pipeline (VAD, barge-in, agent "brain"); this orchestrates the
// session RPCs, consumes the `talk.event` stream, runs the interaction state machine,
// and wires the audio engine (mic → appendAudio, agent audio → playback). See
// src/lib/TALK.md for the contract and the Phase-1 scope.

import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import { TalkAudio } from '../lib/talkAudio'

export type TalkPhase =
  | 'idle' | 'connecting' | 'listening' | 'user_speaking'
  | 'thinking' | 'speaking' | 'tool_running' | 'error'

// Pure interaction-state transition (unit-tested). `role` distinguishes user vs agent
// transcripts when the event carries it. Unhandled events leave the phase unchanged.
export function nextPhase(phase: TalkPhase, evt: string, role?: 'user' | 'assistant'): TalkPhase {
  switch (evt) {
    case 'speechStart':      return 'user_speaking'                       // incl. barge-in over the agent
    case 'transcript.done':  return role === 'user' ? 'thinking' : phase  // user turn ended → await agent
    case 'audio':            return 'speaking'
    case 'audioDone':        return 'listening'
    case 'tool.call':
    case 'tool.progress':    return 'tool_running'
    case 'tool.result':      return phase === 'tool_running' ? 'thinking' : phase
    case 'error':            return 'error'
    default:                 return phase
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
  speech: { providers: TalkProvider[] }
}

export interface TalkTranscriptLine { id: string; role: 'user' | 'assistant'; text: string; final: boolean }

export interface TalkConfig {
  mode: string
  transport: string
  brain: string
  provider?: string
  voice?: string
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
  catalog: TalkCatalog | null
  config: TalkConfig

  loadCatalog: () => Promise<void>
  setConfig: (patch: Partial<TalkConfig>) => void
  start: () => Promise<void>
  stop: () => Promise<void>
  toggleMute: () => void
  interrupt: () => void
}

const DEFAULT_CONFIG: TalkConfig = { mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult' }

// Audio engine + event unsubscribe live outside the store (not React/serializable state).
let audio: TalkAudio | null = null
let unsubEvents: (() => void) | null = null

// Defensive payload readers — the talk.event payload field names are confirmed at build.
function evType(p: Record<string, unknown>): string { return String(p.type ?? p.event ?? '') }
function evRole(p: Record<string, unknown>): 'user' | 'assistant' | undefined {
  const r = String(p.role ?? p.speaker ?? '')
  return r === 'user' || r === 'assistant' ? r : undefined
}
function evText(p: Record<string, unknown>): string {
  return String(p.delta ?? p.text ?? p.transcript ?? '')
}
function evAudio(p: Record<string, unknown>): string | null {
  const a = p.audioBase64 ?? p.audio ?? p.data
  return typeof a === 'string' ? a : null
}
function evItemId(p: Record<string, unknown>): string {
  return String(p.itemId ?? p.id ?? p.turnId ?? 'live')
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
  catalog: null,
  config: DEFAULT_CONFIG,

  async loadCatalog() {
    try {
      const cat = await gatewayClient.request<TalkCatalog>('talk.catalog', {})
      set({ catalog: cat })
      // Default the provider to the first configured one, if any.
      const configured = cat.speech?.providers?.find(p => p.configured)
      if (configured && !get().config.provider) {
        set(s => ({ config: { ...s.config, provider: configured.id, voice: configured.voices?.[0] } }))
      }
    } catch (e) { set({ error: String(e) }) }
  },

  setConfig(patch) { set(s => ({ config: { ...s.config, ...patch } })) },

  async start() {
    if (get().phase !== 'idle' && get().phase !== 'error') return
    set({ phase: 'connecting', error: null, transcript: [], toolActivity: null })

    // Subscribe to the talk.event stream before creating the session.
    unsubEvents?.()
    unsubEvents = gatewayClient.on(frame => {
      if (frame.event !== 'talk.event') return
      handleTalkEvent(set, get, (frame.payload ?? {}) as Record<string, unknown>)
    })

    try {
      const { config } = get()
      const res = await gatewayClient.request<{ sessionId: string }>('talk.session.create', {
        mode: config.mode,
        transport: config.transport,
        brain: config.brain,
        ...(config.provider ? { provider: config.provider } : {}),
        ...(config.voice ? { voice: config.voice } : {}),
      })
      const sessionId = res.sessionId
      set({ sessionId })

      audio = new TalkAudio({
        onAudioChunk: (audioBase64) => {
          const sid = get().sessionId
          if (sid) void gatewayClient.request('talk.session.appendAudio', { sessionId: sid, audioBase64 }).catch(() => {})
        },
        onMicLevel: (l) => set({ micLevel: l }),
        onAgentLevel: (l) => set({ agentLevel: l }),
      })
      await audio.startCapture()
      set({ phase: 'listening' })
    } catch (e) {
      unsubEvents?.(); unsubEvents = null
      set({ phase: 'error', error: String(e) })
    }
  },

  async stop() {
    const sid = get().sessionId
    if (sid) await gatewayClient.request('talk.session.cancelTurn', { sessionId: sid }).catch(() => {})
    await audio?.stop(); audio = null
    unsubEvents?.(); unsubEvents = null
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

function handleTalkEvent(set: SetFn, get: GetFn, p: Record<string, unknown>) {
  const type = evType(p)
  const role = evRole(p)

  // Phase machine.
  const phase = nextPhase(get().phase, type, role)
  if (phase !== get().phase) set({ phase })

  switch (type) {
    case 'audio': {
      const b64 = evAudio(p)
      if (b64) audio?.enqueue(b64)
      break
    }
    case 'transcript':
    case 'transcript.delta':
    case 'transcript.done':
    case 'transcription': {
      const id = evItemId(p)
      const r: 'user' | 'assistant' = role ?? (get().phase === 'speaking' ? 'assistant' : 'user')
      const text = evText(p)
      const final = type === 'transcript.done'
      set(s => {
        const lines = [...s.transcript]
        const i = lines.findIndex(l => l.id === id)
        if (i >= 0) lines[i] = { ...lines[i], text: type === 'transcript' || type === 'transcript.done' ? text : lines[i].text + text, final }
        else lines.push({ id, role: r, text, final })
        return { transcript: lines.slice(-50) }
      })
      break
    }
    case 'tool.call':
      set({ toolActivity: String(p.name ?? p.tool ?? 'tool') })
      break
    case 'tool.result':
      set({ toolActivity: null })
      break
    case 'error':
      set({ error: String(p.message ?? p.error ?? 'Talk error') })
      break
  }
}
