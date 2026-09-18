import { describe, it, expect } from 'vitest'
import {
  buildJoinPrompt, buildLeavePrompt, buildStopPrompt, captureFromConfig, checklistState, detectPlatform, guestNameFromConfig,
  matchActiveSession, normaliseMeetingUrl, parseMeetingToolResult, pendingPhase, platformForProvider, pluginReadiness,
  toolAction, NO_NOTES_AFTER_MS, PLATFORMS, type PendingJoin, type TranscriptSession,
} from '../meetings'
import * as F from './fixtures/sprint/meetings'

const S = (s: unknown) => s as TranscriptSession

describe('detectPlatform / normaliseMeetingUrl', () => {
  it('matches every link in the QA table', () => {
    for (const link of F.MEETING_LINKS) {
      expect(detectPlatform(link.url), link.url).toBe(link.expected)
      if (link.sanitized) expect(normaliseMeetingUrl(link.url), link.url).toBe(link.sanitized)
    }
  })
  it('matches a live session on origin + path, whatever the query', () => {
    const active = [S(F.SESSION_MEET_ACTIVE), S(F.SESSION_MEET_ACTIVE_OLDER_SAME_URL)]
    // The newest of two on the same link.
    expect(matchActiveSession('https://meet.google.com/xyz-abcd-efg?authuser=0', active)?.selector).toBe(F.SESSION_MEET_ACTIVE.selector)
    expect(matchActiveSession('https://meet.google.com/aaa-bbbb-ccc', active)).toBeNull()
    // Zoom's pwd is dropped by the gateway; the match still works.
    const zoom = S({ ...F.SESSION_MEET_ACTIVE, source: { providerId: 'zoom', meetingUrl: 'https://acme.zoom.us/j/81234567890' } })
    expect(matchActiveSession('https://acme.zoom.us/j/81234567890?pwd=AbC123xyz#success', [zoom])).toBe(zoom)
  })
})

describe('prompts', () => {
  it('join says the tool, the link, the mode and the sentinel', () => {
    expect(buildJoinPrompt('zoom', 'https://zoom.us/j/81234567890?pwd=AbC', 'transcribe')).toBe(
      'Use the `zoom_meetings` tool with action "join", url "https://zoom.us/j/81234567890?pwd=AbC", mode "transcribe". Do only this. '
      + "Then reply with the tool's result exactly, including any status or manualAction, and nothing else. "
      + 'If the tool isn\'t available, say "MEETING_TOOL_MISSING".')
    expect(buildJoinPrompt('meet', 'https://meet.google.com/abc-defg-hij', 'agent')).toContain('`google_meet`')
  })
  it('leave and stop', () => {
    expect(buildLeavePrompt('teams')).toBe('Use the `teams_meetings` tool with action "leave" for this meeting. Reply with the result only.')
    expect(buildStopPrompt(S(F.SESSION_MEET_ACTIVE))).toContain('`google_meet` tool with action "leave" for the meeting at "https://meet.google.com/xyz-abcd-efg"')
    expect(buildStopPrompt(S({ ...F.SESSION_DISCORD_DONE, active: true }))).toBe(`Use the transcripts tool with action "stop" and selector "${F.SESSION_DISCORD_DONE.selector}". Reply with the result only.`)
    expect(platformForProvider('zoom-meetings')).toBe('zoom')
  })
})

describe('parseMeetingToolResult', () => {
  it('reads each outcome', () => {
    expect(parseMeetingToolResult(F.TOOLCALL_ZOOM_JOIN_RUNNING).kind).toBe('running')
    expect(parseMeetingToolResult(F.TOOLCALL_MEET_JOIN_OK).kind).toBe('ok')
    expect(parseMeetingToolResult(F.TOOLCALL_MEET_JOIN_MANUAL)).toEqual({ kind: 'manual', text: 'Waiting for the host to admit "OpenClaw Agent" from the lobby.' })
    expect(parseMeetingToolResult(F.TOOLCALL_TEAMS_JOIN_ERROR)).toEqual({ kind: 'error', text: F.TOOLCALL_TEAMS_JOIN_ERROR.error })
    expect(parseMeetingToolResult(F.TOOLCALL_ZOOM_JOIN_PLAINTEXT)).toEqual({ kind: 'ok', text: 'Joined Zoom meeting 81234567890 in transcribe mode.' })
    expect(parseMeetingToolResult({ name: 'zoom_meetings', status: 'done', result: 'MEETING_TOOL_MISSING' }).kind).toBe('error')
    expect(toolAction(F.TOOLCALL_MEET_JOIN_OK)).toBe('join')
  })
})

