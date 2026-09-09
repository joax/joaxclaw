import { describe, it, expect } from 'vitest'
import { vapidKeyToBytes, pushUrlToNavigate, defaultPushPrefs } from '../webPush'

// The VAPID key arrives base64url and `PushManager.subscribe` wants raw bytes. Getting
// the alphabet or the padding wrong produces a subscription the push service rejects
// later, on a phone, with no useful error — so it is pinned here instead.
describe('vapidKeyToBytes', () => {
  it('decodes the base64url alphabet', () => {
    // "\xfb\xff" encodes as "+/8=" in base64 and "-_8" in base64url.
    expect(Array.from(vapidKeyToBytes('-_8'))).toEqual([0xfb, 0xff])
  })

  it('restores stripped padding', () => {
    expect(Array.from(vapidKeyToBytes('QQ'))).toEqual([0x41])       // needs "=="
    expect(Array.from(vapidKeyToBytes('QUI'))).toEqual([0x41, 0x42]) // needs "="
  })

  it('decodes a real 65-byte P-256 application server key', () => {
    const key = 'BOEHV960gYW9RhLFPzhBz5AzN2csZcqoiFR-0G2lbiSpSD8tgOm9AUZDYFbyCXEEXkyyyMmQb1niCaax2wWlhZw'
    const bytes = vapidKeyToBytes(key)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(0x04)  // uncompressed EC point marker
  })
})

// The gateway's push payload carries its own Control UI path, relative when
// `gateway.publicOrigin` is unset and absolute when it is set — a config key we don't
// control, so both have to work.
describe('pushUrlToNavigate', () => {
  it('routes a failed scheduled task to Automations, relative or absolute', () => {
    expect(pushUrlToNavigate('automations?job=abc&run=1')).toEqual({ section: 'crons' })
    expect(pushUrlToNavigate('https://gw.example.com/automations?job=abc')).toEqual({ section: 'crons' })
  })

  it('tolerates a Control UI served under a base path', () => {
    expect(pushUrlToNavigate('https://gw.example.com/ui/automations')).toEqual({ section: 'crons' })
  })

  it('declines paths this app has no view for, so the tap just focuses the app', () => {
    // Approvals and questions land here until their views exist (Phase 2 / Phase 1).
    expect(pushUrlToNavigate('approve/abc123')).toBeUndefined()
    expect(pushUrlToNavigate('ask/q1')).toBeUndefined()
  })

  it('declines a missing or unusable url', () => {
    expect(pushUrlToNavigate(undefined)).toBeUndefined()
    expect(pushUrlToNavigate('')).toBeUndefined()
    expect(pushUrlToNavigate('   ')).toBeUndefined()
    expect(pushUrlToNavigate(42)).toBeUndefined()
  })
})

describe('defaultPushPrefs', () => {
  it('only opts into categories this app can act on', () => {
    const { categories } = defaultPushPrefs()
    expect(categories.agentFinished).toBe(true)
    expect(categories.scheduledTaskFailed).toBe(true)
    expect(categories.backgroundTaskFailed).toBe(true)
    // No approvals or questions UI yet — the gateway would push into a dead end.
    expect(categories.approvalRequested).toBe(false)
    expect(categories.agentQuestion).toBe(false)
  })

  it('sends every category the closed schema requires', () => {
    // `push.web.preferences.set` validates against a closed object: an omitted key is
    // a hard INVALID_REQUEST, not a default.
    expect(Object.keys(defaultPushPrefs().categories).sort()).toEqual([
      'agentFinished', 'agentQuestion', 'approvalRequested',
      'backgroundTaskFailed', 'humanMentioned', 'scheduledTaskFailed',
    ])
  })
})
