import { useEffect, useRef, useState, useCallback } from 'react'
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type Simulation, type SimulationNodeDatum, type SimulationLinkDatum
} from 'd3-force'
import type { GraphData, GraphNode } from '../../store/obsidian'

// d3-force node — extends GraphNode with SimulationNodeDatum (x, y, vx, vy, fx, fy)
interface SimNode extends GraphNode, SimulationNodeDatum {
  x: number; y: number
}

type SimLink = SimulationLinkDatum<SimNode> & { source: SimNode; target: SimNode }

// ── Palette ───────────────────────────────────────────────────────────────────

const BG          = '#0f0e17'
const EDGE_DIM    = 'rgba(120, 115, 160, 0.10)'
const EDGE_NORMAL = 'rgba(160, 155, 200, 0.35)'
const EDGE_HOV    = 'rgba(145, 125, 255, 0.90)'
const NODE_DIM    = 'rgba(90, 85, 130, 0.22)'
const NODE_DEF    = 'rgba(148, 140, 200, 0.82)'
const NODE_HUB    = 'rgba(165, 155, 230, 0.95)'
const NODE_HOV    = '#e2dfff'
const NODE_CON    = 'rgba(185, 170, 255, 0.92)'
const LABEL_DIM   = 'rgba(160, 155, 200, 0.45)'
const LABEL_BRIGHT= 'rgba(225, 220, 255, 0.95)'

function folderColor(folder: string, alpha: number): string {
  if (!folder) return `rgba(148, 140, 200, ${alpha})`
  let h = 5381
  for (let i = 0; i < folder.length; i++) h = ((h << 5) + h) ^ folder.charCodeAt(i)
  const hue = ((h >>> 0) % 280) + 200
  return `hsla(${hue}, 55%, 68%, ${alpha})`
}

function nodeRadius(linkCount: number): number {
  return 4 + Math.sqrt(linkCount) * 1.8
}

// ── Force settings ────────────────────────────────────────────────────────────

interface Forces {
  charge:      number  // repulsion strength (negative = repel)
  linkStrength:number  // spring pull along edges (0–1)
  linkDistance:number  // ideal edge length in px
  gravity:     number  // pull toward centre (0–1)
}

const DEFAULTS: Forces = {
  charge:      -80,
  linkStrength: 0.4,
  linkDistance: 60,
  gravity:      0.08,
}

// ── ForceGraph ────────────────────────────────────────────────────────────────

interface Props { data: GraphData; width: number; height: number }

