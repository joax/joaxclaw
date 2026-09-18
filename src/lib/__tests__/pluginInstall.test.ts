import { describe, it, expect } from 'vitest'
import {
  classifyInstallError, clawhubTarget, findingLocation, hasCriticalFinding, installedOutcome,
  officialTarget, readInstallPolicyWarning, readTrustRefusal, restartCompleted, runStatusLine, withAcks,
  type InstallRun,
} from '../pluginInstall'

// Error payloads below are shaped as plugins-mutations.ts builds them in OpenClaw 2026.9.4:
// `errorShape(code, message, { details })`, with details filled in precedence order.
const policyDetails = (over: Record<string, unknown> = {}) => ({
  installPolicyCode: 'install_policy_warning_acknowledgement_required',
  targetName: 'issue-tracker',
  targetType: 'plugin',
  requestMode: 'install',
  reason: 'Package runs a postinstall script.',
  findings: [
    { ruleId: 'scripts.postinstall', severity: 'warn', message: 'spawns a process', file: 'scripts/postinstall.js', line: 3 },
    { ruleId: 'links.external', severity: 'info', message: 'links to an external host', file: 'README.md' },
  ],
  ...over,
})

describe('withAcks', () => {
  it('sends the bare identity when nothing has been acknowledged', () => {
    expect(withAcks({ source: 'official', pluginId: 'slack' }, {})).toEqual({ source: 'official', pluginId: 'slack' })
  })
  it('carries both acknowledgements together once both were needed', () => {
    // The gateway re-checks consent before the policy on every attempt, so dropping the
    // token on the policy retry would ask for consent a second time.
    expect(withAcks({ source: 'clawhub', packageName: '@acme/tracker', version: '1.4.2' }, { reviewToken: 't1', policyAck: true })).toEqual({
      source: 'clawhub', packageName: '@acme/tracker', version: '1.4.2',
      acknowledgeInstallPolicyWarning: true, acknowledgeCapabilities: { reviewToken: 't1' },
    })
  })
})

describe('targets', () => {
  it('official targets install by plugin id and never carry a version', () => {
    expect(officialTarget('zoom-meetings', 'Zoom meetings', 'meetings')).toEqual({
      params: { source: 'official', pluginId: 'zoom-meetings' }, displayName: 'Zoom meetings', pluginId: 'zoom-meetings', origin: 'meetings',
    })
  })
  it('clawhub targets pick a version only when one is given', () => {
    expect(clawhubTarget('@acme/tracker', 'Tracker').params).toEqual({ source: 'clawhub', packageName: '@acme/tracker' })
    expect(clawhubTarget('@acme/tracker', 'Tracker', { version: '1.0.0' }).params).toEqual({ source: 'clawhub', packageName: '@acme/tracker', version: '1.0.0' })
  })
})

