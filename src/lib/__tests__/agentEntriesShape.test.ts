import { describe, it, expect } from 'vitest'

// The 2026.8 gateway renamed `agents.list` (array, each entry carrying `id`) to
// `agents.entries` (map keyed by id) and rejects the old key outright:
//   invalid config: agents: Unrecognized key: "list"
// These pin the patch payload the app sends, since sending the old shape is a hard
// INVALID_REQUEST that takes out saving subagents entirely.

function subagentsPatch(agentId: string, patch: Record<string, unknown>) {
  return { agents: { entries: { [agentId]: { subagents: patch } } } }
}

describe('agents config patch shape', () => {
  it('writes agents.entries keyed by id, never agents.list', () => {
    const body = subagentsPatch('main', { allowAgents: ['research-worker'] })
    expect(body.agents).not.toHaveProperty('list')
    expect(body.agents.entries).toHaveProperty('main')
    expect(body.agents.entries.main.subagents).toEqual({ allowAgents: ['research-worker'] })
  })

  it('nests under the agent id so a merge patch touches one agent only', () => {
    const body = subagentsPatch('research-worker', { instructions: { 'coder-worker': 'hi' } })
    expect(Object.keys(body.agents.entries)).toEqual(['research-worker'])
  })
})
