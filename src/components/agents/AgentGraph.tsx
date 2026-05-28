import { useMemo, useState, useRef, useEffect } from 'react'
import type { Agent } from '../../lib/types'
import { Settings2, X, Trash2, Check, Loader2 } from 'lucide-react'
import { useAgentsStore } from '../../store/agents'
import { Btn } from '../ui/Btn'

interface Props {
  agents: Agent[]
  defaultId: string | null
  onChat: (agent: Agent) => void
  onConnect: (fromId: string, toId: string) => void
  onDisconnect: (fromId: string, toId: string) => void
  onEdit: (agent: Agent) => void
}

interface DragState { fromId: string; x: number; y: number }

const CARD_W       = 210
const CARD_H       = 100
const FOREIGN_EXTRA = 26   // extra px below card for the connector handle
const HANDLE_R     = 6
const H_GAP        = 270
const V_GAP        = 190

function agentDisplayName(a: Agent): string {
  return a.identity?.name ?? a.name ?? a.id
}

function agentModel(a: Agent): string {
  return a.model?.primary ?? a.agentRuntime?.id ?? ''
}

function suggestInstructions(fromAgent: Agent, toAgent: Agent): string {
  const from = agentDisplayName(fromAgent)
  const to   = agentDisplayName(toAgent)
  return [
    `Use ${to} when you need to delegate a task that falls outside your own capabilities or knowledge.`,
    ``,
    `When calling ${to}:`,
    `- Provide a clear, self-contained description of the task`,
    `- Include all relevant context and any data it needs`,
    `- Specify the expected output format or structure`,
    `- Mention any constraints, deadlines, or priorities`,
    ``,
    `${from} should only delegate to ${to} when doing so genuinely improves the result — avoid unnecessary delegation for tasks you can handle directly.`,
  ].join('\n')
}

function computeLayout(agents: Agent[]): Map<string, { x: number; y: number }> {
  const allIds = new Set(agents.map(a => a.id))
  const hasParent = new Set<string>()
  for (const a of agents)
    for (const sub of a.allowedSubAgents ?? [])
      if (allIds.has(sub)) hasParent.add(sub)

  const level = new Map<string, number>()
  const roots = agents.filter(a => !hasParent.has(a.id))
  const queue: Array<{ id: string; lvl: number }> = roots.map(a => ({ id: a.id, lvl: 0 }))
  while (queue.length) {
    const { id, lvl } = queue.shift()!
    if ((level.get(id) ?? -1) >= lvl) continue
    level.set(id, lvl)
    const a = agents.find(x => x.id === id)
    for (const sub of a?.allowedSubAgents ?? [])
      if (allIds.has(sub)) queue.push({ id: sub, lvl: lvl + 1 })
  }
  for (const a of agents) if (!level.has(a.id)) level.set(a.id, 0)

  const byLevel = new Map<number, string[]>()
  for (const [id, lvl] of level) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(id)
  }

  const positions = new Map<string, { x: number; y: number }>()
  for (const [lvl, ids] of byLevel)
    ids.forEach((id, i) => positions.set(id, {
      x: (i - (ids.length - 1) / 2) * H_GAP,
      y: lvl * V_GAP,
    }))
  return positions
}

function svgPoint(e: MouseEvent | React.MouseEvent, svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect()
  const vb   = svg.viewBox.baseVal
  return {
    x: (e.clientX - rect.left) * (vb.width  / rect.width)  + vb.x,
    y: (e.clientY - rect.top)  * (vb.height / rect.height) + vb.y,
  }
}

// ── EdgeEditor ────────────────────────────────────────────────────────────────

interface EdgeEditorProps {
  fromAgent: Agent
  toAgent: Agent
  onClose: () => void
  onDisconnect: () => void
}

