import { useEffect, useRef, useState } from 'react'
import { useTalkStore, type TalkPhase, type VisualizerStyle } from '../../store/talk'
import { FREQ_BINS } from '../../lib/talkAudio'

// Talk visualizers — all driven by the same inputs (conversation phase, RMS level, and
// live FFT bins for bars/radial). No WebGL, so they're immune to the Electron GPU
// fallback. The audio source switches mic↔agent by phase (handled by the caller).

export type VizSource = 'mic' | 'agent' | 'idle'

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
function colorForPhase(phase: TalkPhase): string {
  switch (phase) {
    case 'speaking': return cssVar('--success', '#22c55e')
    case 'thinking':
    case 'tool_running': return '#a855f7'
    case 'error': return cssVar('--danger', '#ef4444')
    case 'idle': return cssVar('--text-secondary', '#94a3b8')
    default: return cssVar('--accent', '#6366f1')
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(m.matches); on(); m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

export function Visualizer(props: { style: VisualizerStyle; phase: TalkPhase; level: number; source: VizSource; onInterrupt: () => void }) {
  const interactive = props.phase === 'speaking'
  const wrap = (node: React.ReactNode) => (
    <button onClick={() => interactive && props.onInterrupt()} title={interactive ? 'Tap to interrupt' : undefined}
      style={{ background: 'none', border: 'none', padding: 0, cursor: interactive ? 'pointer' : 'default', lineHeight: 0 }}>
      {node}
    </button>
  )
  if (props.style === 'bars') return wrap(<Bars phase={props.phase} source={props.source} />)
  if (props.style === 'radial') return wrap(<Radial phase={props.phase} level={props.level} source={props.source} />)
  if (props.style === 'blob') return wrap(<Blob phase={props.phase} level={props.level} />)
  return wrap(<Orb phase={props.phase} level={props.level} />)
}

// ── Orb (CSS) ───────────────────────────────────────────────────────────────────

function Orb({ phase, level }: { phase: TalkPhase; level: number }) {
  const reduced = usePrefersReducedMotion()
  const smooth = useRef(0)
  const [, force] = useState(0)
  useEffect(() => {
    let raf = 0
    const tick = () => { smooth.current += (level - smooth.current) * 0.25; force(n => (n + 1) & 1023); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [level])
  const breathing = reduced || phase === 'idle' ? 0 : (Math.sin(Date.now() / 700) + 1) / 2 * 0.06
  const scale = 1 + smooth.current * 0.5 + (phase === 'thinking' || phase === 'tool_running' ? breathing * 2 : breathing)
  const color = colorForPhase(phase)
  return (
    <div style={{
      width: 160, height: 160, borderRadius: '50%', transform: `scale(${scale})`, transition: 'transform 0.05s linear',
      background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${color} 85%, white), ${color} 60%, color-mix(in srgb, ${color} 60%, transparent))`,
      boxShadow: `0 0 ${12 + smooth.current * 60}px color-mix(in srgb, ${color} 70%, transparent)`,
      opacity: phase === 'idle' ? 0.5 : 1,
    }} />
  )
}

// ── shared canvas driver ─────────────────────────────────────────────────────────

// Runs a rAF loop, keeps the latest props in refs, hands the draw fn (ctx, freq[0..1],
// level, t) each frame. Returns a canvas sized at `size` (logical px, DPR-scaled).
function useCanvasViz(
  size: { w: number; h: number },
  deps: { phase: TalkPhase; source: VizSource; level?: number },
  draw: (ctx: CanvasRenderingContext2D, freq: Float32Array, level: number, t: number, phase: TalkPhase) => void,
) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef(deps); state.current = deps
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size.w * dpr; canvas.height = size.h * dpr
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.scale(dpr, dpr)
    const bins = new Uint8Array(FREQ_BINS)
    const norm = new Float32Array(FREQ_BINS)
    let raf = 0
    const tick = (t: number) => {
      const { phase, source } = state.current
      ctx.clearRect(0, 0, size.w, size.h)
      const got = source !== 'idle' && useTalkStore.getState().fillFrequencies(source === 'agent' ? 'agent' : 'mic', bins)
      // Real FFT when audio is flowing; a soft synthetic shape otherwise (idle/thinking).
      const synth = !got || phase === 'thinking' || phase === 'tool_running'
      for (let i = 0; i < FREQ_BINS; i++) {
        norm[i] = synth
          ? (Math.sin(t / 380 + i * 0.5) * 0.5 + 0.5) * (phase === 'thinking' || phase === 'tool_running' ? 0.5 : 0.12)
          : bins[i] / 255
      }
      draw(ctx, norm, state.current.level ?? 0, t, phase)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [size.w, size.h])  // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}

// ── Bars / equalizer ─────────────────────────────────────────────────────────────

function Bars({ phase, source }: { phase: TalkPhase; source: VizSource }) {
  const N = 28
  const ref = useCanvasViz({ w: 260, h: 130 }, { phase, source }, (ctx, freq, _l, _t) => {
    const color = colorForPhase(phase)
    const bw = 260 / N
    for (let i = 0; i < N; i++) {
      // Sample across the lower 3/4 of the spectrum (where voice energy sits).
      const v = freq[Math.floor((i / N) * FREQ_BINS * 0.75)]
      const h = Math.max(3, v * 120)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.35 + v * 0.65
      const x = i * bw + bw * 0.15, w = bw * 0.7
      roundRect(ctx, x, 130 - h, w, h, w / 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  })
  return <canvas ref={ref} style={{ width: 260, height: 130 }} />
}

// ── Radial spectrum ──────────────────────────────────────────────────────────────

function Radial({ phase, level, source }: { phase: TalkPhase; level: number; source: VizSource }) {
  const N = 56
  const ref = useCanvasViz({ w: 220, h: 220 }, { phase, source, level }, (ctx, freq, lvl) => {
    const color = colorForPhase(phase)
    const cx = 110, cy = 110, r0 = 42
    // Glowing core reacts to level.
    const cr = r0 - 8 + lvl * 12
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr)
    g.addColorStop(0, color); g.addColorStop(1, 'transparent')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill()
    // Radiating bars.
    ctx.strokeStyle = color; ctx.lineCap = 'round'
    for (let i = 0; i < N; i++) {
      const v = freq[Math.floor((i / N) * FREQ_BINS * 0.8)]
      const len = 6 + v * 56
      const a = (i / N) * Math.PI * 2
      ctx.globalAlpha = 0.4 + v * 0.6
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  })
  return <canvas ref={ref} style={{ width: 220, height: 220 }} />
}

// ── Blob (SVG morph) ─────────────────────────────────────────────────────────────

function Blob({ phase, level }: { phase: TalkPhase; level: number }) {
  const pathRef = useRef<SVGPathElement>(null)
  const smooth = useRef(0)
  const state = useRef({ phase, level }); state.current = { phase, level }
  useEffect(() => {
    let raf = 0
    const tick = (t: number) => {
      smooth.current += (state.current.level - smooth.current) * 0.2
      const p = pathRef.current
      if (p) p.setAttribute('d', blobPath(110, 110, 70, t, smooth.current, state.current.phase))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [])
  const color = colorForPhase(phase)
  return (
    <svg width={220} height={220} viewBox="0 0 220 220" style={{ filter: `drop-shadow(0 0 14px color-mix(in srgb, ${color} 55%, transparent))`, opacity: phase === 'idle' ? 0.6 : 1 }}>
      <defs>
        <radialGradient id="talk-blob" cx="38%" cy="32%">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--bg-primary) 0%, white)" stopOpacity="0.85" />
          <stop offset="55%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity="0.65" />
        </radialGradient>
      </defs>
      <path ref={pathRef} fill="url(#talk-blob)" />
    </svg>
  )
}

// Closed blob path via a few low-frequency sine lobes that wobble over time + level.
function blobPath(cx: number, cy: number, base: number, t: number, level: number, phase: TalkPhase): string {
  const pts = 8
  const amp = base * (0.12 + level * 0.32) + (phase === 'thinking' || phase === 'tool_running' ? Math.sin(t / 300) * 4 : 0)
  const speed = t / 900
  const pos: [number, number][] = []
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2
    const r = base + Math.sin(a * 3 + speed) * amp * 0.5 + Math.cos(a * 2 - speed * 1.3) * amp * 0.5
    pos.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  // Catmull-Rom → cubic Bézier for a smooth closed loop.
  let d = `M ${pos[0][0].toFixed(1)} ${pos[0][1].toFixed(1)} `
  for (let i = 0; i < pts; i++) {
    const p0 = pos[(i - 1 + pts) % pts], p1 = pos[i], p2 = pos[(i + 1) % pts], p3 = pos[(i + 2) % pts]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `
  }
  return d + 'Z'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
