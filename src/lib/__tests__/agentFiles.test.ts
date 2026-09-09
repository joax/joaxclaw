import { describe, it, expect } from 'vitest'
import {
  AGENT_CORE_FILES,
  CREATABLE_AGENT_FILES,
  creatableAgentFiles,
  isAgentCoreFile,
} from '../agentFiles'

// `agents.files.set` validates against the gateway's WORKSPACE_BOOTSTRAP_FILENAMES and
// rejects everything else with `unsupported file "<name>"`. These pin the six names, so
// a UI that offers a name outside them fails the test rather than the user.

describe('agent core files', () => {
  it('is exactly the gateway allowlist', () => {
    expect([...AGENT_CORE_FILES]).toEqual([
      'AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'BOOTSTRAP.md', 'MEMORY.md',
    ])
  })

  it('rejects free-text filenames — the old New file box built these', () => {
    expect(isAgentCoreFile('notes.md')).toBe(false)
    expect(isAgentCoreFile('agents.md')).toBe(false)   // allowlist is case-sensitive
    expect(isAgentCoreFile('AGENTS.md')).toBe(true)
  })

  it('only offers files the gateway says may legitimately be absent', () => {
    // AGENTS.md always exists; BOOTSTRAP.md is gateway-owned and hidden post-onboarding.
    expect([...CREATABLE_AGENT_FILES]).not.toContain('AGENTS.md')
    expect([...CREATABLE_AGENT_FILES]).not.toContain('BOOTSTRAP.md')
    for (const name of CREATABLE_AGENT_FILES) expect(isAgentCoreFile(name)).toBe(true)
  })
})

describe('creatableAgentFiles', () => {
  it('offers what is missing', () => {
    expect(creatableAgentFiles(['AGENTS.md', 'SOUL.md']))
      .toEqual(['IDENTITY.md', 'USER.md', 'MEMORY.md'])
  })

  it('offers nothing once every optional file exists', () => {
    expect(creatableAgentFiles(AGENT_CORE_FILES)).toEqual([])
  })

  it('ignores files outside the allowlist', () => {
    expect(creatableAgentFiles(['notes.md', 'SOUL.md']))
      .toEqual(['IDENTITY.md', 'USER.md', 'MEMORY.md'])
  })
})
