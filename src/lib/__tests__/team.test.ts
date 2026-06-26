import { describe, it, expect } from 'vitest'
import {
  TEAM_SCHEMA_VERSION,
  MAX_REVISIONS,
  BRANCH_END,
  type TeamBlueprint,
  type TeamExportBundle,
  type TeamRoute,
  newBlueprint,
  bumpBlueprint,
  serializeBlueprint,
  parseBlueprint,
  serializeBundle,
  parseBundle,
  blueprintPath,
  blueprintFilename,
  compiledMdPath,
  revisionsPath,
  appendRevision,
  parseRevisions,
  serializeRevisions,
  validateBundle,
  parseRunRequest,
  serializeRunRequest,
  runRequestPath,
  type TeamRunRequest,
} from '../teamBlueprint'
import { buildTeamProcessDef, extractMembersFromDef } from '../teamCompiler'
import { compileProcessToJob, buildLaunchPrompt } from '../processCompiler'
import { serializeProcess, parseProcessFile } from '../processParser'
import { validateTeamForLaunch } from '../teamValidation'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MEMBERS = [
  { agentId: 'researcher', role: 'Researcher', task: 'Gather relevant data' },
  { agentId: 'analyst',    role: 'Analyst',    task: 'Analyse and summarise findings' },
  { agentId: 'writer',     role: 'Writer',     task: 'Write the final report', reviewBefore: true },
]

function makeBp(overrides: Partial<TeamBlueprint> = {}): TeamBlueprint {
  const base = newBlueprint('test-team', 'Test Team')
  return {
    ...base,
    controllerAgentId: 'controller-agent',
    members: MEMBERS,
    outputContract: 'A three-section report.',
    ...overrides,
  }
}

// ── Blueprint serialization round-trip ───────────────────────────────────────

describe('blueprint serialization', () => {
  it('round-trips through JSON', () => {
    const bp = makeBp()
    const text = serializeBlueprint(bp)
    const parsed = parseBlueprint(text)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe(bp.id)
    expect(parsed!.name).toBe(bp.name)
    expect(parsed!.controllerAgentId).toBe(bp.controllerAgentId)
    expect(parsed!.members).toHaveLength(3)
    expect(parsed!.outputContract).toBe(bp.outputContract)
    expect(parsed!.schemaVersion).toBe(TEAM_SCHEMA_VERSION)
  })

  it('returns null for invalid JSON', () => {
    expect(parseBlueprint('not json')).toBeNull()
    expect(parseBlueprint('{}')).toBeNull()           // missing id
    expect(parseBlueprint('{"id":"x"}')).toBeNull()   // missing name
  })

  it('preserves all member fields including optional ones', () => {
    const bp = makeBp()
    const parsed = parseBlueprint(serializeBlueprint(bp))!
    const writer = parsed.members.find(m => m.agentId === 'writer')!
    expect(writer.reviewBefore).toBe(true)
    const researcher = parsed.members.find(m => m.agentId === 'researcher')!
    expect(researcher.reviewBefore).toBeUndefined()
  })
})

// ── Bundle serialization round-trip ──────────────────────────────────────────

describe('bundle serialization', () => {
  it('round-trips a full bundle', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const compiled = serializeProcess(def)
    const bundle: TeamExportBundle = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: bp,
      compiledProcessMd: compiled,
      exportedAt: Date.now(),
    }
    const parsed = parseBundle(serializeBundle(bundle))
    expect(parsed).not.toBeNull()
    expect(parsed!.blueprint.id).toBe(bp.id)
    expect(parsed!.blueprint.members).toHaveLength(3)
    expect(parsed!.compiledProcessMd).toBe(compiled)
  })

  it('accepts a bare blueprint JSON (no bundle wrapper)', () => {
    const bp = makeBp()
    const parsed = parseBundle(serializeBlueprint(bp))
    expect(parsed).not.toBeNull()
    expect(parsed!.blueprint.id).toBe(bp.id)
  })

  it('returns null for garbage input', () => {
    expect(parseBundle('garbage')).toBeNull()
    expect(parseBundle('{}')).toBeNull()
  })
})

// ── bumpBlueprint ─────────────────────────────────────────────────────────────

describe('bumpBlueprint', () => {
  it('increments version', () => {
    const bp = makeBp()
    const bumped = bumpBlueprint(bp, { name: 'Updated Name' })
    expect(bumped.version).toBe(bp.version + 1)
  })

  it('preserves immutable fields', () => {
    const bp = makeBp()
    const bumped = bumpBlueprint(bp, { name: 'Changed' })
    expect(bumped.id).toBe(bp.id)
    expect(bumped.createdAt).toBe(bp.createdAt)
    expect(bumped.schemaVersion).toBe(bp.schemaVersion)
  })

  it('updates the patched fields', () => {
    const bp = makeBp()
    const bumped = bumpBlueprint(bp, { name: 'New Name', outputContract: 'New contract' })
    expect(bumped.name).toBe('New Name')
    expect(bumped.outputContract).toBe('New contract')
  })

  it('updates updatedAt', () => {
    const bp = makeBp()
    const before = Date.now()
    const bumped = bumpBlueprint(bp, {})
    expect(bumped.updatedAt).toBeGreaterThanOrEqual(before)
  })
})

// ── Compiler ──────────────────────────────────────────────────────────────────

