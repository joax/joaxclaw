import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Square, CheckCircle2, XCircle, AlertCircle, RefreshCw, Eye, EyeOff, Server, Plug, Cpu, Sparkles, MessageSquare, HelpCircle, MonitorSmartphone, ArrowUpCircle, ClipboardList } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useConnectionStore, useIsRemoteGateway } from '../../store/connection'
import { useMetricsStore } from '../../store/metrics'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { formatBytes } from '../../lib/ollama'
import { gatewayClient } from '../../lib/gateway'
import { gatewayHost } from '../../lib/ollamaHealth'
import { useHelpStore } from '../../store/help'
import { useSkillsStore } from '../../store/skills'
import { ChannelsPanel } from './ChannelsPanel'
import { DevicesPanel } from './DevicesPanel'
import { LocalEnginesCard } from './LocalEnginesCard'
import { SessionsView } from '../sessions/SessionsView'
import { buildGatewayUpdatePrompt } from '../../lib/gatewayUpdate'
import { useGatewayUpdateStore } from '../../store/gatewayUpdate'
import { sendViaAgent } from '../../lib/agentPrompt'

interface ConfigSnapshot { hash?: string; config?: Record<string, unknown>; parsed?: Record<string, unknown> }

type GwStatus = { running: boolean; pid?: number; uptime?: string }

