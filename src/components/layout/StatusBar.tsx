import { useEffect, useRef, useState } from 'react'
import { Wifi, WifiOff, Heart, Cpu, MemoryStick, ChevronUp, Globe, HardDrive } from 'lucide-react'
import { ModelIcon } from '../ui/ModelIcon'
import { useConnectionStore, useIsRemoteGateway, useConnectionSignal } from '../../store/connection'
import type { ConnectionSignal } from '../../lib/connectionSignal'
import { useMetricsStore } from '../../store/metrics'
import { useSettingsStore } from '../../store/settings'
import { useSessionsStore } from '../../store/sessions'
import { useChatStore } from '../../store/chat'
import { useModelsStore } from '../../store/models'
import { useHelpStore } from '../../store/help'
import { formatBytes } from '../../lib/ollama'

export function StatusBar() {
  const { status, lastHeartbeat, heartbeats, uptimeStart } = useConnectionStore()
  const remoteGateway = useIsRemoteGateway()
  const signal = useConnectionSignal()
  const openHelp = useHelpStore(s => s.openHelp)
  const { metrics, ollamaModels, activeModel } = useMetricsStore()
  const { showGpu, showRam, showHeartbeat, showModelName, toggleMonitor, monitorVisible } = useSettingsStore()
  const sessions = useSessionsStore(s => s.sessions)
  const { conversations, activeConvId } = useChatStore()
  const providers = useModelsStore(s => s.providers)
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

  // Most accurate model: last assistant message's model field → session config → Ollama metrics
  const activeConv = conversations.find(c => c.id === activeConvId)
  const lastAssistantModel = activeConv?.messages.findLast(m => m.role === 'assistant' && m.model)?.model
  const activeConvSession = activeConv?.sessionKey ? sessions.find(s => s.key === activeConv.sessionKey) : undefined
  const sessionModel = activeConvSession?.model
    ? (activeConvSession.modelProvider ? `${activeConvSession.modelProvider}/${activeConvSession.model}` : activeConvSession.model)
    : undefined

  // If the message model has no provider prefix, find which provider owns it
  function resolveModel(raw: string): string {
    if (raw.includes('/')) return raw
    for (const [pid, p] of Object.entries(providers)) {
      if (p.models.some(m => m.id === raw)) return `${pid}/${raw}`
    }
    return raw
  }

  const displayModel = lastAssistantModel
    ? resolveModel(lastAssistantModel)
    : (sessionModel ?? activeModel ?? ollamaModels[0]?.name ?? '—')
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
        {status === 'connected' && (
          <button
            onClick={() => openHelp('gateways')}
            title={`${remoteGateway ? 'Remote' : 'Local'} gateway — tap for the difference`}
            className="flex items-center gap-1 transition-opacity hover:opacity-100"
            style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: 0, opacity: 0.85,
              color: remoteGateway ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <span className="opacity-40" style={{ color: 'var(--text-secondary)' }}>·</span>
            {remoteGateway ? <Globe size={11} /> : <HardDrive size={11} />}
            <span>{remoteGateway ? 'Remote' : 'Local'}</span>
          </button>
        )}
        {status === 'connected' && (
          <>
            <span className="opacity-40" style={{ color: 'var(--text-secondary)' }}>·</span>
            <SignalIndicator signal={signal} />
          </>
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
          <div className="flex items-center gap-1.5">
            <ModelIcon model={displayModel} size={11} />
            <span style={{ color: 'var(--text-primary)' }}>
              {displayModel}
            </span>
          </div>
          <Divider />
        </>
      )}

      {/* GPU — hidden when the gateway is remote (these are the client's stats) */}
      {showGpu && gpu && !remoteGateway && (
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

      {/* RAM — hidden when the gateway is remote (these are the client's stats) */}
      {showRam && metrics && !remoteGateway && (
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

// Wifi-style strength bars for the gateway connection. Color follows the rating;
// the tooltip surfaces the underlying round-trip latency and any packet loss.
function SignalIndicator({ signal }: { signal: ConnectionSignal }) {
  const color =
    signal.level === 'excellent' || signal.level === 'good' ? 'var(--success)'
    : signal.level === 'fair' ? 'var(--warning)'
    : signal.level === 'poor' ? 'var(--danger)'
    : 'var(--text-secondary)'

  const title = [
    `Connection: ${signal.label}`,
    signal.rtt !== null ? `${signal.rtt}ms round-trip` : signal.level === 'measuring' ? 'measuring…' : null,
    signal.loss > 0 ? `${Math.round(signal.loss * 100)}% loss` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center gap-1.5" title={title}>
      <div className="flex items-end gap-px" style={{ height: 11 }}>
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            style={{
              width: 3,
              height: 3 + i * 2.5,
              borderRadius: 1,
              background: i < signal.bars ? color : 'var(--border)',
              opacity: i < signal.bars ? 1 : 0.4,
            }}
          />
        ))}
      </div>
      {signal.rtt !== null && (
        <span style={{ color, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', minWidth: '5ch' }}>
          {signal.rtt}ms
        </span>
      )}
    </div>
  )
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