describe('buildTeamProcessDef', () => {
  it('produces a ProcessDef with correct id, name, type', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    expect(def.id).toBe('test-team')
    expect(def.name).toBe('Test Team')
    expect(def.type).toBe('team')
  })

  it('sets controllerAgentId', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    expect(def.controllerAgentId).toBe('controller-agent')
  })

  it('includes outputContract', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    expect(def.outputContract).toBe('A three-section report.')
  })

  it('generates start + agent nodes + handoff nodes + end', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const nodes = def.graph!.nodes
    const types = nodes.map(n => n.type)
    expect(types).toContain('start')
    expect(types).toContain('end')
    // 3 members → 3 agent nodes
    expect(nodes.filter(n => n.type === 'agent')).toHaveLength(3)
    // 2 handoff nodes (between 3 members)
    expect(nodes.filter(n => n.type === 'handoff')).toHaveLength(2)
    // 1 review gate before member[2] (reviewBefore: true)
    expect(nodes.filter(n => n.type === 'review')).toHaveLength(1)
  })

  it('sets agentId on agent nodes', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const agentIds = def.graph!.nodes
      .filter(n => n.type === 'agent')
      .map(n => n.agentId)
    expect(agentIds).toContain('researcher')
    expect(agentIds).toContain('analyst')
    expect(agentIds).toContain('writer')
  })

  it('produces a fully connected graph (no dangling nodes)', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const { nodes, edges } = def.graph!
    const nodeIds = new Set(nodes.map(n => n.id))
    const edgeFromIds = new Set(edges.map(e => e.from))
    const edgeToIds   = new Set(edges.map(e => e.to))

    // Every non-start node should be a target of at least one edge
    const nonStartNodes = nodes.filter(n => n.type !== 'start')
    for (const n of nonStartNodes) {
      expect(edgeToIds.has(n.id), `Node ${n.id} has no incoming edge`).toBe(true)
    }
    // Every non-end node should be a source of at least one edge
    const nonEndNodes = nodes.filter(n => n.type !== 'end')
    for (const n of nonEndNodes) {
      expect(edgeFromIds.has(n.id), `Node ${n.id} has no outgoing edge`).toBe(true)
    }
    // All edge endpoints must refer to real node ids
    for (const e of edges) {
      expect(nodeIds.has(e.from), `Edge ${e.id} from unknown node ${e.from}`).toBe(true)
      expect(nodeIds.has(e.to),   `Edge ${e.id} to unknown node ${e.to}`).toBe(true)
    }
  })

  it('survives a single-member team (no handoffs)', () => {
    const bp = makeBp({ members: [{ agentId: 'solo', role: 'Solo', task: 'Do everything' }] })
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    expect(def.graph!.nodes.filter(n => n.type === 'handoff')).toHaveLength(0)
    expect(def.graph!.nodes.filter(n => n.type === 'agent')).toHaveLength(1)
  })
})

// ── Compile → extract round-trip ─────────────────────────────────────────────

describe('compile → extract members round-trip', () => {
  it('extractMembersFromDef returns original members', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const extracted = extractMembersFromDef(def)

    expect(extracted).toHaveLength(3)
    expect(extracted[0].agentId).toBe('researcher')
    expect(extracted[0].role).toBe('Researcher')
    expect(extracted[1].agentId).toBe('analyst')
    expect(extracted[2].agentId).toBe('writer')
    expect(extracted[2].reviewBefore).toBe(true)
    expect(extracted[0].reviewBefore).toBe(false)
  })

  it('round-trips through ProcessDef serialization', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const md = serializeProcess(def)
    const reparsed = parseProcessFile('/tmp/test-team.md', md)

    expect(reparsed).not.toBeNull()
    expect(reparsed!.id).toBe(bp.id)
    expect(reparsed!.type).toBe('team')
    expect(reparsed!.outputContract).toBe(bp.outputContract)
    expect(reparsed!.controllerAgentId).toBe(bp.controllerAgentId)

    const members = extractMembersFromDef(reparsed!)
    expect(members).toHaveLength(3)
    expect(members[0].agentId).toBe('researcher')
    expect(members[2].reviewBefore).toBe(true)
  })
})

// ── Path helpers ──────────────────────────────────────────────────────────────

describe('path helpers', () => {
  it('blueprintPath produces correct filename', () => {
    expect(blueprintPath('my-team', '/home/user/.openclaw/teams'))
      .toBe('/home/user/.openclaw/teams/my-team.team.json')
  })

  it('compiledMdPath produces correct filename', () => {
    expect(compiledMdPath('my-team', '/home/user/.openclaw/teams'))
      .toBe('/home/user/.openclaw/teams/my-team.md')
  })

  it('revisionsPath produces correct filename', () => {
    expect(revisionsPath('my-team', '/home/user/.openclaw/teams'))
      .toBe('/home/user/.openclaw/teams/my-team.revisions.json')
  })
})

// ── Revision history ──────────────────────────────────────────────────────────

describe('revision history', () => {
  it('appendRevision stores a full blueprint snapshot', () => {
    const bp = makeBp()
    const revs = appendRevision([], bp)
    expect(revs).toHaveLength(1)
    expect(revs[0].blueprint.id).toBe(bp.id)
    expect(revs[0].blueprint.version).toBe(bp.version)
    expect(revs[0].savedAt).toBe(bp.updatedAt)
    expect(revs[0].blueprint.members).toHaveLength(3)
  })

  it('round-trips through JSON serialization', () => {
    const bp = makeBp()
    const revs = appendRevision([], bp)
    const parsed = parseRevisions(serializeRevisions(revs))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].blueprint.id).toBe(bp.id)
    expect(parsed[0].blueprint.members).toHaveLength(3)
    expect(parsed[0].savedAt).toBe(bp.updatedAt)
  })

  it(`caps at MAX_REVISIONS (${MAX_REVISIONS})`, () => {
    let revs: ReturnType<typeof appendRevision> = []
    for (let i = 0; i < MAX_REVISIONS + 5; i++) {
      const bp = bumpBlueprint(makeBp(), { name: `Version ${i}` })
      revs = appendRevision(revs, bp)
    }
    expect(revs).toHaveLength(MAX_REVISIONS)
  })

  it('keeps revisions ordered newest-last', () => {
    let revs: ReturnType<typeof appendRevision> = []
    const v1 = makeBp()
    const v2 = bumpBlueprint(v1, { name: 'Updated' })
    revs = appendRevision(revs, v1)
    revs = appendRevision(revs, v2)
    expect(revs[0].blueprint.version).toBe(v1.version)
    expect(revs[1].blueprint.version).toBe(v2.version)
  })

  it('parseRevisions returns empty array for invalid input', () => {
    expect(parseRevisions('not json')).toHaveLength(0)
    expect(parseRevisions('[]')).toHaveLength(0)      // empty array
    expect(parseRevisions('[{}]')).toHaveLength(0)    // entry missing blueprint.id
    expect(parseRevisions('[{"blueprint":{},"savedAt":0}]')).toHaveLength(0) // missing blueprint.id
  })
})

