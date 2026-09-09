import { describe, it, expect } from 'vitest'
import {
  isInstallable, needsForce, skillInstallParams, skillTrustLabel, skillUpdateParams,
  updateOutcomes, type SkillSearchResult,
} from '../skillCatalog'

const hit = (over: Partial<SkillSearchResult> = {}): SkillSearchResult => ({
  score: 3060,
  slug: 'alibabacloud-quickbi-smartq',
  installRef: '@sdk-team/alibabacloud-quickbi-smartq',
  displayName: 'Alibabacloud Quickbi Smartq',
  official: true,
  ownerHandle: 'sdk-team',
  version: null,
  downloads: 877,
  trust: { installability: 'installable' },
  ...over,
})

describe('skillInstallParams', () => {
  it('installs by installRef, never the bare slug', () => {
    // The two differ, and several publishers can share one slug — sending the bare slug
    // could install a DIFFERENT publisher's skill under the name you searched for.
    // Real values from a live ClawHub search.
    expect(skillInstallParams(hit())).toEqual({
      source: 'clawhub',
      slug: '@sdk-team/alibabacloud-quickbi-smartq',
    })
  })

  it('omits a null version rather than sending it', () => {
    // ClawHub returns null for plenty of skills, and null is not "latest".
    expect('version' in skillInstallParams(hit())).toBe(false)
    expect(skillInstallParams(hit({ version: '1.4.0' })).version).toBe('1.4.0')
  })

  it('carries agentId and force only when asked', () => {
    expect(skillInstallParams(hit(), { agentId: 'main', force: true }))
      .toMatchObject({ agentId: 'main', force: true })
    const plain = skillInstallParams(hit())
    expect('agentId' in plain).toBe(false)
    expect('force' in plain).toBe(false)
  })
})

describe('skillUpdateParams', () => {
  it('refreshes one tracked slug', () => {
    expect(skillUpdateParams({ slug: 'pdf-tools' })).toEqual({ source: 'clawhub', slug: 'pdf-tools' })
  })

  it('refreshes everything tracked', () => {
    expect(skillUpdateParams({ all: true })).toEqual({ source: 'clawhub', all: true })
  })

  it('adds force only when retrying deliberately', () => {
    expect(skillUpdateParams({ all: true }, { force: true })).toMatchObject({ force: true })
    expect('force' in skillUpdateParams({ all: true })).toBe(false)
  })
})

describe('needsForce / updateOutcomes', () => {
  it('names the skills whose local edits block an update', () => {
    // The gateway reports this per skill rather than failing the whole call; retrying
    // with force overwrites those edits, which is the user's call, not ours.
    const results = [
      { slug: 'pdf-tools', ok: true },
      { slug: 'my-edited-skill', ok: false, code: 'force_required' },
    ]
    expect(needsForce(results)).toEqual(['my-edited-skill'])
  })

  it('is empty when everything updated cleanly', () => {
    expect(needsForce([{ slug: 'a', ok: true }])).toEqual([])
    expect(needsForce(undefined)).toEqual([])
  })

  it('finds the outcomes wherever they are nested', () => {
    // Success carries them at the top level; a partial failure nests them under details.
    expect(updateOutcomes({ results: [{ slug: 'a' }] })).toEqual([{ slug: 'a' }])
    expect(updateOutcomes({ details: { results: [{ slug: 'b' }] } })).toEqual([{ slug: 'b' }])
    expect(updateOutcomes({ nothing: true })).toEqual([])
    expect(updateOutcomes(undefined)).toEqual([])
  })
})

describe('skillTrustLabel', () => {
  it('marks official results', () => {
    expect(skillTrustLabel(hit())).toBe('Official')
  })

  it('falls back to the publisher handle', () => {
    expect(skillTrustLabel(hit({ official: false, publisher: { handle: 'someone' } }))).toBe('someone')
    expect(skillTrustLabel(hit({ official: false, publisher: undefined }))).toBe('sdk-team')
  })

  it('prefers an explicit ClawHub verdict over a handle', () => {
    expect(skillTrustLabel(hit({ official: false, trust: { clawHubVerdict: 'flagged' } }))).toBe('flagged')
  })
})

describe('isInstallable', () => {
  it('trusts an unknown installability rather than blocking', () => {
    // An older gateway may not report it at all; refusing would hide every result.
    expect(isInstallable(hit({ trust: undefined }))).toBe(true)
    expect(isInstallable(hit({ trust: { installability: 'installable' } }))).toBe(true)
  })

  it('respects an explicit refusal', () => {
    expect(isInstallable(hit({ trust: { installability: 'unavailable' } }))).toBe(false)
  })
})
