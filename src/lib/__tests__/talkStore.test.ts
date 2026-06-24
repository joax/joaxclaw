import { describe, it, expect } from 'vitest'
import { nextPhase, providersForMode, transportForMode, talkErrorMessage, summarize, type TalkCatalog } from '../../store/talk'

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

describe('nextPhase — Talk interaction state machine', () => {
  it('user speech (incl. barge-in) → user_speaking', () => {
    expect(nextPhase('listening', 'speechStart')).toBe('user_speaking')
    expect(nextPhase('speaking', 'speechStart')).toBe('user_speaking')   // barge-in
  })
  it('a finished user turn → thinking; an agent transcript does not', () => {
    expect(nextPhase('user_speaking', 'transcript.done', 'user')).toBe('thinking')
    expect(nextPhase('speaking', 'transcript.done', 'assistant')).toBe('speaking')
  })
  it('agent audio → speaking, audioDone → listening', () => {
    expect(nextPhase('thinking', 'audio')).toBe('speaking')
    expect(nextPhase('speaking', 'audioDone')).toBe('listening')
  })
  it('tool lifecycle: call → tool_running, result → thinking', () => {
    expect(nextPhase('thinking', 'tool.call')).toBe('tool_running')
    expect(nextPhase('tool_running', 'tool.result')).toBe('thinking')
    expect(nextPhase('speaking', 'tool.result')).toBe('speaking')   // only from tool_running
  })
  it('error → error; unknown/plain transcript events leave phase unchanged', () => {
    expect(nextPhase('speaking', 'error')).toBe('error')
    expect(nextPhase('listening', 'transcript.delta')).toBe('listening')
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
