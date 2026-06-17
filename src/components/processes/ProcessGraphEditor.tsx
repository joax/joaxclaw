import { useState, useRef, useCallback, useEffect } from 'react'
import { Plus, Trash2, X, Save, ZoomIn, ZoomOut, Maximize2, LayoutGrid, Bot, Database, FolderOpen, Brain, Radio, ChevronDown, AlertCircle, Shuffle, UserCheck } from 'lucide-react'
import type { ProcessDef, GraphNode, GraphEdge, Deliverable, ProcessGraph, PortSide } from '../../lib/processParser'
import { useAgentsStore } from '../../store/agents'
import { useObsidianStore } from '../../store/obsidian'
import { ModelIcon } from '../ui/ModelIcon'

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_W         = 200
const NODE_W_HANDOFF = 160
const NODE_H_BASE    = 72
const NODE_H_HANDOFF = 60
const NODE_H_REVIEW  = 60
const PORT_R         = 8
const PORT_HIT       = 16
const GRID           = 20

const COLOR_HANDOFF = '#f59e0b'
const COLOR_REVIEW  = '#8b5cf6'

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9) }
function snap(v: number) { return Math.round(v / GRID) * GRID }

function nodeWidth(node: GraphNode): number {
  return node.type === 'handoff' ? NODE_W_HANDOFF : NODE_W
}

function nodeHeight(node: GraphNode): number {
  if (node.type === 'handoff') return NODE_H_HANDOFF
  if (node.type === 'review')  return NODE_H_REVIEW
  const extras = (node.deliverables?.length ?? 0) * 22
  return NODE_H_BASE + (extras > 0 ? extras + 8 : 0)
}

function portPos(node: GraphNode, side: PortSide) {
  const h = nodeHeight(node)
  const w = nodeWidth(node)
  switch (side) {
    case 'left':   return { x: node.position.x - PORT_R,     y: node.position.y + h / 2 }
    case 'right':  return { x: node.position.x + w + PORT_R, y: node.position.y + h / 2 }
    case 'top':    return { x: node.position.x + w / 2,      y: node.position.y - PORT_R }
    case 'bottom': return { x: node.position.x + w / 2,      y: node.position.y + h + PORT_R }
  }
}

function smartBezier(x1: number, y1: number, fromSide: PortSide, x2: number, y2: number, toSide: PortSide): string {
  const dist = Math.max(Math.hypot(x2 - x1, y2 - y1) * 0.45, 60)
  let cx1 = x1, cy1 = y1, cx2 = x2, cy2 = y2
  if (fromSide === 'right')  cx1 = x1 + dist
  if (fromSide === 'left')   cx1 = x1 - dist
  if (fromSide === 'bottom') cy1 = y1 + dist
  if (fromSide === 'top')    cy1 = y1 - dist
  if (toSide === 'left')     cx2 = x2 - dist
  if (toSide === 'right')    cx2 = x2 + dist
  if (toSide === 'top')      cy2 = y2 - dist
  if (toSide === 'bottom')   cy2 = y2 + dist
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
}

function arrowPoints(x: number, y: number, toSide: PortSide): string {
  switch (toSide) {
    case 'left':   return `${x},${y} ${x-8},${y-4} ${x-8},${y+4}`
    case 'right':  return `${x},${y} ${x+8},${y-4} ${x+8},${y+4}`
    case 'top':    return `${x},${y} ${x-4},${y-8} ${x+4},${y-8}`
    case 'bottom': return `${x},${y} ${x-4},${y+8} ${x+4},${y+8}`
  }
}

function bestPortPair(from: GraphNode, to: GraphNode): { fromPort: PortSide; toPort: PortSide } {
  const fx = from.position.x + nodeWidth(from)  / 2
  const fy = from.position.y + nodeHeight(from) / 2
  const tx = to.position.x   + nodeWidth(to)    / 2
  const ty = to.position.y   + nodeHeight(to)   / 2
  const angle = Math.atan2(ty - fy, tx - fx) * 180 / Math.PI
  if (angle > -45  && angle <=  45)  return { fromPort: 'right',  toPort: 'left'   }
  if (angle >  45  && angle <= 135)  return { fromPort: 'bottom', toPort: 'top'    }
  if (angle > -135 && angle <= -45)  return { fromPort: 'top',    toPort: 'bottom' }
  return                                     { fromPort: 'left',   toPort: 'right'  }
}

function validateGraph(graph: ProcessGraph): string[] {
  const warnings: string[] = []
  for (const node of graph.nodes) {
    if (node.type === 'agent' && !node.agentId)
      warnings.push(`Agent node "${node.id}": no agent selected`)
    if (node.type === 'handoff' && !node.routingCondition)
      warnings.push(`Handoff "${node.id}": missing routing condition`)
    if (node.type === 'handoff' && !graph.edges.some(e => e.from === node.id))
      warnings.push(`Handoff "${node.id}": no outgoing connections`)
    if (node.type === 'review' && !node.notificationTarget)
      warnings.push(`Review "${node.id}": missing notification target`)
  }
  return warnings
}

// ── Auto-layout ───────────────────────────────────────────────────────────────

