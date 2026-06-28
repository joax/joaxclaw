// Runtime validation for team launch.
// Pure function — no side effects, safe to call in tests and UI.
//
// Checks every pre-condition the current process runtime requires before
// sessions.create + chat.send can succeed. Mirrors the actual runtime path in
// processesStore.startRun so any mismatch here surffaces before the user hits Run.

import type { ProcessDef } from './processParser'
import { compileProcessToJob, buildLaunchPrompt } from './processCompiler'
import type { TeamBlueprint } from './teamBlueprint'
import { BRANCH_END } from './teamBlueprint'

export interface TeamLaunchValidation {
  valid: boolean
  errors: string[]
}

export function validateTeamForLaunch(
  bp: TeamBlueprint,
  def: ProcessDef | undefined
): TeamLaunchValidation {
  const errors: string[] = []

  if (!bp.controllerAgentId) errors.push('No controller agent selected')
  if (bp.members.length === 0) errors.push('Team has no members')
  if (bp.members.some(m => !m.agentId)) errors.push('Some members have no agent selected')

  // Validate routes reference real members. A route/branch may target a member by its
  // (unique) role — preferred when an agentId is reused — or by agentId (legacy).
  if (bp.routes && bp.routes.length > 0) {
    const agentIds = new Set(bp.members.map(m => m.agentId))
    const roles = new Set(bp.members.map(m => m.role))
    const resolves = (role: string | undefined, agentId: string) =>
      (role ? roles.has(role) : false) || agentIds.has(agentId)
    for (const route of bp.routes) {
      const afterLabel = route.afterRole || route.afterMemberId
      if (!resolves(route.afterRole, route.afterMemberId))
        errors.push(`Route references unknown member: "${afterLabel}"`)
      if (route.branches.length === 0)
        errors.push(`Route after "${afterLabel}" has no branches`)
      for (const branch of route.branches) {
        if (branch.nextMemberId !== BRANCH_END && !resolves(branch.nextRole, branch.nextMemberId))
          errors.push(`Branch references unknown member: "${branch.nextRole || branch.nextMemberId}"`)
      }
    }
  }

  if (!def) {
    errors.push('Team has not been compiled yet — save the team first')
    return { valid: false, errors }
  }

  if (!def.graph) {
    errors.push('Compiled process is missing a graph')
    return { valid: false, errors }
  }

  const { nodes, edges } = def.graph
  if (!nodes.some(n => n.type === 'start')) errors.push('Graph is missing a start node')
  if (!nodes.some(n => n.type === 'end')) errors.push('Graph is missing an end node')
  if (!nodes.some(n => n.type === 'agent')) errors.push('Graph has no agent nodes')

  // Reachability-based connectivity check (forward BFS from start).
  //
  // Linear teams: every node must be reachable from start — there are no
  //   intentional gaps in the chain.
  // Branching teams: only 'end' must be reachable.  Skip-style routes can
  //   legitimately leave some members unreachable on certain execution paths
  //   (e.g. A → decision → C skips B entirely).  Requiring full reachability
  //   would reject valid blueprints, so we only enforce that a path to 'end'
  //   exists and that every *reachable* node has somewhere to go.
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from)!.push(e.to)
  }
  const reachable = new Set<string>()
  const bfsQueue = ['start']
  while (bfsQueue.length > 0) {
    const cur = bfsQueue.shift()!
    if (reachable.has(cur)) continue
    reachable.add(cur)
    for (const next of adj.get(cur) ?? []) bfsQueue.push(next)
  }

  if (!reachable.has('end'))
    errors.push('End node is not reachable from start — check for broken connections')

  const isBranching = !!(bp.routes && bp.routes.length > 0)
  if (!isBranching) {
    const unreachableNodes = nodes.filter(n => !reachable.has(n.id))
    if (unreachableNodes.length > 0)
      errors.push(`Nodes not reachable from start: ${unreachableNodes.map(n => n.id).join(', ')}`)
  }

  const edgeFromIds = new Set(edges.map(e => e.from))
  const reachableDeadEnds = nodes.filter(
    n => n.type !== 'end' && reachable.has(n.id) && !edgeFromIds.has(n.id)
  )
  if (reachableDeadEnds.length > 0)
    errors.push(`Nodes with no outgoing edge: ${reachableDeadEnds.map(n => n.id).join(', ')}`)

  // Smoke-test the full runtime compile path (compileProcessToJob + buildLaunchPrompt).
  // This mirrors exactly what processesStore.startRun does before calling chat.send.
  if (errors.length === 0) {
    try {
      const job = compileProcessToJob(def)
      const prompt = buildLaunchPrompt(def, job)
      if (!prompt) errors.push('Launch prompt generation produced an empty result')
    } catch (e) {
      errors.push(`Runtime compilation failed: ${String(e)}`)
    }
  }

  return { valid: errors.length === 0, errors }
}
