import { useEffect } from 'react'
import { Heart, X, Cpu, Monitor, Server } from 'lucide-react'
import { useConnectionStore, useIsRemoteGateway } from '../../store/connection'
import { useMetricsStore } from '../../store/metrics'
import { useModelsStore } from '../../store/models'
import { useSettingsStore } from '../../store/settings'
import { formatBytes } from '../../lib/ollama'
import { gatewayHost } from '../../lib/ollamaHealth'
import { useIsNarrow } from '../../lib/useIsNarrow'

export function SystemMonitorHUD() {
  const { status, heartbeats, lastHeartbeat, uptimeStart } = useConnectionStore()
  const remoteGateway = useIsRemoteGateway()
  const gwHost = useConnectionStore(s => gatewayHost(s.connection?.url))
  const { metrics, engineModels } = useMetricsStore()
  const { toggleMonitor } = useSettingsStore()
  const narrow = useIsNarrow()

  // Engine instances come from the models config; load it if this is the first surface
  // opened, otherwise a second (cron) engine stays invisible until another view does.
  const providers = useModelsStore(s => s.providers)
  const loadModels = useModelsStore(s => s.load)
  useEffect(() => {
    if (Object.keys(providers).length === 0) loadModels()
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const multiEngine = engineModels.length > 1
  const loadedTotal = engineModels.reduce((n, e) => n + e.models.filter(m => m.loaded).length, 0)

  const gpu = metrics?.gpu?.[0]
  const hbAgo = lastHeartbeat ? Math.round((Date.now() - lastHeartbeat) / 1000) : null
  const uptime = uptimeStart ? formatUptime(Date.now() - uptimeStart) : null

  const inner = (
    <>
      {/* Header — a large, finger-friendly close on mobile. */}
      <div className="flex items-center gap-2" style={{ padding: narrow ? '10px 14px' : '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <Monitor size={narrow ? 16 : 13} style={{ color: 'var(--accent)' }} />
        <span className="font-semibold flex-1" style={{ color: 'var(--text-primary)', fontSize: narrow ? 15 : 12 }}>System Monitor</span>
        <button
          onClick={toggleMonitor}
          title="Close"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', width: narrow ? 40 : 20, height: narrow ? 40 : 20, marginRight: narrow ? -8 : 0, borderRadius: 'var(--radius)' }}
        >
          <X size={narrow ? 20 : 13} />
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

        {/* Hardware. On a remote gateway these come from the HOST via the joaxclaw-fs
            plugin's host.metrics RPC; if it's unavailable (older plugin) `metrics` is null
            and we prompt to update it rather than show the client machine's numbers. Loaded
            models stay client-side, so that list is local-gateway-only. */}
        {remoteGateway && !metrics ? (
          <Section label="Hardware">
            <div className="flex items-start gap-2 px-2.5 py-2 rounded" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <Server size={13} style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: 1 }} />
              <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Gateway runs on <b style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{gwHost}</b>.
                Update the <b style={{ color: 'var(--text-primary)' }}>joaxclaw-fs</b> plugin on the host to see its CPU / RAM / GPU here.
              </p>
            </div>
          </Section>
        ) : (
        <>
        {remoteGateway && (
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Hardware on gateway host <b style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{gwHost}</b>
          </p>
        )}
        {/* Loaded models — read from whichever machine runs the gateway (via the plugin
            when remote), and from EVERY configured local instance. A gateway commonly
            runs a second isolated engine for cron work that loads its own copy of a
            model into the same GPU; showing only the interactive one understates what
            is actually resident. Instances are labelled only when there is more than
            one, so the single-engine case stays as plain as before. */}
        <Section label="Models in VRAM">
          {loadedTotal === 0 ? (
            <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>None loaded</p>
          ) : (
            engineModels.map(engine => {
              const loaded = engine.models.filter(m => m.loaded)
              if (loaded.length === 0) return null
              return (
                <div key={engine.key} className="mb-2 last:mb-0">
                  {multiEngine && (
                    <p className="text-xs mb-0.5" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                      {engine.label}{engine.isCron ? ' · cron' : ''}
                    </p>
                  )}
                  {loaded.map(m => (
                    <div key={m.name} className="mb-1 last:mb-0">
                      <p className="text-xs font-mono truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {m.vramUsed ? `${formatBytes(m.vramUsed)} VRAM` : formatBytes(m.size)}
                      </p>
                    </div>
                  ))}
                </div>
              )
            })
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
        </>
        )}
      </div>
    </>
  )

  // Mobile: a bottom sheet with a backdrop + drag handle. Desktop: the compact
  // bottom-right card. Both self-position (fixed), so App.tsx just renders <HUD/>.
  if (narrow) {
    return (
      <>
        <div className="animate-fade-in" style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)' }} onClick={toggleMonitor} />
        <div
          className="animate-slide-up"
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61,
            background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.45)', paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, paddingBottom: 2 }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)' }} />
          </div>
          {inner}
        </div>
      </>
    )
  }

  return (
    <div
      className="animate-fade-in"
      style={{
        position: 'fixed', bottom: 38, right: 16, zIndex: 50, width: 280,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}
    >
      {inner}
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
