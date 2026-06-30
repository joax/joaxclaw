import { useEffect, useState } from 'react'
import { RotateCcw, Square, CheckCircle2, XCircle, AlertCircle, RefreshCw, Eye, EyeOff, Server, Plug, Cpu, Sparkles, MessageSquare, HelpCircle, MonitorSmartphone, ArrowUpCircle } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useConnectionStore, useIsRemoteGateway } from '../../store/connection'
import { useMetricsStore } from '../../store/metrics'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { formatBytes } from '../../lib/ollama'
import { useHelpStore } from '../../store/help'
import { useSkillsStore } from '../../store/skills'
import { ChannelsPanel } from './ChannelsPanel'
import { DevicesPanel } from './DevicesPanel'
import { LocalEnginesCard } from './LocalEnginesCard'
import { buildGatewayUpdatePrompt } from '../../lib/gatewayUpdate'
import { sendViaAgent } from '../../lib/agentPrompt'

type GwStatus = { running: boolean; pid?: number; uptime?: string }

type SettingsTab = 'connection' | 'gateway' | 'devices' | 'channels' | 'engines' | 'skills'
// Remembered across remounts (e.g. when an auto-reconnect briefly swaps the view
// out) so the user returns to the tab they were on — notably Channels.
let lastSettingsTab: SettingsTab = 'connection'
const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'connection', label: 'Connection', icon: <Plug size={15} /> },
  { id: 'gateway',    label: 'Gateway',    icon: <Server size={15} /> },
  { id: 'devices',    label: 'Devices',    icon: <MonitorSmartphone size={15} /> },
  { id: 'channels',   label: 'Channels',   icon: <MessageSquare size={15} /> },
  { id: 'engines',    label: 'Local LLM',  icon: <Cpu size={15} /> },
  { id: 'skills',     label: 'Skills',     icon: <Sparkles size={15} /> },
]

