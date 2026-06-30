import { useEffect, useRef, useState } from 'react'
import {
  Brain, CheckCircle2, XCircle, Loader2, ChevronRight, ChevronDown,
  FolderOpen, Globe, RefreshCw, Unlink, AlertTriangle, Puzzle, Plus,
  Bot, Eye, Pencil, Ban, Check
} from 'lucide-react'
import { useObsidianStore, type ObsidianConfig, type VaultInfo, type AgentAccess } from '../../store/obsidian'
import { useExtensionsStore } from '../../store/extensions'
import { ForceGraph } from './ForceGraph'
import { Btn } from '../ui/Btn'

// ── Plugin-disabled gate ──────────────────────────────────────────────────────

function PluginDisabledView({ onNavigateExtensions }: { onNavigateExtensions: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8">
      <div
        className="flex items-center justify-center rounded-full"
        style={{ width: 64, height: 64, background: 'color-mix(in srgb, var(--warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}
      >
        <Brain size={28} style={{ color: 'var(--warning)' }} />
      </div>
      <div className="text-center max-w-sm">
        <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
          Obsidian plugin not enabled
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          The Obsidian memory integration requires the <span className="font-mono text-xs px-1 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>obsidian</span> plugin
          to be enabled in your Openclaw gateway configuration.
        </p>
      </div>
      <Btn variant="outline" size="sm" icon={<Puzzle size={13} />} onClick={onNavigateExtensions}>
        Go to Extensions
      </Btn>
    </div>
  )
}

// ── Setup wizard ──────────────────────────────────────────────────────────────

type WizardStep = 'welcome' | 'mode' | 'local' | 'remote' | 'testing' | 'done'

function SetupWizard({ pluginConfig, onDone }: {
  pluginConfig: { url?: string; apiKey?: string }
  onDone: () => void
}) {
  const { addVault, testConnection } = useObsidianStore()
  const [step, setStep] = useState<WizardStep>('welcome')
  const [obsInstalled, setObsInstalled] = useState<boolean | null>(null)
  const [name, setName] = useState('Personal')
  const [url, setUrl] = useState(pluginConfig.url ?? 'http://localhost:27123')
  const [apiKey, setApiKey] = useState(pluginConfig.apiKey ?? '')
  const [testResult, setTestResult] = useState<{ ok: boolean; vaultInfo?: VaultInfo; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const api = (window as unknown as { api?: { obsidian?: { detect?: () => Promise<{ installed: boolean }> } } }).api
    api?.obsidian?.detect?.().then(r => setObsInstalled(r.installed)).catch(() => setObsInstalled(false))
  }, [])

  async function handleTest(mode: 'local' | 'remote') {
    setStep('testing')
    setTesting(true)
    const cfg: ObsidianConfig = { name: name.trim() || (mode === 'local' ? 'Personal' : 'Remote'), mode, url, apiKey }
    const result = await testConnection(cfg)
    setTestResult(result)
    setTesting(false)
    if (result.ok) {
      addVault(cfg)
      setStep('done')
    } else {
      setStep(mode)
    }
  }

  // ── Welcome ─────────────────────────────────────────────────────────────────
  if (step === 'welcome') return (
    <WizardShell step={1} total={3} title="Connect Obsidian Memory">
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Link your Obsidian vault so agents can read and write notes as memory.
          The connection uses the <strong style={{ color: 'var(--text-primary)' }}>Local REST API</strong> community plugin.
        </p>

        <div className="flex items-center gap-2 px-3 py-2.5 rounded text-sm"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          {obsInstalled === null
            ? <Loader2 size={14} className="animate-spin shrink-0" style={{ color: 'var(--text-secondary)' }} />
            : obsInstalled
              ? <CheckCircle2 size={14} className="shrink-0" style={{ color: 'var(--success)' }} />
              : <AlertTriangle size={14} className="shrink-0" style={{ color: 'var(--warning)' }} />
          }
          <span style={{ color: 'var(--text-secondary)' }}>
            {obsInstalled === null ? 'Checking for Obsidian…'
              : obsInstalled ? 'Obsidian detected on this machine'
              : 'Obsidian not found — you can still connect to a remote vault'}
          </span>
        </div>

        <Btn variant="primary" size="sm" icon={<ChevronRight size={13} />}
          onClick={() => setStep('mode')} disabled={obsInstalled === null}
          style={{ alignSelf: 'flex-end' }}>
          Get started
        </Btn>
      </div>
    </WizardShell>
  )

  // ── Mode selection ───────────────────────────────────────────────────────────
  if (step === 'mode') return (
    <WizardShell step={2} total={3} title="How do you want to connect?">
      <div className="flex flex-col gap-3">
        {[
          {
            mode: 'local' as const,
            icon: <FolderOpen size={22} />,
            label: 'This computer',
            desc: 'Vault lives on this machine. Requires the Local REST API plugin in Obsidian.',
            disabled: obsInstalled === false,
            defaultName: 'Personal'
          },
          {
            mode: 'remote' as const,
            icon: <Globe size={22} />,
            label: 'Another machine / server',
            desc: 'Connect to an Obsidian vault running on a remote host via its REST API URL.',
            disabled: false,
            defaultName: 'Remote'
          }
        ].map(opt => (
          <button
            key={opt.mode}
            disabled={opt.disabled}
            onClick={() => {
              setStep(opt.mode)
              if (opt.mode === 'local') setUrl('http://localhost:27123')
              setName(opt.defaultName)
            }}
            className="flex items-center gap-4 px-4 py-3.5 text-left rounded transition-all"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              cursor: opt.disabled ? 'not-allowed' : 'pointer',
              opacity: opt.disabled ? 0.45 : 1
            }}
            onMouseEnter={e => { if (!opt.disabled) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
          >
            <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{opt.icon}</span>
            <div>
              <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{opt.label}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{opt.desc}</p>
              {opt.disabled && <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>Obsidian not detected on this machine</p>}
            </div>
            <ChevronRight size={16} className="ml-auto shrink-0" style={{ color: 'var(--text-secondary)' }} />
          </button>
        ))}
      </div>
    </WizardShell>
  )

  // ── Local setup ──────────────────────────────────────────────────────────────
  if (step === 'local') return (
    <WizardShell step={3} total={3} title="Set up Local REST API">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Install the plugin in Obsidian:</p>
          {[
            'Open Obsidian → Settings → Community plugins',
            'Turn off Restricted mode if prompted',
            'Click Browse and search for "Local REST API"',
            'Install Local REST API by Adam Coddington and enable it',
            'Open the plugin settings — copy the API Key shown there',
          ].map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)', marginTop: 1 }}>
                {i + 1}
              </span>
              <span>{s}</span>
            </div>
          ))}
        </div>

        <ConfigFields name={name} url={url} apiKey={apiKey} onName={setName} onUrl={setUrl} onApiKey={setApiKey} />

        {testResult && !testResult.ok && (
          <ErrorBanner message={testResult.error ?? 'Connection failed'} />
        )}

        <div className="flex items-center justify-between">
          <Btn variant="ghost" size="sm" onClick={() => setStep('mode')}>← Back</Btn>
          <Btn variant="primary" size="sm" loading={testing} onClick={() => handleTest('local')}>
            Test &amp; connect
          </Btn>
        </div>
      </div>
    </WizardShell>
  )

  // ── Remote setup ─────────────────────────────────────────────────────────────
  if (step === 'remote') return (
    <WizardShell step={3} total={3} title="Connect to remote vault">
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Run Obsidian with the Local REST API plugin on the remote machine, then enter its address below.
          Use HTTP (port 27123) to avoid certificate issues.
        </p>

        <ConfigFields name={name} url={url} apiKey={apiKey} onName={setName} onUrl={setUrl} onApiKey={setApiKey}
          urlPlaceholder="http://192.168.1.42:27123" />

        {testResult && !testResult.ok && (
          <ErrorBanner message={testResult.error ?? 'Connection failed'} />
        )}

        <div className="flex items-center justify-between">
          <Btn variant="ghost" size="sm" onClick={() => setStep('mode')}>← Back</Btn>
          <Btn variant="primary" size="sm" loading={testing} onClick={() => handleTest('remote')}>
            Test &amp; connect
          </Btn>
        </div>
      </div>
    </WizardShell>
  )

  // ── Testing ──────────────────────────────────────────────────────────────────
  if (step === 'testing') return (
    <WizardShell step={3} total={3} title="Connecting…">
      <div className="flex flex-col items-center gap-4 py-6">
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Testing connection to {url}…</p>
      </div>
    </WizardShell>
  )

  // ── Done ─────────────────────────────────────────────────────────────────────
  return (
    <WizardShell step={3} total={3} title="All set!">
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="flex items-center justify-center rounded-full"
          style={{ width: 56, height: 56, background: 'color-mix(in srgb, var(--success) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)' }}>
          <CheckCircle2 size={26} style={{ color: 'var(--success)' }} />
        </div>
        <div className="text-center">
          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Connected!</p>
          {testResult?.vaultInfo && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Found {testResult.vaultInfo.mdFiles} notes ({testResult.vaultInfo.totalFiles} total files)
            </p>
          )}
        </div>
        <Btn variant="primary" size="sm" onClick={onDone}>Open graph view →</Btn>
      </div>
    </WizardShell>
  )
}

