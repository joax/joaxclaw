// Parser for PROCESS.md files — YAML frontmatter + markdown body.
// Frontmatter is minimal hand-rolled YAML (no external dep needed for the
// subset we use: strings, numbers, booleans, and simple arrays/objects).

export interface ProcessAgent {
  id: string
  role?: string
  model?: string
  instructions?: string
}

export interface ProcessTransition {
  from: string
  to: string
  condition?: string
}

export interface ProcessWorkflow {
  startAgent: string
  transitions?: ProcessTransition[]
}

// ── Visual graph types ────────────────────────────────────────────────────────

export interface Deliverable {
  id: string
  type: 'workspace' | 'vault' | 'channel' | 'memory'
  path?: string          // file path or vault note name
  description?: string   // human label shown on edges
}

export interface GraphNode {
  id: string
  type: 'start' | 'agent' | 'end' | 'handoff' | 'review'
  position: { x: number; y: number }
  agentId?: string
  task?: string
  soul?: string
  deliverables?: Deliverable[]
  // Handoff node
  routingCondition?: string
  handoffBrief?: string
  // Review node
  notificationTarget?: string
  reviewPrompt?: string
}

export type PortSide = 'left' | 'right' | 'top' | 'bottom'

export interface GraphEdge {
  id: string
  from: string            // source node id
  to: string              // target node id
  fromPort?: PortSide     // defaults to 'right'
  toPort?: PortSide       // defaults to 'left'
  label?: string          // shown on the edge
  condition?: string      // optional routing condition
}

export interface ProcessGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ── Process definition ────────────────────────────────────────────────────────

export interface ProcessDef {
  id: string
  name: string
  description?: string
  version?: string | number
  tags?: string[]
  agents: ProcessAgent[]
  workflow: ProcessWorkflow
  graph?: ProcessGraph
  maxTurns?: number
  timeout?: number
  sessionTarget?: string
  trigger?: string
  controllerAgentId?: string  // agent ID to use as Team Lead when executing
  type?: 'process' | 'team'
  outputContract?: string     // team: description of expected final output
  workspace?: string          // team: shared working dir (repo) every member edits via cwd

  path: string
  body: string
  raw: string
}

// ── Frontmatter extraction ────────────────────────────────────────────────────

function extractFrontmatter(text: string): { yaml: string; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { yaml: '', body: text }
  return { yaml: match[1], body: match[2].trim() }
}

// ── Minimal YAML parser ───────────────────────────────────────────────────────
// Handles: key: value, key: "value", key: 'value', lists (- item), nested objects

function parseYaml(yaml: string): Record<string, unknown> {
  const lines = yaml.split(/\r?\n/)
  const root: Record<string, unknown> = {}
  const stack: Array<{ obj: Record<string, unknown> | unknown[]; indent: number; key?: string }> = [
    { obj: root, indent: -1 }
  ]

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue

    const indent = line.search(/\S/)
    const content = line.trim()

    // Pop stack to correct level
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()

    const top = stack[stack.length - 1]
    const parent = top.obj

    // List item
    if (content.startsWith('- ')) {
      const val = parseScalar(content.slice(2).trim())
      if (Array.isArray(parent)) {
        parent.push(val)
      } else if (top.key && Array.isArray((parent as Record<string, unknown>)[top.key])) {
        ((parent as Record<string, unknown>)[top.key] as unknown[]).push(val)
      } else if (top.key) {
        const arr: unknown[] = [val]
        ;(parent as Record<string, unknown>)[top.key] = arr
        stack.push({ obj: arr, indent, key: undefined })
      }
      continue
    }

    // List item (object entry under -)
    if (content.startsWith('-')) {
      const inner: Record<string, unknown> = {}
      if (Array.isArray(parent)) {
        parent.push(inner)
      } else if (top.key) {
        const existing = (parent as Record<string, unknown>)[top.key]
        if (Array.isArray(existing)) existing.push(inner)
        else (parent as Record<string, unknown>)[top.key] = [inner]
      }
      stack.push({ obj: inner, indent })
      continue
    }

    // Key-value pair
    const colonIdx = content.indexOf(':')
    if (colonIdx < 0) continue
    const key = content.slice(0, colonIdx).trim()
    const rest = content.slice(colonIdx + 1).trim()

    if (rest === '' || rest === '|' || rest === '>') {
      // Nested object or block scalar — push new object
      const child: Record<string, unknown> = {}
      ;(parent as Record<string, unknown>)[key] = child
      stack.push({ obj: child, indent, key })
    } else {
      ;(parent as Record<string, unknown>)[key] = parseScalar(rest)
    }
  }

  return root
}