export function GatewayView({ onOpenChat }: { onOpenChat?: () => void } = {}) {
  const { status, connection, connect, disconnect } = useConnectionStore()
  const remote = useIsRemoteGateway()
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

  const [tab, setTabState] = useState<SettingsTab>(lastSettingsTab)
  const setTab = (t: SettingsTab) => { lastSettingsTab = t; setTabState(t) }

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

  // Update OpenClaw itself on the gateway host. Unlike restart/stop (which shell out
  // locally), this asks the connected agent to run `openclaw update` on its host, so it
  // works for a remote gateway too — the agent always runs on the gateway host.
  const handleUpdate = async () => {
    setCmdRunning(true)
    const built = await buildGatewayUpdatePrompt()
    setCmdRunning(false)
    if (!built.ok || !built.prompt) {
      setCmdOutput(built.error ?? 'Failed to prepare the update')
      return
    }
    setCmdOutput('Update requested — opening a chat and asking the agent to run it on the gateway host.')
    sendViaAgent(built.prompt, onOpenChat)
  }

  const handleConnect = () => {
    connect({ url: editUrl, token: editToken })
  }

  const statusDot = (
    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
      <div className="w-2 h-2 rounded-full" style={{
        background: status === 'connected' ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--danger)'
      }} />
      {status}
    </div>
  )

  return (
    <div className="flex flex-1 min-h-0">
      {/* Category rail */}
      <div
        className="flex flex-col shrink-0 py-4 px-3 gap-1"
        style={{ width: 200, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      >
        <h1 className="text-sm font-semibold px-2 mb-2" style={{ color: 'var(--text-primary)' }}>Gateway</h1>
        {SETTINGS_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded"
            style={{
              background: tab === t.id ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : 'transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              border: 'none', cursor: 'pointer', borderRadius: 'var(--radius)',
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="px-2">{statusDot}</div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">

        {/* ── Connection ── */}
        {tab === 'connection' && (
          <SettingsScroll title="Connection">
            <Card title="Gateway connection">
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
                {statusDot}
              </div>
            </Card>
          </SettingsScroll>
        )}

        {/* ── Gateway (controls + config editor) ── */}
        {tab === 'gateway' && (
          <div className="flex flex-col flex-1 min-h-0 p-6 gap-4">
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Gateway</h2>
                {configPath && <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>{configPath}</p>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs mr-1" style={{ color: gwStatus?.running ? 'var(--success)' : 'var(--danger)' }}>
                  {gwStatus?.running ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  <span>{gwStatus?.running ? 'Running' : 'Stopped'}</span>
                  {gwStatus?.pid && <span className="opacity-60">PID {gwStatus.pid}</span>}
                </div>
                <Btn variant="outline" size="sm" icon={<ArrowUpCircle size={12} />} loading={cmdRunning} disabled={status !== 'connected'} onClick={handleUpdate}>Update</Btn>
                <Btn variant="outline" size="sm" icon={<RotateCcw size={12} />} loading={cmdRunning} onClick={() => runCmd(window.api.gateway.restart)}>Restart</Btn>
                <Btn variant="outline" size="sm" icon={<RotateCcw size={12} />} loading={cmdRunning} onClick={() => runCmd(window.api.gateway.restartSafe)}>Safe</Btn>
                <Btn variant="danger" size="sm" icon={<Square size={12} />} loading={cmdRunning} onClick={() => runCmd(window.api.gateway.stop)}>Stop</Btn>
                <Btn variant="outline" size="sm" icon={<RefreshCw size={12} />} onClick={loadConfig} loading={configLoading}>Reload</Btn>
              </div>
            </div>

            {cmdOutput && (
              <pre className="text-xs p-2 rounded shrink-0" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: 11, maxHeight: 80, overflow: 'auto' }}>
                {cmdOutput}
              </pre>
            )}

            {configError && (
              <div className="px-3 py-2 rounded text-sm flex items-center gap-2 shrink-0" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
                <AlertCircle size={14} />
                {configError}
              </div>
            )}

            <div className="flex-1 overflow-hidden" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', minHeight: 0 }}>
              <Editor
                height="100%"
                defaultLanguage="json"
                value={configText}
                onChange={v => { setConfigText(v ?? ''); setConfigDirty(true) }}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false }, fontSize: 13, lineHeight: 1.6,
                  scrollBeyondLastLine: false, wordWrap: 'on', formatOnPaste: true,
                  renderWhitespace: 'boundary', padding: { top: 12 },
                }}
              />
            </div>

            {configDirty && (
              <div className="flex items-center gap-3 px-4 py-2.5 rounded animate-fade-in shrink-0" style={{ background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-surface))', border: '1px solid var(--warning)' }}>
                <AlertCircle size={14} style={{ color: 'var(--warning)' }} />
                <span className="text-sm flex-1" style={{ color: 'var(--warning)' }}>Unsaved changes</span>
                <Btn variant="outline" size="sm" onClick={() => { loadConfig(); setConfigDirty(false) }}>Discard</Btn>
                <Btn size="sm" icon={saveStatus === 'saved' ? <CheckCircle2 size={13} /> : undefined} onClick={handleSave} loading={saveStatus === 'saving'} style={saveStatus === 'saved' ? { background: 'var(--success)' } : undefined}>
                  {saveStatus === 'saved' ? 'Saved!' : 'Save & Reload'}
                </Btn>
              </div>
            )}
          </div>
        )}

        {/* ── Devices ── */}
        {tab === 'devices' && (
          <DevicesPanel connected={status === 'connected'} />
        )}

        {/* ── Channels ── */}
        {tab === 'channels' && (
          <ChannelsPanel connected={status === 'connected'} />
        )}

        {/* ── Ollama ── */}
        {tab === 'engines' && (
          <SettingsScroll title="Local LLM">
            <LocalEnginesCard gatewayUrl={connection?.url} />
            {!remote && (
              <Card title="Ollama Models (local)">
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
                          <p className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>VRAM {formatBytes(model.vramUsed)} loaded</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </SettingsScroll>
        )}

        {/* ── Skills ── */}
        {tab === 'skills' && (
          <SettingsScroll title="Skills">
            <AppSkillsCard gatewayUrl={connection?.url} connected={status === 'connected'} />
          </SettingsScroll>
        )}
      </div>
    </div>
  )
}

// Scrollable, width-constrained content wrapper for a settings section.
function SettingsScroll({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="p-6 flex flex-col gap-4" style={{ maxWidth: 560 }}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}


// Status + reinstall for the app-native agent skills (process-builder, teams-blueprint).
function AppSkillsCard({ gatewayUrl, connected }: { gatewayUrl?: string; connected: boolean }) {
  const { results, running, run } = useSkillsStore()
  const openHelp = useHelpStore(s => s.openHelp)

  // Remote skill uploads are gated by skills.install.allowUploadedArchives.
  const uploadBlocked = results.some(r =>
    r.status === 'error' && /allowUploadedArchives|uploaded skill archive/i.test(r.error ?? '')
  )

  return (
    <Card title="App Skills">
      <div className="space-y-2.5">
        <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Agent skills that teach models to build JoaxClaw teams &amp; processes. Installed automatically on connect.
        </p>

        <div className="space-y-1.5">
          {results.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
              {connected ? 'Not installed yet.' : 'Connect to install.'}
            </p>
          )}
          {results.map(r => (
            <div key={r.slug} className="flex items-start gap-2 text-xs">
              {r.status === 'error'
                ? <XCircle size={12} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                : <CheckCircle2 size={12} style={{ color: r.status === 'installed' ? 'var(--success)' : 'var(--text-secondary)', flexShrink: 0, marginTop: 1 }} />}
              <div className="min-w-0">
                <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{r.slug}</span>
                <span style={{ color: 'var(--text-secondary)' }}> — {r.status}</span>
                {r.error && (
                  <p style={{ color: 'var(--warning)', opacity: 0.9, marginTop: 1, wordBreak: 'break-word' }}>{r.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {uploadBlocked && (
          <button
            onClick={() => openHelp('gateways')}
            className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-left"
            style={{
              background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-elevated))',
              border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
              cursor: 'pointer',
            }}
          >
            <HelpCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>
              Remote upload disabled — enable <code style={{ fontFamily: 'monospace' }}>skills.install.allowUploadedArchives</code>
            </span>
            <span className="text-xs" style={{ color: 'var(--accent)' }}>Help</span>
          </button>
        )}

        <Btn
          variant="outline"
          size="sm"
          className="w-full"
          icon={<RefreshCw size={12} />}
          loading={running}
          disabled={!connected}
          onClick={() => run(gatewayUrl, true)}
        >
          Reinstall
        </Btn>
      </div>
    </Card>
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
