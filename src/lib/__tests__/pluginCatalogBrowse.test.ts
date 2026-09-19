import { describe, it, expect } from 'vitest'
import {
  browseParams, cardAction, clawhubUrl, formatCount, hostInstallCommand, installTargetForEntry, needsNewerGateway,
  needsSummary, readmeForDisplay, securityLabel, summariseRemoteError, unavailableReason, updatedAgo,
  README_RENDER_LIMIT, type DiscoveryEntry, type LocalState,
} from '../pluginCatalog'
import * as F from './fixtures/sprint/pluginCatalog'

// Entries shaped as PluginDiscoveryEntrySchema (OpenClaw 2026.9.4).
const entry = (local: Partial<DiscoveryEntry['local']> = {}, catalog: Partial<DiscoveryEntry['catalog']> = {}): DiscoveryEntry => ({
  id: 'ch_tracker',
  catalog: { name: 'Issue Tracker', official: false, categories: ['developer'], packageName: '@acme/issue-tracker', ...catalog },
  local: { present: false, installed: false, enabled: false, state: 'not-installed', action: 'install', install: { source: 'clawhub', packageName: '@acme/issue-tracker' }, ...local },
})
const installedAs = (state: LocalState) => entry({ present: true, installed: true, enabled: state !== 'disabled', state, action: 'manage', pluginId: 'issue-tracker' })

describe('browseParams', () => {
  it('pages a list view with the cursor', () => {
    expect(browseParams({ intent: 'featured', cursor: 'c1' })).toEqual({ intent: 'featured', cursor: 'c1', pageSize: 24 })
  })
  it('adds the category', () => {
    expect(browseParams({ intent: 'all', category: 'voice' })).toEqual({ intent: 'all', category: 'voice', pageSize: 24 })
  })
  it('searches across everything and never sends a cursor with a query', () => {
    // The gateway refuses the pair: "Plugin search does not accept a browse cursor."
    expect(browseParams({ intent: 'trending', query: ' slack ', cursor: 'c1' })).toEqual({ intent: 'all', query: 'slack', pageSize: 24 })
  })
})

describe('cardAction', () => {
  it('installed and enabled → Installed, Manage', () => {
    expect(cardAction(installedAs('enabled'), { admin: true })).toEqual({ kind: 'manage', label: 'Manage', pill: { tone: 'done', text: 'Installed' } })
  })
  it('needs setup → Needs setup, Configure', () => {
    expect(cardAction(installedAs('needs-setup'), { admin: false })).toMatchObject({ kind: 'configure', pill: { tone: 'needsYou', text: 'Needs setup' } })
  })
  it('installed but disabled → Off, Manage', () => {
    expect(cardAction(installedAs('disabled'), { admin: true })).toMatchObject({ kind: 'manage', pill: { tone: 'neutral', text: 'Off' } })
  })
  it('error → Error, Manage', () => {
    expect(cardAction(installedAs('error'), { admin: true })).toMatchObject({ kind: 'manage', pill: { tone: 'failed', text: 'Error' } })
  })
  it('installable with admin → Install', () => {
    expect(cardAction(entry(), { admin: true })).toEqual({ kind: 'install', label: 'Install' })
  })
  it('installable without admin → Ask an admin', () => {
    expect(cardAction(entry(), { admin: false })).toEqual({ kind: 'askAdmin', label: 'Ask an admin' })
  })
  it('unavailable → no button', () => {
    expect(cardAction(entry({ action: 'unavailable', install: undefined }), { admin: true })).toEqual({ kind: 'none' })
  })
  it('installed state wins over the catalog action', () => {
    expect(cardAction(entry({ installed: true, state: 'enabled', action: 'install' }), { admin: true }).kind).toBe('manage')
  })
  it('a row marked installed but not-installed is treated as not installed', () => {
    expect(cardAction(entry({ installed: true, state: 'not-installed' }), { admin: true }).kind).toBe('install')
  })
  it('manage without being installed still offers Manage', () => {
    expect(cardAction(entry({ action: 'manage' }), { admin: true })).toEqual({ kind: 'manage', label: 'Manage' })
  })
})

