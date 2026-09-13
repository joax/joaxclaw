// Building a team's launch prompt on the gateway host.
//
// A team run is two calls: create a session for the controller agent, then send it one
// prompt. That prompt is the whole orchestration — it embeds the compiled team and tells
// the controller to run the members with sessions_spawn / sessions_yield. Everything
// after that happens on the gateway, which is why closing JoaxClaw never stopped a run.
//
// Until now only the app could BUILD that prompt, so only the app could start a team.
// `teams.run` wrote a request file and waited for the app to notice, which meant an agent
// on Slack could ask for a team run, get `ok`, and have nothing happen.
//
// This module is the compiler, ported from src/lib/processCompiler.ts. It is deliberately
// dependency-free so a test can import BOTH it and the TypeScript original and assert
// they produce byte-identical prompts — the two drifting silently would mean a headless
// run behaving differently from the same team run out of the app, which is exactly the
// kind of difference nobody would think to look for.

/** Compile a process definition into the controller job embedded in the prompt. */
export function compileProcessToJob(def) {
  // Key order matters: the job is JSON.stringify'd into the prompt, so a different
  // insertion order produces a different prompt for the same team.
  const job = {
    processId: def.id,
    processName: def.name,
    nodes: def.graph?.nodes ?? [],
    edges: def.graph?.edges ?? [],
  }
  if (def.workspace) job.workspace = def.workspace
  return job
}

/**
 * The Team Lead launch prompt.
 *
 * `objective` is the task for THIS run — it becomes the headline goal and is substituted
 * for any `{objective}` placeholder in a member task, a handoff brief or the output
 * contract. Omitted, the blueprint's baked-in tasks run as written.
 */
