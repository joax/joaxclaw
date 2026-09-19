import { describe, it, expect } from 'vitest'
import {
  base64ToBytes, buildDiscussMessage, buildSummarizePrompt, canonicalProvider, durationLabel, meetingMeta, meetingPill,
  meetingTitle, providerFilters, providerLabel, readTranscriptError, recentMeetings, summaryHasStructure, tooLargeCommand,
  captureState, checklistState,
  type TranscriptSession,
} from '../meetings'
import * as F from './fixtures/sprint/meetings'

// QA's fixtures follow the 2026.9.4 transcript schemas (timestamps are ISO strings,
// selectors are `YYYY-MM-DD/<id>`, meetingUrl is origin + path).
const S = (s: unknown) => s as TranscriptSession

describe('providers', () => {
  it('labels the known providers and their aliases', () => {
    for (const id of ['google-meet', 'googlemeet', 'meet']) expect(providerLabel(id)).toBe('Google Meet')
    for (const id of ['teams', 'teams-meetings', 'msteams', 'microsoft-teams']) expect(providerLabel(id)).toBe('Teams')
    for (const id of ['zoom', 'zoom-meetings']) expect(providerLabel(id)).toBe('Zoom')
    expect(providerLabel('discord-voice')).toBe('Discord')
  })
  it('falls back to the gateway name, then the id', () => {
    expect(providerLabel('manual-transcript', 'Imported')).toBe('Imported')
    expect(providerLabel('manual-transcript')).toBe('manual-transcript')
  })
  it('filters by the canonical id, in a fixed order, leaving out imports', () => {
    expect(providerFilters(['zoom-meetings', 'discord-voice', 'meet', 'manual-transcript', 'zoom']))
      .toEqual([{ id: 'google-meet', label: 'Google Meet' }, { id: 'zoom', label: 'Zoom' }, { id: 'discord-voice', label: 'Discord' }])
    expect(canonicalProvider('msteams')).toBe('teams')
  })
})

describe('rows', () => {
  it('falls back to "{Provider} meeting" without a title', () => {
    expect(meetingTitle(S(F.SESSION_ZOOM_HEURISTIC_UNTITLED))).toBe('Zoom meeting')
    expect(meetingTitle(S(F.SESSION_MEET_DONE))).toBe('Weekly product sync')
  })
  it('parses ISO durations', () => {
    expect(durationLabel(F.SESSION_MEET_DONE.startedAt, F.SESSION_MEET_DONE.stoppedAt)).toBe('42 min')
    expect(durationLabel(F.SESSION_OVER_ONE_HOUR.startedAt, F.SESSION_OVER_ONE_HOUR.stoppedAt)).toBe('1 h 35 min')
    expect(durationLabel('2026-09-18T10:00:00Z', '2026-09-18T10:00:30Z')).toBe('under 1 min')
    // Live: elapsed so far.
    expect(durationLabel('2026-09-18T10:00:00Z', undefined, Date.parse('2026-09-18T10:12:00Z'))).toBe('12 min')
    expect(durationLabel('not a date', undefined)).toBe('')
  })
  it('builds the meta line without "0 people"', () => {
    const meta = meetingMeta(S(F.SESSION_MEET_DONE))
    expect(meta.startsWith('Google Meet · ')).toBe(true)
    expect(meta).toMatch(/· 42 min · 5 people$/)
    expect(meetingMeta(S({ ...F.SESSION_MEET_DONE, participants: [] }))).not.toMatch(/people/)
  })
  it('pills: Recording while live, No speech for an empty finished one', () => {
    expect(meetingPill(S(F.SESSION_MEET_ACTIVE))).toEqual({ tone: 'working', text: 'Recording' })
    expect(meetingPill(S(F.SESSION_TEAMS_NO_SPEECH))).toEqual({ tone: 'neutral', text: 'No speech' })
    expect(meetingPill(S(F.SESSION_MEET_DONE))).toBeNull()
  })
  it('recent meetings: live ones, then the three latest finished', () => {
    const list = [F.SESSION_MEET_DONE, F.SESSION_ZOOM_HEURISTIC_UNTITLED, F.SESSION_TEAMS_NO_SPEECH, F.SESSION_DISCORD_DONE, F.SESSION_OVER_ONE_HOUR].map(S)
    const out = recentMeetings(list, [S(F.SESSION_MEET_ACTIVE)])
    expect(out.map(s => s.selector)).toEqual([
      F.SESSION_MEET_ACTIVE.selector, F.SESSION_DISCORD_DONE.selector, F.SESSION_OVER_ONE_HOUR.selector, F.SESSION_MEET_DONE.selector,
    ])
  })
})

describe('errors', () => {
  it('reads details.type, not the message', () => {
    expect(readTranscriptError(F.ERR_INVALID_CURSOR)).toBe('invalidCursor')
    expect(readTranscriptError(F.ERR_INVALID_CURSOR_LIBRARY)).toBe('invalidCursor')
    expect(readTranscriptError(F.ERR_SESSION_NOT_FOUND)).toBe('notFound')
    expect(readTranscriptError(F.ERR_EXPORT_TOO_LARGE)).toBe('exportTooLarge')
    expect(readTranscriptError(F.ERR_RESULT_TOO_LARGE)).toBe('tooLarge')
    expect(readTranscriptError(F.ERR_ARCHIVE_UNAVAILABLE)).toBe('unavailable')
  })
  it('tells an archive-role denial from a missing scope (both FORBIDDEN)', () => {
    expect(readTranscriptError(F.ERR_ARCHIVE_FORBIDDEN)).toBe('forbidden')
    expect(readTranscriptError(F.ERR_MISSING_SCOPE_READ)).toBe('missingScope')
  })
})

