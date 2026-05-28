import { Heart, X, Cpu, MemoryStick, Monitor } from 'lucide-react'
import { useConnectionStore } from '../../store/connection'
import { useMetricsStore } from '../../store/metrics'
import { useSettingsStore } from '../../store/settings'
import { formatBytes } from '../../lib/ollama'

export function SystemMonitorHUD() {
  const { status, heartbeats, lastHeartbeat, uptimeStart } = useConnectionStore()
  const { metrics, ollamaModels } = useMetricsStore()
  const { toggleMonitor } = useSettingsStore()

  const gpu = metrics?.gpu?.[0]
  const hbAgo = lastHeartbeat ? Math.round((Date.now() - lastHeartbeat) / 1000) : null
  const uptime = uptimeStart ? formatUptime(Date.now() - uptimeStart) : null

  return (
    <div
      className="animate-fade-in"
      style={{
        width: 280,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <Monitor size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>System Monitor</span>
        <button onClick={toggleMonitor} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}>
          <X size={13} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Gateway */}
        <Section label="Gateway">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{
              background: status === 'connected' ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--danger)'
            }} />
            <span className="text-xs" style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{status}</span>
            {uptime && <span className="text-xs ml-auto" style={{ color: 'var(--text-secondary)' }}>up {uptime}</span>}
          </div>
        </Section>

        {/* Heartbeat */}
        <Section label="Heartbeat">
          <div className="flex items-center gap-2 mb-1.5">
            <Heart size={11} style={{ color: status === 'connected' ? 'var(--success)' : 'var(--border)' }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {hbAgo !== null ? `${hbAgo}s ago` : 'No beats yet'}
            </span>
          </div>
          <div className="flex items-end gap-0.5">
            {Array.from({ length: 20 }, (_, i) => {
              const beat = heartbeats[heartbeats.length - 20 + i]
              return (
                <div
                  key={i}
                  style={{
                    width: 8,
                    height: beat ? 14 : 6,
                    borderRadius: 2,
                    background: beat ? (beat.ok ? 'var(--success)' : 'var(--danger)') : 'var(--border)',
                    opacity: beat ? 1 : 0.3,
                    transition: 'height 0.2s'
                  }}
                />
              )
            })}
          </div>
        </Section>

        {/* Loaded models */}
        <Section label="Models in VRAM">
          {ollamaModels.filter(m => m.loaded).length === 0 ? (
            <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>None loaded</p>
          ) : (
            ollamaModels.filter(m => m.loaded).map(m => (
              <div key={m.name} className="mb-2 last:mb-0">
                <p className="text-xs font-mono truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {m.vramUsed ? `${formatBytes(m.vramUsed)} VRAM` : formatBytes(m.size)}
                </p>
              </div>
            ))
          )}
        </Section>

        {/* GPU hardware details */}
        {gpu && (
          <Section label="GPU">
            <div className="flex items-center gap-1.5 mb-1">
              <Cpu size={11} style={{ color: 'var(--text-secondary)' }} />
              <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{gpu.model}</span>
              {gpu.temperatureGpu > 0 && (
                <span className="text-xs font-mono" style={{ color: gpu.temperatureGpu > 80 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                  {gpu.temperatureGpu}°C
                </span>
              )}
            </div>
            {gpu.memTotal > 0 && (
              <MeterRow
                label="VRAM"
                value={Math.round((gpu.memUsed / gpu.memTotal) * 100)}
                color="color-mix(in srgb, var(--accent) 70%, var(--success))"
                detail={`${formatBytes(gpu.memUsed * 1048576)}/${formatBytes(gpu.memTotal * 1048576)}`}
              />
            )}
          </Section>
        )}

        {/* RAM */}
        {metrics && (
          <Section label="System RAM">
            <MeterRow
              label="Used"
              value={Math.round((metrics.ramUsed / metrics.ramTotal) * 100)}
              color="var(--success)"
              detail={`${formatBytes(metrics.ramUsed)}/${formatBytes(metrics.ramTotal)}`}
            />
          </Section>
        )}

        {/* GPU load + CPU side by side */}
        <div className="flex gap-3">
          {gpu && (
            <div className="flex-1">
              <Section label="GPU">
                <MeterRow label="Load" value={gpu.utilizationGpu} color="var(--accent)" />
              </Section>
            </div>
          )}
          {metrics && (
            <div className="flex-1">
              <Section label="CPU">
                <MeterRow label="Load" value={metrics.cpu} color="var(--warning)" />
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
        {label}
      </p>
      {children}
    </div>
  )
}

function MeterRow({ label, value, color, detail }: { label: string; value: number; color: string; detail?: string }) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
          {detail ?? `${value}%`}
        </span>
      </div>
      <div className="meter">
        <div className="meter-fill" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
    </div>
  )
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