// ── validateBundle ────────────────────────────────────────────────────────────

describe('validateBundle', () => {
  it('returns no errors for a valid bundle', () => {
    const bp = makeBp()
    const bundle: TeamExportBundle = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: bp,
      exportedAt: Date.now(),
    }
    expect(validateBundle(bundle)).toHaveLength(0)
  })

  it('rejects a bundle with a future schema version', () => {
    const errors = validateBundle({
      schemaVersion: TEAM_SCHEMA_VERSION + 1,
      blueprint: { id: 'x', name: 'X', members: [], version: 1, controllerAgentId: '' },
      exportedAt: Date.now(),
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/schema|upgrade/i)
  })

  it('reports a missing blueprint field', () => {
    const errors = validateBundle({ schemaVersion: TEAM_SCHEMA_VERSION, exportedAt: Date.now() })
    expect(errors.some(e => /blueprint/i.test(e))).toBe(true)
  })

  it('reports missing required blueprint sub-fields', () => {
    const errors = validateBundle({
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: { name: 'X', members: [], version: 1 }, // missing id
    })
    expect(errors.some(e => /id/i.test(e))).toBe(true)
  })

  it('returns errors for non-object input', () => {
    expect(validateBundle(null)).not.toHaveLength(0)
    expect(validateBundle('string')).not.toHaveLength(0)
    expect(validateBundle(42)).not.toHaveLength(0)
  })

  it('parseBundle returns null for a future schema version', () => {
    const futureBundle = JSON.stringify({
      schemaVersion: TEAM_SCHEMA_VERSION + 1,
      blueprint: { id: 'x', name: 'X', members: [], version: 1 },
      exportedAt: Date.now(),
    })
    expect(parseBundle(futureBundle)).toBeNull()
  })
})

// ── validateTeamForLaunch ─────────────────────────────────────────────────────

describe('validateTeamForLaunch', () => {
  it('returns valid for a fully-formed team', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails when no controller agent is selected', () => {
    const bp = makeBp({ controllerAgentId: '' })
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /controller/i.test(e))).toBe(true)
  })

  it('fails when team has no members', () => {
    const bp = makeBp({ members: [] })
    const result = validateTeamForLaunch(bp, undefined)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /member/i.test(e))).toBe(true)
  })

  it('fails when def is not provided (team not yet compiled)', () => {
    const bp = makeBp()
    const result = validateTeamForLaunch(bp, undefined)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /compiled|save/i.test(e))).toBe(true)
  })

  it('fails when graph has disconnected nodes', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    // Remove the first edge (start → agent-0) to create a disconnected graph
    const broken = { ...def, graph: { nodes: def.graph!.nodes, edges: def.graph!.edges.slice(1) } }
    const result = validateTeamForLaunch(bp, broken)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /incoming edge|outgoing edge/i.test(e))).toBe(true)
  })

  it('smoke-tests the runtime compile path (compileProcessToJob + buildLaunchPrompt)', () => {
    // validateTeamForLaunch internally calls compileProcessToJob and buildLaunchPrompt.
    // A valid=true result means those calls succeeded — the launch path is exercised.
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(true)
  })

  it('single-member team passes validation', () => {
    const bp = makeBp({ members: [{ agentId: 'solo', role: 'Solo', task: 'Do everything' }] })
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(true)
  })

  it('fails when a route references an unknown member', () => {
    const bp = makeBp({
      routes: [{ afterMemberId: 'nobody', branches: [{ condition: '', nextMemberId: BRANCH_END }] }],
    })
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /unknown member/i.test(e))).toBe(true)
  })

  it('fails when a branch references an unknown member', () => {
    const bp = makeBp({
      routes: [{ afterMemberId: 'researcher', branches: [{ condition: 'if X', nextMemberId: 'ghost' }] }],
    })
    const def = buildTeamProcessDef(bp, '/tmp/test-team.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /unknown member/i.test(e))).toBe(true)
  })
})

// ── Branching ─────────────────────────────────────────────────────────────────

// Fixture: researcher → (if relevant → analyst, otherwise → writer)
const BRANCH_ROUTES: TeamRoute[] = [
  {
    afterMemberId: 'researcher',
    branches: [
      { condition: 'if findings are substantial', nextMemberId: 'analyst' },
      { condition: 'otherwise',                   nextMemberId: 'writer'  },
    ],
  },
]

function makeBranchBp(overrides: Partial<TeamBlueprint> = {}): TeamBlueprint {
  return makeBp({ routes: BRANCH_ROUTES, ...overrides })
}

describe('branching — blueprint serialization', () => {
  it('round-trips routes through JSON', () => {
    const bp = makeBranchBp()
    const parsed = parseBlueprint(serializeBlueprint(bp))!
    expect(parsed.routes).toHaveLength(1)
    const route = parsed.routes![0]
    expect(route.afterMemberId).toBe('researcher')
    expect(route.branches).toHaveLength(2)
    expect(route.branches[0].nextMemberId).toBe('analyst')
    expect(route.branches[1].nextMemberId).toBe('writer')
  })

  it('round-trips through full export bundle', () => {
    const bp = makeBranchBp()
    const bundle: TeamExportBundle = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: bp,
      exportedAt: Date.now(),
    }
    const parsed = parseBundle(serializeBundle(bundle))!
    expect(parsed.blueprint.routes).toHaveLength(1)
    expect(parsed.blueprint.routes![0].branches[0].condition).toBe('if findings are substantial')
  })

  it('BRANCH_END sentinel round-trips', () => {
    const bp = makeBp({
      routes: [{ afterMemberId: 'analyst', branches: [{ condition: 'done', nextMemberId: BRANCH_END }] }],
    })
    const parsed = parseBlueprint(serializeBlueprint(bp))!
    expect(parsed.routes![0].branches[0].nextMemberId).toBe(BRANCH_END)
  })

  it('linear team with no routes still has no routes after round-trip', () => {
    const bp = makeBp()
    const parsed = parseBlueprint(serializeBlueprint(bp))!
    expect(parsed.routes).toBeUndefined()
  })
})

