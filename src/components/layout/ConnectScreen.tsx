import { useState, useEffect, useRef } from 'react'
import { Wifi, Trash2, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Zap } from 'lucide-react'
import { useConnectionStore } from '../../store/connection'
import { gatewayClient, type ConnLog } from '../../lib/gateway'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'

interface Props { onConnect: () => void }

export function ConnectScreen({ onConnect }: Props) {
  const { connect, disconnect, savedConnections, removeConnection, status, statusDetail } = useConnectionStore()
  const [url, setUrl] = useState('ws://localhost:18789')
  const [token, setToken] = useState('')
  const [label, setLabel] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [log, setLog] = useState<ConnLog[]>([])
  const [autoFilling, setAutoFilling] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const handleAutoFill = async () => {
    setAutoFilling(true)
    try {
      const result = await (window as unknown as { api: { config: { read: () => Promise<{ ok: boolean; text?: string }> } } }).api.config.read()
      if (!result.ok || !result.text) return
      const cfg = JSON.parse(result.text)
      const gw = cfg?.gateway ?? {}
      const port = gw.port ?? 18789
      const detectedUrl = `ws://localhost:${port}`
      const detectedToken = typeof gw?.auth?.token === 'string' ? gw.auth.token : ''
      setUrl(detectedUrl)
      if (detectedToken) setToken(detectedToken)
    } catch {
      // ignore — user can fill manually
    } finally {
      setAutoFilling(false)
    }
  }

  // Scroll debug log to bottom on new entries
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  // Listen to gateway connection log
  useEffect(() => {
    gatewayClient.onLog = (entry) => setLog(prev => [...prev.slice(-99), entry])
    return () => { gatewayClient.onLog = undefined }
  }, [])

  // Auto-fill from config on first load if no saved connections
  useEffect(() => {
    if (savedConnections.length === 0) handleAutoFill()
  }, [])

  // Navigate to chat only once truly connected
  useEffect(() => {
    if (status === 'connected') onConnect()
  }, [status])

  // When an error occurs, auto-expand the log so user can see what went wrong
  useEffect(() => {
    if (status === 'error' || (status === 'disconnected' && log.length > 0)) {
      setShowLog(true)
    }
  }, [status])

  const isConnecting = status === 'connecting'

  const handleConnect = () => {
    if (!url.trim()) return
    setLog([])
    setShowLog(true)
    connect({ url: url.trim(), token: token.trim(), label: label.trim() || undefined })
  }

  const handleDisconnect = () => {
    disconnect()
    setLog([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isConnecting) handleConnect()
  }

  const isError = status === 'error' || (status === 'disconnected' && log.length > 0 && log.some(l => l.dir === 'info' && l.text.includes('losed')))

  return (
    <div className="flex flex-1 items-center justify-center p-8" style={{ background: 'var(--bg-primary)' }}>
      <div className="w-full max-w-lg animate-fade-in">
        {/* Card */}
        <div
          className="p-8"
          style={{
            background: 'var(--bg-surface)',
            border: `1px solid ${isError ? 'var(--danger)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)',
            transition: 'border-color 0.2s'
          }}
        >
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🦞</div>
            <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>JoaxClaw</h1>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>Connect to your Openclaw Gateway</p>
            <Btn
              variant="ghost"
              size="sm"
              icon={<Zap size={13} />}
              onClick={handleAutoFill}
              disabled={autoFilling || isConnecting}
            >
              {autoFilling ? 'Detecting…' : 'Auto-fill from config'}
            </Btn>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Gateway URL
              </label>
              <Input
                value={url}
                onChange={setUrl}
                placeholder="ws://localhost:18789"
                disabled={isConnecting}
                onKeyDown={handleKeyDown}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Gateway Token
              </label>
              <div className="relative">
                <Input
                  value={token}
                  onChange={setToken}
                  type={showToken ? 'text' : 'password'}
                  placeholder="Paste your bearer token…"
                  disabled={isConnecting}
                  onKeyDown={handleKeyDown}
                  style={{ paddingRight: 48 }}
                />
                <button
                  onClick={() => setShowToken(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                  style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {showToken ? 'hide' : 'show'}
                </button>
              </div>
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                Generate: <code>openclaw doctor --generate-gateway-token</code>
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Label (optional)
              </label>
              <Input
                value={label}
                onChange={setLabel}
                placeholder="e.g. Home server"
                disabled={isConnecting}
                onKeyDown={handleKeyDown}
              />
            </div>

            {/* Status banner */}
            {isConnecting && (
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded text-sm animate-fade-in"
                style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid var(--accent)', color: 'var(--accent)' }}
              >
                <div className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: 'var(--accent)', flexShrink: 0 }} />
                Connecting — check the log below for progress
              </div>
            )}

            {isError && statusDetail && (
              <div
                className="flex items-start gap-2 px-3 py-2.5 rounded text-sm animate-fade-in"
                style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p className="font-medium">Connection failed</p>
                  <p className="text-xs mt-0.5 opacity-80">{statusDetail}</p>
                </div>
              </div>
            )}

            {status === 'connected' && (
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded text-sm animate-fade-in"
                style={{ background: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid var(--success)', color: 'var(--success)' }}
              >
                <CheckCircle2 size={15} />
                Connected! Navigating…
              </div>
            )}

            <div className="flex gap-2">
              {isConnecting ? (
                <Btn
                  variant="danger"
                  onClick={handleDisconnect}
                  className="flex-1"
                >
                  Cancel
                </Btn>
              ) : (
                <Btn
                  onClick={handleConnect}
                  className="flex-1"
                  icon={<Wifi size={15} />}
                  disabled={!url.trim()}
                >
                  Connect
                </Btn>
              )}
            </div>
          </div>
        </div>

        {/* Debug log */}
        <div className="mt-3">
          <button
            onClick={() => setShowLog(s => !s)}
            className="flex items-center gap-1.5 text-xs w-full px-2 py-1"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Connection log
            {log.length > 0 && <span className="ml-auto opacity-60">{log.length} events</span>}
          </button>

          {showLog && (
            <div
              ref={logRef}
              className="overflow-y-auto animate-fade-in"
              style={{
                maxHeight: 220,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                fontFamily: 'monospace',
                fontSize: 11,
                lineHeight: 1.5
              }}
            >
              {log.length === 0 && (
                <p className="px-3 py-2 italic" style={{ color: 'var(--text-secondary)' }}>
                  Log will appear here when you connect…
                </p>
              )}
              {log.map((entry, i) => (
                <div
                  key={i}
                  className="flex gap-2 px-3 py-0.5 border-b"
                  style={{ borderColor: 'var(--border)', borderBottomWidth: 1 }}
                >
                  <span style={{ color: 'var(--text-secondary)', flexShrink: 0, fontSize: 10, paddingTop: 1 }}>
                    {new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span
                    style={{
                      flexShrink: 0, fontSize: 10, paddingTop: 1, fontWeight: 600,
                      color: entry.dir === 'in' ? 'var(--success)' : entry.dir === 'out' ? 'var(--accent)' : 'var(--text-secondary)'
                    }}
                  >
                    {entry.dir === 'in' ? '←' : entry.dir === 'out' ? '→' : '·'}
                  </span>
                  <span
                    style={{
                      color: entry.dir === 'info'
                        ? 'var(--text-secondary)'
                        : entry.dir === 'in' ? 'var(--text-primary)' : 'var(--accent)',
                      wordBreak: 'break-all',
                      whiteSpace: 'pre-wrap',
                      flex: 1
                    }}
                  >
                    {entry.dir !== 'info' ? tryPretty(entry.text) : entry.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Saved connections */}
        {savedConnections.length > 0 && (
          <div
            className="mt-3 p-4"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
          >
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Saved connections</p>
            <div className="space-y-1.5">
              {savedConnections.map(conn => (
                <div
                  key={conn.url}
                  className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer group"
                  style={{ background: 'var(--bg-elevated)', borderRadius: 'calc(var(--radius) / 1.5)' }}
                  onClick={() => { setUrl(conn.url); setToken(conn.token); setLabel(conn.label ?? '') }}
                >
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-secondary)', flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {conn.label || conn.url}
                    </p>
                    {conn.label && <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{conn.url}</p>}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); removeConnection(conn.url) }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity"
                    style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <Trash2 size={12} />
                  </button>
                  <span className="text-xs" style={{ color: 'var(--accent)' }}>use →</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function tryPretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