describe('download', () => {
  it('decodes the export as bytes, so UTF-8 survives', () => {
    const bytes = base64ToBytes(F.EXPORT_RESULT_UTF8.data)
    expect(new TextDecoder().decode(bytes)).toBe(F.EXPORT_UTF8_EXPECTED_TEXT)
    expect(bytes.length).toBe(F.EXPORT_RESULT_UTF8.sizeBytes)
  })
  it('points a too-large transcript at `transcripts path`', () => {
    expect(tooLargeCommand(F.SESSION_MEET_DONE.selector)).toBe('openclaw transcripts path 2026-09-14/meet_7f3a2c91 --transcript')
    expect(tooLargeCommand("2026-09-14/it's")).toBe("openclaw transcripts path '2026-09-14/it'\\''s' --transcript")
  })
})

describe('summaries', () => {
  it('knows a legacy markdown-only summary', () => {
    expect(summaryHasStructure(F.SUMMARY_MODEL)).toBe(true)
    expect(summaryHasStructure(F.SUMMARY_HEURISTIC)).toBe(true)
    expect(summaryHasStructure(F.SUMMARY_LEGACY_MARKDOWN_ONLY)).toBe(false)
  })
})

describe('prompts', () => {
  it('summarize', () => {
    expect(buildSummarizePrompt('2026-09-16/board-prep'))
      .toBe('Use the transcripts tool with action "summarize" and selector "2026-09-16/board-prep". Reply "done" when finished.')
  })
  it('discuss carries the title, selector and notes, and reads fine without notes', () => {
    const msg = buildDiscussMessage(S(F.SESSION_MEET_DONE), F.SUMMARY_MODEL.markdown)
    expect(msg).toMatch(/^Here are the notes from "Weekly product sync" \(.+, Google Meet\)\. Its transcript selector is 2026-09-14\/meet_7f3a2c91;/)
    expect(msg).toContain('## Decisions')
    const bare = buildDiscussMessage(S(F.SESSION_IMPORTED_NO_SUMMARY), undefined)
    expect(bare).not.toMatch(/undefined/)
    expect(bare.endsWith('if you need it.')).toBe(true)
  })
})

// QA: after turning notes on, the gateway restarts, and for ~2 s after the reconnect the
// checklist still said "Meeting notes are off" (the previous connection's status).
describe('captureState', () => {
  const read = (value: boolean, seq: number, atMs: number) => ({ value, seq, atMs })
  const none = { status: null, config: null, requested: null }

  it('is "checking" (null) until this connection has read it', () => {
    expect(captureState({ ...none, connectionSeq: 1 })).toBeNull()
  })

  it('shows a read from this connection', () => {
    expect(captureState({ ...none, status: read(false, 1, 100), connectionSeq: 1 })).toBe(false)
    expect(captureState({ ...none, status: read(true, 1, 100), connectionSeq: 1 })).toBe(true)
  })

  it("never shows the previous connection's read after a reconnect", () => {
    expect(captureState({ ...none, status: read(false, 1, 100), connectionSeq: 2 })).toBeNull()
    expect(captureState({ ...none, status: read(true, 1, 100), connectionSeq: 2 })).toBeNull()
    expect(captureState({ ...none, config: read(false, 1, 100), connectionSeq: 2 })).toBeNull()
  })

  it('prefers transcripts.status, falling back to config (2026.8)', () => {
    expect(captureState({ ...none, status: read(true, 1, 100), config: read(false, 1, 100), connectionSeq: 1 })).toBe(true)
    expect(captureState({ ...none, config: read(false, 1, 100), connectionSeq: 1 })).toBe(false)
    // A stale status doesn't hide a fresh config read.
    expect(captureState({ ...none, status: read(true, 1, 100), config: read(false, 2, 200), connectionSeq: 2 })).toBe(false)
  })

  describe('after turning notes on here', () => {
    const requested = { seq: 1, atMs: 1_000 }

    it('shows the intended state through the restart, not the stale "off"', () => {
      // Before the restart: the old process still says off.
      expect(captureState({ ...none, status: read(false, 1, 1_500), connectionSeq: 1, requested })).toBe(true)
      // Reconnected, nothing read yet on the new connection (the QA case).
      expect(captureState({ ...none, status: read(false, 1, 1_500), connectionSeq: 2, requested })).toBe(true)
      // A read sent before the change was accepted can't confirm or contradict it.
      expect(captureState({ ...none, status: read(false, 1, 900), connectionSeq: 1, requested })).toBe(true)
    })

    it("then takes the gateway's word from the first fresh read, either way", () => {
      expect(captureState({ ...none, status: read(true, 2, 3_000), connectionSeq: 2, requested })).toBe(true)
      expect(captureState({ ...none, status: read(false, 2, 3_000), connectionSeq: 2, requested })).toBe(false)
      expect(captureState({ ...none, config: read(false, 2, 3_000), connectionSeq: 2, requested })).toBe(false)
    })

    it('an "on" read on the same connection counts (no restart needed)', () => {
      expect(captureState({ ...none, status: read(true, 1, 1_500), connectionSeq: 1, requested })).toBe(true)
    })

    it('drives the checklist: notes count as on while checking only because we asked', () => {
      const plugins = { meet: 'ready', teams: 'missing', zoom: 'missing' } as const
      expect(checklistState(captureState({ ...none, connectionSeq: 2, requested }), plugins).captureOn).toBe(true)
      expect(checklistState(captureState({ ...none, connectionSeq: 2 }), plugins).captureOn).toBe(false)
    })
  })
})
