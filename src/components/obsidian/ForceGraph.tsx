import { useEffect, useRef, useState, useCallback } from 'react'
import type { GraphData, GraphNode } from '../../store/obsidian'

interface SimNode extends GraphNode {
  x: number; y: number
  vx: number; vy: number
  fx?: number; fy?: number
}

// ── Palette matching Obsidian's default theme ─────────────────────────────────

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
  const hue = ((h >>> 0) % 280) + 200  // blue-purple range like Obsidian
  return `hsla(${hue}, 55%, 68%, ${alpha})`
}

function nodeRadius(linkCount: number): number {
  return 4 + Math.sqrt(linkCount) * 1.8
}

// ── Force settings ────────────────────────────────────────────────────────────

interface Forces {
  repulsion:   number   // node-node repulsion strength
  springK:     number   // spring constant along edges
  springLen:   number   // ideal edge length
  gravity:     number   // pull toward centre
}

const DEFAULTS: Forces = { repulsion: 3500, springK: 0.06, springLen: 90, gravity: 0.02 }

const DAMPING     = 0.87
const ALPHA_DECAY = 0.003
const ALPHA_MIN   = 0.002

// ── ForceGraph ────────────────────────────────────────────────────────────────

interface Props { data: GraphData; width: number; height: number }

export function ForceGraph({ data, width, height }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const nodesRef   = useRef<SimNode[]>([])
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map())
  const adjRef     = useRef<Map<string, Set<string>>>(new Map())
  const alphaRef   = useRef(1)
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
  const [tooltip, setTooltip] = useState<{ title: string; path: string; x: number; y: number } | null>(null)
  const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing'>('default')

  function updateForce<K extends keyof Forces>(key: K, value: Forces[K]) {
    forcesRef.current[key] = value
    setForces(f => ({ ...f, [key]: value }))
    alphaRef.current = Math.max(alphaRef.current, 0.3)
  }

  useEffect(() => { wRef.current = width }, [width])
  useEffect(() => { hRef.current = height }, [height])

  // ── Init simulation ───────────────────────────────────────────────────────
  useEffect(() => {
    const cx = wRef.current / 2, cy = hRef.current / 2
    const r  = Math.min(cx, cy) * 0.65

    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const angle = (i / data.nodes.length) * Math.PI * 2
      const jitter = 0.4 + Math.random() * 0.6
      return {
        ...n,
        x: cx + Math.cos(angle) * r * jitter,
        y: cy + Math.sin(angle) * r * jitter,
        vx: 0, vy: 0
      }
    })

    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    const adj = new Map<string, Set<string>>()
    for (const e of data.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set())
      if (!adj.has(e.target)) adj.set(e.target, new Set())
      adj.get(e.source)!.add(e.target)
      adj.get(e.target)!.add(e.source)
    }

    nodesRef.current   = nodes
    nodeMapRef.current = nodeMap
    adjRef.current     = adj
    alphaRef.current   = 1
    hoveredRef.current = null
    setTooltip(null)
  }, [data])

  // ── Simulation tick ───────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const nodes = nodesRef.current
    const alpha = alphaRef.current
    if (alpha < ALPHA_MIN || nodes.length === 0) return

    const { repulsion, springK, springLen, gravity } = forcesRef.current
    const cx = wRef.current / 2, cy = hRef.current / 2

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        const dx = b.x - a.x, dy = b.y - a.y
        const dist2 = dx * dx + dy * dy + 1
        const dist  = Math.sqrt(dist2)
        const force = (repulsion / dist2) * alpha
        const fx = force * dx / dist, fy = force * dy / dist
        a.vx -= fx; a.vy -= fy
        b.vx += fx; b.vy += fy
      }
    }

    const nodeMap = nodeMapRef.current
    for (const edge of data.edges) {
      const a = nodeMap.get(edge.source), b = nodeMap.get(edge.target)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const dist  = Math.sqrt(dx * dx + dy * dy) + 0.01
      const force = springK * (dist - springLen) * alpha
      const fx = force * dx / dist, fy = force * dy / dist
      a.vx += fx; a.vy += fy
      b.vx -= fx; b.vy -= fy
    }

    for (const n of nodes) {
      if (n.fx !== undefined) { n.x = n.fx; n.vx = 0 }
      if (n.fy !== undefined) { n.y = n.fy; n.vy = 0 }
      if (n.fx === undefined) {
        n.vx += (cx - n.x) * gravity * alpha
        n.vx *= DAMPING
        n.x += n.vx
      }
      if (n.fy === undefined) {
        n.vy += (cy - n.y) * gravity * alpha
        n.vy *= DAMPING
        n.y += n.vy
      }
    }

    alphaRef.current *= (1 - ALPHA_DECAY)
  }, [data.edges])

  // ── Draw frame ────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = wRef.current, H = hRef.current
    const { x: tx, y: ty, s } = tRef.current
    const nodes   = nodesRef.current
    const nodeMap = nodeMapRef.current
    const adj     = adjRef.current
    const hov     = hoveredRef.current
    const hovAdj  = hov ? (adj.get(hov.id) ?? new Set<string>()) : new Set<string>()
    const hasHov  = hov !== null

    // Background
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)

    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(s, s)

    // ── Edges ───────────────────────────────────────────────────────────────
    for (const edge of data.edges) {
      const a = nodeMap.get(edge.source), b = nodeMap.get(edge.target)
      if (!a || !b) continue

      const isHovEdge = hasHov && (edge.source === hov!.id || edge.target === hov!.id)

      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)

      if (isHovEdge) {
        ctx.strokeStyle = EDGE_HOV
        ctx.lineWidth   = 1.5 / s
        ctx.globalAlpha = 1
      } else if (hasHov) {
        ctx.strokeStyle = EDGE_DIM
        ctx.lineWidth   = 0.8 / s
        ctx.globalAlpha = 1
      } else {
        ctx.strokeStyle = EDGE_NORMAL
        ctx.lineWidth   = 1 / s
        ctx.globalAlpha = 1
      }
      ctx.stroke()
    }

    // ── Nodes ───────────────────────────────────────────────────────────────
    ctx.globalAlpha = 1
    for (const n of nodes) {
      const isHov = hov?.id === n.id
      const isCon = hasHov ? hovAdj.has(n.id) : false
      const isDim = hasHov && !isHov && !isCon
      const r     = nodeRadius(n.linkCount) / s
      const isHub = n.linkCount >= 5

      ctx.shadowBlur  = 0
      ctx.shadowColor = 'transparent'

      let fill: string
      if (isHov) {
        fill = NODE_HOV
        ctx.shadowColor = '#9d8fff'
        ctx.shadowBlur  = 18 / s
      } else if (isCon) {
        fill = NODE_CON
        ctx.shadowColor = '#9d8fff'
        ctx.shadowBlur  = 8 / s
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
      ctx.shadowBlur  = 0

      // Subtle ring for hub / hovered / connected nodes
      if ((isHub || isHov || isCon) && !isDim) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, r + 1.2 / s, 0, Math.PI * 2)
        ctx.strokeStyle = isHov ? 'rgba(200,190,255,0.7)' : 'rgba(155,145,210,0.4)'
        ctx.lineWidth   = 0.8 / s
        ctx.stroke()
      }

      // ── Label ─────────────────────────────────────────────────────────────
      const showLabel = isHov || isCon || (n.linkCount >= 3 && !isDim) || (s > 1.2 && !isDim)
      if (showLabel) {
        const fs  = Math.max(9, 11 / s)
        const lx  = n.x + r + 4 / s
        const ly  = n.y + fs * 0.37

        ctx.font      = `${fs}px Inter, system-ui, sans-serif`
        ctx.fillStyle = isHov ? LABEL_BRIGHT : (isCon ? 'rgba(200,190,255,0.9)' : LABEL_DIM)
        ctx.fillText(n.title, lx, ly)
      }
    }

    ctx.restore()
  }, [data.edges])

  // ── RAF loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let running = true
    const loop = () => {
      if (!running) return
      tick()
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { running = false; cancelAnimationFrame(rafRef.current) }
  }, [tick, draw])

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const toWorld = (sx: number, sy: number) => {
    const { x, y, s } = tRef.current
    return { wx: (sx - x) / s, wy: (sy - y) / s }
  }

  const hitTest = (wx: number, wy: number): SimNode | null => {
    let best: SimNode | null = null, bestD = 20 / tRef.current.s
    for (const n of nodesRef.current) {
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
      inter.node.x  = wx; inter.node.y  = wy
      alphaRef.current = Math.max(alphaRef.current, 0.25)
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
    if (interRef.current.node) {
      interRef.current.node.fx = undefined
      interRef.current.node.fy = undefined
    }
    interRef.current = { mode: 'none', node: null, sx0: 0, sy0: 0, tx0: 0, ty0: 0 }
    const { wx, wy } = toWorld(0, 0)
    const found = hitTest(wx, wy)
    setCursor(found ? 'grab' : 'default')
  }, [])

  const handleLeave = useCallback(() => {
    if (interRef.current.node) {
      interRef.current.node.fx = undefined
      interRef.current.node.fy = undefined
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
    alphaRef.current = 0.5
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

      {/* Forces panel — top-right */}
      <div
        className="absolute top-3 right-3"
        style={{ pointerEvents: 'auto', zIndex: 10 }}
      >
        {/* Toggle button */}
        <button
          onClick={() => setPanelOpen(o => !o)}
          title="Simulation forces"
          style={{
            width: 30, height: 30, borderRadius: 7,
            border: `1px solid ${panelOpen ? 'rgba(160,145,255,0.55)' : 'rgba(140,130,200,0.25)'}`,
            background: panelOpen ? 'rgba(50,40,80,0.92)' : 'rgba(25,22,40,0.88)',
            color: panelOpen ? 'rgba(210,200,255,0.95)' : 'rgba(200,195,235,0.80)',
            fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', backdropFilter: 'blur(6px)',
            marginLeft: 'auto'
          }}
        >
          ⚙
        </button>

        {/* Panel */}
        {panelOpen && (
          <div
            style={{
              marginTop: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(140,130,200,0.30)',
              background: 'rgba(18,15,32,0.94)',
              backdropFilter: 'blur(8px)',
              width: 210,
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: 10
            }}
          >
            {([
              { key: 'gravity',   label: 'Center force', min: 0, max: 0.12, step: 0.002, fmt: (v: number) => v.toFixed(3) },
              { key: 'repulsion', label: 'Repel force',  min: 200, max: 12000, step: 100, fmt: (v: number) => String(Math.round(v)) },
              { key: 'springK',   label: 'Link force',   min: 0, max: 0.3, step: 0.005, fmt: (v: number) => v.toFixed(3) },
              { key: 'springLen', label: 'Link distance',min: 10, max: 400, step: 5,  fmt: (v: number) => String(Math.round(v)) },
            ] as Array<{ key: keyof Forces; label: string; min: number; max: number; step: number; fmt: (v: number) => string }>).map(({ key, label, min, max, step, fmt }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, color: 'rgba(185,178,225,0.85)', fontFamily: 'Inter, system-ui, sans-serif' }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 10, color: 'rgba(145,138,195,0.70)', fontFamily: 'monospace' }}>
                    {fmt(forces[key])}
                  </span>
                </div>
                <input
                  type="range"
                  min={min} max={max} step={step}
                  value={forces[key]}
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
                alphaRef.current = Math.max(alphaRef.current, 0.4)
              }}
              style={{
                marginTop: 2, padding: '4px 0', borderRadius: 5, fontSize: 11,
                border: '1px solid rgba(120,110,180,0.30)',
                background: 'rgba(45,38,70,0.60)',
                color: 'rgba(175,165,225,0.80)',
                cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif'
              }}
            >
              Reset to defaults
            </button>
          </div>
        )}
      </div>

      {/* Zoom controls — Obsidian-style bottom-right */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5" style={{ pointerEvents: 'auto' }}>
        {[
          { label: '+', action: () => zoomBy(1.25) },
          { label: '−', action: () => zoomBy(0.8) },
          { label: '⊙', action: handleReset },
        ].map(btn => (
          <button
            key={btn.label}
            onClick={btn.action}
            style={{
              width: 30, height: 30, borderRadius: 7,
              border: '1px solid rgba(140, 130, 200, 0.25)',
              background: 'rgba(25, 22, 40, 0.88)',
              color: 'rgba(200, 195, 235, 0.80)',
              fontSize: btn.label === '⊙' ? 13 : 18, fontWeight: 300,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(6px)', transition: 'border-color 0.15s, color 0.15s'
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(160,145,255,0.55)'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(225,220,255,0.95)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(140,130,200,0.25)'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(200,195,235,0.80)'
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(tooltip.x + 14, width - 220),
            top: Math.max(tooltip.y - 36, 8),
            padding: '5px 11px',
            borderRadius: 6,
            background: 'rgba(16, 14, 26, 0.94)',
            border: '1px solid rgba(140, 125, 255, 0.35)',
            color: '#d4cfff',
            fontSize: 12,
            fontFamily: 'Inter, system-ui, sans-serif',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)'
          }}
        >
          <div style={{ fontWeight: 500 }}>{tooltip.title}</div>
          {tooltip.path !== tooltip.title + '.md' && (
            <div style={{ fontSize: 10, color: 'rgba(160,150,210,0.6)', marginTop: 2 }}>
              {tooltip.path}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