describe('readInstallPolicyWarning', () => {
  it('reads the reason and findings', () => {
    const w = readInstallPolicyWarning({ code: 'INVALID_REQUEST', details: policyDetails() })
    expect(w?.reason).toBe('Package runs a postinstall script.')
    expect(w?.findings).toHaveLength(2)
    expect(w?.findings[0]).toEqual({ ruleId: 'scripts.postinstall', severity: 'warn', message: 'spawns a process', file: 'scripts/postinstall.js', line: 3 })
  })
  it('is null without a reason, since there is nothing to decide on', () => {
    expect(readInstallPolicyWarning({ details: policyDetails({ reason: '  ' }) })).toBeNull()
  })
  it('is null for other refusals', () => {
    expect(readInstallPolicyWarning({ details: { capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED' } })).toBeNull()
    expect(readInstallPolicyWarning(new Error('boom'))).toBeNull()
  })
  it('drops a malformed finding but keeps the question', () => {
    const w = readInstallPolicyWarning({ details: policyDetails({ findings: [
      { ruleId: 'a', severity: 'loud', message: 'bad severity' },
      { ruleId: 'b', severity: 'critical', message: 'fine', line: -1 },
    ] }) })
    expect(w?.findings).toEqual([{ ruleId: 'b', severity: 'critical', message: 'fine' }])
    expect(hasCriticalFinding(w)).toBe(true)
  })
})

describe('findingLocation', () => {
  it('shows file:line, the file alone, or nothing', () => {
    expect(findingLocation({ ruleId: 'x', severity: 'warn', message: 'm', file: 'a.js', line: 3 })).toBe('a.js:3')
    expect(findingLocation({ ruleId: 'x', severity: 'warn', message: 'm', file: 'a.js' })).toBe('a.js')
    expect(findingLocation({ ruleId: 'x', severity: 'warn', message: 'm' })).toBe('')
  })
})

describe('readTrustRefusal', () => {
  it('reads ClawHub trust details', () => {
    expect(readTrustRefusal({ details: { clawhubTrustCode: 'clawhub_download_blocked', warning: 'Malware verdict' } }))
      .toEqual({ code: 'clawhub_download_blocked', warning: 'Malware verdict' })
  })
  it('ignores unknown codes when nothing else is present', () => {
    expect(readTrustRefusal({ details: { clawhubTrustCode: 'something_else' } })).toBeNull()
  })
})

describe('classifyInstallError', () => {
  it('puts consent first, as the gateway does', () => {
    const r = classifyInstallError({ details: { capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED', pluginId: 'p', reviewToken: 't' } }, 'x')
    expect(r.kind).toBe('consent')
  })
  it('reads a policy warning', () => {
    expect(classifyInstallError({ details: policyDetails() }, 'x').kind).toBe('policy')
  })
  it('reports a trust refusal with the gateway warning when there is one', () => {
    expect(classifyInstallError({ details: { clawhubTrustCode: 'clawhub_download_blocked', warning: 'Blocked by scan' } }, 'raw'))
      .toEqual({ kind: 'trust', message: 'Blocked by scan' })
    expect(classifyInstallError({ details: { clawhubTrustCode: 'clawhub_security_unavailable' } }, 'raw'))
      .toEqual({ kind: 'trust', message: 'raw' })
  })
  it('tells a dropped connection from a failure', () => {
    expect(classifyInstallError(new Error('Connection closed'), 'Connection closed').kind).toBe('dropped')
    expect(classifyInstallError(new Error('Disconnected'), 'Disconnected').kind).toBe('dropped')
  })
  it('passes anything else through as text', () => {
    expect(classifyInstallError({ code: 'UNAVAILABLE' }, 'npm exploded')).toEqual({ kind: 'error', message: 'npm exploded' })
  })
})

describe('restartCompleted', () => {
  it('needs a new connection', () => {
    expect(restartCompleted({ bootIdBefore: 'a', bootIdNow: 'b', seqBefore: 3, seqNow: 3 })).toBe(false)
  })
  it('needs a new boot id when both sides have one', () => {
    // A network blip that reconnects to the same process isn't the restart.
    expect(restartCompleted({ bootIdBefore: 'a', bootIdNow: 'a', seqBefore: 3, seqNow: 4 })).toBe(false)
    expect(restartCompleted({ bootIdBefore: 'a', bootIdNow: 'b', seqBefore: 3, seqNow: 4 })).toBe(true)
  })
  it('falls back to "a new connection" when the gateway sends no boot id', () => {
    expect(restartCompleted({ seqBefore: 3, seqNow: 4 })).toBe(true)
    expect(restartCompleted({ bootIdBefore: 'a', seqBefore: 3, seqNow: 4 })).toBe(true)
  })
})

describe('installedOutcome', () => {
  // plugins.list rows as PluginCatalogEntrySchema defines them in 2026.9.
  const list = { plugins: [
    { id: 'slack', name: 'Slack', installed: true, enabled: true, state: 'enabled' },
    { id: 'zoom-meetings', name: 'Zoom', installed: true, enabled: true, state: 'needs-setup' },
    { id: 'teams-meetings', name: 'Teams', installed: true, enabled: false, state: 'disabled' },
    { id: 'broken', name: 'Broken', installed: true, enabled: true, state: 'error', error: 'manifest invalid' },
    { id: 'google-meet', name: 'Meet', installed: false, enabled: false, state: 'not-installed' },
  ], diagnostics: [], mutationAllowed: true }
  it('maps each state', () => {
    expect(installedOutcome(list, 'slack')).toEqual({ outcome: 'enabled' })
    expect(installedOutcome(list, 'zoom-meetings')).toEqual({ outcome: 'needs-setup' })
    expect(installedOutcome(list, 'teams-meetings')).toEqual({ outcome: 'disabled' })
    expect(installedOutcome(list, 'broken')).toEqual({ outcome: 'error', error: 'manifest invalid' })
  })
  it('counts a catalog row that isn\'t installed, or no row, as missing', () => {
    expect(installedOutcome(list, 'google-meet')).toEqual({ outcome: 'missing' })
    expect(installedOutcome(list, 'nope')).toEqual({ outcome: 'missing' })
    expect(installedOutcome(null, 'slack')).toEqual({ outcome: 'missing' })
  })
})

describe('runStatusLine', () => {
  const run = (over: Partial<InstallRun>): InstallRun => ({
    target: officialTarget('slack', 'Slack plugin'), phase: 'installing', acks: {}, ...over,
  })
  it('stays out of the way while a dialog asks', () => {
    expect(runStatusLine(run({ phase: 'consent' }))).toBeNull()
    expect(runStatusLine(run({ phase: 'review' }))).toBeNull()
  })
  it('describes a deferred restart', () => {
    expect(runStatusLine(run({ phase: 'restarting', deferred: true }))?.text).toMatch(/once the work it's running finishes/)
  })
  it('uses the PRD copy for the outcomes', () => {
    expect(runStatusLine(run({ phase: 'done', outcome: 'enabled' }))).toEqual({ tone: 'done', text: 'Installed. Slack plugin is ready.' })
    expect(runStatusLine(run({ phase: 'done', outcome: 'needs-setup' }))?.tone).toBe('needsYou')
    expect(runStatusLine(run({ phase: 'failed', failure: 'timeout' }))).toEqual({
      tone: 'failed', retry: true,
      text: "The gateway didn't come back after installing Slack plugin. Check it on the Gateway tab, then try again.",
    })
    expect(runStatusLine(run({ phase: 'failed', failure: 'restart', message: 'nope' }))?.text)
      .toBe("Installed Slack plugin, but the gateway couldn't restart: nope. Restart it from the Gateway tab.")
    expect(runStatusLine(run({ phase: 'failed', failure: 'trust', message: 'flagged' }))).toEqual({ tone: 'failed', text: 'ClawHub blocked this download: flagged' })
  })
})
