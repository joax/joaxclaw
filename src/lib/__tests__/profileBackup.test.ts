import { describe, it, expect } from 'vitest'
import { mergeProfileBackup, type ProfileState } from '../profileBackup'

const state = (over: Partial<ProfileState> = {}): ProfileState => ({
  userProfile: { name: '', about: '' },
  shareProfile: true,
  useNameAsIdentity: true,
  welcomeSeen: false,
  ...over,
})

describe('mergeProfileBackup', () => {
  // The reported bug: the welcome asked again on every open.
  it('restores "welcome seen" so the first-run modal never asks twice', () => {
    expect(mergeProfileBackup(state(), { welcomeSeen: true })).toEqual({ welcomeSeen: true })
  })

  it('never un-sets "welcome seen" from a stale backup', () => {
    const patch = mergeProfileBackup(state({ welcomeSeen: true }), { welcomeSeen: false })
    expect(patch.welcomeSeen).toBeUndefined()
  })

  it('restores a profile localStorage lost', () => {
    const backup = { userProfile: { name: 'Joaquin', about: 'Builds JoaxClaw' } }
    expect(mergeProfileBackup(state(), backup).userProfile).toEqual(backup.userProfile)
  })

  it('never overwrites a profile the user has already typed here', () => {
    const current = state({ userProfile: { name: 'Local', about: '' } })
    const patch = mergeProfileBackup(current, { userProfile: { name: 'Older', about: 'stale' } })
    expect(patch.userProfile).toBeUndefined()
  })

  it('treats a whitespace-only profile as empty on both sides', () => {
    expect(mergeProfileBackup(state({ userProfile: { name: '  ', about: ' ' } }), {
      userProfile: { name: 'Real', about: '' },
    }).userProfile).toEqual({ name: 'Real', about: '' })

    expect(mergeProfileBackup(state(), { userProfile: { name: ' ', about: '  ' } }).userProfile).toBeUndefined()
  })

  it('restores an opt-OUT, since these default to on', () => {
    expect(mergeProfileBackup(state(), { shareProfile: false })).toEqual({ shareProfile: false })
    expect(mergeProfileBackup(state(), { useNameAsIdentity: false })).toEqual({ useNameAsIdentity: false })
  })

  it('is a no-op for an empty backup — a genuinely new install still gets the welcome', () => {
    expect(mergeProfileBackup(state(), {})).toEqual({})
  })

  it('fills every gap at once when localStorage is wiped', () => {
    const patch = mergeProfileBackup(state(), {
      userProfile: { name: 'Joaquin', about: 'x' }, welcomeSeen: true,
      shareProfile: false, useNameAsIdentity: false,
    })
    expect(patch).toEqual({
      userProfile: { name: 'Joaquin', about: 'x' }, welcomeSeen: true,
      shareProfile: false, useNameAsIdentity: false,
    })
  })
})