function parseScalar(s: string): unknown {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  // Inline array [a, b, c]
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map(p => parseScalar(p.trim()))
  }
  return s
}

// ── Public parse function ─────────────────────────────────────────────────────

export function parseProcessFile(path: string, text: string): ProcessDef | null {
  try {
    const { yaml, body } = extractFrontmatter(text)
    if (!yaml) return null

    const fm = parseYaml(yaml) as Record<string, unknown>

    const agents: ProcessAgent[] = []
    const rawAgents = fm.agents
    if (Array.isArray(rawAgents)) {
      for (const a of rawAgents) {
        if (a && typeof a === 'object') {
          const agent = a as Record<string, unknown>
          agents.push({
            id: String(agent.id ?? ''),
            role: agent.role ? String(agent.role) : undefined,
            model: agent.model ? String(agent.model) : undefined,
            instructions: agent.instructions ? String(agent.instructions) : undefined,
          })
        }
      }
    }

    const wfRaw = (fm.workflow ?? {}) as Record<string, unknown>
    const transitions: ProcessTransition[] = []
    if (Array.isArray(wfRaw.transitions)) {
      for (const t of wfRaw.transitions) {
        if (t && typeof t === 'object') {
          const tr = t as Record<string, unknown>
          transitions.push({
            from: String(tr.from ?? ''),
            to: String(tr.to ?? ''),
            condition: tr.condition ? String(tr.condition) : undefined,
          })
        }
      }
    }

    const id = fm.id ? String(fm.id) : path.split('/').pop()?.replace(/\.md$/i, '') ?? 'unknown'

    // Parse visual graph — prefer the JSON comment block (robust round-trip),
    // fall back to the legacy YAML graph field for older files.
    let graph: ProcessGraph | undefined
    const graphCommentMatch = text.match(/<!--\s*graph-data\s*\n([\s\S]*?)\n-->/)
    if (graphCommentMatch) {
      try { graph = JSON.parse(graphCommentMatch[1]) as ProcessGraph } catch { /* ignore */ }
    }
    if (!graph) {
      // Legacy: try to read graph from YAML frontmatter (pre-JSON-comment format)
      const graphRaw = fm.graph as Record<string, unknown> | undefined
      if (graphRaw && typeof graphRaw === 'object' && !Array.isArray(graphRaw)) {
        const gNodes: GraphNode[] = []
        const gEdges: GraphEdge[] = []
        if (Array.isArray(graphRaw.nodes)) {
          for (const n of graphRaw.nodes as Record<string, unknown>[]) {
            const pos = (n.position ?? {}) as Record<string, unknown>
            gNodes.push({
              id: String(n.id ?? ''),
              type: (n.type as GraphNode['type']) ?? 'agent',
              position: { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0) },
              agentId: n.agentId ? String(n.agentId) : undefined,
              task: n.task ? String(n.task) : undefined,
            })
          }
        }
        if (Array.isArray(graphRaw.edges)) {
          for (const e of graphRaw.edges as Record<string, unknown>[]) {
            gEdges.push({
              id: String(e.id ?? Math.random().toString(36).slice(2)),
              from: String(e.from ?? ''),
              to: String(e.to ?? ''),
            })
          }
        }
        if (gNodes.length) graph = { nodes: gNodes, edges: gEdges }
      }
    }

    // Remove the graph-data comment from the displayed body
    const cleanBody = body.replace(/<!--\s*graph-data\s*\n[\s\S]*?\n-->\s*\n?/, '').trim()

    return {
      id,
      name: fm.name ? String(fm.name) : id,
      description: fm.description ? String(fm.description) : undefined,
      version: fm.version !== undefined ? String(fm.version) : undefined,
      tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
      agents,
      workflow: {
        startAgent: wfRaw.startAgent ? String(wfRaw.startAgent) : (agents[0]?.id ?? ''),
        transitions,
      },
      graph,
      maxTurns: typeof fm.maxTurns === 'number' ? fm.maxTurns : undefined,
      timeout: typeof fm.timeout === 'number' ? fm.timeout : undefined,
      sessionTarget: fm.sessionTarget ? String(fm.sessionTarget) : undefined,
      trigger: fm.trigger ? String(fm.trigger) : 'manual',
      controllerAgentId: fm.controller ? String(fm.controller) : undefined,
      type: fm.type === 'team' ? 'team' : 'process',
      outputContract: fm.outputContract ? String(fm.outputContract) : undefined,
      workspace: fm.workspace ? String(fm.workspace) : undefined,
      path,
      body: cleanBody,
      raw: text,
    }
  } catch {
    return null
  }
}

