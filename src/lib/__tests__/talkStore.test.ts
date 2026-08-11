import { describe, it, expect } from 'vitest'
import {
  nextPhase, providersForMode, transportForMode, talkErrorMessage, summarize,
  readEventKind, readRole, readLineId, mergeTranscript, type TalkCatalog,
} from '../../store/talk'

// Frames below are shaped exactly as the gateway's realtime relay emits them
// (OpenClaw 2026.6.5, transport gateway-relay), with the session id anonymised. The
// point of keeping them verbatim is the envelope/talkEvent split: the flat envelope
// and the nested typed event use different names for the same thing.
const READY = {
  relaySessionId: 'sess-1', type: 'ready',
  talkEvent: { sessionId: 'sess-1', id: 'sess-1:1', type: 'session.ready', seq: 1, payload: null },
}
const USER_DELTA = {
  relaySessionId: 'sess-1', type: 'transcript', role: 'user', text: ' He', final: false,
  talkEvent: { id: 'sess-1:24', type: 'transcript.delta', turnId: 'turn-1', seq: 24, final: false, payload: { role: 'user', text: ' He' } },
}
const AGENT_TEXT_DELTA = {
  relaySessionId: 'sess-1', type: 'transcript', role: 'assistant', text: 'Hello! Yes,', final: false,
  talkEvent: { id: 'sess-1:80', type: 'output.text.delta', turnId: 'turn-1', final: false, payload: { text: 'Hello! Yes,' } },
}
const AUDIO_DELTA = {
  relaySessionId: 'sess-1', type: 'audio', audioBase64: 'AAAA', itemId: 'item-1',
  talkEvent: { type: 'output.audio.delta', turnId: 'turn-1', payload: { byteLength: 4 } },
}
const CLEAR = {
  relaySessionId: 'sess-1', type: 'clear',
  talkEvent: { type: 'output.audio.done', turnId: 'turn-1', payload: { reason: 'clear' }, final: true },
}
// Emitted with no `talkEvent` at all — the envelope is the only name it has.
const AUDIO_DONE = { relaySessionId: 'sess-1', type: 'audioDone', itemId: 'item-1' }
const TOOL_CALL = {
  relaySessionId: 'sess-1', type: 'toolCall', itemId: 'i1', callId: 'c1',
  name: 'openclaw_agent_consult', args: { question: 'what is the weather' },
  talkEvent: { type: 'tool.call', itemId: 'i1', callId: 'c1', turnId: 'turn-1', payload: { name: 'openclaw_agent_consult', args: { question: 'what is the weather' } } },
}
// The envelope says "toolResult" while the typed event says this is progress, not a
// result — the typed name is the one that must win.
const TOOL_WORKING = {
  relaySessionId: 'sess-1', type: 'toolResult', callId: 'c1',
  talkEvent: { type: 'tool.progress', callId: 'c1', turnId: 'turn-1', payload: { name: 'openclaw_agent_consult', status: 'working' } },
}

