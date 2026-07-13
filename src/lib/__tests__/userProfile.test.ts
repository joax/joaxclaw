import { describe, it, expect } from 'vitest'
import { buildProfilePreamble, chatIdentityName, profileIsEmpty, DEFAULT_IDENTITY } from '../userProfile'

describe('userProfile', () => {
  it('profileIsEmpty treats blank/whitespace as empty', () => {
    expect(profileIsEmpty(undefined)).toBe(true)
    expect(profileIsEmpty({ name: '', about: '' })).toBe(true)
    expect(profileIsEmpty({ name: '   ', about: '\n' })).toBe(true)
    expect(profileIsEmpty({ name: 'Joaq', about: '' })).toBe(false)
    expect(profileIsEmpty({ name: '', about: 'dev' })).toBe(false)
  })

  it('buildProfilePreamble returns null when empty', () => {
    expect(buildProfilePreamble(undefined)).toBeNull()
    expect(buildProfilePreamble({ name: ' ', about: ' ' })).toBeNull()
  })

  it('buildProfilePreamble includes name and about when present', () => {
    const p = buildProfilePreamble({ name: 'Joaq', about: 'Backend engineer, likes concise answers' })!
    expect(p).toContain('Name: Joaq')
    expect(p).toContain('About: Backend engineer, likes concise answers')
    expect(p.startsWith('[')).toBe(true)
    expect(p.endsWith(']')).toBe(true)
  })

  it('buildProfilePreamble omits a missing field', () => {
    const nameOnly = buildProfilePreamble({ name: 'Joaq', about: '' })!
    expect(nameOnly).toContain('Name: Joaq')
    expect(nameOnly).not.toContain('About:')
  })

  it('chatIdentityName uses the name only when opted in and present', () => {
    expect(chatIdentityName({ name: 'Joaq', about: '' }, true)).toBe('Joaq')
    expect(chatIdentityName({ name: 'Joaq', about: '' }, false)).toBe(DEFAULT_IDENTITY)
    expect(chatIdentityName({ name: '  ', about: '' }, true)).toBe(DEFAULT_IDENTITY)
    expect(chatIdentityName(undefined, true)).toBe(DEFAULT_IDENTITY)
  })
})
