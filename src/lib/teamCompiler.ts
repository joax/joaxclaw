// Compile a TeamBlueprint into a ProcessDef that the existing process runtime
// can execute directly.  The compiled graph is always derived from the blueprint;
// the .md file is an execution artifact, not a source of truth.
//
// Linear blueprint (no routes):
//   start → agent[0] → handoff[0→1] → agent[1] → … → agent[N] → end
//   A reviewBefore flag inserts a Review gate before that agent (index > 0).
//
// Branching blueprint (routes present):
//   After the specified member a decision node (handoff type, multi-edge) routes
//   to the branch targets.  The existing handoff node + conditional edge model
//   handles this without any new node types.

import type { ProcessDef, ProcessGraph, GraphNode, GraphEdge, ProcessAgent } from './processParser'
import type { TeamBlueprint, TeamRoute, TeamMemberDef } from './teamBlueprint'
import { BRANCH_END } from './teamBlueprint'

// Re-export TeamMemberDef from teamBlueprint so existing imports of
// "TeamMemberDef from teamCompiler" still resolve.
export type { TeamMemberDef } from './teamBlueprint'

const STEP_X = 220

// Resolve a route/branch target to a UNIQUE member index. A `role` is preferred (it
// uniquely identifies a step even when the same agentId is reused for several members);
// `agentId` is the backward-compatible fallback (correct when agentIds are unique).
// Returns -1 when nothing matches.
function resolveMemberIndex(members: readonly TeamMemberDef[], target: { role?: string; agentId?: string }): number {
  if (target.role) {
    const i = members.findIndex(m => m.role === target.role)
    if (i !== -1) return i
  }
  if (target.agentId) {
    const i = members.findIndex(m => m.agentId === target.agentId)
    if (i !== -1) return i
  }
  return -1
}

// ── Public entry point ────────────────────────────────────────────────────────

export function buildTeamProcessDef(bp: TeamBlueprint, compiledPath: string): ProcessDef {
  if (!bp.routes || bp.routes.length === 0) {
    return buildLinearTeamDef(bp, compiledPath)
  }
  return buildBranchingTeamDef(bp, compiledPath)
}

// ── Linear compiler (original logic, unchanged) ───────────────────────────────

function buildLinearTeamDef(bp: TeamBlueprint, compiledPath: string): ProcessDef {
  const { id, name, description, controllerAgentId, members, outputContract, workspace } = bp

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  let x = 60
  let eIdx = 0
  const addEdge = (from: string, to: string) =>
    edges.push({ id: `e${++eIdx}`, from, to })

  nodes.push({ id: 'start', type: 'start', position: { x, y: 200 } })
  let prev = 'start'
  x += STEP_X

  for (let i = 0; i < members.length; i++) {
    const m = members[i]

    if (m.reviewBefore && i > 0) {
      const rid = `review-${i}`
      nodes.push({
        id: rid, type: 'review', position: { x, y: 200 },
        reviewPrompt: `Please review the output before ${m.role} begins.`,
        notificationTarget: 'default',
      })
      addEdge(prev, rid)
      prev = rid
      x += STEP_X
    }

    const aid = `agent-${i}`
    nodes.push({
      id: aid, type: 'agent', position: { x, y: 200 },
      agentId: m.agentId, task: m.task,
      ...(m.soul ? { soul: m.soul } : {}),
    })
    addEdge(prev, aid)
    prev = aid
    x += STEP_X

    if (i < members.length - 1) {
      const next = members[i + 1]
      const hid = `handoff-${i}`
      nodes.push({
        id: hid, type: 'handoff', position: { x, y: 200 },
        routingCondition: `When ${m.role} has completed their task`,
        handoffBrief: `{previous_agent_output}\n\nTask for ${next.role}: ${next.task}`,
      })
      addEdge(prev, hid)
      prev = hid
      x += STEP_X
    }
  }

  nodes.push({ id: 'end', type: 'end', position: { x, y: 200 } })
  addEdge(prev, 'end')

  const graph: ProcessGraph = { nodes, edges }
  const agents: ProcessAgent[] = members.map(m => ({ id: m.agentId, role: m.role }))

  return {
    id, name, description,
    type: 'team',
    outputContract,
    ...(workspace ? { workspace } : {}),
    version: bp.version,
    tags: bp.tags ?? ['team'],
    agents,
    workflow: { startAgent: members[0]?.agentId ?? '', transitions: [] },
    graph,
    maxTurns: 30,
    timeout: 600,
    controllerAgentId,
    path: compiledPath,
    body: buildBody(name, members, outputContract),
    raw: '',
  }
}

