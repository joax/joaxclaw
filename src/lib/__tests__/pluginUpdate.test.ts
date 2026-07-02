import { describe, it, expect } from 'vitest'
import { compareSemver, isUpdateAvailable } from '../pluginUpdate'

describe('compareSemver', () => {
  it('orders by major/minor/patch', () => {
    expect(compareSemver('0.5.0', '0.4.0')).toBe(1)
    expect(compareSemver('0.4.0', '0.5.0')).toBe(-1)
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1)
    expect(compareSemver('0.4.10', '0.4.9')).toBe(1)
    expect(compareSemver('0.5.0', '0.5.0')).toBe(0)
  })
  it('tolerates a leading v and prerelease/build suffixes', () => {
    expect(compareSemver('v0.5.0', '0.4.0')).toBe(1)
    expect(compareSemver('0.5.0-beta.1', '0.5.0')).toBe(0)  // suffix ignored
  })
  it('returns 0 for unparseable versions (no update prompt)', () => {
    expect(compareSemver('nightly', '0.4.0')).toBe(0)
    expect(compareSemver(undefined, '0.4.0')).toBe(0)
  })
})

describe('isUpdateAvailable', () => {
  it('is true only when latest is strictly newer than installed', () => {
    expect(isUpdateAvailable('0.4.0', '0.5.0')).toBe(true)
    expect(isUpdateAvailable('0.5.0', '0.5.0')).toBe(false)
    expect(isUpdateAvailable('0.5.0', '0.4.0')).toBe(false)
  })
  it('is false when either version is missing', () => {
    expect(isUpdateAvailable(undefined, '0.5.0')).toBe(false)
    expect(isUpdateAvailable('0.4.0', undefined)).toBe(false)
  })
})
