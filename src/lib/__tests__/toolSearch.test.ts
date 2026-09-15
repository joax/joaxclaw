import { describe, it, expect } from 'vitest'
import { isExplicitlyOff, parseCalVer, localToolSearchOn } from '../toolSearch'

// On OpenClaw 2026.9 local models get Tool Search by default, and then write their tool
// calls as text (nothing runs). The chat names that cause, but only when it actually
// applies on this gateway.

describe('isExplicitlyOff', () => {
  it('is false or an object with enabled: false', () => {
    expect(isExplicitlyOff(false)).toBe(true)
    expect(isExplicitlyOff({ enabled: false, mode: 'tools' })).toBe(true)
    expect(isExplicitlyOff(undefined)).toBe(false)
    expect(isExplicitlyOff(true)).toBe(false)
    expect(isExplicitlyOff({ mode: 'tools' })).toBe(false)
  })
})

describe('parseCalVer', () => {
  it('reads the version however the gateway phrases it', () => {
    expect(parseCalVer('2026.9.4')).toEqual([2026, 9, 4])
    expect(parseCalVer('2026.9.1-beta.1')).toEqual([2026, 9, 1])
    expect(parseCalVer('OpenClaw 2026.8.2 (3a9d69d)')).toEqual([2026, 8, 2])
    expect(parseCalVer('dev')).toBeNull()
    expect(parseCalVer(undefined)).toBeNull()
  })
})

describe('localToolSearchOn', () => {
  it('an explicit value wins either way', () => {
    expect(localToolSearchOn({ setting: false, serverVersion: '2026.9.4' })).toBe(false)
    expect(localToolSearchOn({ setting: { enabled: false }, localModelLean: true })).toBe(false)
    expect(localToolSearchOn({ setting: true, serverVersion: '2026.8.2' })).toBe(true)
    expect(localToolSearchOn({ setting: { mode: 'tools' } })).toBe(true)
  })

  it('unset on 2026.9+: on automatically (the reported gateway)', () => {
    expect(localToolSearchOn({ setting: undefined, serverVersion: '2026.9.4' })).toBe(true)
    expect(localToolSearchOn({ setting: undefined, serverVersion: '2027.1.0' })).toBe(true)
  })

  it('unset on 2026.8: only through lean mode', () => {
    expect(localToolSearchOn({ setting: undefined, serverVersion: '2026.8.2' })).toBe(false)
    expect(localToolSearchOn({ setting: undefined, serverVersion: '2026.8.2', localModelLean: true })).toBe(true)
  })

  it('unset with an unknown version: only through lean mode', () => {
    expect(localToolSearchOn({ setting: undefined })).toBe(false)
    expect(localToolSearchOn({ setting: undefined, localModelLean: true })).toBe(true)
  })
})