function WizardShell({ step, total, title, children }: {
  step: number; total: number; title: string; children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-xl"
            style={{ width: 44, height: 44, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', flexShrink: 0 }}>
            <Brain size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Step {step} of {total}
            </p>
            <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          </div>
        </div>

        <div className="flex gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{
              height: 3, borderRadius: 2, flex: 1,
              background: i < step ? 'var(--accent)' : 'var(--border)',
              transition: 'background 0.2s'
            }} />
          ))}
        </div>

        <div className="flex flex-col gap-4 p-5 rounded-xl"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function ConfigFields({ name, url, apiKey, onName, onUrl, onApiKey, urlPlaceholder = 'http://localhost:27123' }: {
  name: string; url: string; apiKey: string
  onName: (v: string) => void; onUrl: (v: string) => void; onApiKey: (v: string) => void
  urlPlaceholder?: string
}) {
  const inputStyle = {
    padding: '7px 10px', fontSize: 13, borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
    color: 'var(--text-primary)', outline: 'none'
  }
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Vault name</span>
        <input value={name} onChange={e => onName(e.target.value)} placeholder="e.g. Personal, Work"
          style={inputStyle} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>API URL</span>
        <input value={url} onChange={e => onUrl(e.target.value)} placeholder={urlPlaceholder}
          style={{ ...inputStyle, fontFamily: 'monospace' }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>API Key</span>
        <input value={apiKey} onChange={e => onApiKey(e.target.value)}
          type="password" placeholder="Token only — not the Bearer prefix"
          style={inputStyle} />
      </label>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded text-xs"
      style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
      <XCircle size={13} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  )
}