export function buildLaunchPrompt(def, job, objective) {
  const obj = objective?.trim()
  const fill = (s) => (obj ? s.replace(/\{objective\}/g, obj) : s)

  const startNode = job.nodes.find((n) => n.type === 'start')
  const firstEdge = job.edges.find((e) => e.from === startNode?.id)
  const firstNode = job.nodes.find((n) => n.id === firstEdge?.to)

  const ws = job.workspace?.trim() || def.workspace?.trim()

  const spawnRule = ws
    ? `2. For each **Agent** node: call sessions_spawn with the node's agentId, the task, AND **cwd: "${ws}"** (so the member edits the shared workspace). Then call sessions_yield to wait for its result. NEVER omit cwd — without it the member edits an isolated sandbox and its work is lost.`
    : `2. For each **Agent** node: call sessions_spawn with the node's agentId and task, then call sessions_yield to wait for its result before continuing.`

  const handoffRule = ws
    ? `3. For each **Handoff** node: members SHARE THE FILESYSTEM at ${ws}, so the previous member's file changes are already on disk — they are the source of truth, not the text output. Evaluate the routingCondition, then spawn the next agent (with cwd: "${ws}") telling it to continue from the current repo state; pass {previous_agent_output} only as a short summary of what changed, not as file contents.`
    : `3. For each **Handoff** node: read the previous agent's output, evaluate the routingCondition, fill the handoffBrief template (substitute {previous_agent_output} with the actual output), then spawn the next agent using the filled brief as the task.`

  const workspaceSection = ws
    ? `\nSHARED WORKSPACE: ${ws}
Every member operates on this directory (a shared repository). They read and edit the SAME files, so each member builds on the previous member's changes directly on disk. After a member completes, if ${ws} is a git repository, stage and commit its work (e.g. \`git -C "${ws}" add -A && git -C "${ws}" commit -m "team ${job.processName} · step <n>: <role>"\`) so each step is checkpointed and recoverable; if it is not a git repo, skip committing. Verify changes landed (e.g. \`git -C "${ws}" status\` or list files) before handing off.\n`
    : ''

  return `You are the Team Lead for the following process. Your role is pure orchestration — you coordinate the team, you do not do the work yourself.

PROCESS: ${job.processName} (${job.processId})
${obj ? `\nTHE TASK FOR THIS RUN — this is what the user wants the team to accomplish:\n${obj}\n\nApply the team blueprint below to accomplish THIS task. Each member's \`task\` describes how that role contributes; treat it as instructions to be applied to the task above, not as the goal itself.\n` : ''}${workspaceSection}
TEAM BLUEPRINT:
${fill(JSON.stringify(job, null, 2))}

STRICT RULES — you must follow these exactly:
1. **Never generate a sub-agent's output yourself.** Every Agent node MUST be executed by spawning a real child session via sessions_spawn. If you write the output directly instead of spawning, you are violating this rule.
${spawnRule}
${handoffRule}
4. For each **Review** node: send the current output to the notificationTarget channel using the message tool, then call sessions_yield to pause until a human responds.
5. Follow the edges exactly — do not skip nodes or reorder them.
6. When all nodes are done, produce a brief summary of outputs and stop.
${def.outputContract ? `\nOUTPUT CONTRACT — the final output MUST satisfy:\n${fill(def.outputContract)}\n` : ''}
Start with node: ${firstNode?.id ?? 'first agent node'}
Begin now.`
}

/**
 * The parts of a compiled `<id>.md` the prompt needs.
 *
 * Only the fields buildLaunchPrompt reads are pulled out — this is not a general YAML
 * parser and must not become one. The graph comes from the `graph-data` JSON comment the
 * app writes; a file without one cannot be launched, because the graph IS the team.
 */
export function parseCompiledProcess(text, fallbackId) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!fm) return null

  const scalar = (key) => {
    // Matches `key: value`, with optional single or double quotes around the value.
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(fm[1])
    if (!m) return undefined
    const raw = m[1].trim()
    if (!raw) return undefined
    const unquoted = /^"([\s\S]*)"$/.exec(raw) ?? /^'([\s\S]*)'$/.exec(raw)
    return (unquoted ? unquoted[1] : raw).trim() || undefined
  }

  const graphComment = /<!--\s*graph-data\s*\n([\s\S]*?)\n-->/.exec(text)
  if (!graphComment) return null
  let graph
  try {
    graph = JSON.parse(graphComment[1])
  } catch {
    return null
  }
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges)) return null

  const id = scalar('id') ?? fallbackId
  if (!id) return null

  const def = { id, name: scalar('name') ?? id, graph }
  const workspace = scalar('workspace')
  if (workspace) def.workspace = workspace
  const outputContract = scalar('outputContract')
  if (outputContract) def.outputContract = outputContract
  const controller = scalar('controller')
  if (controller) def.controllerAgentId = controller
  return def
}

/**
 * The run record written when a launch prompt is handed out.
 *
 * It records an ATTEMPT, not a run. A caller can fetch a prompt and never spawn the team
 * lead, so the status is 'idle' and no step is claimed done — the app's sequence view
 * reads those fields literally and would otherwise light up work that never happened.
 * When JoaxClaw next connects it adopts the real session and overwrites this.
 *
 * The shape is ProcessRun (src/store/processes.ts) — the app parses this file straight
 * into one, so a field that does not belong there has no way to be read.
 */
export function buildLaunchRunRecord(processId, objective, now = Date.now()) {
  return {
    processId,
    startedAt: now,
    status: 'idle',
    stepsDone: 0,
    outputBuffer: '',
    ...(objective ? { objective } : {}),
    log: [{ ts: now, text: 'Launch prompt issued to an agent — the run starts when it spawns the team lead.' }],
  }
}

/**
 * Whether a new attempt record may replace what is already on disk.
 *
 * A run in flight must survive: fetching a prompt while the team is mid-run (a second
 * agent asking, a retry, a schedule overlapping) must not wipe the record of the run
 * that is actually going. Anything else — finished, failed, an earlier attempt, or a
 * file too corrupt to read — is safe to replace.
 */
export function canReplaceRunRecord(existingText) {
  if (!existingText) return true
  try {
    return JSON.parse(existingText)?.status !== 'running'
  } catch {
    return true
  }
}