function computeLayout(graph: ProcessGraph): ProcessGraph {
  const { nodes, edges } = graph
  if (nodes.length <= 1) return graph

  const adj   = new Map<string, string[]>()
  const inDeg = new Map<string, number>()
  for (const n of nodes) { adj.set(n.id, []); inDeg.set(n.id, 0) }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to)
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
  }

  // Assign column via longest-path BFS so dependencies always go left→right
  const col   = new Map<string, number>()
  const queue = nodes.filter(n => (inDeg.get(n.id) ?? 0) === 0).map(n => n.id)
  for (const id of queue) col.set(id, 0)

  let qi = 0
  while (qi < queue.length) {
    const id = queue[qi++]
    const c  = col.get(id) ?? 0
    for (const next of adj.get(id) ?? []) {
      const nc = c + 1
      if ((col.get(next) ?? -1) < nc) { col.set(next, nc); queue.push(next) }
    }
  }
  for (const n of nodes) if (!col.has(n.id)) col.set(n.id, 0)

  // Group nodes by column, preserving original order within each column
  const byCol = new Map<number, GraphNode[]>()
  for (const n of nodes) {
    const c = col.get(n.id) ?? 0
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(n)
  }

  const COL_GAP  = 280
  const ROW_GAP  = 24
  const ORIGIN_X = 60
  const ORIGIN_Y = 60

  // First pass: lay out each column top-down and measure total heights
  const rawPos = new Map<string, { x: number; y: number }>()
  const colH   = new Map<number, number>()

  for (const [c, colNodes] of byCol) {
    let y = ORIGIN_Y
    for (const n of colNodes) {
      rawPos.set(n.id, { x: ORIGIN_X + c * COL_GAP, y })
      y += nodeHeight(n) + ROW_GAP
    }
    colH.set(c, y - ROW_GAP - ORIGIN_Y)
  }

  // Second pass: vertically centre shorter columns against the tallest
  const maxH = Math.max(...colH.values())
  const newPos = new Map<string, { x: number; y: number }>()
  for (const [c, colNodes] of byCol) {
    const offset = snap((maxH - (colH.get(c) ?? 0)) / 2)
    for (const n of colNodes) {
      const p = rawPos.get(n.id)!
      newPos.set(n.id, { x: snap(p.x), y: snap(p.y + offset) })
    }
  }

  return {
    nodes: nodes.map(n => ({ ...n, position: newPos.get(n.id) ?? n.position })),
    edges: edges.map(e => ({ ...e, fromPort: 'right' as PortSide, toPort: 'left' as PortSide })),
  }
}

function fitToView(nodes: GraphNode[], canvas: HTMLDivElement): { pan: { x: number; y: number }; zoom: number } {
  if (nodes.length === 0) return { pan: { x: 0, y: 0 }, zoom: 1 }
  const PAD  = 60
  const minX = Math.min(...nodes.map(n => n.position.x))
  const minY = Math.min(...nodes.map(n => n.position.y))
  const maxX = Math.max(...nodes.map(n => n.position.x + nodeWidth(n)))
  const maxY = Math.max(...nodes.map(n => n.position.y + nodeHeight(n)))
  const gW   = maxX - minX
  const gH   = maxY - minY
  const zoom = Math.min(
    (canvas.clientWidth  - PAD * 2) / gW,
    (canvas.clientHeight - PAD * 2) / gH,
    1.4,
  )
  return {
    zoom,
    pan: {
      x: (canvas.clientWidth  - gW * zoom) / 2 - minX * zoom,
      y: (canvas.clientHeight - gH * zoom) / 2 - minY * zoom,
    },
  }
}

// ── Deliverable helpers ───────────────────────────────────────────────────────

type DeliverableType = Deliverable['type']

