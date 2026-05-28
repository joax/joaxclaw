import { useEffect, useRef, useState } from 'react'
import { Wifi, WifiOff, Heart, Cpu, MemoryStick, ChevronUp } from 'lucide-react'
import { useConnectionStore } from '../../store/connection'
import { useMetricsStore } from '../../store/metrics'
import { useSettingsStore } from '../../store/settings'
import { formatBytes } from '../../lib/ollama'

export function StatusBar() {
  const { status, lastHeartbeat, heartbeats, uptimeStart } = useConnectionStore()
  const { metrics, ollamaModels, activeModel } = useMetricsStore()
  const { showGpu, showRam, showHeartbeat, showModelName, toggleMonitor, monitorVisible } = useSettingsStore()
  const [hbPulse, setHbPulse] = useState(false)
  const [uptime, setUptime] = useState('')
  const prevHb = useRef<number | null>(null)

  // Heartbeat pulse animation
  useEffect(() => {
    if (lastHeartbeat && lastHeartbeat !== prevHb.current) {
      prevHb.current = lastHeartbeat
      setHbPulse(true)
      setTimeout(() => setHbPulse(false), 600)
    }
  }, [lastHeartbeat])

  // Uptime counter
  useEffect(() => {
    const id = setInterval(() => {
      if (!uptimeStart) { setUptime(''); return }
      const s = Math.floor((Date.now() - uptimeStart) / 1000)
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      setUptime(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`)
    }, 1000)
    return () => clearInterval(id)
  }, [uptimeStart])

  const hbAgo = lastHeartbeat ? Math.round((Date.now() - lastHeartbeat) / 1000) : null
  const hbLate = hbAgo !== null && hbAgo > 40
  const gpu = metrics?.gpu?.[0]

  const statusColor = status === 'connected' ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--danger)'

  return (
    <div
      className="flex items-center gap-4 px-3 shrink-0 text-xs"
      style={{
        height: 28,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        color: 'var(--text-secondary)'
      }}
    >
      {/* Connection */}
      <div className="flex items-center gap-1.5">
        {status === 'connected'
          ? <Wifi size={11} style={{ color: 'var(--success)' }} />
          : <WifiOff size={11} style={{ color: 'var(--danger)' }} />
        }
        <span style={{ color: statusColor }}>
          {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
        </span>
        {uptime && (
          <span className="opacity-50" style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', minWidth: '4ch' }}>
            · {uptime}
          </span>
        )}
      </div>

      <Divider />

      {/* Heartbeat */}
      {showHeartbeat && (
        <>
          <div className="flex items-center gap-1.5">
            <Heart
              size={11}
              className={hbPulse ? 'animate-heartbeat' : ''}
              style={{ color: hbLate ? 'var(--warning)' : status === 'connected' ? 'var(--success)' : 'var(--border)' }}
            />
            <HeartbeatSparkline beats={heartbeats} />
            {hbAgo !== null && (
              <span style={{ color: hbLate ? 'var(--warning)' : undefined, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', minWidth: '4ch' }}>
                {hbAgo}s ago
              </span>
            )}
          </div>
          <Divider />
        </>
      )}

      {/* Model */}
      {showModelName && (
        <>
          <div className="flex items-center gap-1">
            <span className="opacity-50">model</span>
            <span style={{ color: 'var(--text-primary)' }}>
              {activeModel ?? ollamaModels[0]?.name ?? '—'}
            </span>
          </div>
          <Divider />
        </>
      )}

      {/* GPU */}
      {showGpu && gpu && (
        <>
          <div className="flex items-center gap-1.5">
            <Cpu size={11} />
            <MiniMeter value={gpu.utilizationGpu} color="var(--accent)" />
            <span>{gpu.utilizationGpu}%</span>
            {gpu.memTotal > 0 && (
              <span className="opacity-50">
                {formatBytes(gpu.memUsed * 1024 * 1024)}/{formatBytes(gpu.memTotal * 1024 * 1024)} VRAM
              </span>
            )}
          </div>
          <Divider />
        </>
      )}

      {/* RAM */}
      {showRam && metrics && (
        <>
          <div className="flex items-center gap-1.5">
            <MemoryStick size={11} />
            <MiniMeter
              value={Math.round((metrics.ramUsed / metrics.ramTotal) * 100)}
              color="var(--success)"
            />
            <span>
              {formatBytes(metrics.ramUsed)}/{formatBytes(metrics.ramTotal)}
            </span>
          </div>
          <Divider />
        </>
      )}

      {/* Expand monitor */}
      <button
        onClick={toggleMonitor}
        title="Toggle system monitor"
        className="ml-auto flex items-center gap-1 transition-opacity hover:opacity-100 opacity-60"
        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11 }}
      >
        <ChevronUp size={11} style={{ transform: monitorVisible ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
        Monitor
      </button>
    </div>
  )
}

function Divider() {
  return <span style={{ color: 'var(--border)', userSelect: 'none' }}>│</span>
}

function MiniMeter({ value, color }: { value: number; color: string }) {
  return (
    <div className="meter" style={{ width: 40 }}>
      <div className="meter-fill" style={{ width: `${Math.min(100, value)}%`, background: color }} />
    </div>
  )
}

function HeartbeatSparkline({ beats }: { beats: { time: number; ok: boolean }[] }) {
  const last = beats.slice(-12)
  return (
    <div className="flex items-center gap-px">
      {Array.from({ length: 12 }, (_, i) => {
        const beat = last[i]
        return (
          <div
            key={i}
            style={{
              width: 4, height: 8,
              borderRadius: 1,
              background: beat ? (beat.ok ? 'var(--success)' : 'var(--danger)') : 'var(--border)',
              opacity: beat ? 1 : 0.3
            }}
          />
        )
      })}
    </div>
  )
}
