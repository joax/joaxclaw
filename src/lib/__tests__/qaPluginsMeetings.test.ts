// QA (sprint 2026.9, PRDs 06 + 07): the shapes an isolated 2026.9.4 gateway actually returned
// for plugins.list, plugins.install and transcripts.list, and the ids the install flow must
// send. Checklists: docs/qa/sprint-2026-9/06-plugin-catalog.md, 07-meetings.md
import { describe, expect, it } from 'vitest'
import { installedOutcome, restartCompleted } from '../pluginInstall'
import { CHANNELS } from '../channels'
import {
  PLATFORMS, PLATFORM_LIST, checklistState, durationLabel, matchActiveSession, normaliseMeetingUrl, pluginReadiness,
  type TranscriptSession,
} from '../meetings'

// plugins.list rows captured live (2026.9.4), before and after installing Google Meet.
const LIST_BEFORE = {
  plugins: [
    { id: '@openclaw/google-meet', name: 'Google Meet', packageName: '@openclaw/google-meet', origin: 'official', installed: false, enabled: false, state: 'not-installed', featured: false, install: { source: 'official', pluginId: '@openclaw/google-meet' } },
    { id: 'teams-meetings', name: 'Microsoft Teams meetings', packageName: '@openclaw/teams-meetings', origin: 'official', installed: false, enabled: false, state: 'not-installed', featured: false, install: { source: 'official', pluginId: 'teams-meetings' } },
    { id: 'zoom-meetings', name: 'Zoom meetings', packageName: '@openclaw/zoom-meetings', origin: 'official', installed: false, enabled: false, state: 'not-installed', featured: false, install: { source: 'official', pluginId: 'zoom-meetings' } },
  ],
  mutationAllowed: true,
}
const INSTALL_RESULT_MEET = {
  ok: true,
  plugin: { id: 'google-meet', name: 'Google Meet', installed: true, enabled: true, state: 'enabled', packageName: '@openclaw/google-meet', version: '2026.9.4', origin: 'global' },
  restartRequired: true,
}
const LIST_AFTER = { plugins: [INSTALL_RESULT_MEET.plugin, LIST_BEFORE.plugins[1], LIST_BEFORE.plugins[2]], mutationAllowed: true }

describe('QA 06/07 · the ids the install flow sends', () => {
  it('07 live: Google Meet installs by its catalog id, and is then known by its runtime id', () => {
    expect(PLATFORMS.meet.installId).toBe('@openclaw/google-meet')
    expect(PLATFORMS.meet.pluginId).toBe(INSTALL_RESULT_MEET.plugin.id)
    // Every platform's install id is what plugins.list offers as its official install.
    for (const p of PLATFORM_LIST) {
      const row = LIST_BEFORE.plugins.find(r => r.packageName === `@openclaw/${p.npm.split('/')[1]}`)
      expect(row?.install.pluginId, p.id).toBe(p.installId)
    }
  })
  it('06 live: official channel plugins install by package name (the runtime id is refused)', () => {
    const official = CHANNELS.filter(c => c.plugin?.official)
    expect(official.length).toBeGreaterThan(10)
    for (const c of official) expect(c.plugin!.spec, c.id).toBe(`@openclaw/${c.plugin!.id}`)
  })
})

describe('QA 06/07 · after the restart', () => {
  it('06-VERIFY: the install result id finds the plugin in plugins.list', () => {
    expect(installedOutcome(LIST_AFTER, INSTALL_RESULT_MEET.plugin.id)).toEqual({ outcome: 'enabled' })
    // The catalog id is not the runtime id: verifying against it would say "missing".
    expect(installedOutcome(LIST_AFTER, '@openclaw/google-meet').outcome).toBe('missing')
  })
  it('06-RESTART: only a new bootId counts as the restart; a reconnect to the same process does not', () => {
    expect(restartCompleted({ bootIdBefore: 'a', bootIdNow: 'a', seqBefore: 3, seqNow: 4 })).toBe(false)
    expect(restartCompleted({ bootIdBefore: 'a', bootIdNow: 'b', seqBefore: 3, seqNow: 4 })).toBe(true)
    expect(restartCompleted({ bootIdBefore: 'a', bootIdNow: 'b', seqBefore: 3, seqNow: 3 })).toBe(false)
  })
  it('07 live: uninstalled meeting plugins are listed as not-installed; the checklist reads them as missing', () => {
    for (const p of PLATFORM_LIST) expect(pluginReadiness(LIST_BEFORE, [], p).state, p.id).toBe('missing')
    expect(pluginReadiness(LIST_AFTER, [], PLATFORMS.meet).state).toBe('ready')
    expect(checklistState(true, { meet: 'ready', teams: 'missing', zoom: 'missing' })).toMatchObject({ complete: true, ready: ['meet'] })
  })
})

describe('QA 07 · transcripts as the gateway stores them', () => {
  // transcripts.list row from the isolated gateway: the meeting URL lost its query string.
  const imported = {
    selector: '2026-09-18/transcript-2026-09-18T20-11-43-113Z-92ad1842', sessionId: 'transcript-2026-09-18T20-11-43-113Z-92ad1842',
    title: 'QA sync <b>bold</b>', providerId: 'manual-transcript', providerName: 'Manual Transcript Import',
    source: { providerId: 'manual-transcript', meetingUrl: 'https://meet.google.com/abc-defg-hij' },
    startedAt: '2026-09-18T20:11:43.113Z', stoppedAt: '2026-09-18T20:11:43.113Z', active: true, activeSubscription: false,
    agentId: 'main', updatedAt: '2026-09-18T20:11:43.124Z', utteranceCount: 4, participants: ['Alice', 'Bob'],
    hasSummary: true, summarySource: 'heuristic',
  } as unknown as TranscriptSession
  it('07-3 live: a join URL with a query string matches the stored origin + path', () => {
    expect(matchActiveSession('https://meet.google.com/abc-defg-hij?authuser=1&pli=1', [imported])?.selector).toBe(imported.selector)
    expect(normaliseMeetingUrl('https://MEET.google.com/abc-defg-hij?authuser=1')).toBe(normaliseMeetingUrl('https://meet.google.com/abc-defg-hij'))
  })
  it('07-1: ISO timestamps give a duration', () => {
    expect(durationLabel('2026-09-18T20:00:00.000Z', '2026-09-18T20:42:10.000Z')).toMatch(/42/)
    expect(() => durationLabel(imported.startedAt, imported.stoppedAt)).not.toThrow()
  })
})