function EdgeEditor({ fromAgent, toAgent, onClose, onDisconnect }: EdgeEditorProps) {
  const { readRelationship, writeRelationship } = useAgentsStore()
  const [instructions, setInstructions] = useState('')
  const [original,     setOriginal]     = useState('')
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isDirty  = instructions !== original
  const fromName = agentDisplayName(fromAgent)
  const toName   = agentDisplayName(toAgent)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    readRelationship(fromAgent.id, toAgent.id)
      .then(text => {
        if (cancelled) return
        if (text) {
          setInstructions(text)
          setOriginal(text)
        } else {
          setInstructions(suggestInstructions(fromAgent, toAgent))
          setOriginal('')
        }
      })
      .catch(() => {
        if (cancelled) return
        setInstructions(suggestInstructions(fromAgent, toAgent))
        setOriginal('')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fromAgent.id, toAgent.id])

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await writeRelationship(fromAgent.id, toAgent.id, instructions)
      setOriginal(instructions)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div
        className="fixed right-0 bottom-0 z-50 flex flex-col"
        style={{ top: 36, width: 400, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Relationship</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {fromName} → {toName}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              WHEN AND HOW TO CALL THIS AGENT
            </label>
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
              Describe when <strong style={{ color: 'var(--text-secondary)' }}>{fromName}</strong> should delegate
              to <strong style={{ color: 'var(--text-secondary)' }}>{toName}</strong>, and how to use it.
              Saved to <code>openclaw.json</code> and persists across restarts.
            </p>
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : (
              <textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder={`e.g. "Use ${toName} when you need to search the web or look up real-time information. Pass the search query as the main task."`}
                rows={9}
                style={{
                  display: 'block', width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  fontSize: 13, lineHeight: 1.6,
                  resize: 'vertical', outline: 'none',
                  boxSizing: 'border-box', fontFamily: 'inherit',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                autoFocus
              />
            )}
          </div>
        </div>

        {/* Save error */}
        {saveError && (
          <div className="mx-5 mb-2 px-3 py-2 rounded text-xs" style={{
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid var(--danger)', color: 'var(--danger)',
          }}>
            {saveError}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          {confirmDelete ? (
            <>
              <Btn size="sm" variant="danger" onClick={onDisconnect} style={{ flex: 1 }}>Confirm remove</Btn>
              <Btn size="sm" variant="outline" onClick={() => setConfirmDelete(false)} style={{ flex: 1 }}>Cancel</Btn>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--danger)', fontSize: 13, padding: '6px 8px',
                  borderRadius: 'var(--radius)',
                }}
              >
                <Trash2 size={13} /> Remove
              </button>
              <div style={{ flex: 1 }} />
              <Btn size="sm" onClick={handleSave} loading={saving} disabled={!isDirty}
                icon={saved ? <Check size={13} /> : undefined}>
                {saved ? 'Saved' : 'Save'}
              </Btn>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ── AgentGraph ────────────────────────────────────────────────────────────────

export function AgentGraph({ agents, defaultId, onChat, onConnect, onDisconnect, onEdit }: Props) {
  const [hovered,     setHovered]     = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<{ from: string; to: string } | null>(null)
  const [dragging,    setDragging]    = useState<DragState | null>(null)
  const [editingEdge, setEditingEdge] = useState<{ from: string; to: string } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const draggingRef     = useRef(dragging)
  const agentsRef       = useRef(agents)
  const positionsRef    = useRef(new Map<string, { x: number; y: number }>())
  const onConnectRef    = useRef(onConnect)
  draggingRef.current   = dragging
  agentsRef.current     = agents
  onConnectRef.current  = onConnect

  const positions = useMemo(() => computeLayout(agents), [agents])
  positionsRef.current = positions

  const isDragging = dragging !== null
  useEffect(() => {
    if (!isDragging) return

    const onMove = (e: MouseEvent) => {
      if (!svgRef.current) return
      const p = svgPoint(e, svgRef.current)
      setDragging(d => d ? { ...d, x: p.x, y: p.y } : null)
    }

    const onUp = (e: MouseEvent) => {
      const d = draggingRef.current
      if (!d) { setDragging(null); return }

      if (svgRef.current) {
        const p = svgPoint(e, svgRef.current)
        const target = agentsRef.current.find(a => {
          if (a.id === d.fromId) return false
          const ap = positionsRef.current.get(a.id)
          if (!ap) return false
          return Math.abs(p.x - ap.x) <= CARD_W / 2 && Math.abs(p.y - ap.y) <= CARD_H / 2
        })
        if (target) {
          const from = agentsRef.current.find(a => a.id === d.fromId)
          if (from && !(from.allowedSubAgents ?? []).includes(target.id))
            onConnectRef.current(d.fromId, target.id)
        }
      }
      setDragging(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [isDragging])

  if (!positions.size) return null

  const allIds = new Set(agents.map(a => a.id))
  const edges: Array<{ from: string; to: string }> = []
  for (const a of agents)
    for (const sub of a.allowedSubAgents ?? [])
      if (allIds.has(sub) && positions.has(a.id) && positions.has(sub))
        edges.push({ from: a.id, to: sub })

  const xs  = [...positions.values()].map(p => p.x)
  const ys  = [...positions.values()].map(p => p.y)
  const pad = { x: CARD_W / 2 + 50, y: CARD_H / 2 + 70 }
  const minX = Math.min(...xs) - pad.x
  const minY = Math.min(...ys) - pad.y
  const vbW  = Math.max(...xs) + pad.x - minX
  const vbH  = Math.max(...ys) + pad.y - minY

  const dragTarget = dragging ? agents.find(a => {
    if (a.id === dragging.fromId) return false
    const ap = positions.get(a.id)
    if (!ap) return false
    return Math.abs(dragging.x - ap.x) <= CARD_W / 2 && Math.abs(dragging.y - ap.y) <= CARD_H / 2
  }) ?? null : null

  const fromEdge = editingEdge ? agents.find(a => a.id === editingEdge.from) ?? null : null
  const toEdge   = editingEdge ? agents.find(a => a.id === editingEdge.to)   ?? null : null

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div
        className="flex flex-1 items-center justify-center min-h-0 overflow-auto"
        style={{ padding: 16, cursor: dragging ? 'crosshair' : 'default' }}
      >
        <svg
          ref={svgRef}
          viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
          style={{
            width: '100%', height: '100%',
            minWidth: vbW, minHeight: vbH, maxWidth: vbW * 2,
            overflow: 'visible', userSelect: 'none',
          }}
        >
          <defs>
            <marker id="ag-arr"      markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <path d="M0,1 L7,3.5 L0,6 Z" fill="var(--border)" />
            </marker>
            <marker id="ag-arr-a"    markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <path d="M0,1 L7,3.5 L0,6 Z" fill="var(--accent)" />
            </marker>
            <marker id="ag-arr-drag" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <path d="M0,1 L7,3.5 L0,6 Z" fill="color-mix(in srgb, var(--accent) 80%, transparent)" />
            </marker>
          </defs>

          {/* ── Edges ── */}
          {edges.map(({ from, to }) => {
            const fp = positions.get(from)!
            const tp = positions.get(to)!
            const fromY  = fp.y + CARD_H / 2
            const toY    = tp.y - CARD_H / 2
            const ctrY   = (fromY + toY) / 2
            const midX   = (fp.x + tp.x) / 2
            const midY   = (fromY + toY) / 2
            const isEdgeHov = hoveredEdge?.from === from && hoveredEdge?.to === to
            const isNodeHov = hovered === from || hovered === to
            const path = `M ${fp.x} ${fromY} C ${fp.x} ${ctrY}, ${tp.x} ${ctrY}, ${tp.x} ${toY}`

            return (
              <g key={`${from}→${to}`}>
                <path
                  d={path} fill="none"
                  stroke={isEdgeHov || isNodeHov ? 'var(--accent)' : 'var(--border)'}
                  strokeWidth={isEdgeHov ? 2 : 1.5}
                  markerEnd={isEdgeHov || isNodeHov ? 'url(#ag-arr-a)' : 'url(#ag-arr)'}
                  opacity={isEdgeHov || isNodeHov ? 1 : 0.55}
                  style={{ transition: 'stroke 0.12s, opacity 0.12s', pointerEvents: 'none' }}
                />
                {/* Wide transparent hit area */}
                <path
                  d={path} fill="none" stroke="transparent" strokeWidth={14}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredEdge({ from, to })}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onClick={() => setEditingEdge({ from, to })}
                />
                {/* Edit badge at midpoint */}
                {isEdgeHov && (
                  <g transform={`translate(${midX},${midY})`} style={{ pointerEvents: 'none' }}>
                    <circle r={9} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={1.5} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={12} fill="var(--accent)" fontWeight="bold">✎</text>
                  </g>
                )}
              </g>
            )
          })}

          {/* ── Drag preview ── */}
          {dragging && (() => {
            const fp = positions.get(dragging.fromId)
            if (!fp) return null
            const color = dragTarget ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 60%, transparent)'
            return (
              <path
                d={`M ${fp.x} ${fp.y + CARD_H / 2} L ${dragging.x} ${dragging.y}`}
                fill="none" stroke={color} strokeWidth={2} strokeDasharray="7 4"
                markerEnd="url(#ag-arr-drag)"
                style={{ pointerEvents: 'none' }}
              />
            )
          })()}

          {/* ── Nodes ── */}
          {agents.map(agent => {
            const pos = positions.get(agent.id)
            if (!pos) return null

            const isHov = !dragging && hovered === agent.id
            const isDef = agent.id === defaultId
            const isSrc = dragging?.fromId === agent.id
            const isTgt = dragTarget?.id === agent.id
            const model = agentModel(agent)
            const label = agentDisplayName(agent)

            const borderColor = isTgt || isSrc || isHov
              ? 'var(--accent)'
              : isDef
              ? 'color-mix(in srgb, var(--accent) 50%, var(--border))'
              : 'var(--border)'

            const fillColor = isTgt
              ? 'color-mix(in srgb, var(--accent) 18%, var(--bg-surface))'
              : isSrc
              ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))'
              : isHov
              ? 'color-mix(in srgb, var(--accent) 7%, var(--bg-surface))'
              : 'var(--bg-surface)'

            return (
              <g key={agent.id} transform={`translate(${pos.x},${pos.y})`}>

                {/* Glow ring */}
                {(isHov || isTgt) && (
                  <rect
                    x={-CARD_W / 2 - 5} y={-CARD_H / 2 - 5}
                    width={CARD_W + 10} height={CARD_H + 10} rx={11}
                    fill={isTgt
                      ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                      : 'color-mix(in srgb, var(--accent) 10%, transparent)'}
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* Default dashed ring */}
                {isDef && (
                  <rect
                    x={-CARD_W / 2 - 4} y={-CARD_H / 2 - 4}
                    width={CARD_W + 8} height={CARD_H + 8} rx={10}
                    fill="none" stroke="var(--accent)" strokeWidth={1.5}
                    strokeDasharray="5 3" opacity={0.6}
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {/* Card background */}
                <rect
                  x={-CARD_W / 2} y={-CARD_H / 2}
                  width={CARD_W} height={CARD_H} rx={8}
                  fill={fillColor}
                  stroke={borderColor}
                  strokeWidth={isTgt || isSrc ? 2 : isHov ? 1.5 : 1}
                  style={{ transition: 'fill 0.12s, stroke 0.12s', pointerEvents: 'none' }}
                />

                {/* Card content + connector handle via foreignObject */}
                <foreignObject
                  x={-CARD_W / 2} y={-CARD_H / 2}
                  width={CARD_W} height={CARD_H + FOREIGN_EXTRA}
                >
                  {/* outer div covers card + connector area for seamless hover */}
                  <div
                    style={{
                      width: CARD_W,
                      height: CARD_H + FOREIGN_EXTRA,
                      position: 'relative',
                      boxSizing: 'border-box',
                    }}
                    onMouseEnter={() => { if (!dragging) setHovered(agent.id) }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {/* Card content */}
                    <div
                      style={{
                        width: CARD_W,
                        height: CARD_H,
                        padding: '10px 12px',
                        boxSizing: 'border-box',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                        cursor: dragging ? (isTgt ? 'copy' : 'crosshair') : 'pointer',
                        background: 'transparent',
                      }}
                      onClick={() => { if (!dragging) onChat(agent) }}
                    >
                      {/* Header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        {agent.identity?.emoji ? (
                          <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
                            {agent.identity.emoji}
                          </span>
                        ) : (
                          <div style={{
                            width: 22, height: 22, flexShrink: 0, borderRadius: 4,
                            background: 'color-mix(in srgb, var(--accent) 20%, var(--bg-elevated))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color: 'var(--accent)',
                          }}>
                            {label.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span style={{
                          flex: 1, fontWeight: 600, fontSize: 13,
                          color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {label}
                        </span>
                        {isDef && (
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                            background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                            color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                          }}>
                            default
                          </span>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); onEdit(agent) }}
                          title="Edit agent"
                          style={{
                            flexShrink: 0, background: 'none', border: 'none',
                            cursor: 'pointer', padding: '2px 3px', borderRadius: 4,
                            color: 'var(--text-secondary)', display: 'flex', alignItems: 'center',
                            opacity: isHov ? 1 : 0, transition: 'opacity 0.12s',
                          }}
                        >
                          <Settings2 size={13} />
                        </button>
                      </div>

                      {/* Model */}
                      <div style={{
                        fontSize: 11, fontFamily: 'monospace',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {model || <span style={{ opacity: 0.4 }}>—</span>}
                      </div>

                      {/* ID */}
                      <div style={{
                        fontSize: 10, fontFamily: 'monospace',
                        color: 'var(--text-secondary)', opacity: 0.45,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {agent.id}
                      </div>
                    </div>

                    {/* Connector handle — positioned below card within foreignObject */}
                    {(isHov || isSrc) && (
                      <div
                        style={{
                          position: 'absolute',
                          top: CARD_H + (FOREIGN_EXTRA - HANDLE_R * 2) / 2,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: HANDLE_R * 2,
                          height: HANDLE_R * 2,
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          border: '2px solid var(--bg-surface)',
                          cursor: 'crosshair',
                          boxSizing: 'border-box',
                        }}
                        onMouseDown={e => {
                          e.stopPropagation()
                          if (!svgRef.current) return
                          const p = svgPoint(e, svgRef.current)
                          setDragging({ fromId: agent.id, x: p.x, y: p.y })
                        }}
                      />
                    )}
                  </div>
                </foreignObject>
              </g>
            )
          })}
        </svg>
      </div>

      <p className="text-center pb-3 text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.45 }}>
        Drag the handle below a node to connect · Click an edge to edit the relationship
      </p>

      {editingEdge && fromEdge && toEdge && (
        <EdgeEditor
          fromAgent={fromEdge}
          toAgent={toEdge}
          onClose={() => setEditingEdge(null)}
          onDisconnect={() => { onDisconnect(editingEdge.from, editingEdge.to); setEditingEdge(null) }}
        />
      )}
    </div>
  )
}