export function ForceGraph({ data, width, height }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const simRef     = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef   = useRef<SimNode[]>([])
  const linksRef   = useRef<SimLink[]>([])
  const adjRef     = useRef<Map<string, Set<string>>>(new Map())
  const tRef       = useRef<{ x: number; y: number; s: number }>({ x: 0, y: 0, s: 1 })
  const rafRef     = useRef(0)
  const wRef       = useRef(width)
  const hRef       = useRef(height)

  const interRef = useRef<{
    mode: 'none' | 'pan' | 'drag'
    node: SimNode | null
    sx0: number; sy0: number
    tx0: number; ty0: number
  }>({ mode: 'none', node: null, sx0: 0, sy0: 0, tx0: 0, ty0: 0 })

  const hoveredRef  = useRef<SimNode | null>(null)
  const forcesRef   = useRef<Forces>({ ...DEFAULTS })
  const [forces, setForces]       = useState<Forces>({ ...DEFAULTS })
  const [panelOpen, setPanelOpen] = useState(false)
  const [tooltip, setTooltip]     = useState<{ title: string; path: string; x: number; y: number } | null>(null)
  const [cursor, setCursor]       = useState<'default' | 'grab' | 'grabbing'>('default')

  useEffect(() => { wRef.current = width }, [width])
  useEffect(() => { hRef.current = height }, [height])

  // ── Build simulation from data ────────────────────────────────────────────
  useEffect(() => {
    const cx = wRef.current / 2, cy = hRef.current / 2
    const f  = forcesRef.current

    // Re-use positions from the previous sim when data changes to avoid re-layout
    const prevMap = new Map(nodesRef.current.map(n => [n.id, { x: n.x, y: n.y }]))

    const nodes: SimNode[] = data.nodes.map(n => {
      const prev = prevMap.get(n.id)
      return {
        ...n,
        // Spread around the centre with mild jitter so the graph doesn't collapse
        x: prev?.x ?? cx + (Math.random() - 0.5) * wRef.current * 0.6,
        y: prev?.y ?? cy + (Math.random() - 0.5) * hRef.current * 0.6,
      } as SimNode
    })

    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    const links: SimLink[] = data.edges
      .map(e => ({ source: nodeMap.get(e.source)!, target: nodeMap.get(e.target)! }))
      .filter(l => l.source && l.target)

    // Adjacency for hover-highlight
    const adj = new Map<string, Set<string>>()
    for (const l of links) {
      const sid = (l.source as SimNode).id, tid = (l.target as SimNode).id
      if (!adj.has(sid)) adj.set(sid, new Set())
      if (!adj.has(tid)) adj.set(tid, new Set())
      adj.get(sid)!.add(tid)
      adj.get(tid)!.add(sid)
    }

    // Stop previous simulation cleanly
    simRef.current?.stop()

    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links)
        .id(n => n.id)
        .distance(f.linkDistance)
        .strength(f.linkStrength))
      .force('charge', forceManyBody<SimNode>()
        .strength(f.charge)
        .theta(0.9)          // Barnes-Hut approximation — fast on large graphs
        .distanceMin(8)
        .distanceMax(600))
      .force('center', forceCenter<SimNode>(cx, cy)
        .strength(f.gravity))
      .force('collision', forceCollide<SimNode>()
        .radius(n => nodeRadius(n.linkCount) + 1.5)
        .strength(0.7))
      .alphaDecay(0.02)      // slower cooling → settles more like Obsidian
      .velocityDecay(0.35)   // moderate damping

    nodesRef.current   = nodes
    linksRef.current   = links
    adjRef.current     = adj
    simRef.current     = sim
    hoveredRef.current = null
    setTooltip(null)

    return () => { sim.stop() }
  }, [data])

  // ── Apply force changes from sliders ──────────────────────────────────────
  // Called directly (never inside a setState updater) with a small alpha nudge
  // so nodes gently settle rather than flying apart.
  function applyForces(f: Forces) {
    const sim = simRef.current
    if (!sim) return
    const cx = wRef.current / 2, cy = hRef.current / 2
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lf = sim.force('link') as any
    lf?.distance(f.linkDistance)
    lf?.strength(f.linkStrength)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sim.force('charge') as any)?.strength(f.charge)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sim.force('center') as any)?.x(cx).y(cy).strength(f.gravity)
    // Small nudge — just enough to let nodes settle to the new equilibrium
    // without launching them far from their current positions
    sim.alpha(0.08).restart()
  }

  function updateForce<K extends keyof Forces>(key: K, value: Forces[K]) {
    forcesRef.current[key] = value
    // Update display state (pure — no side effects)
    setForces(prev => ({ ...prev, [key]: value }))
    // Apply to running simulation outside of setState
    applyForces(forcesRef.current)
  }

  // ── Draw frame (runs every RAF, no custom tick — d3 drives positions) ──────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = wRef.current, H = hRef.current
    const { x: tx, y: ty, s } = tRef.current
    const nodes  = nodesRef.current
    const links  = linksRef.current
    const adj    = adjRef.current
    const hov    = hoveredRef.current
    const hovAdj = hov ? (adj.get(hov.id) ?? new Set<string>()) : new Set<string>()
    const hasHov = hov !== null

    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(s, s)

    // Edges
    for (const link of links) {
      const a = link.source as SimNode, b = link.target as SimNode
      if (a.x == null || b.x == null) continue
      const isHovEdge = hasHov && (a.id === hov!.id || b.id === hov!.id)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      if (isHovEdge) {
        ctx.strokeStyle = EDGE_HOV; ctx.lineWidth = 1.5 / s
      } else if (hasHov) {
        ctx.strokeStyle = EDGE_DIM; ctx.lineWidth = 0.8 / s
      } else {
        ctx.strokeStyle = EDGE_NORMAL; ctx.lineWidth = 1 / s
      }
      ctx.globalAlpha = 1
      ctx.stroke()
    }

    // Nodes
    ctx.globalAlpha = 1
    for (const n of nodes) {
      if (n.x == null) continue
      const isHov = hov?.id === n.id
      const isCon = hasHov ? hovAdj.has(n.id) : false
      const isDim = hasHov && !isHov && !isCon
      const r     = nodeRadius(n.linkCount) / s
      const isHub = n.linkCount >= 5

      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'

      let fill: string
      if (isHov) {
        fill = NODE_HOV; ctx.shadowColor = '#9d8fff'; ctx.shadowBlur = 18 / s
      } else if (isCon) {
        fill = NODE_CON; ctx.shadowColor = '#9d8fff'; ctx.shadowBlur = 8 / s
      } else if (isDim) {
        fill = NODE_DIM
      } else if (isHub) {
        fill = NODE_HUB
      } else {
        fill = folderColor(n.folder, n.linkCount > 0 ? 0.85 : 0.60)
      }

      ctx.beginPath()
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.shadowBlur = 0

      if ((isHub || isHov || isCon) && !isDim) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, r + 1.2 / s, 0, Math.PI * 2)
        ctx.strokeStyle = isHov ? 'rgba(200,190,255,0.7)' : 'rgba(155,145,210,0.4)'
        ctx.lineWidth = 0.8 / s
        ctx.stroke()
      }

      // Labels
      const showLabel = isHov || isCon || (n.linkCount >= 3 && !isDim) || (s > 1.2 && !isDim)
      if (showLabel) {
        const fs = Math.max(9, 11 / s)
        ctx.font      = `${fs}px Inter, system-ui, sans-serif`
        ctx.fillStyle = isHov ? LABEL_BRIGHT : (isCon ? 'rgba(200,190,255,0.9)' : LABEL_DIM)
        ctx.fillText(n.title, n.x + r + 4 / s, n.y + fs * 0.37)
      }
    }

    ctx.restore()
  }, [])

  // ── RAF loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let running = true
    const loop = () => {
      if (!running) return
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { running = false; cancelAnimationFrame(rafRef.current) }
  }, [draw])

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const toWorld = (sx: number, sy: number) => {
    const { x, y, s } = tRef.current
    return { wx: (sx - x) / s, wy: (sy - y) / s }
  }

  const hitTest = (wx: number, wy: number): SimNode | null => {
    let best: SimNode | null = null, bestD = 20 / tRef.current.s
    for (const n of nodesRef.current) {
      if (n.x == null) continue
      const d = Math.sqrt((n.x - wx) ** 2 + (n.y - wy) ** 2)
      if (d < Math.max(bestD, nodeRadius(n.linkCount) / tRef.current.s + 4)) {
        if (d < bestD) { bestD = d; best = n }
      }
    }
    return best
  }

  // ── Mouse events ──────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top
    const inter = interRef.current

    if (inter.mode === 'pan') {
      tRef.current = { ...tRef.current, x: inter.tx0 + (sx - inter.sx0), y: inter.ty0 + (sy - inter.sy0) }
      return
    }
    if (inter.mode === 'drag' && inter.node) {
      const { wx, wy } = toWorld(sx, sy)
      inter.node.fx = wx; inter.node.fy = wy
      simRef.current?.alpha(Math.max(simRef.current.alpha(), 0.2)).restart()
      return
    }

    const { wx, wy } = toWorld(sx, sy)
    const found = hitTest(wx, wy)
    if (found !== hoveredRef.current) {
      hoveredRef.current = found
      setCursor(found ? 'grab' : 'default')
      setTooltip(found ? { title: found.title, path: found.id, x: sx, y: sy } : null)
    } else if (found && tooltip) {
      setTooltip(prev => prev ? { ...prev, x: sx, y: sy } : null)
    }
  }, [tooltip])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top
    const { wx, wy } = toWorld(sx, sy)
    const node = hitTest(wx, wy)
    if (node) {
      node.fx = wx; node.fy = wy
      setCursor('grabbing')
      interRef.current = { mode: 'drag', node, sx0: sx, sy0: sy, tx0: 0, ty0: 0 }
    } else {
      const { x, y } = tRef.current
      setCursor('grabbing')
      interRef.current = { mode: 'pan', node: null, sx0: sx, sy0: sy, tx0: x, ty0: y }
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    // Release dragged node — d3 lets it settle freely
    if (interRef.current.node) {
      interRef.current.node.fx = undefined
      interRef.current.node.fy = undefined
      simRef.current?.alpha(Math.max(simRef.current.alpha(), 0.15)).restart()
    }
    interRef.current = { mode: 'none', node: null, sx0: 0, sy0: 0, tx0: 0, ty0: 0 }
    setCursor('default')
  }, [])

  const handleLeave = useCallback(() => {
    if (interRef.current.node) {
      interRef.current.node.fx = undefined
      interRef.current.node.fy = undefined
      simRef.current?.alpha(Math.max(simRef.current.alpha(), 0.15)).restart()
    }
    interRef.current = { mode: 'none', node: null, sx0: 0, sy0: 0, tx0: 0, ty0: 0 }
    hoveredRef.current = null
    setCursor('default')
    setTooltip(null)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14
    const { x, y, s } = tRef.current
    const ns = Math.min(8, Math.max(0.05, s * factor))
    tRef.current = { x: sx - (sx - x) * (ns / s), y: sy - (sy - y) * (ns / s), s: ns }
  }, [])

  const zoomBy = (factor: number) => {
    const { x, y, s } = tRef.current
    const cx = wRef.current / 2, cy = hRef.current / 2
    const ns = Math.min(8, Math.max(0.05, s * factor))
    tRef.current = { x: cx - (cx - x) * (ns / s), y: cy - (cy - y) * (ns / s), s: ns }
  }

  const handleReset = () => {
    tRef.current = { x: 0, y: 0, s: 1 }
    simRef.current?.alpha(0.5).restart()
  }

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', background: BG }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: 'block', cursor }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleLeave}
        onWheel={handleWheel}
      />

      {/* Forces panel */}
      <div className="absolute top-3 right-3" style={{ pointerEvents: 'auto', zIndex: 10 }}>
        <button
          onClick={() => setPanelOpen(o => !o)}
          title="Simulation forces"
          style={{
            width: 30, height: 30, borderRadius: 7,
            border: `1px solid ${panelOpen ? 'rgba(160,145,255,0.55)' : 'rgba(140,130,200,0.25)'}`,
            background: panelOpen ? 'rgba(50,40,80,0.92)' : 'rgba(25,22,40,0.88)',
            color: panelOpen ? 'rgba(210,200,255,0.95)' : 'rgba(200,195,235,0.80)',
            fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', backdropFilter: 'blur(6px)', marginLeft: 'auto'
          }}
        >⚙</button>

        {panelOpen && (
          <div style={{
            marginTop: 6, padding: '10px 12px', borderRadius: 8,
            border: '1px solid rgba(140,130,200,0.30)',
            background: 'rgba(18,15,32,0.94)', backdropFilter: 'blur(8px)',
            width: 210, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: 10
          }}>
            {([
              { key: 'gravity',      label: 'Center force',   min: 0,    max: 0.5,  step: 0.01,  fmt: (v: number) => v.toFixed(2) },
              { key: 'charge',       label: 'Repel force',    min: -600, max: -5,   step: 5,     fmt: (v: number) => String(Math.round(v)) },
              { key: 'linkStrength', label: 'Link force',     min: 0,    max: 1,    step: 0.05,  fmt: (v: number) => v.toFixed(2) },
              { key: 'linkDistance', label: 'Link distance',  min: 10,   max: 300,  step: 5,     fmt: (v: number) => String(Math.round(v)) },
            ] as Array<{ key: keyof Forces; label: string; min: number; max: number; step: number; fmt: (v: number) => string }>).map(({ key, label, min, max, step, fmt }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, color: 'rgba(185,178,225,0.85)', fontFamily: 'Inter, system-ui, sans-serif' }}>{label}</span>
                  <span style={{ fontSize: 10, color: 'rgba(145,138,195,0.70)', fontFamily: 'monospace' }}>{fmt(forces[key])}</span>
                </div>
                <input
                  type="range" min={min} max={max} step={step} value={forces[key]}
                  onChange={e => updateForce(key, parseFloat(e.target.value))}
                  style={{
                    width: '100%', height: 3, cursor: 'pointer',
                    accentColor: 'rgba(145,125,255,0.9)',
                    WebkitAppearance: 'none', appearance: 'none',
                    borderRadius: 2, outline: 'none',
                    background: `linear-gradient(to right, rgba(145,125,255,0.8) 0%, rgba(145,125,255,0.8) ${((forces[key] - min) / (max - min)) * 100}%, rgba(80,75,120,0.5) ${((forces[key] - min) / (max - min)) * 100}%, rgba(80,75,120,0.5) 100%)`
                  }}
                />
              </div>
            ))}
            <button
              onClick={() => {
                forcesRef.current = { ...DEFAULTS }
                setForces({ ...DEFAULTS })
                // Full reheat on explicit reset — user expects nodes to re-layout
                const sim = simRef.current
                if (sim) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const lf = sim.force('link') as any
                  const cx = wRef.current / 2, cy = hRef.current / 2
                  lf?.distance(DEFAULTS.linkDistance).strength(DEFAULTS.linkStrength)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ;(sim.force('charge') as any)?.strength(DEFAULTS.charge)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ;(sim.force('center') as any)?.x(cx).y(cy).strength(DEFAULTS.gravity)
                  sim.alpha(0.5).restart()
                }
              }}
              style={{
                marginTop: 2, padding: '4px 0', borderRadius: 5, fontSize: 11,
                border: '1px solid rgba(120,110,180,0.30)',
                background: 'rgba(45,38,70,0.60)',
                color: 'rgba(175,165,225,0.80)',
                cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif'
              }}
            >Reset to defaults</button>
          </div>
        )}
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5" style={{ pointerEvents: 'auto' }}>
        {[{ label: '+', action: () => zoomBy(1.25) }, { label: '−', action: () => zoomBy(0.8) }, { label: '⊙', action: handleReset }].map(btn => (
          <button
            key={btn.label}
            onClick={btn.action}
            style={{
              width: 30, height: 30, borderRadius: 7,
              border: '1px solid rgba(140,130,200,0.25)',
              background: 'rgba(25,22,40,0.88)',
              color: 'rgba(200,195,235,0.80)',
              fontSize: btn.label === '⊙' ? 13 : 18, fontWeight: 300,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(6px)', transition: 'border-color 0.15s, color 0.15s'
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(160,145,255,0.55)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(225,220,255,0.95)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(140,130,200,0.25)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(200,195,235,0.80)' }}
          >{btn.label}</button>
        ))}
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: Math.min(tooltip.x + 14, width - 220),
          top: Math.max(tooltip.y - 36, 8),
          padding: '5px 11px', borderRadius: 6,
          background: 'rgba(16,14,26,0.94)',
          border: '1px solid rgba(140,125,255,0.35)',
          color: '#d4cfff', fontSize: 12,
          fontFamily: 'Inter, system-ui, sans-serif',
          pointerEvents: 'none', whiteSpace: 'nowrap',
          maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)'
        }}>
          <div style={{ fontWeight: 500 }}>{tooltip.title}</div>
          {tooltip.path !== tooltip.title + '.md' && (
            <div style={{ fontSize: 10, color: 'rgba(160,150,210,0.6)', marginTop: 2 }}>{tooltip.path}</div>
          )}
        </div>
      )}
    </div>
  )
}