describe('branching — compiler', () => {
  it('uses linear path when no routes defined', () => {
    const linear = makeBp()
    const branching = makeBranchBp()
    // Both should produce the same node types when we clear routes
    const defLinear = buildTeamProcessDef(linear, '/tmp/test.md')
    const defNoBranch = buildTeamProcessDef({ ...branching, routes: [] }, '/tmp/test.md')
    // Clearing routes falls back to linear — same handoff structure
    expect(defNoBranch.graph!.nodes.filter(n => n.type === 'handoff').map(n => n.id))
      .toEqual(defLinear.graph!.nodes.filter(n => n.type === 'handoff').map(n => n.id))
  })

  it('places a decision node after the branching member', () => {
    const bp = makeBranchBp()
    const def = buildTeamProcessDef(bp, '/tmp/test.md')
    const nodeIds = def.graph!.nodes.map(n => n.id)
    expect(nodeIds).toContain('decision-0')   // after researcher (index 0)
    expect(nodeIds).toContain('agent-0')       // researcher
    expect(nodeIds).toContain('agent-1')       // analyst
    expect(nodeIds).toContain('agent-2')       // writer
  })

  it('decision node has two outgoing edges with conditions', () => {
    const bp = makeBranchBp()
    const def = buildTeamProcessDef(bp, '/tmp/test.md')
    const branchEdges = def.graph!.edges.filter(e => e.from === 'decision-0')
    expect(branchEdges).toHaveLength(2)
    const targets = branchEdges.map(e => e.to)
    expect(targets).toContain('agent-1')  // analyst
    expect(targets).toContain('agent-2')  // writer
    // Conditions are preserved on edges
    const condEdge = branchEdges.find(e => e.to === 'agent-1')!
    expect(condEdge.condition).toBe('if findings are substantial')
  })

  it('BRANCH_END routes to the end node', () => {
    const bp = makeBp({
      routes: [{ afterMemberId: 'researcher', branches: [
        { condition: 'if done', nextMemberId: BRANCH_END },
        { condition: 'otherwise', nextMemberId: 'analyst' },
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/test.md')
    const endEdges = def.graph!.edges.filter(e => e.to === 'end')
    expect(endEdges.some(e => e.from === 'decision-0')).toBe(true)
  })

  it('produces a fully connected graph for a branching team', () => {
    const bp = makeBranchBp()
    const def = buildTeamProcessDef(bp, '/tmp/test.md')
    const { nodes, edges } = def.graph!
    const nodeIds = new Set(nodes.map(n => n.id))
    const edgeToIds = new Set(edges.map(e => e.to))
    const edgeFromIds = new Set(edges.map(e => e.from))

    // All edge endpoints reference real nodes
    for (const e of edges) {
      expect(nodeIds.has(e.from), `Edge ${e.id} from unknown node ${e.from}`).toBe(true)
      expect(nodeIds.has(e.to), `Edge ${e.id} to unknown node ${e.to}`).toBe(true)
    }
    // Every non-start node has at least one incoming edge
    for (const n of nodes.filter(n => n.type !== 'start')) {
      expect(edgeToIds.has(n.id), `${n.id} has no incoming edge`).toBe(true)
    }
    // Every non-end node has at least one outgoing edge
    for (const n of nodes.filter(n => n.type !== 'end')) {
      expect(edgeFromIds.has(n.id), `${n.id} has no outgoing edge`).toBe(true)
    }
  })

  it('single-branch route compiles cleanly', () => {
    const bp = makeBp({
      members: [
        { agentId: 'a', role: 'A', task: 'do A' },
        { agentId: 'b', role: 'B', task: 'do B' },
      ],
      routes: [{ afterMemberId: 'a', branches: [{ condition: '', nextMemberId: 'b' }] }],
    })
    const def = buildTeamProcessDef(bp, '/tmp/test.md')
    const { nodes, edges } = def.graph!
    expect(nodes.some(n => n.id === 'decision-0')).toBe(true)
    expect(edges.some(e => e.from === 'decision-0' && e.to === 'agent-1')).toBe(true)
  })

  it('ProcessDef serialization round-trip preserves branching structure', () => {
    const bp = makeBranchBp()
    const def = buildTeamProcessDef(bp, '/tmp/test.md')
    const md = serializeProcess(def)
    const reparsed = parseProcessFile('/tmp/test.md', md)
    expect(reparsed).not.toBeNull()
    // Decision node survives the MD round-trip
    const nodes = reparsed!.graph!.nodes
    expect(nodes.some(n => n.id === 'decision-0')).toBe(true)
    // Branch edges with conditions survive
    const branchEdges = reparsed!.graph!.edges.filter(e => e.from === 'decision-0')
    expect(branchEdges).toHaveLength(2)
    expect(branchEdges.some(e => e.condition === 'if findings are substantial')).toBe(true)
  })

  it('validateTeamForLaunch passes for a valid branching team', () => {
    const bp = makeBranchBp()
    const def = buildTeamProcessDef(bp, '/tmp/test.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ── Branching — skip-style routing ───────────────────────────────────────────
// A "skip" route jumps from member A directly to member C, bypassing B entirely.
// B has no incoming edge in the compiled graph but the team is still valid because
// the branching validation checks reachability rather than raw edge counts.

describe('branching — skip-style routing', () => {
  function makeSkipBp() {
    return makeBp({
      members: [
        { agentId: 'a', role: 'A', task: 'do A' },
        { agentId: 'b', role: 'B', task: 'do B' },
        { agentId: 'c', role: 'C', task: 'do C' },
      ],
      routes: [{
        afterMemberId: 'a',
        branches: [{ condition: 'skip B', nextMemberId: 'c' }],
      }],
    })
  }

  it('skip edge (decision-0 → agent-2) is present with the correct condition', () => {
    const def = buildTeamProcessDef(makeSkipBp(), '/tmp/skip.md')
    const skipEdge = def.graph!.edges.find(e => e.from === 'decision-0' && e.to === 'agent-2')
    expect(skipEdge).toBeDefined()
    expect(skipEdge!.condition).toBe('skip B')
  })

  it('skipped member (B = agent-1) has no incoming edge', () => {
    const def = buildTeamProcessDef(makeSkipBp(), '/tmp/skip.md')
    const incomingToB = def.graph!.edges.filter(e => e.to === 'agent-1')
    expect(incomingToB).toHaveLength(0)
  })

  it('skip-style team passes validateTeamForLaunch', () => {
    const bp = makeSkipBp()
    const def = buildTeamProcessDef(bp, '/tmp/skip.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('skip directly to BRANCH_END (early exit) is valid', () => {
    const bp = makeBp({
      members: [
        { agentId: 'a', role: 'A', task: 'do A' },
        { agentId: 'b', role: 'B', task: 'do B' },
      ],
      routes: [{
        afterMemberId: 'a',
        branches: [{ condition: 'early exit', nextMemberId: BRANCH_END }],
      }],
    })
    const def = buildTeamProcessDef(bp, '/tmp/skip-end.md')
    // end is reachable from start via the skip branch
    const pathToEnd = def.graph!.edges.some(e => e.from === 'decision-0' && e.to === 'end')
    expect(pathToEnd).toBe(true)
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(true)
  })

  it('linear team with a broken edge still fails validation', () => {
    const bp = makeBp()   // linear, no routes
    const def = buildTeamProcessDef(bp, '/tmp/linear.md')
    // Remove start → agent-0 to create an unreachable chain
    const broken = { ...def, graph: { nodes: def.graph!.nodes, edges: def.graph!.edges.slice(1) } }
    const result = validateTeamForLaunch(bp, broken)
    expect(result.valid).toBe(false)
    // Either end is unreachable or a node is unreachable — the validator catches it
    expect(result.errors.some(e => /reachable|outgoing edge/i.test(e))).toBe(true)
  })
})

// ── blueprintFilename ─────────────────────────────────────────────────────────

describe('blueprintFilename', () => {
  it('produces the correct .team.json filename', () => {
    expect(blueprintFilename('my-team')).toBe('my-team.team.json')
    expect(blueprintFilename('researcher-pipeline')).toBe('researcher-pipeline.team.json')
  })
})

// ── parseBlueprint — forward-compat defaults ──────────────────────────────────

describe('parseBlueprint — forward-compat defaults', () => {
  it('fills in schemaVersion, members, createdAt, updatedAt, version, controllerAgentId when missing', () => {
    // A "bare minimum" blueprint JSON — only id and name required.
    const minimal = JSON.stringify({ id: 'x', name: 'X' })
    const bp = parseBlueprint(minimal)
    expect(bp).not.toBeNull()
    expect(bp!.schemaVersion).toBe(TEAM_SCHEMA_VERSION)
    expect(bp!.members).toEqual([])
    expect(bp!.version).toBe(1)
    expect(bp!.controllerAgentId).toBe('')
    expect(bp!.createdAt).toBeGreaterThan(0)
    expect(bp!.updatedAt).toBeGreaterThan(0)
  })

  it('does not overwrite present optional fields', () => {
    const bp = parseBlueprint(JSON.stringify({
      id: 'x', name: 'X',
      schemaVersion: 1, members: [], version: 7,
      controllerAgentId: 'ctrl', createdAt: 100, updatedAt: 200,
    }))
    expect(bp!.version).toBe(7)
    expect(bp!.controllerAgentId).toBe('ctrl')
  })
})

// ── parseRevisions — optional-chain edge case ─────────────────────────────────

describe('parseRevisions — edge cases', () => {
  it('filters out entries whose blueprint field is absent', () => {
    const result = parseRevisions('[{"savedAt":1}]')
    expect(result).toHaveLength(0)
  })

  it('filters out entries where savedAt is not a number', () => {
    const result = parseRevisions('[{"blueprint":{"id":"x"},"savedAt":"string"}]')
    expect(result).toHaveLength(0)
  })

  it('keeps entries that pass all filter checks', () => {
    const raw = JSON.stringify([{
      blueprint: { id: 'x', name: 'X', members: [], version: 1,
                   controllerAgentId: '', schemaVersion: 1, createdAt: 0, updatedAt: 0 },
      savedAt: 1234,
    }])
    const result = parseRevisions(raw)
    expect(result).toHaveLength(1)
    expect(result[0].blueprint.id).toBe('x')
  })
})

describe('validateBundle — empty string fields', () => {
  it('reports error for an empty-string id (triggers !bp.id branch)', () => {
    const errors = validateBundle({
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: { id: '', name: 'X', members: [], version: 1 },
      exportedAt: Date.now(),
    })
    expect(errors.some(e => /id/i.test(e))).toBe(true)
  })

  it('reports error for an empty-string name', () => {
    const errors = validateBundle({
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: { id: 'x', name: '', members: [], version: 1 },
      exportedAt: Date.now(),
    })
    expect(errors.some(e => /name/i.test(e))).toBe(true)
  })

  it('reports error when members is not an array', () => {
    const errors = validateBundle({
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: { id: 'x', name: 'X', members: 'not-array', version: 1 },
      exportedAt: Date.now(),
    })
    expect(errors.some(e => /members/i.test(e))).toBe(true)
  })

  it('reports error when version is not a number', () => {
    const errors = validateBundle({
      schemaVersion: TEAM_SCHEMA_VERSION,
      blueprint: { id: 'x', name: 'X', members: [], version: 'string' },
      exportedAt: Date.now(),
    })
    expect(errors.some(e => /version/i.test(e))).toBe(true)
  })
})

// ── Compiler — additional branch coverage ─────────────────────────────────────

describe('compiler — soul field and tags', () => {
  it('linear compiler preserves soul field on agent nodes', () => {
    const bp = makeBp({
      members: [
        { agentId: 'a', role: 'A', task: 'do A', soul: 'You are a specialist.' },
        { agentId: 'b', role: 'B', task: 'do B' },
      ],
    })
    const def = buildTeamProcessDef(bp, '/tmp/soul-test.md')
    const aNode = def.graph!.nodes.find(n => n.agentId === 'a')
    expect(aNode?.soul).toBe('You are a specialist.')
    const bNode = def.graph!.nodes.find(n => n.agentId === 'b')
    expect(bNode?.soul).toBeUndefined()
  })

  it('branching compiler preserves soul field on agent nodes', () => {
    const bp = makeBp({
      members: [
        { agentId: 'researcher', role: 'Researcher', task: 'research', soul: 'Expert researcher.' },
        { agentId: 'analyst',    role: 'Analyst',    task: 'analyse' },
        { agentId: 'writer',     role: 'Writer',     task: 'write' },
      ],
      routes: [{ afterMemberId: 'researcher', branches: [
        { condition: 'needs analysis', nextMemberId: 'analyst' },
        { condition: 'otherwise',      nextMemberId: 'writer'  },
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/soul-branch.md')
    const rNode = def.graph!.nodes.find(n => n.agentId === 'researcher')
    expect(rNode?.soul).toBe('Expert researcher.')
  })

  it('compiler uses fallback tags ["team"] when blueprint has no tags', () => {
    // makeBp() does not set tags → the compiler falls back to ['team']
    const bp = makeBp()
    expect(bp.tags).toBeUndefined()
    const def = buildTeamProcessDef(bp, '/tmp/tags-test.md')
    expect(def.tags).toEqual(['team'])
  })

  it('compiler uses explicit tags when blueprint provides them', () => {
    const bp = makeBp({ tags: ['research', 'finance'] })
    const def = buildTeamProcessDef(bp, '/tmp/tags-test.md')
    expect(def.tags).toEqual(['research', 'finance'])
  })

  it('buildBody omits Output Contract section when outputContract is absent', () => {
    const bp = makeBp({
      outputContract: undefined,
      routes: [{ afterMemberId: 'researcher', branches: [
        { condition: 'done', nextMemberId: BRANCH_END },
      ]}],
    })
    // With routes but no outputContract — exercises both the routes and no-outputContract paths
    const def = buildTeamProcessDef(bp, '/tmp/nobody.md')
    expect(def.body).not.toContain('Output Contract')
    expect(def.body).toContain('Conditional Routing')
  })

  it('buildBody includes BRANCH_END as "end" in the routing section', () => {
    const bp = makeBp({
      routes: [{ afterMemberId: 'researcher', branches: [
        { condition: 'done', nextMemberId: BRANCH_END },
        { condition: 'otherwise', nextMemberId: 'analyst' },
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/end-route.md')
    expect(def.body).toContain('done → end')
    expect(def.body).toContain('otherwise → analyst')
  })

  it('safety edge: last member with a route but no BRANCH_END gets an implicit end edge', () => {
    // b is last; its route points back to a (no BRANCH_END) — compiler adds decision-1 → end
    const bp = makeBp({
      members: [
        { agentId: 'a', role: 'A', task: 'do A' },
        { agentId: 'b', role: 'B', task: 'do B' },
      ],
      routes: [{ afterMemberId: 'b', branches: [
        { condition: 'retry', nextMemberId: 'a' },
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/safety.md')
    const safetyEdge = def.graph!.edges.find(e => e.from === 'decision-1' && e.to === 'end')
    expect(safetyEdge).toBeDefined()
  })

  it('extractMembersFromDef falls back to node.id when agentId is absent', () => {
    const bp = makeBp({ members: [{ agentId: 'solo', role: 'Solo', task: 'Do everything' }] })
    const def = buildTeamProcessDef(bp, '/tmp/solo.md')
    // Remove agentId from the agent node to exercise the `n.agentId ?? n.id` fallback
    const nodesCopy = def.graph!.nodes.map(n =>
      n.type === 'agent' ? { ...n, agentId: undefined } : n
    )
    const defWithoutAgentId = { ...def, graph: { ...def.graph!, nodes: nodesCopy } }
    const members = extractMembersFromDef(defWithoutAgentId)
    expect(members).toHaveLength(1)
    // Falls back to node.id ('agent-0') since agentId is undefined
    expect(members[0].agentId).toBe('agent-0')
  })

  it('branch edges with empty condition use undefined (not empty string) in the graph', () => {
    // The `branch.condition || undefined` expression: empty string → undefined → no condition prop
    const bp = makeBp({
      members: [
        { agentId: 'a', role: 'A', task: 'do A' },
        { agentId: 'b', role: 'B', task: 'do B' },
      ],
      routes: [{ afterMemberId: 'a', branches: [
        { condition: '',    nextMemberId: 'b' },      // empty → undefined on non-BRANCH_END edge
        { condition: 'done', nextMemberId: BRANCH_END }, // non-empty → preserved on BRANCH_END edge
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/cond-test.md')
    const emptyCondEdge = def.graph!.edges.find(e => e.from === 'decision-0' && e.to === 'agent-1')
    expect(emptyCondEdge?.condition).toBeUndefined()
    const doneEdge = def.graph!.edges.find(e => e.from === 'decision-0' && e.to === 'end')
    expect(doneEdge?.condition).toBe('done')
  })

  it('empty condition on BRANCH_END edge also uses undefined', () => {
    // Exercises `branch.condition || undefined` on the BRANCH_END → end path
    const bp = makeBp({
      members: [
        { agentId: 'a', role: 'A', task: 'do A' },
        { agentId: 'b', role: 'B', task: 'do B' },
      ],
      routes: [{ afterMemberId: 'a', branches: [
        { condition: '', nextMemberId: BRANCH_END },  // empty condition + BRANCH_END
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/empty-branch-end.md')
    const endEdge = def.graph!.edges.find(e => e.from === 'decision-0' && e.to === 'end')
    expect(endEdge).toBeDefined()
    expect(endEdge?.condition).toBeUndefined()
  })

  it('duplicate agentIds in branching team: second occurrence is skipped in index', () => {
    // Exercises the if@L124.b1 false branch (agentId already in memberIdxByAgentId)
    const bp = makeBp({
      members: [
        { agentId: 'dup', role: 'First',  task: 'do A' },
        { agentId: 'dup', role: 'Second', task: 'do B' }, // same agentId — hits the false branch
      ],
      routes: [{ afterMemberId: 'dup', branches: [{ condition: '', nextMemberId: BRANCH_END }] }],
    })
    const def = buildTeamProcessDef(bp, '/tmp/dup.md')
    expect(def).toBeDefined()
    expect(def.graph!.nodes.some(n => n.id === 'decision-0')).toBe(true)
  })

  it('branch target not found in member index: description uses fallback role, edge is omitted', () => {
    // Pass 1 (routingCondition description): `memberIdxByAgentId.get(id) ?? 0` uses index 0 as
    //   fallback role when the target agentId is unknown — exercises the ?? 0 branch.
    // Pass 2 (edge wiring): `if (targetIdx !== undefined)` skips adding the edge entirely.
    const bp = makeBp({
      members: [
        { agentId: 'a', role: 'A', task: 'do A' },
        { agentId: 'b', role: 'B', task: 'do B' },
      ],
      routes: [{ afterMemberId: 'a', branches: [
        { condition: 'fallback path', nextMemberId: 'nonexistent' },
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/fallback.md')
    expect(def).toBeDefined()
    // The routingCondition description uses the fallback role at index 0 ('A')
    const decNode = def.graph!.nodes.find(n => n.id === 'decision-0')
    expect(decNode?.routingCondition).toContain('A')
    // No edge is created for the unknown target (targetIdx === undefined → skipped)
    const unknownEdge = def.graph!.edges.find(e => e.from === 'decision-0')
    expect(unknownEdge).toBeUndefined()
  })

  it('branching compiler with empty members produces minimal graph', () => {
    // Exercises `members[0]?.agentId ?? ""` → the ?. short-circuits on undefined → fallback ''
    // Also exercises `buildBody` with routes but empty members list
    const bp: TeamBlueprint = {
      ...newBlueprint('empty-team', 'Empty'),
      controllerAgentId: 'ctrl',
      members: [],
      routes: [{ afterMemberId: 'ghost', branches: [{ condition: '', nextMemberId: BRANCH_END }] }],
    }
    const def = buildTeamProcessDef(bp, '/tmp/empty.md')
    expect(def.workflow.startAgent).toBe('')   // members[0]?.agentId ?? '' fallback
    expect(def.graph!.nodes.some(n => n.type === 'start')).toBe(true)
    expect(def.graph!.nodes.some(n => n.type === 'end')).toBe(true)
  })

  it('buildBody: empty branch condition renders as "otherwise"', () => {
    // Exercises `b.condition || 'otherwise'` false branch in buildBody
    const bp = makeBp({
      routes: [{ afterMemberId: 'researcher', branches: [
        { condition: '',        nextMemberId: 'analyst' },   // empty → 'otherwise'
        { condition: 'if yes',  nextMemberId: 'writer'  },   // non-empty → preserved
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/otherwise.md')
    expect(def.body).toContain('otherwise → analyst')
    expect(def.body).toContain('if yes → writer')
  })

  it('branchDesc uses member role in routingCondition for non-BRANCH_END branch', () => {
    // Exercises the non-BRANCH_END path in branchDesc:
    // `members[memberIdxByAgentId.get(b.nextMemberId) ?? 0]?.role ?? b.nextMemberId`
    // When the target member exists and has a role, the role string is used.
    const bp = makeBp({
      members: [
        { agentId: 'researcher', role: 'Researcher', task: 'research' },
        { agentId: 'analyst',    role: 'Analyst',    task: 'analyse'  },
        { agentId: 'writer',     role: 'Writer',     task: 'write'    },
      ],
      routes: [{ afterMemberId: 'researcher', branches: [
        { condition: 'complex case', nextMemberId: 'analyst' },
        { condition: 'otherwise',    nextMemberId: 'writer'  },
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/role-desc.md')
    const decNode = def.graph!.nodes.find(n => n.id === 'decision-0')
    expect(decNode?.routingCondition).toContain('Analyst')
    expect(decNode?.routingCondition).toContain('Writer')
  })

  it('decision routingCondition uses "end" label for BRANCH_END branch', () => {
    const bp = makeBp({
      members: [
        { agentId: 'researcher', role: 'Researcher', task: 'research' },
        { agentId: 'analyst',    role: 'Analyst',    task: 'analyse'  },
        { agentId: 'writer',     role: 'Writer',     task: 'write'    },
      ],
      routes: [{ afterMemberId: 'researcher', branches: [
        { condition: 'if concise enough', nextMemberId: BRANCH_END },
        { condition: 'otherwise',          nextMemberId: 'analyst' },
      ]}],
    })
    const def = buildTeamProcessDef(bp, '/tmp/dec-end.md')
    const decNode = def.graph!.nodes.find(n => n.id === 'decision-0')
    expect(decNode?.routingCondition).toContain('end')
    expect(decNode?.routingCondition).toContain('Analyst')
  })
})

// ── validateTeamForLaunch — additional branch coverage ───────────────────────

describe('validateTeamForLaunch — additional error cases', () => {
  it('fails when some members have no agent selected', () => {
    const bp = makeBp({ members: [{ agentId: '', role: 'R', task: 'T' }] })
    const result = validateTeamForLaunch(bp, undefined)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /agent selected/i.test(e))).toBe(true)
  })

  it('fails when a route has an empty branches array', () => {
    const bp = makeBp({
      routes: [{ afterMemberId: 'researcher', branches: [] }],
    })
    const def = buildTeamProcessDef(bp, '/tmp/empty-branches.md')
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /no branches/i.test(e))).toBe(true)
  })

  it('fails when def has no graph', () => {
    const bp = makeBp()
    const def = { ...buildTeamProcessDef(bp, '/tmp/t.md'), graph: undefined }
    const result = validateTeamForLaunch(bp, def)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /missing a graph/i.test(e))).toBe(true)
  })

  it('fails when graph has no start node', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/t.md')
    const noStart = {
      ...def,
      graph: { nodes: def.graph!.nodes.filter(n => n.type !== 'start'), edges: def.graph!.edges },
    }
    const result = validateTeamForLaunch(bp, noStart)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /missing a start node/i.test(e))).toBe(true)
  })

  it('fails when graph has no end node', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/t.md')
    const noEnd = {
      ...def,
      graph: { nodes: def.graph!.nodes.filter(n => n.type !== 'end'), edges: def.graph!.edges },
    }
    const result = validateTeamForLaunch(bp, noEnd)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /missing.*end node|end.*not reachable/i.test(e))).toBe(true)
  })

  it('fails when graph has no agent nodes', () => {
    const bp = makeBp()
    const def = buildTeamProcessDef(bp, '/tmp/t.md')
    const noAgents = {
      ...def,
      graph: { nodes: def.graph!.nodes.filter(n => n.type !== 'agent'), edges: def.graph!.edges },
    }
    const result = validateTeamForLaunch(bp, noAgents)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => /no agent nodes/i.test(e))).toBe(true)
  })
})

// ── Run requests (agent → app "run this team with this task") ─────────────────

describe('parseRunRequest', () => {
  it('round-trips a valid request', () => {
    const req: TeamRunRequest = { task: 'Do the thing', autorun: true, nonce: 'n1', requestedAt: 123 }
    expect(parseRunRequest(serializeRunRequest(req))).toEqual(req)
  })

  it('returns null for blank / empty / nullish input', () => {
    expect(parseRunRequest('')).toBeNull()
    expect(parseRunRequest('   ')).toBeNull()
    expect(parseRunRequest(null)).toBeNull()
    expect(parseRunRequest(undefined)).toBeNull()
  })

  it('returns null when task or nonce is missing', () => {
    expect(parseRunRequest(JSON.stringify({ nonce: 'n', requestedAt: 1 }))).toBeNull()
    expect(parseRunRequest(JSON.stringify({ task: 'x', requestedAt: 1 }))).toBeNull()
    expect(parseRunRequest(JSON.stringify({ task: '   ', nonce: 'n' }))).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseRunRequest('{not json')).toBeNull()
  })

  it('trims the task, defaults autorun to false, and tolerates a missing requestedAt', () => {
    const req = parseRunRequest(JSON.stringify({ task: '  go  ', nonce: 'n2' }))
    expect(req).toEqual({ task: 'go', autorun: false, nonce: 'n2', requestedAt: 0 })
  })

  it('coerces a non-boolean autorun to false', () => {
    expect(parseRunRequest(JSON.stringify({ task: 't', nonce: 'n', autorun: 'yes' }))?.autorun).toBe(false)
  })

  it('builds the request path next to the team', () => {
    expect(runRequestPath('my-team', '/teams')).toBe('/teams/my-team.runrequest.json')
  })
})

// ── Run objective (reusable team + per-run task) ──────────────────────────────

describe('buildLaunchPrompt — run objective', () => {
  const buildDef = (overrides: Partial<TeamBlueprint> = {}) =>
    buildTeamProcessDef(makeBp(overrides), compiledMdPath('test-team', '/teams'))

  it('omits the task section and leaves placeholders untouched when no objective is given', () => {
    const def = buildDef()
    const job = compileProcessToJob(def)
    const prompt = buildLaunchPrompt(def, job)
    expect(prompt).not.toMatch(/THE TASK FOR THIS RUN/)
  })

  it('injects the objective as the run headline', () => {
    const def = buildDef()
    const job = compileProcessToJob(def)
    const prompt = buildLaunchPrompt(def, job, 'Analyse the Q3 churn numbers')
    expect(prompt).toMatch(/THE TASK FOR THIS RUN/)
    expect(prompt).toContain('Analyse the Q3 churn numbers')
  })

  it('substitutes {objective} in member tasks and the output contract', () => {
    const def = buildDef({
      members: [{ agentId: 'researcher', role: 'Researcher', task: 'Research {objective} thoroughly' }],
      outputContract: 'A report on {objective}.',
    })
    const job = compileProcessToJob(def)
    const prompt = buildLaunchPrompt(def, job, 'electric vehicles')
    expect(prompt).toContain('Research electric vehicles thoroughly')
    expect(prompt).toContain('A report on electric vehicles.')
    expect(prompt).not.toContain('{objective}')
  })

  it('trims the objective and treats whitespace-only as absent', () => {
    const def = buildDef()
    const job = compileProcessToJob(def)
    expect(buildLaunchPrompt(def, job, '   ')).not.toMatch(/THE TASK FOR THIS RUN/)
    expect(buildLaunchPrompt(def, job, '  go  ')).toMatch(/THE TASK FOR THIS RUN[\s\S]*\ngo\n/)
  })
})
