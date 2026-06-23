import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, PhoneOff, Phone, Settings2, Captions, AlertCircle, Wrench, KeyRound, Bot } from 'lucide-react'
import { useTalkStore, providersForMode, type TalkPhase, type VisualizerStyle } from '../../store/talk'
import { useConnectionStore } from '../../store/connection'
import { useAgentsStore } from '../../store/agents'
import { Visualizer, type VizSource } from './Visualizer'

// Talk mode (Phase 1): a click-to-start voice conversation with your agent over the
// gateway's Talk API. The gateway owns VAD/barge-in/turn-taking; this renders the
// reactive orb, live captions, and controls. No avatar yet (see src/lib/TALK.md).

const PHASE_LABEL: Record<TalkPhase, string> = {
  idle: 'Tap to start',
  connecting: 'Connecting…',
  listening: 'Listening',
  user_speaking: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  tool_running: 'Working…',
  error: 'Error',
}

// Orb colour per phase (CSS var names).
function phaseColor(phase: TalkPhase): string {
  switch (phase) {
    case 'speaking': return 'var(--success)'
    case 'thinking':
    case 'tool_running': return 'color-mix(in srgb, var(--accent) 60%, #a855f7)'
    case 'error': return 'var(--danger)'
    case 'idle': return 'var(--text-secondary)'
    default: return 'var(--accent)'
  }
}

const VIZ_LABEL: Record<VisualizerStyle, string> = { orb: 'Orb', bars: 'Bars', radial: 'Radial', blob: 'Blob' }

