import type { ProcessDef, GraphNode, GraphEdge } from './processParser'

export interface ControllerJob {
  processId: string
  processName: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function compileProcessToJob(def: ProcessDef): ControllerJob {
  return {
    processId: def.id,
    processName: def.name,
    nodes: def.graph?.nodes ?? [],
    edges: def.graph?.edges ?? [],
  }
}

export function buildLaunchPrompt(def: ProcessDef, job: ControllerJob): string {
  const startNode = job.nodes.find(n => n.type === 'start')
  const firstEdge = job.edges.find(e => e.from === startNode?.id)
  const firstNode = job.nodes.find(n => n.id === firstEdge?.to)

  return `You are the Team Lead for the following process. Your role is pure orchestration — you coordinate the team, you do not do the work yourself.

PROCESS: ${job.processName} (${job.processId})

TEAM BLUEPRINT:
${JSON.stringify(job, null, 2)}

STRICT RULES — you must follow these exactly:
1. **Never generate a sub-agent's output yourself.** Every Agent node MUST be executed by spawning a real child session via sessions_spawn. If you write the output directly instead of spawning, you are violating this rule.
2. For each **Agent** node: call sessions_spawn with the node's agentId and task, then call sessions_yield to wait for its result before continuing.
3. For each **Handoff** node: read the previous agent's output, evaluate the routingCondition, fill the handoffBrief template (substitute {previous_agent_output} with the actual output), then spawn the next agent using the filled brief as the task.
4. For each **Review** node: send the current output to the notificationTarget channel using the message tool, then call sessions_yield to pause until a human responds.
5. Follow the edges exactly — do not skip nodes or reorder them.
6. When all nodes are done, produce a brief summary of outputs and stop.

Start with node: ${firstNode?.id ?? 'first agent node'}
Begin now.`
}