describe('unavailableReason', () => {
  it('names a read-only config', () => {
    expect(unavailableReason(entry({ action: 'unavailable' }), { mutationAllowed: false })).toMatch(/doesn't allow plugin changes from apps/)
  })
  it('names a local-only row with nothing to install', () => {
    expect(unavailableReason({ ...entry({ action: 'unavailable', install: undefined }, { packageName: undefined }), id: 'local_eA' }, { mutationAllowed: true })).toBe('Not available from the catalog.')
  })
  it('falls back to a generic line', () => {
    expect(unavailableReason(entry({ action: 'unavailable' }), { mutationAllowed: null })).toBe("Can't be installed from here.")
  })
})

describe('installTargetForEntry', () => {
  it('ClawHub with the chosen version', () => {
    expect(installTargetForEntry(entry(), { version: '1.4.2', origin: 'browser:ch_tracker' })).toEqual({
      params: { source: 'clawhub', packageName: '@acme/issue-tracker', version: '1.4.2' },
      displayName: 'Issue Tracker', origin: 'browser:ch_tracker',
    })
  })
  it('official never sends a version, since the closed schema rejects it', () => {
    const e = entry({ install: { source: 'official', pluginId: 'zoom-meetings' }, pluginId: 'zoom-meetings' })
    expect(installTargetForEntry(e, { version: '9.9.9' })?.params).toEqual({ source: 'official', pluginId: 'zoom-meetings' })
  })
  it('null with nothing to install from, or when the gateway says it cannot be installed', () => {
    expect(installTargetForEntry({ ...entry({ install: undefined }, { packageName: undefined }), id: 'local_eA' })).toBeNull()
    expect(installTargetForEntry(entry({ action: 'unavailable' }))).toBeNull()
  })
})

describe('hostInstallCommand', () => {
  it('uses the clawhub: spec for ClawHub entries', () => {
    expect(hostInstallCommand(entry())).toBe('openclaw plugins install clawhub:@acme/issue-tracker')
  })
  it('uses the bare id for official entries (there is no npm spec on an entry)', () => {
    expect(hostInstallCommand(entry({ install: { source: 'official', pluginId: 'google-meet' } }, { packageName: '@openclaw/google-meet' })))
      .toBe('openclaw plugins install google-meet')
  })
  it('falls back to the plugin id', () => {
    expect(hostInstallCommand(entry({ install: { source: 'official', pluginId: 'google-meet' } }, { packageName: undefined })))
      .toBe('openclaw plugins install google-meet')
  })
})

describe('needsSummary', () => {
  const d = (configuration: { name: string; required: boolean; sensitive: boolean }[], extra: { skills?: { name: string }[]; mcpServers?: string[] } = {}) =>
    ({ configuration, skills: extra.skills ?? [], mcpServers: extra.mcpServers ?? [] })
  it('counts a required sensitive field as an API key', () => {
    expect(needsSummary(d([{ name: 'ISSUE_TOKEN', required: true, sensitive: true }]))).toEqual(['1 API key (ISSUE_TOKEN)'])
  })
  it('counts required settings', () => {
    expect(needsSummary(d([{ name: 'a', required: true, sensitive: false }, { name: 'b', required: true, sensitive: false }]))).toEqual(['2 required settings'])
  })
  it('says there is nothing to configure', () => {
    expect(needsSummary(d([{ name: 'opt', required: false, sensitive: true }]))).toEqual(['Nothing to configure'])
  })
  it("never says nothing to configure when the gateway says the installed plugin needs setup", () => {
    expect(needsSummary(d([]), 'needs-setup')).toEqual(['Required settings before it can run'])
    expect(needsSummary(d([]), 'enabled')).toEqual(['Nothing to configure'])
    // Declared requirements are listed as before.
    expect(needsSummary(d([{ name: 'ISSUE_TOKEN', required: true, sensitive: true }]), 'needs-setup')).toEqual(['1 API key (ISSUE_TOKEN)'])
  })
  it('lists skills and MCP servers', () => {
    expect(needsSummary(d([], { skills: [{ name: 'triage' }], mcpServers: ['tracker'] })))
      .toEqual(['Nothing to configure', 'Adds skills: triage', 'Starts MCP servers: tracker'])
  })
})

describe('summariseRemoteError', () => {
  it('says what is on screen for each real outage variant', () => {
    const cases = [F.BROWSE_ALL_CLAWHUB_DOWN, F.BROWSE_FEATURED_CLAWHUB_DOWN, F.BROWSE_BUNDLED_CLAWHUB_DOWN, F.BROWSE_SEARCH_BOTH_DOWN, F.BROWSE_SEARCH_PARTIAL]
    for (const r of cases) {
      expect(summariseRemoteError(r.remoteError, r.items.length)).toBe(r.items.length
        ? "ClawHub isn't reachable right now. Showing only what's already on this gateway."
        : "ClawHub isn't reachable right now, so this list is empty. Try again in a moment.")
    }
  })
  it('passes other text through', () => {
    expect(summariseRemoteError('Something else', 0)).toBe('Something else')
    expect(summariseRemoteError(undefined, 0)).toBeNull()
  })
})

describe('clawhubUrl', () => {
  it('builds /{scope}/plugins/{name} as the Control UI does', () => {
    expect(clawhubUrl('@acme/issue-tracker')).toBe('https://clawhub.ai/acme/plugins/issue-tracker')
    expect(clawhubUrl('issue-tracker', '@someone')).toBe('https://clawhub.ai/someone/plugins/issue-tracker')
    expect(clawhubUrl('issue-tracker')).toBe('https://clawhub.ai/plugins/issue-tracker')
    expect(clawhubUrl(undefined)).toBeNull()
  })
})

describe('securityLabel', () => {
  it('maps the ClawHub verdicts, with no date (the gateway sends none)', () => {
    expect(securityLabel(F.DETAIL_CLAWHUB_FULL.detail.security)).toEqual({ tone: 'done', text: 'Verified clean' })
    expect(securityLabel({ status: 'pass' })?.tone).toBe('done')
    expect(securityLabel(F.DETAIL_CLAWHUB_BLOCKED.detail.security)).toEqual({ tone: 'failed', text: 'Blocked by ClawHub' })
    expect(securityLabel({ status: 'pending' })?.text).toBe('Review recommended')
    expect(securityLabel({ status: 'clean' })).toEqual({ tone: 'done', text: 'Verified clean' })
    expect(securityLabel({ status: 'suspicious' })).toEqual({ tone: 'needsYou', text: 'Review recommended' })
    expect(securityLabel({ status: 'malicious' })).toEqual({ tone: 'failed', text: 'Blocked by ClawHub' })
    expect(securityLabel(undefined)).toBeNull()
  })
})

describe('small formatters', () => {
  it('formatCount', () => {
    expect(formatCount(950)).toBe('950')
    expect(formatCount(3100)).toBe('3.1k')
    expect(formatCount(12_400)).toBe('12.4k')
    expect(formatCount(1_200_000)).toBe('1.2m')
  })
  it('updatedAgo', () => {
    const now = Date.UTC(2026, 8, 18)
    expect(updatedAgo(now - 3 * 86_400_000, now)).toBe('3 days ago')
    expect(updatedAgo(now - 86_400_000, now)).toBe('yesterday')
    expect(updatedAgo(now, now)).toBe('today')
  })
  it('needsNewerGateway compares dated versions, ignoring a range prefix', () => {
    expect(needsNewerGateway('>=2026.9.5', '2026.9.4')).toBe(true)
    expect(needsNewerGateway('2026.4.20', '2026.9.4')).toBe(false)
    expect(needsNewerGateway('2026.9', '2026.9.4')).toBe(false)
    expect(needsNewerGateway(undefined, '2026.9.4')).toBe(false)
  })
  it('readmeForDisplay cuts a long README', () => {
    expect(readmeForDisplay('  ')).toBeNull()
    expect(readmeForDisplay('x'.repeat(README_RENDER_LIMIT + 5))?.truncated).toBe(true)
    expect(readmeForDisplay('# Hi')).toEqual({ text: '# Hi', truncated: false })
  })
})

// Against QA's captured 2026.9.4 payloads.
describe('catalog fixtures', () => {
  it('installs a ClawHub-only entry by its package name (it never carries local.install)', () => {
    expect(F.ENTRY_REMOTE_INSTALLABLE.local.install).toBeUndefined()
    expect(installTargetForEntry(F.ENTRY_REMOTE_INSTALLABLE, { version: '1.4.2' })?.params)
      .toEqual({ source: 'clawhub', packageName: '@example-publisher/issue-tracker', version: '1.4.2' })
    expect(cardAction(F.ENTRY_REMOTE_INSTALLABLE, { admin: true }).kind).toBe('install')
  })
  it('respects the gate when the config is read-only', () => {
    expect(installTargetForEntry(F.ENTRY_REMOTE_READ_ONLY)).toBeNull()
    expect(cardAction(F.ENTRY_REMOTE_READ_ONLY, { admin: true }).kind).toBe('none')
    expect(unavailableReason(F.ENTRY_REMOTE_READ_ONLY, { mutationAllowed: false })).toMatch(/^This gateway doesn't allow/)
  })
  it('installs a present local plugin through its official action, without a version', () => {
    expect(installTargetForEntry(F.ENTRY_LOCAL_OFFICIAL_INSTALLABLE, { version: '9' })?.params).toEqual({ source: 'official', pluginId: 'memory-core' })
    expect(hostInstallCommand(F.ENTRY_LOCAL_OFFICIAL_INSTALLABLE)).toBe('openclaw plugins install memory-core')
  })
  it('has nothing to install for a local-only row', () => {
    expect(installTargetForEntry(F.ENTRY_LOCAL_UNAVAILABLE)).toBeNull()
    expect(unavailableReason(F.ENTRY_LOCAL_UNAVAILABLE, { mutationAllowed: true })).toBe('Not available from the catalog.')
    expect(hostInstallCommand(F.ENTRY_LOCAL_UNAVAILABLE)).toBe('openclaw plugins install browser')
  })
  it('uses the clawhub: spec for a ClawHub entry', () => {
    expect(hostInstallCommand(F.ENTRY_REMOTE_INSTALLABLE)).toBe('openclaw plugins install clawhub:@example-publisher/issue-tracker')
  })
  it('maps every installed state', () => {
    expect(cardAction(F.ENTRY_INSTALLED_ENABLED, { admin: false }).pill?.text).toBe('Installed')
    expect(cardAction(F.ENTRY_INSTALLED_NEEDS_SETUP, { admin: true }).kind).toBe('configure')
    expect(cardAction(F.ENTRY_INSTALLED_DISABLED, { admin: true }).pill?.text).toBe('Off')
    expect(cardAction(F.ENTRY_INSTALLED_ERROR, { admin: true }).pill?.text).toBe('Error')
  })
  it("doesn't claim a local plugin needs nothing", () => {
    expect(needsSummary(F.DETAIL_LOCAL.detail)).toEqual(['Adds skills: joaxclaw-files'])
    expect(needsSummary(F.DETAIL_CLAWHUB_FULL.detail)).toEqual(['1 API key (ISSUE_TOKEN)', 'Adds skills: triage'])
  })
  it('warns about a newer minimum gateway', () => {
    expect(needsNewerGateway(F.DETAIL_CLAWHUB_NEEDS_NEWER_GATEWAY.detail.compatibility?.minGatewayVersion, '2026.9.4')).toBe(true)
    expect(needsNewerGateway(F.DETAIL_CLAWHUB_FULL.detail.compatibility?.minGatewayVersion, '2026.9.4')).toBe(false)
  })
  it('cuts the oversize README', () => {
    expect(readmeForDisplay(F.DETAIL_OVERSIZE_README.detail.readme)?.truncated).toBe(true)
  })
})