// ── Serialize a ProcessDef back to PROCESS.md text ────────────────────────────

function yamlStr(s: string): string {
  if (/[:#\[\]{}&*!|>'"%@`\n]/.test(s) || s.includes(': ')) return `"${s.replace(/"/g, '\\"')}"`
  return s
}

export function serializeProcess(def: ProcessDef): string {
  const lines: string[] = ['---']
  lines.push(`id: ${yamlStr(def.id)}`)
  lines.push(`name: ${yamlStr(def.name)}`)
  if (def.description) lines.push(`description: ${yamlStr(def.description)}`)
  lines.push(`version: ${def.version ?? 1}`)
  if (def.trigger) lines.push(`trigger: ${def.trigger}`)
  if (def.tags?.length) lines.push(`tags: [${def.tags.map(yamlStr).join(', ')}]`)
  if (def.maxTurns != null) lines.push(`maxTurns: ${def.maxTurns}`)
  if (def.timeout != null) lines.push(`timeout: ${def.timeout}`)
  if (def.sessionTarget) lines.push(`sessionTarget: ${yamlStr(def.sessionTarget)}`)
  if (def.controllerAgentId) lines.push(`controller: ${yamlStr(def.controllerAgentId)}`)
  if (def.type === 'team') lines.push(`type: team`)
  if (def.outputContract) lines.push(`outputContract: ${yamlStr(def.outputContract)}`)
  if (def.workspace) lines.push(`workspace: ${yamlStr(def.workspace)}`)
  lines.push('---')

  // Graph is stored as JSON in an HTML comment so we avoid round-tripping
  // complex nested structures through the hand-rolled YAML parser.
  // Markdown renderers ignore HTML comments, so the file remains readable.
  if (def.graph) {
    lines.push('')
    lines.push('<!-- graph-data')
    lines.push(JSON.stringify(def.graph))
    lines.push('-->')
  }

  if (def.body) lines.push('', def.body)
  return lines.join('\n')
}

// ── Template for new process files ───────────────────────────────────────────

export function processTemplate(name: string, id: string): string {
  const graph: ProcessGraph = {
    nodes: [
      { id: 'start',      type: 'start',   position: { x: 60,   y: 160 } },
      { id: 'researcher', type: 'agent',   position: { x: 300,  y: 160 }, task: 'Research and gather relevant information' },
      { id: 'handoff-1',  type: 'handoff', position: { x: 560,  y: 160 },
        routingCondition: 'When research is complete',
        handoffBrief: '{previous_agent_output}\n\nTask for analyst: analyse the findings above and produce structured insights.' },
      { id: 'analyst',    type: 'agent',   position: { x: 800,  y: 160 }, task: 'Analyse the research findings and produce insights' },
      { id: 'end',        type: 'end',     position: { x: 1060, y: 160 } },
    ],
    edges: [
      { id: 'e1', from: 'start',      to: 'researcher' },
      { id: 'e2', from: 'researcher', to: 'handoff-1'  },
      { id: 'e3', from: 'handoff-1',  to: 'analyst'    },
      { id: 'e4', from: 'analyst',    to: 'end'        },
    ],
  }
  return `---
id: ${yamlStr(id)}
name: ${yamlStr(name)}
description: Describe what this process does
version: 1
trigger: manual
maxTurns: 20
timeout: 300
---

<!-- graph-data
${JSON.stringify(graph)}
-->

# ${name}

## Overview

Describe the purpose of this process.

## Team

- **Researcher** — gathers and structures information
- **Analyst** — interprets findings and produces insights
`
}
