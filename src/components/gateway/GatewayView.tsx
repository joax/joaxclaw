import { useEffect, useState } from 'react'
import { RotateCcw, Square, CheckCircle2, XCircle, AlertCircle, RefreshCw, Eye, EyeOff } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useConnectionStore } from '../../store/connection'
import { useMetricsStore } from '../../store/metrics'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { formatBytes } from '../../lib/ollama'

type GwStatus = { running: boolean; pid?: number; uptime?: string }

export function GatewayView() {
  const { status, connection, connect, disconnect } = useConnectionStore()
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
