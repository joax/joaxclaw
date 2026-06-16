import { useEffect, useState } from 'react'
import { RotateCcw, Square, CheckCircle2, XCircle, AlertCircle, RefreshCw, Eye, EyeOff, Info, X, Server, LifeBuoy, Zap, HardDrive } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useConnectionStore } from '../../store/connection'
import { useMetricsStore } from '../../store/metrics'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { formatBytes } from '../../lib/ollama'
import { resolveOllamaUrl } from '../../lib/ollamaHealth'
import { useHelpStore } from '../../store/help'

type GwStatus = { running: boolean; pid?: number; uptime?: string }

export function GatewayView() {
  const { status, connection, savedConnections, connect, disconnect, setOllamaUrls } = useConnectionStore()
  const { ollamaModels } = useMetricsStore()

  const [configText, setConfigText] = useState('')
  const [configPath, setConfigPath] = useState('')
  const [configError, setConfigError] = useState('')
  const [configDirty, setConfigDirty] = useState(false)
  const [configLoading, setConfigLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const [gwStatus, setGwStatus] = useState<GwStatus | null>(null)
  const [cmdRunning, setCmdRunning] = useState(false)
  const [cmdOutput, setCmdOutput] = useState('')
  const [showToken, setShowToken] = useState(false)

  const [editUrl, setEditUrl] = useState(connection?.url ?? 'ws://localhost:18789')
  const [editToken, setEditToken] = useState(connection?.token ?? '')

  // Load config file
  const loadConfig = async () => {
    if (!window.api?.config) return
    setConfigLoading(true)
    const res = await window.api.config.read()
    setConfigLoading(false)
    if (res.ok && res.text) {
      setConfigText(res.text)
      setConfigPath(res.path ?? '')
      setConfigError('')
      setConfigDirty(false)
    } else {
      setConfigError(res.error ?? 'Failed to read config')
    }
  }

  // Check gateway status
  const checkStatus = async () => {
    if (!window.api?.gateway) return
    const res = await window.api.gateway.status()
    if (res.ok && res.stdout) {
      try {
        const data = JSON.parse(res.stdout)
        setGwStatus({ running: true, pid: data.pid, uptime: data.uptime })
      } catch {
        setGwStatus({ running: res.ok })
      }
    } else {
      setGwStatus({ running: false })
    }
  }

  useEffect(() => {
    loadConfig()
    checkStatus()
  }, [])

  const handleSave = async () => {
    if (!window.api?.config) return
    setSaveStatus('saving')
    const res = await window.api.config.write(configText)
    if (res.ok) {
      setSaveStatus('saved')
      setConfigDirty(false)
      setTimeout(() => setSaveStatus('idle'), 2000)
    } else {
      setSaveStatus('error')
    }
  }

  const runCmd = async (fn: () => Promise<{ ok: boolean; stdout: string; stderr: string }>) => {
    setCmdRunning(true)
    const res = await fn()
    setCmdOutput((res.stdout || res.stderr || (res.ok ? 'Success' : 'Failed')))
    setCmdRunning(false)
    setTimeout(() => checkStatus(), 1000)
  }

  const handleConnect = () => {
    connect({ url: editUrl, token: editToken })
  }

  return (
    <div className="flex flex-1 min-h-0 p-6 gap-5">
      {/* Left: JSON editor */}
      <div className="flex flex-col flex-1 min-w-0 gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Gateway Config</h1>
            {configPath && (
              <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>{configPath}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Btn variant="outline" size="sm" icon={<RefreshCw size={12} />} onClick={loadConfig} loading={configLoading}>
              Reload
            </Btn>
          </div>
        </div>

        {configError && (
          <div className="px-3 py-2 rounded text-sm flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
            <AlertCircle size={14} />
            {configError}
          </div>
        )}

        <div
          className="flex-1 overflow-hidden"
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', minHeight: 0 }}
        >
          <Editor
            height="100%"
            defaultLanguage="json"
            value={configText}
            onChange={v => { setConfigText(v ?? ''); setConfigDirty(true) }}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineHeight: 1.6,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              formatOnPaste: true,
              renderWhitespace: 'boundary',
              padding: { top: 12 }
            }}
          />
        </div>

        {/* Save bar */}
        {configDirty && (
          <div
            className="flex items-center gap-3 px-4 py-2.5 rounded animate-fade-in"
            style={{ background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-surface))', border: '1px solid var(--warning)' }}
          >
            <AlertCircle size={14} style={{ color: 'var(--warning)' }} />
            <span className="text-sm flex-1" style={{ color: 'var(--warning)' }}>Unsaved changes</span>
            <Btn variant="outline" size="sm" onClick={() => { loadConfig(); setConfigDirty(false) }}>Discard</Btn>
            <Btn
              size="sm"
              icon={saveStatus === 'saved' ? <CheckCircle2 size={13} /> : undefined}
              onClick={handleSave}
              loading={saveStatus === 'saving'}
              style={saveStatus === 'saved' ? { background: 'var(--success)' } : undefined}
            >
              {saveStatus === 'saved' ? 'Saved!' : 'Save & Reload'}
            </Btn>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex flex-col gap-4" style={{ width: 280, flexShrink: 0 }}>
        {/* Connection settings */}
        <Card title="Connection">
          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>URL</label>
              <Input value={editUrl} onChange={setEditUrl} placeholder="ws://localhost:18789" style={{ fontSize: 12 }} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Token</label>
              <div className="relative">
                <Input
                  value={editToken}
                  onChange={setEditToken}
                  type={showToken ? 'text' : 'password'}
                  placeholder="Bearer token"
                  style={{ fontSize: 12, paddingRight: 36 }}
                />
                <button
                  onClick={() => setShowToken(s => !s)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            {status === 'connected' ? (
              <Btn variant="danger" size="sm" onClick={disconnect} className="w-full">Disconnect</Btn>
            ) : (
              <Btn size="sm" onClick={handleConnect} loading={status === 'connecting'} className="w-full">
                {status === 'connecting' ? 'Connecting…' : 'Connect'}
              </Btn>
            )}
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <div className="w-2 h-2 rounded-full" style={{
                background: status === 'connected' ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--danger)'
              }} />
              {status}
            </div>
          </div>
        </Card>

        {/* Gateway controls */}
        <Card title="Gateway Controls">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs mb-3" style={{ color: gwStatus?.running ? 'var(--success)' : 'var(--danger)' }}>
              {gwStatus?.running ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              <span>{gwStatus?.running ? 'Running' : 'Stopped'}</span>
              {gwStatus?.pid && <span className="opacity-60">PID {gwStatus.pid}</span>}
            </div>
            <Btn
              variant="outline" size="sm" className="w-full"
              icon={<RotateCcw size={12} />}
              loading={cmdRunning}
              onClick={() => runCmd(window.api.gateway.restart)}
            >
              Restart
            </Btn>
            <Btn
              variant="outline" size="sm" className="w-full"
              icon={<RotateCcw size={12} />}
              loading={cmdRunning}
              onClick={() => runCmd(window.api.gateway.restartSafe)}
            >
              Restart (safe)
            </Btn>
            <Btn
              variant="danger" size="sm" className="w-full"
              icon={<Square size={12} />}
              loading={cmdRunning}
              onClick={() => runCmd(window.api.gateway.stop)}
            >
              Stop
            </Btn>
            {cmdOutput && (
              <pre className="text-xs mt-2 p-2 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: 11 }}>
                {cmdOutput}
              </pre>
            )}
          </div>
        </Card>

        {/* Ollama endpoints */}
        <OllamaEndpointsCard
          targetUrl={connection?.url ?? savedConnections.find(c => c.url === editUrl)?.url}
          editUrl={editUrl}
          overrides={connection?.ollamaUrls ?? savedConnections.find(c => c.url === (connection?.url ?? editUrl))?.ollamaUrls}
          onSave={setOllamaUrls}
        />

        {/* Ollama models */}
        <Card title="Ollama Models">
          <div className="space-y-2">
            {ollamaModels.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No models found. Is Ollama running?</p>
            )}
            {ollamaModels.map(model => (
              <div key={model.name} className="text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: model.loaded ? 'var(--success)' : 'var(--border)', flexShrink: 0 }} />
                  <span className="flex-1 truncate font-mono" style={{ color: 'var(--text-primary)' }}>{model.name}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{formatBytes(model.size)}</span>
                </div>
                {model.loaded && model.vramUsed && (
                  <div className="ml-3.5 mt-1">
                    <div className="meter">
                      <div className="meter-fill" style={{ width: '60%', background: 'var(--accent)' }} />
                    </div>
                    <p className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      VRAM {formatBytes(model.vramUsed)} loaded
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

// Per-connection Ollama URL overrides (shared with the cron Ollama-isolation panel).
function OllamaEndpointsCard({ targetUrl, editUrl, overrides, onSave }: {
  targetUrl?: string
  editUrl: string
  overrides?: { main?: string; cron?: string }
  onSave: (gatewayUrl: string, urls: { main?: string; cron?: string }) => void
}) {
  const [showWhy, setShowWhy] = useState(false)
  // Placeholders reflect the default the app would use when no override is set.
  const mainDefault = resolveOllamaUrl('main', targetUrl ?? editUrl)?.url ?? 'http://host:11434'
  const cronDefault = resolveOllamaUrl('cron', targetUrl ?? editUrl)?.url ?? 'http://host:11435'

  return (
    <Card title="Ollama Endpoints">
      <div className="space-y-2.5">
        {/* Info callout — why are there two Ollama instances? */}
        <button
          onClick={() => setShowWhy(true)}
          className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-left"
          style={{
            background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-elevated))',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
            cursor: 'pointer',
          }}
        >
          <Info size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>Why two Ollama instances?</span>
          <span className="text-xs" style={{ color: 'var(--accent)' }}>Learn more</span>
        </button>

        <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          URLs used for Ollama health checks. Leave blank to use the default (localhost when the
          gateway is local, otherwise the gateway host).
        </p>

        {showWhy && <WhyTwoOllamasOverlay onClose={() => setShowWhy(false)} />}
        <OllamaUrlRow
          label="Main"
          port={11434}
          placeholder={mainDefault}
          value={overrides?.main ?? ''}
          disabled={!targetUrl}
          onSave={v => targetUrl && onSave(targetUrl, { main: v || undefined })}
        />
        <OllamaUrlRow
          label="CRON"
          port={11435}
          placeholder={cronDefault}
          value={overrides?.cron ?? ''}
          disabled={!targetUrl}
          onSave={v => targetUrl && onSave(targetUrl, { cron: v || undefined })}
        />
        {!targetUrl && (
          <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
            Connect to a gateway (or pick a saved one) to configure its endpoints.
          </p>
        )}
      </div>
    </Card>
  )
}

// Explains the two-instance Ollama setup, with a link into the Help service.
function WhyTwoOllamasOverlay({ onClose }: { onClose: () => void }) {
  const openHelp = useHelpStore(s => s.openHelp)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 z-50 flex flex-col"
        style={{
          transform: 'translate(-50%, -50%)', width: 480, maxHeight: '80vh',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Server size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Why two Ollama instances?</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-3" style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
          <p>
            Ollama serves <b>one request at a time per model</b> — a new request preempts whatever is
            running. So a single Ollama shared between your live chats and scheduled jobs means
            <b style={{ color: 'var(--text-primary)' }}> "last request wins"</b>.
          </p>

          <div className="flex items-start gap-2 px-3 py-2 rounded" style={{
            background: 'color-mix(in srgb, var(--danger) 6%, var(--bg-elevated))',
            border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
          }}>
            <Zap size={13} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12 }}>
              Without isolation, a CRON job firing mid-conversation <b style={{ color: 'var(--text-primary)' }}>cancels your active chat session</b>.
            </span>
          </div>

          <p>
            Running a second, isolated Ollama for background work keeps the two from contending:
          </p>
          <ul className="space-y-1.5" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li className="flex items-center gap-2">
              <Server size={12} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span><b style={{ color: 'var(--text-primary)' }}>Main · :11434</b> — interactive chats & agents</span>
            </li>
            <li className="flex items-center gap-2">
              <Server size={12} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <span><b style={{ color: 'var(--text-primary)' }}>CRON · :11435</b> — background scheduled jobs</span>
            </li>
            <li className="flex items-center gap-2">
              <HardDrive size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <span>Shared model files on disk · separate GPU queues</span>
            </li>
          </ul>

          <p>
            CRON jobs target the isolated instance with the <code style={codeStyle}>ollama-cron/</code> model
            prefix (the service is <code style={codeStyle}>ollama-cron</code>). Set each instance's URL above —
            useful when the gateway, and therefore Ollama, runs on a remote host.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <Btn
            variant="outline"
            size="sm"
            icon={<LifeBuoy size={13} />}
            onClick={() => { onClose(); openHelp('troubleshooting') }}
          >
            Open Help
          </Btn>
          <Btn size="sm" onClick={onClose}>Got it</Btn>
        </div>
      </div>
    </>
  )
}

const codeStyle: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 11, padding: '1px 5px', borderRadius: 4,
  background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)',
}

// Single URL input that commits on blur / Enter.
function OllamaUrlRow({ label, port, value, placeholder, disabled, onSave }: {
  label: string; port: number; value: string; placeholder: string; disabled?: boolean; onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <div>
      <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
        {label} <span style={{ opacity: 0.6, fontFamily: 'monospace' }}>:{port}</span>
      </label>
      <input
        value={draft}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() !== value.trim()) onSave(draft.trim()) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: 12, fontFamily: 'monospace',
          borderRadius: 'var(--radius)', border: '1px solid var(--border)',
          background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none',
          opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'text',
        }}
      />
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div className="px-3 py-2.5 text-xs font-semibold" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}
