import { useEffect, useRef, useState } from 'react'
import { Square, CheckCircle2, XCircle, Loader2, Clock, Activity, Terminal, Users, Heart } from 'lucide-react'
import type { ProcessDef, GraphNode } from '../../lib/processParser'
import type { ProcessRun } from '../../store/processes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fileApi = () => (window as any)?.api?.file as {
  read: (path: string) => Promise<{ ok: boolean; text?: string }>
} | null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const homedir = (): string => (window as any)?.api?.system?.homedir ?? '~'

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Derive ordered execution steps from the graph (non-start, non-end nodes sorted by x position)
function getOrderedSteps(def: ProcessDef): GraphNode[] {
  if (!def.graph) return []
  return def.graph.nodes
    .filter(n => n.type !== 'start' && n.type !== 'end')
    .sort((a, b) => a.position.x - b.position.x)
}

interface WatchdogState {
  healthy?: boolean
  lastCheck?: number
  message?: string
  stalledAgents?: string[]
}

interface Props {
  def: ProcessDef
  run?: ProcessRun
  onStop: () => void
}

export function ProcessMonitor({ def, run, onStop }: Props) {
  const logEndRef   = useRef<HTMLDivElement>(null)
  const [watchdog, setWatchdog] = useState<WatchdogState | null>(null)
  const [stopping,  setStopping] = useState(false)

  // Auto-scroll activity log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [run?.log.length])

  // Poll watchdog state file
  useEffect(() => {
    const readWatchdog = async () => {
      const api = fileApi()
      if (!api) return
      const path = `${homedir()}/.openclaw/state/orchestrator/watchdog.json`
      const res = await api.read(path)
      if (!res.ok || !res.text) return
      try { setWatchdog(JSON.parse(res.text)) } catch { /* ignore */ }
    }
    readWatchdog()
    const interval = setInterval(readWatchdog, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleStop = async () => {
    setStopping(true)
    onStop()
    setTimeout(() => setStopping(false), 2000)
  }

  const steps   = getOrderedSteps(def)
  const elapsed = run ? (run.finishedAt ?? Date.now()) - run.startedAt : 0
  const isRunning = run?.status === 'running'

  // Status colours
  const statusColor = run?.status === 'done' ? 'var(--success)'
    : run?.status === 'error' ? 'var(--danger)'
    : run?.status === 'running' ? 'var(--accent)'
    : 'var(--text-secondary)'

  const StatusIcon = run?.status === 'done' ? CheckCircle2
    : run?.status === 'error' ? XCircle
    : run?.status === 'running' ? Loader2
    : Clock

  const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }
  const sectionHead: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
    color: 'var(--text-secondary)', marginBottom: 6,
  }

  if (!run) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-secondary)' }}>
        <Activity size={32} style={{ opacity: 0.2 }} />
        <p style={{ fontSize: 13 }}>Not yet run</p>
        <p style={{ fontSize: 11, opacity: 0.6 }}>Select a controller agent and press Run to start.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>

      {/* Status banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: `color-mix(in srgb, ${statusColor} 6%, var(--bg-surface))`, flexShrink: 0 }}>
        <StatusIcon size={14} style={{ color: statusColor, flexShrink: 0 }} className={isRunning ? 'animate-spin' : ''} />
        <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>
          {run.status === 'running' ? 'Running' : run.status === 'done' ? 'Completed' : run.status === 'error' ? 'Failed' : 'Stopped'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {isRunning ? `${fmtDuration(elapsed)} elapsed` : `in ${fmtDuration(elapsed)}`}
        </span>
        {run.currentAgent && isRunning && (
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            › {run.currentAgent}
          </span>
        )}
        {run.error && (
          <span style={{ fontSize: 11, color: 'var(--danger)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.error}
          </span>
        )}
        {isRunning && (
          <button
            onClick={handleStop} disabled={stopping}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', fontSize: 11, borderRadius: 'var(--radius)', border: '1px solid var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', cursor: stopping ? 'default' : 'pointer', opacity: stopping ? 0.6 : 1, flexShrink: 0 }}>
            <Square size={11} /> {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>

      {/* Main columns */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left: Team Progress + Watchdog */}
        <div style={{ width: 220, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>

          {/* Team Progress */}
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)', flex: '0 0 auto', maxHeight: '55%', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <Users size={10} style={{ color: 'var(--text-secondary)' }} />
              <span style={sectionHead}>Team Progress</span>
            </div>
            {steps.length === 0 ? (
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.5 }}>No steps defined</p>
            ) : steps.map((node, i) => {
              const isDone   = i < run.stepsDone
              const isActive = isRunning && i === run.stepsDone
              const nodeColor = node.type === 'handoff' ? '#f59e0b' : node.type === 'review' ? '#8b5cf6' : undefined
              const stepColor = isDone ? 'var(--success)' : isActive ? 'var(--accent)' : 'var(--border)'
              return (
                <div key={node.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 6 }}>
                  <div style={{ width: 14, height: 14, borderRadius: node.type === 'handoff' ? 2 : '50%', border: `2px solid ${stepColor}`, background: isDone ? stepColor : 'transparent', flexShrink: 0, marginTop: 1 }}>
                    {isDone && <CheckCircle2 size={10} style={{ color: 'var(--bg-surface)', margin: '0 auto', display: 'block', marginTop: 0 }} />}
                    {isActive && <Loader2 size={10} style={{ color: 'var(--accent)', margin: '0 auto', display: 'block' }} className="animate-spin" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: nodeColor ?? (isDone ? 'var(--text-secondary)' : isActive ? 'var(--text-primary)' : 'var(--text-secondary)'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.type === 'handoff' ? '◇ Handoff' : node.type === 'review' ? '⬡ Review' : (node.agentId ?? node.id)}
                    </div>
                    {node.task && (
                      <div style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {node.task}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Watchdog */}
          <div style={{ padding: '10px 12px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <Heart size={10} style={{ color: 'var(--text-secondary)' }} />
              <span style={sectionHead}>Watchdog</span>
            </div>
            {watchdog ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: watchdog.healthy ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: watchdog.healthy ? 'var(--success)' : 'var(--danger)' }}>
                    {watchdog.healthy ? 'Healthy' : 'Alert'}
                  </span>
                </div>
                {watchdog.lastCheck && (
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.6 }}>
                    Last check: {fmtTime(watchdog.lastCheck)}
                  </div>
                )}
                {watchdog.message && (
                  <div style={{ fontSize: 10, color: watchdog.healthy ? 'var(--text-secondary)' : 'var(--danger)', marginTop: 4, lineHeight: 1.4 }}>
                    {watchdog.message}
                  </div>
                )}
                {watchdog.stalledAgents && watchdog.stalledAgents.length > 0 && (
                  <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 'var(--radius)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--danger)', marginBottom: 3 }}>STALLED</div>
                    {watchdog.stalledAgents.map(a => (
                      <div key={a} style={{ fontSize: 10, color: 'var(--danger)', fontFamily: 'monospace' }}>{a}</div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.4 }}>Not running</p>
            )}
          </div>
        </div>

        {/* Right: Output + Activity Log */}
        <div style={{ ...col, padding: 12, overflow: 'hidden' }}>

          {/* Streaming output */}
          {(run.outputBuffer || isRunning) && (
            <div style={{ flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <Terminal size={10} style={{ color: 'var(--text-secondary)' }} />
                <span style={sectionHead}>Current Output</span>
                {isRunning && <span style={{ fontSize: 9, color: 'var(--accent)' }}>● live</span>}
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto', padding: '8px 10px', borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {run.outputBuffer || <span style={{ opacity: 0.4 }}>Waiting for output…</span>}
              </div>
            </div>
          )}

          {/* Activity log */}
          <div style={{ ...col, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <Activity size={10} style={{ color: 'var(--text-secondary)' }} />
              <span style={sectionHead}>Activity Log</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {run.log.length === 0 ? (
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.4 }}>No activity yet</p>
              ) : run.log.map((entry, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.4 }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.5, flexShrink: 0, fontSize: 10 }}>
                    {fmtTime(entry.ts)}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{entry.text}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