export function TalkView() {
  const {
    phase, muted, micLevel, agentLevel, transcript, toolActivity, error, catalog, config, visualizer,
    loadCatalog, setConfig, setVisualizer, start, stop, toggleMute, interrupt,
  } = useTalkStore()
  const connected = useConnectionStore(s => s.status === 'connected')
  const { agents, defaultId, fetch: fetchAgents } = useAgentsStore()
  const [showSettings, setShowSettings] = useState(false)
  const [showCaptions, setShowCaptions] = useState(true)

  useEffect(() => { if (connected && !catalog) loadCatalog() }, [connected])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (connected && agents.length === 0) fetchAgents() }, [connected])  // eslint-disable-line react-hooks/exhaustive-deps
  // End the session if we leave the view / disconnect.
  useEffect(() => () => { void useTalkStore.getState().stop() }, [])
  useEffect(() => { if (!connected && phase !== 'idle') void stop() }, [connected])  // eslint-disable-line react-hooks/exhaustive-deps

  const active = phase !== 'idle' && phase !== 'error'
  // The orb reacts to the mic while listening, to the agent while it speaks.
  const level = phase === 'speaking' || phase === 'tool_running' ? agentLevel
    : (phase === 'listening' || phase === 'user_speaking') ? micLevel : 0
  const source: VizSource = phase === 'speaking' || phase === 'tool_running' ? 'agent'
    : (phase === 'listening' || phase === 'user_speaking') ? 'mic' : 'idle'

  // Phase 1 talks over the realtime path; providers come from the mode's provider list.
  const modeProviders = providersForMode(catalog, config.mode)
  const hasConfiguredProvider = modeProviders.some(p => p.configured)
  const needsKey = !!catalog && !hasConfiguredProvider
  const providerLabel = modeProviders.find(p => p.id === config.provider)?.label ?? config.provider
  const brainIsAgent = config.brain === 'agent-consult'
  const effectiveAgentId = config.agentId ?? defaultId ?? undefined
  const agent = agents.find(a => a.id === effectiveAgentId)

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <Mic size={16} style={{ color: 'var(--accent)' }} />
        <span className="font-semibold text-sm flex-1" style={{ color: 'var(--text-primary)' }}>Talk</span>
        <select value={visualizer} onChange={e => setVisualizer(e.target.value as VisualizerStyle)} title="Visualizer"
          style={{ fontSize: 11, padding: '3px 7px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', outline: 'none', cursor: 'pointer' }}>
          {(['orb', 'bars', 'radial', 'blob'] as VisualizerStyle[]).map(v => <option key={v} value={v}>{VIZ_LABEL[v]}</option>)}
        </select>
        <IconBtn title="Captions" active={showCaptions} onClick={() => setShowCaptions(v => !v)}><Captions size={15} /></IconBtn>
        <IconBtn title="Settings" active={showSettings} onClick={() => setShowSettings(v => !v)}><Settings2 size={15} /></IconBtn>
      </div>

      {/* Who answers + how */}
      {connected && (
        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 px-5 py-1.5 shrink-0 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <Bot size={12} style={{ color: 'var(--accent)' }} />
          {brainIsAgent ? (
            <span>Talking to <b style={{ color: 'var(--text-primary)' }}>{agent?.id ?? effectiveAgentId ?? 'default agent'}</b>{agent?.model?.primary && <> (<code style={{ fontFamily: 'monospace' }}>{agent.model.primary}</code>)</>}</span>
          ) : (
            <span>Talking to the <b style={{ color: 'var(--text-primary)' }}>{providerLabel ?? 'realtime'}</b> model directly</span>
          )}
          <span style={{ opacity: 0.5 }}>·</span>
          <span>voice: {providerLabel ?? '—'}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>brain: {config.brain}</span>
        </div>
      )}

      {showSettings && (
        <SettingsBar catalog={catalog} config={config} setConfig={setConfig} disabled={active}
          agents={agents} defaultId={defaultId} setProviderKey={useTalkStore.getState().setProviderKey} />
      )}

      {/* Stage */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-6" style={{ minHeight: 230 }}>
        <div style={{ width: 230, height: 230, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Visualizer style={visualizer} phase={phase} level={level} source={source} onInterrupt={interrupt} />
        </div>

        <div className="text-center" style={{ minHeight: 24 }}>
          <p className="text-sm font-medium" style={{ color: phaseColor(phase) }}>
            {phase === 'error' ? (error ?? 'Error') : PHASE_LABEL[phase]}
          </p>
          {toolActivity && (
            <span className="inline-flex items-center gap-1 mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <Wrench size={11} /> {toolActivity}
            </span>
          )}
        </div>

        {!connected && (
          <Notice icon={<AlertCircle size={14} />}>Connect to a gateway to start Talk.</Notice>
        )}
        {connected && needsKey && (
          <Notice icon={<AlertCircle size={14} />}>
            Talk needs a configured <b style={{ color: 'var(--text-primary)' }}>{config.mode === 'realtime' ? 'realtime voice' : config.mode}</b> provider
            {modeProviders.length > 0 && <> — available: {modeProviders.map(p => p.label).join(', ')}</>}.
            Set its key on the gateway at <code style={{ fontFamily: 'monospace' }}>talk.providers.&lt;id&gt;.apiKey</code>
            {config.mode === 'realtime' && <> (ElevenLabs is transcription-only and can&apos;t drive realtime Talk)</>}.
          </Notice>
        )}
      </div>

      {/* Captions */}
      {showCaptions && transcript.length > 0 && (
        <Captionsfeed lines={transcript} />
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        {!active ? (
          <BigBtn color="var(--accent)" disabled={!connected || needsKey} onClick={() => start()}>
            <Phone size={16} /> Start
          </BigBtn>
        ) : (
          <>
            <RoundBtn title={muted ? 'Unmute' : 'Mute'} active={muted} onClick={toggleMute}>
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </RoundBtn>
            <BigBtn color="var(--danger)" onClick={() => stop()}>
              <PhoneOff size={16} /> End
            </BigBtn>
          </>
        )}
      </div>
    </div>
  )
}

// ── bits ────────────────────────────────────────────────────────────────────────

function Captionsfeed({ lines }: { lines: { id: string; role: 'user' | 'assistant'; text: string; final: boolean }[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight) }, [lines])
  return (
    <div ref={ref} className="overflow-y-auto px-5 py-3 shrink-0 space-y-1.5" style={{ maxHeight: 140, borderTop: '1px solid var(--border)' }}>
      {lines.filter(l => l.text.trim()).map(l => (
        <div key={l.id} className="text-xs" style={{ color: l.role === 'assistant' ? 'var(--text-primary)' : 'var(--text-secondary)', opacity: l.final ? 1 : 0.65 }}>
          <span style={{ fontWeight: 600, color: l.role === 'assistant' ? 'var(--accent)' : 'var(--text-secondary)' }}>{l.role === 'assistant' ? 'Agent' : 'You'}: </span>
          {l.text}
        </div>
      ))}
    </div>
  )
}

function SettingsBar({ catalog, config, setConfig, disabled, agents, defaultId, setProviderKey }: {
  catalog: ReturnType<typeof useTalkStore.getState>['catalog']
  config: ReturnType<typeof useTalkStore.getState>['config']
  setConfig: (p: Partial<ReturnType<typeof useTalkStore.getState>['config']>) => void
  disabled: boolean
  agents: ReturnType<typeof useAgentsStore.getState>['agents']
  defaultId: string | null
  setProviderKey: (id: string, key: string) => Promise<boolean>
}) {
  const modeProviders = providersForMode(catalog, config.mode)
  const provider = modeProviders.find(p => p.id === config.provider)
  // Phase 1 supports the realtime path (gateway-relay). stt-tts needs a managed-room
  // client we haven't built; offer it only if the gateway lists it, but it'll explain itself.
  const PHASE1_MODES = (catalog?.modes ?? ['realtime']).filter(m => m === 'realtime')
  return (
    <div className="flex flex-col gap-2 px-5 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <Select label="Mode" value={config.mode} disabled={disabled || PHASE1_MODES.length <= 1} onChange={v => setConfig({ mode: v, provider: undefined, voice: undefined })} options={PHASE1_MODES} />
        <Select label="Provider" value={config.provider ?? ''} disabled={disabled} onChange={v => setConfig({ provider: v, voice: undefined })}
          options={modeProviders.map(p => ({ value: p.id, label: `${p.label}${p.configured ? '' : ' (no key)'}` }))} placeholder="default" />
        {provider?.voices?.length ? (
          <Select label="Voice" value={config.voice ?? ''} disabled={disabled} onChange={v => setConfig({ voice: v })} options={provider.voices} placeholder="default" />
        ) : null}
        <Select label="Brain" value={config.brain} disabled={disabled} onChange={v => setConfig({ brain: v })} options={catalog?.brains ?? ['agent-consult']} />
        {config.brain === 'agent-consult' && (
          <Select label="Agent" value={config.agentId ?? ''} disabled={disabled} onChange={v => setConfig({ agentId: v || undefined })}
            options={agents.map(a => ({ value: a.id, label: a.id }))} placeholder={`default${defaultId ? ` (${defaultId})` : ''}`} />
        )}
      </div>
      {/* Set the realtime provider's key (talk.providers.<id>.apiKey) right here. */}
      {provider && !provider.configured && !disabled && (
        <ProviderKeyField providerId={provider.id} label={provider.label} onSave={setProviderKey} />
      )}
    </div>
  )
}

function ProviderKeyField({ providerId, label, onSave }: { providerId: string; label: string; onSave: (id: string, key: string) => Promise<boolean> }) {
  const [key, setKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const save = async () => { if (!key.trim()) return; setSaving(true); await onSave(providerId, key); setSaving(false); setKey('') }
  return (
    <div className="flex items-center gap-1.5">
      <KeyRound size={12} style={{ color: 'var(--warning)', flexShrink: 0 }} />
      <span className="text-xs" style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label} key</span>
      <input value={key} onChange={e => setKey(e.target.value)} type={reveal ? 'text' : 'password'} placeholder="paste API key" disabled={saving}
        onKeyDown={e => { if (e.key === 'Enter') void save() }}
        style={{ flex: 1, minWidth: 140, fontSize: 11, fontFamily: 'monospace', padding: '4px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none' }} />
      <button onClick={() => setReveal(r => !r)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 10 }}>{reveal ? 'hide' : 'show'}</button>
      <button onClick={save} disabled={saving || !key.trim()} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer', color: 'white', background: 'var(--accent)', opacity: saving || !key.trim() ? 0.5 : 1 }}>{saving ? '…' : 'Save'}</button>
      <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.6, whiteSpace: 'nowrap' }}>→ talk.providers.{providerId}.apiKey</span>
    </div>
  )
}

function Select({ label, value, onChange, options, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string
  options: (string | { value: string; label: string })[]
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
      {label}
      <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
        style={{ fontSize: 12, padding: '3px 6px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none', opacity: disabled ? 0.6 : 1 }}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function Notice({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded text-xs max-w-md" style={{ background: 'color-mix(in srgb, var(--warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      <span style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span>{children}</span>
    </div>
  )
}

function BigBtn({ color, onClick, disabled, children }: { color: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center gap-2 text-sm font-medium"
      style={{ padding: '9px 20px', borderRadius: 999, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', color: 'white', background: color, opacity: disabled ? 0.45 : 1 }}>
      {children}
    </button>
  )
}

function RoundBtn({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="flex items-center justify-center"
      style={{ width: 42, height: 42, borderRadius: 999, cursor: 'pointer', color: active ? 'white' : 'var(--text-primary)', background: active ? 'var(--danger)' : 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      {children}
    </button>
  )
}

function IconBtn({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 'var(--radius)', cursor: 'pointer', color: active ? 'var(--accent)' : 'var(--text-secondary)', background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none', border: 'none' }}>
      {children}
    </button>
  )
}
