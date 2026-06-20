import { describe, it, expect } from 'vitest'
import {
  channelPolicySpec, nestedPatch, readPolicyPath, readAllowlist, isActionAllowed,
} from '../channelPolicy'

describe('channelPolicySpec', () => {
  it('returns a spec for curated providers', () => {
    expect(channelPolicySpec('discord')?.actions).toContain('moderation')
    expect(channelPolicySpec('telegram')?.access.map(f => f.path)).toContain('allowFrom')
    // matrix uses the nested dm.policy path (no top-level dmPolicy)
    expect(channelPolicySpec('matrix')?.access.map(f => f.path)).toContain('dm.policy')
  })
  it('returns null for non-curated providers', () => {
    expect(channelPolicySpec('irc')).toBeNull()
  })
})

describe('nestedPatch', () => {
  it('builds a flat patch', () => {
    expect(nestedPatch('dmPolicy', 'open')).toEqual({ dmPolicy: 'open' })
  })
  it('builds a nested patch from a dotted path', () => {
    expect(nestedPatch('dm.policy', 'allowlist')).toEqual({ dm: { policy: 'allowlist' } })
    expect(nestedPatch('actions.moderation', false)).toEqual({ actions: { moderation: false } })
  })
})

describe('readPolicyPath / readAllowlist', () => {
  const block = { dmPolicy: 'allowlist', allowFrom: ['a', 'b'], dm: { policy: 'open' }, actions: { moderation: false } }
  it('reads flat and nested paths', () => {
    expect(readPolicyPath(block, 'dmPolicy')).toBe('allowlist')
    expect(readPolicyPath(block, 'dm.policy')).toBe('open')
    expect(readPolicyPath(block, 'missing.path')).toBeUndefined()
    expect(readPolicyPath(undefined, 'dmPolicy')).toBeUndefined()
  })
  it('reads allowlists as clean string arrays', () => {
    expect(readAllowlist(block, 'allowFrom')).toEqual(['a', 'b'])
    expect(readAllowlist(block, 'missing')).toEqual([])
    expect(readAllowlist({ allowFrom: ['a', 2, null, 'b'] }, 'allowFrom')).toEqual(['a', 'b'])
  })
})

describe('isActionAllowed', () => {
  it('defaults to allowed; only an explicit false blocks', () => {
    const block = { actions: { moderation: false, reactions: true } }
    expect(isActionAllowed(block, 'moderation')).toBe(false)
    expect(isActionAllowed(block, 'reactions')).toBe(true)
    expect(isActionAllowed(block, 'pins')).toBe(true)        // unset → allowed
    expect(isActionAllowed(undefined, 'pins')).toBe(true)    // no block → allowed
  })
})
