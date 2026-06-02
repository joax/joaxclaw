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

  return `You are the Team Lead for the following process. Execute it step by step.

PROCESS: ${job.processName} (${job.processId})

TEAM BLUEPRINT:
${JSON.stringify(job, null, 2)}

EXECUTION RULES:
1. For each **Agent** node: spawn a sub-agent using sessions_spawn with the node's task as the prompt, then sessions_yield to wait for the result.
2. For each **Handoff** node: evaluate the previous output against the routingCondition. Fill the handoffBrief template (replacing {previous_agent_output} with the actual output) and use it as context when spawning the next agent.
3. For each **Review** node: send the current output to the notificationTarget channel and pause using sessions_yield. Continue when human approval arrives.
4. End when you reach the END node. Summarise all outputs.

Start with node: ${firstNode?.id ?? 'first agent node'}
Begin now.`
}