describe('pendingPhase', () => {
  const p: PendingJoin = { id: 'p1', convId: 'c1', url: 'https://meet.google.com/xyz-abcd-efg', platform: 'meet', agentId: 'main', startedAt: 0 }
  const base = { join: null, chatKnown: true, active: [] as TranscriptSession[], hasStatus: true, now: 1000 }
  it('joining, then the manual step, then recording once the session is live', () => {
    expect(pendingPhase(p, base).phase).toBe('joining')
    expect(pendingPhase(p, { ...base, join: { kind: 'manual', text: 'Admit me' } })).toEqual({ phase: 'manual', text: 'Admit me' })
    expect(pendingPhase(p, { ...base, active: [S(F.SESSION_MEET_ACTIVE)] })).toEqual({ phase: 'recording', selector: F.SESSION_MEET_ACTIVE.selector })
  })
  it('warns when an OK join produces no notes for three minutes', () => {
    const ok = { ...base, join: { kind: 'ok' as const, text: '' } }
    expect(pendingPhase({ ...p, okAt: 0 }, { ...ok, now: NO_NOTES_AFTER_MS - 1 }).phase).toBe('recording')
    expect(pendingPhase({ ...p, okAt: 0 }, { ...ok, now: NO_NOTES_AFTER_MS }).phase).toBe('noNotes')
    // 2026.8: no status to check against.
    expect(pendingPhase({ ...p, okAt: 0 }, { ...ok, hasStatus: false, now: NO_NOTES_AFTER_MS * 2 }).phase).toBe('recording')
  })
  it('fails on an error, the sentinel, or a reply without the tool', () => {
    expect(pendingPhase(p, { ...base, join: { kind: 'error', text: 'boom' } })).toEqual({ phase: 'failed', text: 'boom' })
    expect(pendingPhase(p, { ...base, replyText: 'MEETING_TOOL_MISSING' }).text).toBe("The agent doesn't have the meeting tool.")
    expect(pendingPhase(p, { ...base, replyText: 'Error: send refused' })).toEqual({ phase: 'failed', text: 'Error: send refused' })
  })
  it('is unknown when the chat is gone (after a reload)', () => {
    expect(pendingPhase(p, { ...base, chatKnown: false, now: 61_000 }).phase).toBe('unknown')
    expect(pendingPhase(p, { ...base, chatKnown: false, now: 5_000 }).phase).toBe('joining')
  })
  it('stops: Stopping until the session is no longer live', () => {
    const stopping = { ...p, selector: F.SESSION_MEET_ACTIVE.selector, stoppingAt: 5 }
    expect(pendingPhase(stopping, { ...base, active: [S(F.SESSION_MEET_ACTIVE)] }).phase).toBe('stopping')
    expect(pendingPhase(stopping, base).phase).toBe('done')
  })
})

describe('setup checklist', () => {
  it('reads plugin readiness; absent means not installed', () => {
    const list = F.PLUGINS_LIST_MIXED
    expect(pluginReadiness(F.PLUGINS_LIST_NO_MEETING_PLUGINS, undefined, PLATFORMS.meet).state).toBe('missing')
    expect(pluginReadiness(list, undefined, PLATFORMS.meet).state).toBe('ready')
    expect(pluginReadiness(list, undefined, PLATFORMS.zoom).state).toBe('off')
    expect(pluginReadiness(list, undefined, PLATFORMS.teams).state).toBe('error')
  })
  it('is complete with notes on and one plugin ready; Chrome never blocks', () => {
    expect(checklistState(true, { meet: 'ready', teams: 'missing', zoom: 'off' })).toEqual({ captureOn: true, ready: ['meet'], complete: true })
    expect(checklistState(false, { meet: 'ready', teams: 'missing', zoom: 'off' }).complete).toBe(false)
    expect(checklistState(true, { meet: 'missing', teams: 'off', zoom: 'error' }).complete).toBe(false)
    expect(checklistState(null, { meet: 'ready', teams: 'ready', zoom: 'ready' }).complete).toBe(false)
  })
  it('reads capture and guest names from config (2026.8 fallback)', () => {
    expect(captureFromConfig({})).toBe(true)
    expect(captureFromConfig({ transcripts: F.CONFIG_TRANSCRIPTS_OFF })).toBe(false)
    expect(guestNameFromConfig({}, PLATFORMS.zoom)).toBe('OpenClaw Agent')
    expect(guestNameFromConfig({ plugins: { entries: { 'zoom-meetings': { config: { chrome: { guestName: 'Notes bot' } } } } } }, PLATFORMS.zoom)).toBe('Notes bot')
  })
})