// ── Branching compiler ────────────────────────────────────────────────────────

function buildBranchingTeamDef(bp: TeamBlueprint, compiledPath: string): ProcessDef {
  const { id, name, description, controllerAgentId, members, outputContract, workspace } = bp
  const routes = bp.routes!

  // Attach each route to the UNIQUE member index its `afterRole`/`afterMemberId` resolves
  // to — not to every member sharing an agentId. This is what makes routing correct when
  // the same agentId is reused across members.
  const routeByMemberIdx = new Map<number, TeamRoute>()
  for (const r of routes) {
    const idx = resolveMemberIndex(members, { role: r.afterRole, agentId: r.afterMemberId })
    if (idx !== -1 && !routeByMemberIdx.has(idx)) routeByMemberIdx.set(idx, r)
  }
  // Resolve a branch's target member by role (preferred) or agentId.
  const branchTargetIdx = (b: { nextRole?: string; nextMemberId: string }): number =>
    resolveMemberIndex(members, { role: b.nextRole, agentId: b.nextMemberId })

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  let x = 60
  let eIdx = 0
  const addEdge = (from: string, to: string, condition?: string) =>
    edges.push({ id: `e${++eIdx}`, from, to, ...(condition ? { condition } : {}) })

  // ── Pass 1: place all nodes ───────────────────────────────────────────────

  nodes.push({ id: 'start', type: 'start', position: { x, y: 200 } })
  x += STEP_X

  for (let i = 0; i < members.length; i++) {
    const m = members[i]
    const route = routeByMemberIdx.get(i)

    if (m.reviewBefore && i > 0) {
      nodes.push({
        id: `review-${i}`, type: 'review', position: { x, y: 200 },
        reviewPrompt: `Please review the output before ${m.role} begins.`,
        notificationTarget: 'default',
      })
      x += STEP_X
    }

    nodes.push({
      id: `agent-${i}`, type: 'agent', position: { x, y: 200 },
      agentId: m.agentId, task: m.task,
      ...(m.soul ? { soul: m.soul } : {}),
    })
    x += STEP_X

    if (route) {
      // Decision node — describe branches in routingCondition for the controller prompt
      const branchDesc = route.branches
        .map(b => {
          const cond = b.condition || 'otherwise'
          const idx = branchTargetIdx(b)
          const target = b.nextMemberId === BRANCH_END
            ? 'end'
            : (members[idx]?.role ?? b.nextRole ?? b.nextMemberId)
          return `${cond} → ${target}`
        })
        .join('; ')
      nodes.push({
        id: `decision-${i}`, type: 'handoff', position: { x, y: 200 },
        routingCondition: branchDesc,
        handoffBrief: '{previous_agent_output}',
      })
      x += STEP_X
    } else if (i < members.length - 1) {
      const next = members[i + 1]
      nodes.push({
        id: `handoff-${i}`, type: 'handoff', position: { x, y: 200 },
        routingCondition: `When ${m.role} has completed their task`,
        handoffBrief: `{previous_agent_output}\n\nTask for ${next.role}: ${next.task}`,
      })
      x += STEP_X
    }
  }

  nodes.push({ id: 'end', type: 'end', position: { x, y: 200 } })

  // ── Pass 2: wire edges ────────────────────────────────────────────────────
  //
  // prev = '' is a sentinel meaning "this member's incoming edge comes from a branch
  // decision, not from sequential flow — don't add a redundant sequential edge".

  let prev = 'start'

  for (let i = 0; i < members.length; i++) {
    const m = members[i]
    const route = routeByMemberIdx.get(i)

    if (m.reviewBefore && i > 0 && prev !== '') {
      addEdge(prev, `review-${i}`)
      prev = `review-${i}`
    }

    if (prev !== '') addEdge(prev, `agent-${i}`)
    prev = `agent-${i}`

    if (route) {
      addEdge(prev, `decision-${i}`)

      for (const branch of route.branches) {
        if (branch.nextMemberId === BRANCH_END) {
          addEdge(`decision-${i}`, 'end', branch.condition || undefined)
        } else {
          const targetIdx = branchTargetIdx(branch)
          if (targetIdx !== -1) {
            addEdge(`decision-${i}`, `agent-${targetIdx}`, branch.condition || undefined)
          }
        }
      }

      // Safety: if last member has a route but no BRANCH_END branch, add implicit end edge
      if (i === members.length - 1 && !route.branches.some(b => b.nextMemberId === BRANCH_END)) {
        addEdge(`decision-${i}`, 'end')
      }

      // Signal to next iteration: don't add a sequential incoming edge for the next member.
      // (The next member will receive its incoming edge from one of the branch edges above.)
      prev = ''
    } else if (i < members.length - 1) {
      addEdge(prev, `handoff-${i}`)
      prev = `handoff-${i}`
    }
    // else: last member with no route — handled after the loop
  }

  if (prev !== '') addEdge(prev, 'end')

  const graph: ProcessGraph = { nodes, edges }
  const agents: ProcessAgent[] = members.map(m => ({ id: m.agentId, role: m.role }))

  return {
    id, name, description,
    type: 'team',
    outputContract,
    ...(workspace ? { workspace } : {}),
    version: bp.version,
    tags: bp.tags ?? ['team'],
    agents,
    workflow: { startAgent: members[0]?.agentId ?? '', transitions: [] },
    graph,
    maxTurns: 30,
    timeout: 600,
    controllerAgentId,
    path: compiledPath,
    body: buildBody(name, members, outputContract, routes),
    raw: '',
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildBody(
  name: string,
  members: TeamBlueprint['members'],
  outputContract?: string,
  routes?: TeamRoute[]
): string {
  const lines = [`# ${name}`, '', '## Team Members', '']
  for (const m of members) lines.push(`- **${m.role}** (\`${m.agentId}\`) — ${m.task}`)
  if (routes && routes.length > 0) {
    lines.push('', '## Conditional Routing', '')
    for (const r of routes) {
      lines.push(`**After ${r.afterRole || r.afterMemberId}:**`)
      for (const b of r.branches) {
        const cond = b.condition || 'otherwise'
        const target = b.nextMemberId === BRANCH_END ? 'end' : (b.nextRole || b.nextMemberId)
        lines.push(`  - ${cond} → ${target}`)
      }
    }
  }
  if (outputContract) lines.push('', '## Output Contract', '', outputContract)
  return lines.join('\n')
}

// ── Legacy migration helper ───────────────────────────────────────────────────

// Reconstruct a TeamMemberDef list from a compiled ProcessDef.
// Used for migrating legacy .md-only teams into the new blueprint format.
// Members are ordered by graph x-position (left to right).
import type { TeamMemberDef } from './teamBlueprint'

export function extractMembersFromDef(def: ProcessDef): TeamMemberDef[] {
  const agentNodes = (def.graph?.nodes ?? [])
    .filter(n => n.type === 'agent')
    .sort((a, b) => a.position.x - b.position.x)

  return agentNodes.map((n, i) => {
    const agentId = n.agentId ?? n.id
    const processAgent = def.agents.find(a => a.id === agentId)
    const prevEdge = def.graph?.edges.find(e => e.to === n.id)
    const prevNode = prevEdge ? def.graph?.nodes.find(nd => nd.id === prevEdge.from) : undefined
    return {
      agentId,
      role: processAgent?.role ?? agentId,
      task: n.task ?? '',
      soul: n.soul,
      reviewBefore: i > 0 && prevNode?.type === 'review',
    }
  })
}
