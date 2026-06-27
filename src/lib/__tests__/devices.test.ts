import { describe, it, expect } from 'vitest'
import { relativeFromMs } from '../dateUtils'
import { deviceHasAdmin, isLastAdminDevice, type PairedDevice } from '../../store/devices'

const NOW = 1_700_000_000_000

describe('relativeFromMs', () => {
  it('returns empty for missing/invalid input', () => {
    expect(relativeFromMs(undefined, NOW)).toBe('')
    expect(relativeFromMs(0, NOW)).toBe('')
    expect(relativeFromMs(-5, NOW)).toBe('')
  })
  it('buckets durations compactly', () => {
    expect(relativeFromMs(NOW - 10_000, NOW)).toBe('now')        // <45s
    expect(relativeFromMs(NOW - 5 * 60_000, NOW)).toBe('5m')
    expect(relativeFromMs(NOW - 3 * 3_600_000, NOW)).toBe('3h')
    expect(relativeFromMs(NOW - 21 * 86_400_000, NOW)).toBe('21d')
    expect(relativeFromMs(NOW - 90 * 86_400_000, NOW)).toBe('3mo')
    expect(relativeFromMs(NOW - 800 * 86_400_000, NOW)).toBe('2y')
  })
  it('clamps a future timestamp to now', () => {
    expect(relativeFromMs(NOW + 10_000, NOW)).toBe('now')
  })
})

// ── device admin / last-admin guard ─────────────────────────────────────────────

function dev(id: string, opts: Partial<PairedDevice> = {}): PairedDevice {
  return { deviceId: id, publicKey: 'pk-' + id, role: 'operator', scopes: ['operator.read'], createdAtMs: NOW, ...opts }
}

describe('deviceHasAdmin', () => {
  it('true when a non-revoked token carries operator.admin', () => {
    expect(deviceHasAdmin(dev('a', { tokens: [{ role: 'operator', scopes: ['operator.admin'], createdAtMs: NOW }] }))).toBe(true)
  })
  it('false when the only admin token is revoked', () => {
    expect(deviceHasAdmin(dev('a', { tokens: [{ role: 'operator', scopes: ['operator.admin'], createdAtMs: NOW, revokedAtMs: NOW }] }))).toBe(false)
  })
  it('falls back to granted scopes when there are no token records', () => {
    expect(deviceHasAdmin(dev('a', { scopes: ['operator.admin', 'operator.read'] }))).toBe(true)
    expect(deviceHasAdmin(dev('a', { scopes: ['operator.read'] }))).toBe(false)
  })
})

describe('isLastAdminDevice', () => {
  const adminTok = [{ role: 'operator', scopes: ['operator.admin'], createdAtMs: NOW }]
  it('true only when the device is the sole admin', () => {
    const a = dev('a', { tokens: adminTok })
    const b = dev('b', { tokens: [{ role: 'operator', scopes: ['operator.read'], createdAtMs: NOW }] })
    expect(isLastAdminDevice([a, b], 'a')).toBe(true)
    expect(isLastAdminDevice([a, b], 'b')).toBe(false)
  })
  it('false when two devices are admin', () => {
    const a = dev('a', { tokens: adminTok })
    const b = dev('b', { tokens: adminTok })
    expect(isLastAdminDevice([a, b], 'a')).toBe(false)
  })
  it('false when no admin devices exist', () => {
    expect(isLastAdminDevice([dev('a'), dev('b')], 'a')).toBe(false)
  })
})
