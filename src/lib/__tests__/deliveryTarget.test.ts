import { describe, it, expect } from 'vitest'
import { deliveryTargetSpec, validateDeliveryTarget } from '../channels'

// A cron announcing to WhatsApp failed on its first scheduled run with "Delivering to
// WhatsApp requires target <E.164|group JID|newsletter JID>" — the form had offered the
// recipient as optional for every channel. These lock which channels can infer a
// recipient and which must be told, so the refusal happens at save time instead.

describe('deliveryTargetSpec', () => {
  it('marks WhatsApp and SMS as needing an explicit recipient', () => {
    expect(deliveryTargetSpec('whatsapp').required).toBe(true)
    expect(deliveryTargetSpec('sms').required).toBe(true)
  })

  it('lets channels that can reply in-place stay optional', () => {
    for (const id of ['slack', 'telegram', 'discord']) {
      expect(deliveryTargetSpec(id).required, id).toBe(false)
    }
  })

  it('falls back to an optional target for unknown or blank channels', () => {
    expect(deliveryTargetSpec('mattermost').required).toBe(false)
    expect(deliveryTargetSpec(undefined).required).toBe(false)
  })

  it('is case- and whitespace-insensitive about the channel id', () => {
    expect(deliveryTargetSpec(' WhatsApp ').required).toBe(true)
  })

  it('names the accepted formats in the hint the user reads', () => {
    expect(deliveryTargetSpec('whatsapp').hint).toMatch(/E\.164/)
    expect(deliveryTargetSpec('whatsapp').hint).toMatch(/g\.us/)
  })
})

describe('validateDeliveryTarget — WhatsApp', () => {
  it('accepts the three shapes the gateway accepts', () => {
    expect(validateDeliveryTarget('whatsapp', '+34600123456')).toBeNull()
    expect(validateDeliveryTarget('whatsapp', '120363021234567890@g.us')).toBeNull()
    expect(validateDeliveryTarget('whatsapp', '120363021234567890@newsletter')).toBeNull()
    expect(validateDeliveryTarget('whatsapp', '34600123456@s.whatsapp.net')).toBeNull()
  })

  it('refuses an empty recipient', () => {
    expect(validateDeliveryTarget('whatsapp', '')).toMatch(/can’t infer/)
    expect(validateDeliveryTarget('whatsapp', '   ')).toMatch(/can’t infer/)
  })

  it('explains a bare phone number rather than just rejecting it', () => {
    expect(validateDeliveryTarget('whatsapp', '600123456')).toMatch(/country code/)
  })

  it('rejects a handle, which WhatsApp has no concept of', () => {
    expect(validateDeliveryTarget('whatsapp', '@someone')).toMatch(/Expected a phone number/)
  })

  it('tolerates surrounding whitespace', () => {
    expect(validateDeliveryTarget('whatsapp', '  +34600123456  ')).toBeNull()
  })
})

describe('validateDeliveryTarget — other channels', () => {
  it('lets an optional channel through with no recipient', () => {
    expect(validateDeliveryTarget('slack', '')).toBeNull()
    expect(validateDeliveryTarget(undefined, '')).toBeNull()
  })

  it('accepts whatever an optional channel is given', () => {
    expect(validateDeliveryTarget('slack', '#general')).toBeNull()
    expect(validateDeliveryTarget('telegram', '-1001234567890')).toBeNull()
  })

  it('holds SMS to E.164', () => {
    expect(validateDeliveryTarget('sms', '+34600123456')).toBeNull()
    expect(validateDeliveryTarget('sms', '600123456')).toMatch(/E\.164/)
    expect(validateDeliveryTarget('sms', '')).toMatch(/E\.164/)
  })
})