// ── Vault switcher dropdown ────────────────────────────────────────────────────

function VaultSwitcher({ onAddVault }: { onAddVault: () => void }) {
  const { vaults, activeVaultUrl, setActiveVault, removeVault, vaultInfo } = useObsidianStore()
  const [open, setOpen] = useState(false)
  const activeVault = vaults.find(v => v.url === activeVaultUrl) ?? vaults[0]

  if (vaults.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors"
        style={{
          background: open ? 'var(--bg-elevated)' : 'transparent',
          color: 'var(--text-primary)',
          border: '1px solid ' + (open ? 'var(--accent)' : 'var(--border)'),
          cursor: 'pointer'
        }}
      >
        <span className="font-medium">{activeVault?.name ?? 'Vault'}</span>
        {vaultInfo && <span style={{ color: 'var(--text-secondary)' }}>· {vaultInfo.mdFiles} notes</span>}
        <ChevronDown size={11} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full mt-1 left-0 z-50 rounded overflow-hidden"
            style={{ minWidth: 180, background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
          >
            {vaults.map(v => (
              <div
                key={v.url}
                className="flex items-center justify-between px-3 py-2 gap-2 group"
                style={{
                  background: v.url === activeVaultUrl ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  cursor: 'pointer'
                }}
                onMouseEnter={e => { if (v.url !== activeVaultUrl) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                onMouseLeave={e => { if (v.url !== activeVaultUrl) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                onClick={() => { setActiveVault(v.url); setOpen(false) }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{v.name}</p>
                  <p className="text-xs truncate font-mono" style={{ color: 'var(--text-secondary)', fontSize: 10 }}>{v.url}</p>
                </div>
                {v.url === activeVaultUrl && (
                  <CheckCircle2 size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                )}
                <button
                  onClick={e => { e.stopPropagation(); removeVault(v.url); setOpen(false) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded"
                  style={{ color: 'var(--danger)', cursor: 'pointer', border: 'none', background: 'transparent' }}
                  title="Remove vault"
                >
                  <XCircle size={12} />
                </button>
              </div>
            ))}

            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer"
              style={{ borderTop: '1px solid var(--border)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              onClick={() => { onAddVault(); setOpen(false) }}
            >
              <Plus size={12} style={{ color: 'var(--accent)' }} />
              <span className="text-xs" style={{ color: 'var(--accent)' }}>Add vault…</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main view (graph + header) ────────────────────────────────────────────────

// ── Agent access control ───────────────────────────────────────────────────────
// Governs how much of the vault the gateway's AGENTS can reach (the app itself always
// has full access). Writes/removes the obsidian-memory skill on the gateway host.
const ACCESS_OPTIONS: { value: AgentAccess; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: 'off',        label: 'Off',          desc: "Agents can't access the vault",   icon: <Ban size={13} /> },
  { value: 'read-only',  label: 'Read-only',    desc: 'Agents can read & search notes',   icon: <Eye size={13} /> },
  { value: 'read-write', label: 'Read & write', desc: 'Agents can also create & edit notes', icon: <Pencil size={13} /> },
]

function AgentAccessControl() {
  const { agentAccess, setAgentAccess } = useObsidianStore()
  const [open, setOpen] = useState(false)
  const current = ACCESS_OPTIONS.find(o => o.value === agentAccess) ?? ACCESS_OPTIONS[2]

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          color: agentAccess === 'off' ? 'var(--text-secondary)' : 'var(--text-primary)', cursor: 'pointer',
        }}
        title="Control what gateway agents can do with this vault"
      >
        <Bot size={13} style={{ color: agentAccess === 'off' ? 'var(--text-secondary)' : 'var(--accent)' }} />
        <span className="hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>Agents:</span>
        {current.icon}
        <span>{current.label}</span>
        <ChevronDown size={12} style={{ color: 'var(--text-secondary)' }} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-20 rounded shadow-lg overflow-hidden"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', minWidth: 240 }}
        >
          {ACCESS_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => { setAgentAccess(o.value); setOpen(false) }}
              className="flex items-start gap-2.5 w-full px-3 py-2 text-left"
              style={{ background: o.value === agentAccess ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent', cursor: 'pointer', border: 'none' }}
              onMouseEnter={e => { if (o.value !== agentAccess) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
              onMouseLeave={e => { if (o.value !== agentAccess) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <span style={{ color: o.value === agentAccess ? 'var(--accent)' : 'var(--text-secondary)', marginTop: 1 }}>{o.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {o.label}
                  {o.value === agentAccess && <Check size={12} style={{ color: 'var(--accent)' }} />}
                </span>
                <span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MainView({ onAddVault }: { onAddVault: () => void }) {
  const { config, graph, loadingGraph, graphProgress, error, loadGraph } = useObsidianStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 800, h: 600 })

  useEffect(() => {
    if (!graph && !loadingGraph) loadGraph()
  }, [config?.url])

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ w: Math.max(200, width), h: Math.max(200, height) })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 text-sm"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <Brain size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Memory</span>

        <VaultSwitcher onAddVault={onAddVault} />

        {config && (
          <span className="text-xs font-mono px-2 py-0.5 rounded truncate max-w-48 hidden"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            {config.url}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {loadingGraph && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={11} className="animate-spin" />
              Loading graph… {Math.round(graphProgress * 100)}%
            </span>
          )}
          <AgentAccessControl />
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={12} />}
            onClick={loadGraph} loading={loadingGraph} title="Reload graph" />
          <Btn size="sm" variant="ghost" icon={<Unlink size={12} />}
            onClick={() => useObsidianStore.getState().clearConfig()}
            style={{ color: 'var(--text-secondary)' }} title="Disconnect vault" />
        </div>
      </div>

      {/* Graph area */}
      <div ref={containerRef} className="flex flex-1 min-h-0" style={{ position: 'relative' }}>
        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3 max-w-sm text-center">
              <XCircle size={28} style={{ color: 'var(--danger)' }} />
              <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
              <Btn size="sm" variant="outline" onClick={loadGraph}>Retry</Btn>
            </div>
          </div>
        )}

        {!graph && !loadingGraph && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No graph data yet.</p>
          </div>
        )}

        {loadingGraph && !graph && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ background: '#0d1117' }}>
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Loading notes… {Math.round(graphProgress * 100)}%
              </p>
              <div style={{ width: 200, height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${Math.round(graphProgress * 100)}%`,
                  background: 'var(--accent)', transition: 'width 0.3s'
                }} />
              </div>
            </div>
          </div>
        )}

        {graph && (
          <ForceGraph data={graph} width={dims.w} height={dims.h} />
        )}

        {graph && graph.nodes.length > 0 && (
          <div
            className="absolute top-3 left-3 flex flex-col gap-1 text-xs px-3 py-2 rounded"
            style={{ background: 'rgba(13,17,23,0.82)', border: '1px solid rgba(100,100,140,0.25)', color: 'rgba(180,175,200,0.7)', backdropFilter: 'blur(4px)', pointerEvents: 'none' }}
          >
            <span>{graph.nodes.length} notes · {graph.edges.length} links</span>
            <span style={{ opacity: 0.6 }}>Scroll to zoom · drag to pan · hover for title</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

interface Props { onNavigateExtensions: () => void }

export function ObsidianView({ onNavigateExtensions }: Props) {
  const { config, vaults, loadConfig } = useObsidianStore()
  const { plugins, skills } = useExtensionsStore()
  const [ready, setReady] = useState(false)
  const [showWizard, setShowWizard] = useState(false)

  useEffect(() => {
    loadConfig()
    setReady(true)
  }, [])

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />
      </div>
    )
  }

  const obsidianPlugin = plugins.find(p => /obsidian/i.test(p.id))
  const obsidianSkill  = skills.find(s => /obsidian/i.test(s.id))
  const pluginEnabled  = (obsidianPlugin?.enabled ?? false) || (obsidianSkill?.enabled ?? false)

  if (!pluginEnabled) {
    return <PluginDisabledView onNavigateExtensions={onNavigateExtensions} />
  }

  const entry = obsidianPlugin ?? obsidianSkill
  const pluginConfig = {
    url: entry?.['apiUrl'] as string | undefined,
    apiKey: entry?.['apiKey'] as string | undefined
  }

  if (vaults.length === 0 || showWizard) {
    return (
      <SetupWizard
        pluginConfig={pluginConfig}
        onDone={() => setShowWizard(false)}
      />
    )
  }

  if (!config) return null

  return <MainView onAddVault={() => setShowWizard(true)} />
}
