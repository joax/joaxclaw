import { describe, it, expect } from 'vitest'
import {
  describeSurface, installParamsFor, readConsentRequired, surfaceHasDanger, trustLabel,
  type PluginSearchPackage,
} from '../pluginCatalog'

const pkg = (over: Partial<PluginSearchPackage> = {}): PluginSearchPackage => ({
  name: '@openclaw/slack',
  displayName: 'Slack',
  family: 'code-plugin',
  channel: 'official',
  isOfficial: true,
  latestVersion: '2026.9.3',
  runtimeId: 'slack',
  ...over,
})

describe('readConsentRequired', () => {
  it('lifts the token out of a refusal', () => {
    // The token is the whole point of the challenge, and could not survive a message match.
    expect(readConsentRequired({
      code: 'INVALID_REQUEST',
      details: {
        capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED',
        pluginId: 'slack',
        reviewToken: 'abc123',
        widened: { tools: ['slack_post'] },
        acceptedAt: '2026-09-01T00:00:00Z',
      },
    })).toEqual({
      pluginId: 'slack',
      reviewToken: 'abc123',
      widened: { tools: ['slack_post'] },
      acceptedAt: '2026-09-01T00:00:00Z',
    })
  })

  it('is null for any other failure', () => {
    expect(readConsentRequired({ code: 'INVALID_REQUEST', message: 'nope' })).toBeNull()
    expect(readConsentRequired({ details: { capabilityConsentCode: 'SOMETHING_ELSE' } })).toBeNull()
    expect(readConsentRequired(undefined)).toBeNull()
  })

  it('is null when the challenge is unusable', () => {
    // Without a token there is nothing to acknowledge with, so this must not be
    // mistaken for a consent prompt we can satisfy.
    expect(readConsentRequired({
      details: { capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED', pluginId: 'slack' },
    })).toBeNull()
  })
})

describe('describeSurface', () => {
  it('puts dangerous flags first', () => {
    const lines = describeSurface({
      channels: ['slack'],
      tools: ['slack_post'],
      dangerousConfigFlags: ['gateway.auth.mode'],
    })
    expect(lines[0]).toEqual({ label: 'Dangerous config flags', items: ['gateway.auth.mode'], dangerous: true })
    expect(lines.map(l => l.label)).toEqual(['Dangerous config flags', 'Messaging channels', 'Agent tools'])
  })

  it('drops empty groups rather than listing nine empty headings', () => {
    expect(describeSurface({ channels: ['slack'], providers: [], tools: [] }))
      .toEqual([{ label: 'Messaging channels', items: ['slack'] }])
  })

  it('is empty for a plugin that declares nothing', () => {
    // The caller must say "declares nothing" — an empty panel and an unread one look
    // identical and mean very different things when the question is consent.
    expect(describeSurface({})).toEqual([])
    expect(describeSurface(undefined)).toEqual([])
  })
})

describe('surfaceHasDanger', () => {
  it('is true only for a declared dangerous flag', () => {
    expect(surfaceHasDanger({ dangerousConfigFlags: ['gateway.auth.mode'] })).toBe(true)
    expect(surfaceHasDanger({ tools: ['x'], dangerousConfigFlags: [] })).toBe(false)
    expect(surfaceHasDanger(undefined)).toBe(false)
  })
})

describe('installParamsFor', () => {
  it('installs an official plugin by its runtime id', () => {
    // The two union members take different identifying fields; sending the wrong one
    // fails the whole call against a closed schema.
    expect(installParamsFor(pkg())).toEqual({ source: 'official', pluginId: 'slack' })
  })

  it('installs a community package by name and version', () => {
    expect(installParamsFor(pkg({
      name: 'slack-thinking-steps', isOfficial: false, channel: 'community',
      runtimeId: undefined, latestVersion: '1.2.0',
    }))).toEqual({ source: 'clawhub', packageName: 'slack-thinking-steps', version: '1.2.0' })
  })

  it('falls back to ClawHub for an official package with no runtime id', () => {
    expect(installParamsFor(pkg({ runtimeId: undefined })))
      .toEqual({ source: 'clawhub', packageName: '@openclaw/slack', version: '2026.9.3' })
  })

  it('omits version when the package advertises none', () => {
    const params = installParamsFor(pkg({ isOfficial: false, runtimeId: undefined, latestVersion: undefined }))
    expect('version' in params).toBe(false)
  })

  it('carries an acknowledgment through either shape', () => {
    expect(installParamsFor(pkg(), 'tok')).toMatchObject({ acknowledgeCapabilities: { reviewToken: 'tok' } })
    expect(installParamsFor(pkg({ isOfficial: false, runtimeId: undefined }), 'tok'))
      .toMatchObject({ acknowledgeCapabilities: { reviewToken: 'tok' } })
  })

  it('omits the acknowledgment entirely when there is none', () => {
    // An absent key and an undefined one are different to a closed schema.
    expect('acknowledgeCapabilities' in installParamsFor(pkg())).toBe(false)
  })
})

describe('trustLabel', () => {
  it('names the provenance', () => {
    expect(trustLabel(pkg())).toBe('Official')
    expect(trustLabel(pkg({ isOfficial: false, channel: 'community' }))).toBe('Community')
    expect(trustLabel(pkg({ isOfficial: false, channel: 'private' }))).toBe('Private')
  })
})