const DELIVERABLE_ICONS: Record<DeliverableType, React.ReactNode> = {
  workspace: <FolderOpen size={10} />,
  vault:     <Brain size={10} />,
  channel:   <Radio size={10} />,
  memory:    <Database size={10} />,
}
const DELIVERABLE_COLORS: Record<DeliverableType, string> = {
  workspace: 'var(--accent)',
  vault:     '#8b5cf6',
  channel:   '#3b82f6',
  memory:    'var(--success)',
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({
  node, selected, agents,
  onSelect, onMouseDown,
  onPortMouseDown, onPortMouseUp,
  onDelete,
}: {
  node: GraphNode
  selected: boolean
  agents: ReturnType<typeof useAgentsStore>['agents']
  onSelect: () => void
  onMouseDown: (e: React.MouseEvent) => void
  onPortMouseDown: (e: React.MouseEvent, nodeId: string, portSide: PortSide) => void
  onPortMouseUp: (nodeId: string, portSide: PortSide) => void
  onDelete: () => void
}) {
  const gwAgent   = node.agentId ? agents.find(a => a.id === node.agentId) : undefined
  const h         = nodeHeight(node)
  const w         = nodeWidth(node)
  const isStart   = node.type === 'start'
  const isEnd     = node.type === 'end'
  const isHandoff = node.type === 'handoff'
  const isReview  = node.type === 'review'

  let borderColor = selected ? 'var(--accent)' : 'var(--border)'
  let headerBg    = selected ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))' : 'var(--bg-elevated)'
  if (isStart)   { borderColor = selected ? 'var(--accent)' : 'color-mix(in srgb, var(--success) 50%, var(--border))'; headerBg = 'color-mix(in srgb, var(--success) 12%, var(--bg-elevated))' }
  if (isEnd)     { borderColor = selected ? 'var(--accent)' : 'color-mix(in srgb, var(--danger) 40%, var(--border))';  headerBg = 'color-mix(in srgb, var(--danger) 12%, var(--bg-elevated))' }
  if (isHandoff) { borderColor = selected ? 'var(--accent)' : `${COLOR_HANDOFF}88`; headerBg = `${COLOR_HANDOFF}18` }
  if (isReview)  { borderColor = selected ? 'var(--accent)' : `${COLOR_REVIEW}88`;  headerBg = `${COLOR_REVIEW}18`  }

  const portIn  = isHandoff ? COLOR_HANDOFF : isReview ? COLOR_REVIEW : 'var(--border)'
  const portOut = isHandoff ? COLOR_HANDOFF : isReview ? COLOR_REVIEW : 'var(--accent)'

  return (
    <div
      style={{ position: 'absolute', left: node.position.x, top: node.position.y, width: w, height: h, overflow: 'visible', cursor: 'default', userSelect: 'none' }}
      onMouseDown={e => { e.stopPropagation(); onSelect(); onMouseDown(e) }}
    >
      {/* Visual card */}
      <div style={{
        position: 'absolute', inset: 0,
        border: `1.5px solid ${borderColor}`,
        borderRadius: isHandoff ? 8 : 10,
        background: 'var(--bg-surface)',
        boxShadow: selected ? `0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)` : '0 2px 8px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '7px 10px', background: headerBg, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: isHandoff ? 13 : 16, lineHeight: 1, flexShrink: 0, color: isHandoff ? COLOR_HANDOFF : isReview ? COLOR_REVIEW : 'inherit' }}>
            {isStart ? '▶' : isEnd ? '⏹' : isHandoff ? '◇' : isReview ? '⬡' : (gwAgent?.identity?.emoji ?? '🤖')}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isHandoff ? COLOR_HANDOFF : isReview ? COLOR_REVIEW : 'var(--text-primary)' }}>
              {isStart ? 'Start' : isEnd ? 'End' : isHandoff ? 'Handoff' : isReview ? 'Review' : (gwAgent?.identity?.name ?? gwAgent?.name ?? node.agentId ?? 'Select agent')}
            </div>
            {!isStart && !isEnd && !isHandoff && !isReview && gwAgent?.model?.primary && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
                <ModelIcon model={gwAgent.model.primary} size={8} />
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {gwAgent.model.primary.split('/').pop()}
                </span>
              </div>
            )}
            {!isStart && !isEnd && !isHandoff && !isReview && !node.agentId && (
              <div style={{ fontSize: 9, color: 'var(--warning)', marginTop: 1 }}>⚠ No agent selected</div>
            )}
            {isReview && node.notificationTarget && (
              <div style={{ fontSize: 9, color: COLOR_REVIEW, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                → {node.notificationTarget}
              </div>
            )}
          </div>
          {selected && node.type !== 'start' && node.type !== 'end' && (
            <button
              onMouseDown={e => { e.stopPropagation(); onDelete() }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2, display: 'flex', flexShrink: 0 }}
            ><Trash2 size={11} /></button>
          )}
        </div>

        {/* Body */}
        {isHandoff && (
          <div style={{ padding: '5px 10px', fontSize: 10, lineHeight: 1.4, color: 'var(--text-secondary)', opacity: node.routingCondition ? 0.85 : 0.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {node.routingCondition || 'Add routing condition…'}
          </div>
        )}
        {!isStart && !isEnd && !isHandoff && !isReview && (
          <>
            <div style={{ padding: '5px 10px 6px', fontSize: 10, color: 'var(--text-secondary)', opacity: node.task ? 0.8 : 0.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.4 }}>
              {node.task || 'Click to add task…'}
            </div>
            {node.deliverables?.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 10px', fontSize: 9 }}>
                <span style={{ color: DELIVERABLE_COLORS[d.type] }}>{DELIVERABLE_ICONS[d.type]}</span>
                <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.description || d.path || d.type}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Left input port */}
      {!isStart && (
        <div
          style={{ position: 'absolute', left: -PORT_HIT, top: '50%', transform: 'translateY(-50%)', width: PORT_HIT * 2, height: PORT_HIT * 2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'crosshair', zIndex: 2 }}
          onMouseUp={e => { e.stopPropagation(); onPortMouseUp(node.id, 'left') }}
        >
          <div style={{ width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%', background: 'var(--bg-surface)', border: `2px solid ${portIn}`, pointerEvents: 'none' }} />
        </div>
      )}

      {/* Right output port */}
      {!isEnd && (
        <div
          style={{ position: 'absolute', right: -PORT_HIT, top: '50%', transform: 'translateY(-50%)', width: PORT_HIT * 2, height: PORT_HIT * 2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'crosshair', zIndex: 2 }}
          onMouseDown={e => { e.stopPropagation(); onPortMouseDown(e, node.id, 'right') }}
        >
          <div style={{ width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%', background: portOut, border: '2px solid var(--bg-surface)', pointerEvents: 'none' }} />
        </div>
      )}

      {/* Top input port */}
      {!isStart && (
        <div
          style={{ position: 'absolute', top: -PORT_HIT, left: '50%', transform: 'translateX(-50%)', width: PORT_HIT * 2, height: PORT_HIT * 2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'crosshair', zIndex: 2 }}
          onMouseUp={e => { e.stopPropagation(); onPortMouseUp(node.id, 'top') }}
        >
          <div style={{ width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%', background: 'var(--bg-surface)', border: `2px solid ${portIn}`, pointerEvents: 'none' }} />
        </div>
      )}

      {/* Bottom output port */}
      {!isEnd && (
        <div
          style={{ position: 'absolute', bottom: -PORT_HIT, left: '50%', transform: 'translateX(-50%)', width: PORT_HIT * 2, height: PORT_HIT * 2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'crosshair', zIndex: 2 }}
          onMouseDown={e => { e.stopPropagation(); onPortMouseDown(e, node.id, 'bottom') }}
        >
          <div style={{ width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%', background: portOut, border: '2px solid var(--bg-surface)', pointerEvents: 'none' }} />
        </div>
      )}
    </div>
  )
}

// ── Collaboration panel ───────────────────────────────────────────────────────

function CollaborationPanel({ node, nodes, edges, agents, vaults, onChange, onClose }: {
  node: GraphNode
  nodes: GraphNode[]
  edges: GraphEdge[]
  agents: ReturnType<typeof useAgentsStore>['agents']
  vaults: ReturnType<typeof useObsidianStore>['vaults']
  onChange: (patch: Partial<GraphNode>) => void
  onClose: () => void
}) {
  const [agentSearch, setAgentSearch] = useState('')
  const [showAgentList, setShowAgentList] = useState(false)
  const gwAgent = node.agentId ? agents.find(a => a.id === node.agentId) : undefined

  const filteredAgents = agents.filter(a =>
    !agentSearch || (a.identity?.name ?? a.name ?? a.id).toLowerCase().includes(agentSearch.toLowerCase())
  )

  const addDeliverable = (type: DeliverableType) =>
    onChange({ deliverables: [...(node.deliverables ?? []), { id: uid(), type, description: '' }] })
  const updateDeliverable = (id: string, patch: Partial<Deliverable>) =>
    onChange({ deliverables: node.deliverables?.map(d => d.id === id ? { ...d, ...patch } : d) })
  const removeDeliverable = (id: string) =>
    onChange({ deliverables: node.deliverables?.filter(d => d.id !== id) })

  const agentLabel = (n: GraphNode) => {
    if (n.type === 'agent') return agents.find(a => a.id === n.agentId)?.identity?.name ?? n.agentId ?? n.id
    return n.type
  }
  const incomingNodes  = edges.filter(e => e.to   === node.id).map(e => nodes.find(n => n.id === e.from)).filter(Boolean) as GraphNode[]
  const outgoingNodes  = edges.filter(e => e.from === node.id).map(e => nodes.find(n => n.id === e.to  )).filter(Boolean) as GraphNode[]

  const input: React.CSSProperties = {
    width: '100%', padding: '5px 8px', fontSize: 12, borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  }
  const label: React.CSSProperties = {
    display: 'block', fontSize: 10, fontWeight: 600, marginBottom: 5,
    textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)',
  }
  const readonlyBox: React.CSSProperties = {
    fontSize: 11, color: 'var(--text-secondary)', padding: '4px 8px',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    background: 'var(--bg-elevated)', minHeight: 28,
  }

  const titleColor = node.type === 'handoff' ? COLOR_HANDOFF : node.type === 'review' ? COLOR_REVIEW : 'var(--text-primary)'
  const titleLabel = { start: 'Start', end: 'End', agent: 'Agent Step', handoff: 'Handoff', review: 'Review Gate' }[node.type]

  return (
    <div className="fixed right-0 bottom-0 z-40 flex flex-col" style={{ top: 36, width: 300, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="font-semibold text-sm" style={{ color: titleColor }}>{titleLabel}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Handoff ── */}
        {node.type === 'handoff' && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <span style={label}>From</span>
                <div style={readonlyBox}>{incomingNodes.map(agentLabel).join(', ') || '—'}</div>
              </div>
              <div style={{ flex: 1 }}>
                <span style={label}>To</span>
                <div style={readonlyBox}>{outgoingNodes.map(agentLabel).join(', ') || '—'}</div>
              </div>
            </div>
            <div>
              <span style={label}>Routing Condition</span>
              <textarea value={node.routingCondition ?? ''} onChange={e => onChange({ routingCondition: e.target.value })}
                placeholder="When should this handoff trigger? e.g. 'When researcher finds Type-A investors…'"
                rows={3} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
            </div>
            <div>
              <span style={label}>Handoff Brief</span>
              <textarea value={node.handoffBrief ?? ''} onChange={e => onChange({ handoffBrief: e.target.value })}
                placeholder={`{previous_agent_output}\n\nTask for {receiving_agent}: {next_task_description}`}
                rows={6} style={{ ...input, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 11 }} />
              <p style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, opacity: 0.7 }}>
                Use <code style={{ fontFamily: 'monospace' }}>{'{previous_agent_output}'}</code> and <code style={{ fontFamily: 'monospace' }}>{'{receiving_agent}'}</code> as placeholders.
              </p>
            </div>
          </>
        )}

        {/* ── Review ── */}
        {node.type === 'review' && (
          <>
            {incomingNodes.length > 0 && (
              <div>
                <span style={label}>Triggered After</span>
                <div style={readonlyBox}>{incomingNodes.map(agentLabel).join(', ')}</div>
              </div>
            )}
            <div>
              <span style={label}>Notification Target</span>
              <input value={node.notificationTarget ?? ''} onChange={e => onChange({ notificationTarget: e.target.value })}
                placeholder="e.g. main, slack-alerts, email…" style={input} />
              <p style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, opacity: 0.7 }}>
                Channel or surface where the review request is sent.
              </p>
            </div>
            <div>
              <span style={label}>Review Prompt</span>
              <textarea value={node.reviewPrompt ?? ''} onChange={e => onChange({ reviewPrompt: e.target.value })}
                placeholder="Instructions shown to the reviewer. What should they approve or redirect?"
                rows={5} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
            </div>
            {outgoingNodes.length > 0 && (
              <div>
                <span style={label}>Continues To</span>
                <div style={readonlyBox}>{outgoingNodes.map(agentLabel).join(', ')}</div>
              </div>
            )}
          </>
        )}

        {/* ── Agent ── */}
        {node.type === 'agent' && (
          <>
            <div>
              <span style={label}>Agent</span>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowAgentList(v => !v)}
                  style={{ ...input, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontSize: 16 }}>{gwAgent?.identity?.emoji ?? '🤖'}</span>
                  <span className="flex-1 truncate" style={{ color: gwAgent ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {gwAgent ? (gwAgent.identity?.name ?? gwAgent.name ?? gwAgent.id) : 'Select agent…'}
                  </span>
                  <ChevronDown size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                </button>
                {showAgentList && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                      <input autoFocus value={agentSearch} onChange={e => setAgentSearch(e.target.value)} placeholder="Search agents…" style={{ ...input, padding: '4px 8px' }} />
                    </div>
                    {filteredAgents.map(a => (
                      <button key={a.id} onClick={() => { onChange({ agentId: a.id }); setShowAgentList(false); setAgentSearch('') }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', background: a.id === node.agentId ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                        <span>{a.identity?.emoji ?? '🤖'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{a.identity?.name ?? a.name ?? a.id}</div>
                          <div className="font-mono" style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.7 }}>{a.id}</div>
                        </div>
                      </button>
                    ))}
                    {filteredAgents.length === 0 && <div style={{ padding: '10px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>No agents found</div>}
                  </div>
                )}
              </div>
            </div>

            <div>
              <span style={label}>Task / Prompt</span>
              <textarea value={node.task ?? ''} onChange={e => onChange({ task: e.target.value })}
                placeholder="Describe what this agent should do in this step…"
                rows={5} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
            </div>

            <div>
              <span style={label}>SOUL / Identity</span>
              <textarea value={node.soul ?? ''} onChange={e => onChange({ soul: e.target.value })}
                placeholder="Override or augment this agent's identity for this step…"
                rows={4} style={{ ...input, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 11 }} />
            </div>

            <div>
              <span style={label}>Deliverables</span>
              <div className="space-y-2">
                {node.deliverables?.map(d => (
                  <div key={d.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: DELIVERABLE_COLORS[d.type] }}>{DELIVERABLE_ICONS[d.type]}</span>
                      <select value={d.type} onChange={e => updateDeliverable(d.id, { type: e.target.value as DeliverableType })}
                        style={{ flex: 1, fontSize: 11, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <option value="workspace">Workspace file</option>
                        <option value="vault">Obsidian vault</option>
                        <option value="channel">Channel message</option>
                        <option value="memory">Agent memory</option>
                      </select>
                      <button onClick={() => removeDeliverable(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'flex' }}><X size={11} /></button>
                    </div>
                    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {d.type === 'vault' && vaults.length > 0 ? (
                        <select value={d.path ?? ''} onChange={e => updateDeliverable(d.id, { path: e.target.value })} style={{ ...input, padding: '4px 8px', fontSize: 11 }}>
                          <option value="">Select vault…</option>
                          {vaults.map(v => <option key={v.url} value={v.name}>{v.name}</option>)}
                        </select>
                      ) : (
                        <input value={d.path ?? ''} onChange={e => updateDeliverable(d.id, { path: e.target.value })}
                          placeholder={d.type === 'workspace' ? 'e.g. output/report.md' : d.type === 'vault' ? 'vault-name' : d.type === 'channel' ? 'slack' : 'memory-key'}
                          style={{ ...input, padding: '4px 8px', fontSize: 11 }} />
                      )}
                      <input value={d.description ?? ''} onChange={e => updateDeliverable(d.id, { description: e.target.value })}
                        placeholder="Label shown on edges…" style={{ ...input, padding: '4px 8px', fontSize: 11 }} />
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {(['workspace', 'vault', 'channel', 'memory'] as DeliverableType[]).map(type => (
                    <button key={type} onClick={() => addDeliverable(type)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 10, borderRadius: 4, border: `1px solid ${DELIVERABLE_COLORS[type]}55`, background: `${DELIVERABLE_COLORS[type]}11`, color: DELIVERABLE_COLORS[type], cursor: 'pointer' }}>
                      <Plus size={9} />{type}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {node.type === 'start' && (
          <div className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <p>Entry point of the process.</p>
            <p className="mt-2 text-xs">Connect to the first Agent or Handoff node using the <span className="font-mono px-1 rounded" style={{ background: 'var(--bg-elevated)' }}>●</span> output port.</p>
          </div>
        )}

        {node.type === 'end' && (
          <div className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <p>Exit point of the process.</p>
            <p className="mt-2 text-xs">Connect any final agent nodes here to terminate the workflow.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Edge label ────────────────────────────────────────────────────────────────

function EdgeLabel({ edge, nodes }: { edge: GraphEdge; nodes: GraphNode[] }) {
  const from = nodes.find(n => n.id === edge.from)
  const to   = nodes.find(n => n.id === edge.to)
  if (!from || !to) return null

  const { fromPort, toPort } = bestPortPair(from, to)
  const p1 = portPos(from, fromPort)
  const p2 = portPos(to,   toPort)
  const mx = (p1.x + p2.x) / 2
  const my = (p1.y + p2.y) / 2
  const label = edge.label || (from.deliverables?.length === 1 ? from.deliverables[0].description : undefined)
  if (!label) return null

  return (
    <g>
      <rect x={mx - 40} y={my - 9} width={80} height={18} rx={4} fill="var(--bg-elevated)" stroke="var(--border)" strokeWidth={1} />
      <text x={mx} y={my + 4} textAnchor="middle" fontSize={9} fill="var(--text-secondary)">{label.length > 14 ? label.slice(0, 13) + '…' : label}</text>
    </g>
  )
}

// ── Main canvas ───────────────────────────────────────────────────────────────

interface EdgeDrag {
  fromNodeId: string
  fromPort: PortSide
  x: number
  y: number
  editingEdgeId?: string
}

interface Props {
  def: ProcessDef
  onSave: (updated: ProcessDef) => Promise<void>
  onClose: () => void
}

export function ProcessGraphEditor({ def, onSave, onClose }: Props) {
  const { agents, fetch: fetchAgents } = useAgentsStore()
  const { vaults, loadConfig: loadVaults } = useObsidianStore()

  const initGraph = (): ProcessGraph => {
    if (def.graph && def.graph.nodes.length > 0) return def.graph
    return {
      nodes: [
        { id: 'start', type: 'start', position: { x: 60,  y: 200 } },
        { id: 'end',   type: 'end',   position: { x: 560, y: 200 } },
      ],
      edges: [],
    }
  }

  const [graph,         setGraph        ] = useState<ProcessGraph>(initGraph)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [pan,           setPan          ] = useState({ x: 0, y: 0 })
  const [zoom,          setZoom         ] = useState(1)
  const [saving,        setSaving       ] = useState(false)
  const [edgeDrag,      setEdgeDrag     ] = useState<EdgeDrag | null>(null)
  const [isPanning,     setIsPanning    ] = useState(false)

  const edgeDragRef     = useRef<EdgeDrag | null>(null)
  const edgeDragCleanup = useRef<(() => void) | null>(null)
  const canvasRef       = useRef<HTMLDivElement>(null)
  const panRef          = useRef(pan)
  const zoomRef         = useRef(zoom)
  useEffect(() => { panRef.current  = pan  }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => {
    void fetchAgents()
    void loadVaults()
  }, [fetchAgents, loadVaults])

  // Restore the saved graph as-is, then fit it into view.
  // Manual layout should persist across tab switches and reopenings.
  useEffect(() => {
    const current = initGraph()
    setGraph(current)
    const frame = requestAnimationFrame(() => {
      if (!canvasRef.current) return
      const { pan: p, zoom: z } = fitToView(current.nodes, canvasRef.current)
      setPan(p); setZoom(z)
    })
    return () => cancelAnimationFrame(frame)
  }, [def.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLayout = useCallback(() => {
    setGraph(g => {
      const laid = computeLayout(g)
      requestAnimationFrame(() => {
        if (!canvasRef.current) return
        const { pan: p, zoom: z } = fitToView(laid.nodes, canvasRef.current)
        setPan(p); setZoom(z)
      })
      return laid
    })
  }, [])

  const selectedNode       = graph.nodes.find(n => n.id === selectedNodeId) ?? null
  const validationWarnings = validateGraph(graph)

  // ── Node operations ─────────────────────────────────────────────────────────

  const updateNode = useCallback((id: string, patch: Partial<GraphNode>) => {
    setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }))
  }, [])

  const deleteNode = useCallback((id: string) => {
    setGraph(g => ({
      nodes: g.nodes.filter(n => n.id !== id),
      edges: g.edges.filter(e => e.from !== id && e.to !== id),
    }))
    setSelectedNodeId(null)
  }, [])

  const addNode = useCallback((type: GraphNode['type']) => {
    const id = `${type}-${uid()}`
    const w  = type === 'handoff' ? NODE_W_HANDOFF : NODE_W
    const h  = type === 'handoff' ? NODE_H_HANDOFF : type === 'review' ? NODE_H_REVIEW : NODE_H_BASE
    const x  = snap((canvasRef.current?.clientWidth  ?? 600) / 2 / zoomRef.current - panRef.current.x / zoomRef.current - w / 2)
    const y  = snap((canvasRef.current?.clientHeight ?? 400) / 2 / zoomRef.current - panRef.current.y / zoomRef.current - h / 2)
    setGraph(g => ({ ...g, nodes: [...g.nodes, { id, type, position: { x, y } }] }))
    setSelectedNodeId(id)
  }, [])

  // ── Edge operations ─────────────────────────────────────────────────────────

  const deleteEdge = useCallback((id: string) => {
    setGraph(g => ({ ...g, edges: g.edges.filter(e => e.id !== id) }))
    setSelectedEdgeId(null)
  }, [])

  // ── Drag: nodes ──────────────────────────────────────────────────────────────

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return
    e.preventDefault()
    const node = graph.nodes.find(n => n.id === nodeId)
    if (!node) return
    const startX = e.clientX, startY = e.clientY
    const origX  = node.position.x, origY = node.position.y
    const z      = zoomRef.current

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / z
      const dy = (ev.clientY - startY) / z
      setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === nodeId ? { ...n, position: { x: snap(origX + dx), y: snap(origY + dy) } } : n) }))
    }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [graph.nodes])

  // ── Drag: ports ──────────────────────────────────────────────────────────────

  const handlePortMouseDown = useCallback((e: React.MouseEvent, nodeId: string, portSide: PortSide) => {
    e.stopPropagation()
    e.preventDefault()
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const px = panRef.current.x, py = panRef.current.y, z = zoomRef.current
    const init: EdgeDrag = { fromNodeId: nodeId, fromPort: portSide, x: (e.clientX - rect.left - px) / z, y: (e.clientY - rect.top - py) / z }
    edgeDragRef.current = init
    setEdgeDrag(init)

    const onMove = (ev: MouseEvent) => {
      if (!canvasRef.current) return
      const r = canvasRef.current.getBoundingClientRect()
      const next: EdgeDrag = { fromNodeId: nodeId, fromPort: portSide, x: (ev.clientX - r.left - panRef.current.x) / zoomRef.current, y: (ev.clientY - r.top - panRef.current.y) / zoomRef.current }
      edgeDragRef.current = next
      setEdgeDrag(next)
    }
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
      edgeDragRef.current = null; edgeDragCleanup.current = null; setEdgeDrag(null)
    }
    const onUp = cleanup
    edgeDragCleanup.current = cleanup
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [])

  const handlePortMouseUp = useCallback((toNodeId: string, toPort: PortSide) => {
    const drag = edgeDragRef.current
    edgeDragCleanup.current?.()
    if (!drag || drag.fromNodeId === toNodeId) return
    if (drag.editingEdgeId) {
      setGraph(g => ({ ...g, edges: g.edges.map(e => e.id === drag.editingEdgeId ? { ...e, to: toNodeId, toPort } : e) }))
      setSelectedEdgeId(drag.editingEdgeId)
    } else {
      setGraph(g => {
        if (g.edges.some(e => e.from === drag.fromNodeId && e.to === toNodeId)) return g
        return { ...g, edges: [...g.edges, { id: `edge-${uid()}`, from: drag.fromNodeId, to: toNodeId, fromPort: drag.fromPort, toPort }] }
      })
    }
  }, [])

  const handleEdgeArrowMouseDown = useCallback((e: React.MouseEvent, edge: GraphEdge) => {
    e.stopPropagation(); e.preventDefault()
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const z = zoomRef.current, px = panRef.current.x, py = panRef.current.y
    const fromNode = graph.nodes.find(n => n.id === edge.from)
    const toNode   = graph.nodes.find(n => n.id === edge.to)
    const fp: PortSide = (fromNode && toNode) ? bestPortPair(fromNode, toNode).fromPort : (edge.fromPort ?? 'right')
    const init: EdgeDrag = { fromNodeId: edge.from, fromPort: fp, x: (e.clientX - rect.left - px) / z, y: (e.clientY - rect.top - py) / z, editingEdgeId: edge.id }
    edgeDragRef.current = init
    setEdgeDrag(init)
    setSelectedEdgeId(null)

    const onMove = (ev: MouseEvent) => {
      if (!canvasRef.current) return
      const r = canvasRef.current.getBoundingClientRect()
      edgeDragRef.current = { fromNodeId: edge.from, fromPort: fp, x: (ev.clientX - r.left - panRef.current.x) / zoomRef.current, y: (ev.clientY - r.top - panRef.current.y) / zoomRef.current, editingEdgeId: edge.id }
      setEdgeDrag({ ...edgeDragRef.current })
    }
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   cleanup)
      edgeDragRef.current = null; edgeDragCleanup.current = null; setEdgeDrag(null)
    }
    edgeDragCleanup.current = cleanup
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   cleanup)
  }, [])

  // ── Canvas pan ──────────────────────────────────────────────────────────────

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    setSelectedNodeId(null); setSelectedEdgeId(null)
    const startX = e.clientX, startY = e.clientY
    const origPanX = panRef.current.x, origPanY = panRef.current.y
    setIsPanning(true)
    const onMove = (ev: MouseEvent) => setPan({ x: origPanX + (ev.clientX - startX), y: origPanY + (ev.clientY - startY) })
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); setIsPanning(false) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.min(2, Math.max(0.3, z * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    await onSave({ ...def, graph })
    setSaving(false)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const svgW = 10000, svgH = 10000

  const toolbarBtn = (extra?: React.CSSProperties): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 12,
    borderRadius: 'var(--radius)', border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer',
    ...extra,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <button onClick={() => addNode('agent')} style={toolbarBtn()}>
          <Plus size={12} /><Bot size={12} /> Agent
        </button>
        <button onClick={() => addNode('handoff')} style={toolbarBtn({ borderColor: `${COLOR_HANDOFF}66`, color: COLOR_HANDOFF })}>
          <Plus size={12} /><Shuffle size={12} /> Handoff
        </button>
        <button onClick={() => addNode('review')} style={toolbarBtn({ borderColor: `${COLOR_REVIEW}66`, color: COLOR_REVIEW })}>
          <Plus size={12} /><UserCheck size={12} /> Review
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
        <button onClick={handleLayout} title="Auto-arrange nodes" style={toolbarBtn()}>
          <LayoutGrid size={12} /> Arrange
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
        <button onClick={() => setZoom(z => Math.min(2, z * 1.2))} style={{ display: 'flex', alignItems: 'center', padding: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--text-secondary)' }}><ZoomIn size={13} /></button>
        <button onClick={() => setZoom(z => Math.max(0.3, z * 0.8))} style={{ display: 'flex', alignItems: 'center', padding: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--text-secondary)' }}><ZoomOut size={13} /></button>
        <button onClick={() => { if (canvasRef.current) { const { pan: p, zoom: z } = fitToView(graph.nodes, canvasRef.current); setPan(p); setZoom(z) } }} title="Fit to view" style={{ display: 'flex', alignItems: 'center', padding: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--text-secondary)' }}><Maximize2 size={13} /></button>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.5 }}>{Math.round(zoom * 100)}%</span>

        <div className="ml-auto flex items-center gap-2">
          {validationWarnings.length > 0 && (
            <span title={validationWarnings.join('\n')} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--warning)', cursor: 'default' }}>
              <AlertCircle size={12} /> {validationWarnings.length} issue{validationWarnings.length !== 1 ? 's' : ''}
            </span>
          )}
          {selectedEdgeId && (
            <button onClick={() => deleteEdge(selectedEdgeId)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', fontSize: 11, borderRadius: 'var(--radius)', border: '1px solid var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', cursor: 'pointer' }}>
              <Trash2 size={11} /> Delete edge
            </button>
          )}
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <X size={13} /> Close
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, borderRadius: 'var(--radius)', border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            <Save size={13} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Empty state hint */}
      {graph.nodes.length <= 2 && graph.edges.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-2 shrink-0 text-xs" style={{ background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-elevated))', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <AlertCircle size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          Add <strong>Agent</strong>, <span style={{ color: COLOR_HANDOFF, fontWeight: 600 }}>Handoff</span>, and <span style={{ color: COLOR_REVIEW, fontWeight: 600 }}>Review</span> nodes · Drag the <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', verticalAlign: 'middle', margin: '0 2px' }} /> port to connect · Click a node to configure
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        style={{ flex: 1, overflow: 'hidden', position: 'relative', background: 'var(--bg-primary)', cursor: isPanning ? 'grabbing' : 'grab' }}
        onMouseDown={handleCanvasMouseDown}
        onWheel={handleWheel}
      >
        {/* Dot grid */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs>
            <pattern id="proc-grid" x={pan.x % (GRID * zoom)} y={pan.y % (GRID * zoom)} width={GRID * zoom} height={GRID * zoom} patternUnits="userSpaceOnUse">
              <circle cx={0} cy={0} r={0.8} fill="var(--border)" opacity={0.5} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#proc-grid)" />
        </svg>

        {/* Transform group */}
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
          {/* SVG edges */}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: svgW, height: svgH, overflow: 'visible', pointerEvents: 'none' }}>
            {graph.edges.map(edge => {
              if (edgeDrag?.editingEdgeId === edge.id) return null
              const from = graph.nodes.find(n => n.id === edge.from)
              const to   = graph.nodes.find(n => n.id === edge.to)
              if (!from || !to) return null
              const { fromPort: fp, toPort: tp } = bestPortPair(from, to)
              const p1 = portPos(from, fp)
              const p2 = portPos(to,   tp)
              const isSelected = edge.id === selectedEdgeId
              const srcColor   = from.type === 'handoff' ? COLOR_HANDOFF : from.type === 'review' ? COLOR_REVIEW : undefined
              const edgeColor  = isSelected ? 'var(--accent)' : srcColor ? `${srcColor}99` : 'color-mix(in srgb, var(--accent) 50%, var(--border))'
              return (
                <g key={edge.id}>
                  <path d={smartBezier(p1.x, p1.y, fp, p2.x, p2.y, tp)} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={() => setSelectedEdgeId(isSelected ? null : edge.id)} />
                  <path d={smartBezier(p1.x, p1.y, fp, p2.x, p2.y, tp)} fill="none" stroke={edgeColor} strokeWidth={isSelected ? 2 : 1.5} />
                  <polygon points={arrowPoints(p2.x, p2.y, tp)} fill={edgeColor} />
                  <EdgeLabel edge={edge} nodes={graph.nodes} />
                  {isSelected && (
                    <circle cx={p2.x} cy={p2.y} r={7} fill="var(--accent)" stroke="var(--bg-surface)" strokeWidth={2} style={{ pointerEvents: 'all', cursor: 'crosshair' }} onMouseDown={e => handleEdgeArrowMouseDown(e, edge)} />
                  )}
                </g>
              )
            })}

            {edgeDrag && (() => {
              const from = graph.nodes.find(n => n.id === edgeDrag.fromNodeId)
              if (!from) return null
              const p1 = portPos(from, edgeDrag.fromPort)
              return <path d={smartBezier(p1.x, p1.y, edgeDrag.fromPort, edgeDrag.x, edgeDrag.y, 'left')} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 3" />
            })()}
          </svg>

          {/* Nodes */}
          {graph.nodes.map(node => (
            <NodeCard
              key={node.id}
              node={node}
              selected={node.id === selectedNodeId}
              agents={agents}
              onSelect={() => setSelectedNodeId(node.id)}
              onMouseDown={e => handleNodeMouseDown(e, node.id)}
              onPortMouseDown={(e, nodeId, portSide) => handlePortMouseDown(e, nodeId, portSide)}
              onPortMouseUp={(nodeId, portSide) => handlePortMouseUp(nodeId, portSide)}
              onDelete={() => deleteNode(node.id)}
            />
          ))}
        </div>
      </div>

      {/* Collaboration panel */}
      {selectedNode && (
        <CollaborationPanel
          node={selectedNode}
          nodes={graph.nodes}
          edges={graph.edges}
          agents={agents}
          vaults={vaults}
          onChange={patch => updateNode(selectedNode.id, patch)}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  )
}