describe('summarize (tool args/results for the activity feed)', () => {
  it('passes strings through and JSON-stringifies objects', () => {
    expect(summarize('hello')).toBe('hello')
    expect(summarize({ q: 'weather', n: 3 })).toBe('{"q":"weather","n":3}')
    expect(summarize(undefined)).toBeUndefined()
    expect(summarize(null)).toBeUndefined()
  })
  it('caps very long values', () => {
    const out = summarize('x'.repeat(1000))!
    expect(out.length).toBe(601)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('readEventKind — envelope vs typed event', () => {
  it('prefers the typed talkEvent name over the flat envelope name', () => {
    expect(readEventKind(USER_DELTA)).toBe('transcript.delta')
    expect(readEventKind(AGENT_TEXT_DELTA)).toBe('output.text.delta')
    expect(readEventKind(AUDIO_DELTA)).toBe('output.audio.delta')
    expect(readEventKind(TOOL_CALL)).toBe('tool.call')
  })
  it('lets the typed name correct a misleading envelope name', () => {
    expect(readEventKind(TOOL_WORKING)).toBe('tool.progress')
  })
  it('falls back to the envelope when a frame carries no talkEvent', () => {
    expect(readEventKind(AUDIO_DONE)).toBe('output.audio.done')
  })
  it('maps the other envelope-only names', () => {
    expect(readEventKind(READY)).toBe('session.ready')
    expect(readEventKind(CLEAR)).toBe('output.audio.done')
    expect(readEventKind({ type: 'close' })).toBe('session.closed')
    expect(readEventKind({ type: 'error' })).toBe('session.error')
  })
})

describe('readRole / readLineId — caption grouping', () => {
  it('reads the speaker from the envelope, and infers it for agent output', () => {
    expect(readRole(USER_DELTA, 'transcript.delta')).toBe('user')
    expect(readRole(AGENT_TEXT_DELTA, 'output.text.delta')).toBe('assistant')
    expect(readRole({ talkEvent: { type: 'output.audio.delta' } }, 'output.audio.delta')).toBe('assistant')
  })
  it('groups a line by turn and speaker, not by the per-event id', () => {
    const a = readLineId(USER_DELTA, 'user')
    const b = readLineId({ ...USER_DELTA, talkEvent: { ...USER_DELTA.talkEvent, id: 'sess-1:26', seq: 26 } }, 'user')
    expect(a).toBe(b)                                          // same turn, same speaker → one line
    expect(readLineId(AGENT_TEXT_DELTA, 'assistant')).not.toBe(a)   // same turn, other speaker
    expect(readLineId({ talkEvent: { turnId: 'turn-2' } }, 'user')).not.toBe(a)
  })
})

describe('mergeTranscript', () => {
  it('appends streamed fragments', () => {
    expect([' He', 'llo', ' there'].reduce(mergeTranscript, '')).toBe(' Hello there')
  })
  it('replaces rather than doubles when a provider resends the whole utterance', () => {
    expect(mergeTranscript('Hello', 'Hello there')).toBe('Hello there')
  })
  it('ignores a repeated tail', () => {
    expect(mergeTranscript('Hello there', ' there')).toBe('Hello there')
  })
})

describe('nextPhase — Talk interaction state machine', () => {
  it('a user transcript is the speech-onset signal (there is no speechStart here)', () => {
    expect(nextPhase('listening', 'transcript.delta', 'user')).toBe('user_speaking')
    expect(nextPhase('speaking', 'transcript.delta', 'assistant')).toBe('speaking')
  })
  it('a finished user turn → thinking; an agent transcript does not', () => {
    expect(nextPhase('user_speaking', 'transcript.done', 'user')).toBe('thinking')
    expect(nextPhase('speaking', 'transcript.done', 'assistant')).toBe('speaking')
  })
  it('agent text → thinking, agent audio → speaking', () => {
    expect(nextPhase('user_speaking', 'output.text.delta', 'assistant')).toBe('thinking')
    expect(nextPhase('speaking', 'output.text.delta', 'assistant')).toBe('speaking')  // audio wins
    expect(nextPhase('thinking', 'output.audio.delta')).toBe('speaking')
  })
  it('leaves the turn end to the playback queue, not to output.audio.done', () => {
    expect(nextPhase('speaking', 'output.audio.done')).toBe('speaking')
  })
  it('tool lifecycle: call → tool_running, result → thinking', () => {
    expect(nextPhase('thinking', 'tool.call')).toBe('tool_running')
    expect(nextPhase('tool_running', 'tool.result')).toBe('thinking')
    expect(nextPhase('tool_running', 'tool.error')).toBe('thinking')
    expect(nextPhase('speaking', 'tool.result')).toBe('speaking')   // only from tool_running
  })
  it('session errors and closes', () => {
    expect(nextPhase('speaking', 'session.error')).toBe('error')
    expect(nextPhase('speaking', 'session.closed')).toBe('idle')
  })
  it('ignores events it has no opinion about', () => {
    expect(nextPhase('listening', 'input.audio.delta')).toBe('listening')
    expect(nextPhase('listening', 'turn.started')).toBe('listening')
    expect(nextPhase('connecting', 'session.ready')).toBe('connecting')  // start() owns this
    expect(nextPhase('listening', 'whatever')).toBe('listening')
  })
})

describe('providersForMode / transportForMode', () => {
  const cat: TalkCatalog = {
    modes: ['realtime', 'stt-tts', 'transcription'], transports: [], brains: [],
    realtime: { providers: [{ id: 'google', label: 'Google Live Voice', configured: false, modes: ['realtime'], brains: [] }] },
    speech: { providers: [{ id: 'google', label: 'Google', configured: false, modes: ['stt-tts'], brains: [] }] },
    transcription: { providers: [{ id: 'elevenlabs', label: 'ElevenLabs', configured: false, modes: ['transcription'], brains: [] }] },
  }
  it('returns the right provider list per mode', () => {
    expect(providersForMode(cat, 'realtime').map(p => p.id)).toEqual(['google'])
    expect(providersForMode(cat, 'transcription').map(p => p.id)).toEqual(['elevenlabs'])
    expect(providersForMode(null, 'realtime')).toEqual([])
  })
  it('maps each mode to its required transport', () => {
    expect(transportForMode('realtime')).toBe('gateway-relay')
    expect(transportForMode('stt-tts')).toBe('managed-room')
  })
})

describe('talkErrorMessage', () => {
  it('extracts the talkIssue/message from a wrapped gateway error', () => {
    const e = new Error('Error: ' + JSON.stringify({ code: 'UNAVAILABLE', message: 'x', details: { talkIssue: { message: 'Realtime voice provider "google" is not configured' } } }))
    expect(talkErrorMessage(e)).toBe('Realtime voice provider "google" is not configured')
  })
  it('falls back to the raw message when not JSON', () => {
    expect(talkErrorMessage(new Error('boom'))).toBe('boom')
  })
})