type SettingsTab = 'connection' | 'gateway' | 'sessions' | 'devices' | 'channels' | 'engines' | 'skills'
// Remembered across remounts (e.g. when an auto-reconnect briefly swaps the view
// out) so the user returns to the tab they were on — notably Channels.
let lastSettingsTab: SettingsTab = 'connection'
const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'connection', label: 'Connection', icon: <Plug size={15} /> },
  { id: 'gateway',    label: 'Gateway',    icon: <Server size={15} /> },
  { id: 'sessions',   label: 'Sessions',   icon: <ClipboardList size={15} /> },
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
  // Top-level config sections last loaded (remote), so removals become deletes on save.
  const loadedKeysRef = useRef<string[]>([])

  // Load the gateway config. On a remote gateway the local ~/.openclaw file is the
  // WRONG machine's config, so read it over the WS via config.get instead (the same
  // RPC Models/Channels use). Local gateways keep the raw-file editor.
  const loadConfig = async () => {
    setConfigLoading(true)
    try {
      if (remote) {
        const snap = await gatewayClient.request<ConfigSnapshot>('config.get', {})
        const cfg = (snap.parsed ?? snap.config ?? {}) as Record<string, unknown>
        loadedKeysRef.current = Object.keys(cfg)
        setConfigText(JSON.stringify(cfg, null, 2))
        setConfigPath(`${gatewayHost(connection?.url) ?? 'remote'} · ~/.openclaw/openclaw.json (via gateway)`)
        setConfigError('')
        setConfigDirty(false)
      } else {
        if (!window.api?.config) return
        const res = await window.api.config.read()
        if (res.ok && res.text) {
          setConfigText(res.text)
          setConfigPath(res.path ?? '')
          setConfigError('')
          setConfigDirty(false)
        } else {
          setConfigError(res.error ?? 'Failed to read config')
        }
      }
    } catch (e) {
      setConfigError(String(e))
    } finally {
      setConfigLoading(false)
    }
  }

  // Check gateway status. A remote gateway has no status CLI we can reach, but if the
  // WS is connected the gateway is by definition running — so derive it from that.
  const checkStatus = async () => {
    if (remote) {
      setGwStatus({ running: status === 'connected' })
      return
    }
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

  // Reload config + status whenever local/remote-ness changes (e.g. after connecting
  // to a remote gateway), not just on first mount.
  useEffect(() => {
    loadConfig()
    checkStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, status])

  const handleSave = async () => {
    setSaveStatus('saving')
    if (remote) {
      // Full-config editor → merge patch. Parse the edited JSON, replace each present
      // top-level section wholesale (so nested removals apply), and null out any
      // section the user deleted entirely. config.patch hot-reloads the gateway.
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(configText)
      } catch (e) {
        setSaveStatus('error')
        setConfigError(`Invalid JSON: ${String(e)}`)
        return
      }
      try {
        const patchObj: Record<string, unknown> = { ...parsed }
        for (const k of loadedKeysRef.current) if (!(k in parsed)) patchObj[k] = null
        // Re-read for a fresh hash to avoid stale-hash conflicts.
        const snap = await gatewayClient.request<ConfigSnapshot>('config.get', {})
        await gatewayClient.request('config.patch', {
          raw: JSON.stringify(patchObj),
          ...(snap.hash ? { baseHash: snap.hash } : {}),
          replacePaths: Object.keys(parsed),
        })
        setSaveStatus('saved')
        setConfigDirty(false)
        setConfigError('')
        setTimeout(() => setSaveStatus('idle'), 2000)
        await loadConfig()
      } catch (e) {
        setSaveStatus('error')
        setConfigError(String(e))
      }
      return
    }
    if (!window.api?.config) return
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

  // Restart/Safe/Stop. Locally we shell out via the Electron main process. On a remote
  // gateway there's no lifecycle RPC and no reachable CLI, so hand the command to the
  // default agent (it runs on the host) via sendViaAgent and jump to that chat.
  const runLifecycle = (
    localFn: () => Promise<{ ok: boolean; stdout: string; stderr: string }>,
    command: string,
    note: string,
  ) => {
    if (remote) {
      const prompt = [
        'Run this command on the gateway host (the machine you are running on) and report its output:',
        '',
        '```bash',
        command,
        '```',
        '',
        note,
      ].join('\n')
      sendViaAgent(prompt, onOpenChat)
    } else {
      runCmd(localFn)
    }
  }

  // Gateway update availability (from the channel-aware update.status RPC) — reflect it
  // on the Update button; refresh whenever this view opens.
  const gwUpdate = useGatewayUpdateStore(s => s.info)
  const checkGwUpdate = useGatewayUpdateStore(s => s.check)
  useEffect(() => { checkGwUpdate() }, [checkGwUpdate])

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
                  {remote && <span className="opacity-60">· remote</span>}
                </div>
                <Btn variant={gwUpdate ? undefined : 'outline'} size="sm" icon={<ArrowUpCircle size={12} />} loading={cmdRunning} disabled={status !== 'connected'} onClick={handleUpdate}
                  title={gwUpdate ? `Update available: ${gwUpdate.currentVersion} → ${gwUpdate.latestVersion}` : 'Update OpenClaw on the gateway host'}>
                  {gwUpdate ? `Update → ${gwUpdate.latestVersion}` : 'Update'}
                </Btn>
                <Btn variant="outline" size="sm" icon={<RotateCcw size={12} />} loading={cmdRunning} onClick={() => runLifecycle(window.api.gateway.restart, 'openclaw gateway restart', 'This briefly drops the connection while the gateway restarts — that is expected; the app will reconnect on its own.')}>Restart</Btn>
                <Btn variant="outline" size="sm" icon={<RotateCcw size={12} />} loading={cmdRunning} onClick={() => runLifecycle(window.api.gateway.restartSafe, 'openclaw gateway restart --safe', 'This briefly drops the connection while the gateway restarts — that is expected; the app will reconnect on its own.')}>Safe</Btn>
                <Btn variant="danger" size="sm" icon={<Square size={12} />} loading={cmdRunning} onClick={() => runLifecycle(window.api.gateway.stop, 'openclaw gateway stop', 'This stops the gateway; the app will disconnect and stay disconnected until it is started again.')}>Stop</Btn>
                <Btn variant="outline" size="sm" icon={<RefreshCw size={12} />} onClick={loadConfig} loading={configLoading}>Reload</Btn>
              </div>
            </div>

            {remote && (
              <div className="flex items-start gap-2 px-3 py-2 rounded text-xs shrink-0" style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-surface))', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', color: 'var(--text-secondary)' }}>
                <Server size={13} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                <span>
                  Remote gateway — this edits the config <b style={{ color: 'var(--text-primary)' }}>on the host</b> over the connection.
                  Restart / Safe / Stop have no remote API, so they open a chat asking an agent on the host to run the command (you approve it).
                </span>
              </div>
            )}

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

        {/* ── Sessions ── */}
        {tab === 'sessions' && (
          <SessionsView onOpenChat={() => onOpenChat?.()} />
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
