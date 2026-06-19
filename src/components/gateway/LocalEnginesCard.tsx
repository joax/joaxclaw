import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Loader2, HelpCircle, RefreshCw, Server } from 'lucide-react'
import { useModelsStore } from '../../store/models'
import { useConnectionStore, useIsRemoteGateway } from '../../store/connection'
import { useHelpStore } from '../../store/help'
import {
  detectFromConfig, detectByPort, checkInstance,
  type EngineInstance, type EngineStatus,
} from '../../lib/localEngines'

type RowStatus = 'checking' | EngineStatus

// Settings card: lists detected local LLM engines (Ollama, LM Studio, vLLM, …),
// lets the user set a reachable URL per engine (needed for remote gateways), and
// gives live reachability feedback as the URL is entered.
export function LocalEnginesCard({ gatewayUrl }: { gatewayUrl?: string }) {
  const providers = useModelsStore(s => s.providers)
  const loadModels = useModelsStore(s => s.load)
  const connection = useConnectionStore(s => s.connection)
  const savedConnections = useConnectionStore(s => s.savedConnections)
  const setEngineUrl = useConnectionStore(s => s.setEngineUrl)
  const openHelp = useHelpStore(s => s.openHelp)
  const remote = useIsRemoteGateway()

  const overrides = connection?.engineUrls ?? savedConnections.find(c => c.url === gatewayUrl)?.engineUrls ?? {}

  const [instances, setInstances] = useState<EngineInstance[]>([])
  const [nonce, setNonce] = useState(0)

  useEffect(() => { loadModels() }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      let insts = detectFromConfig(providers)
      if (!remote) {
        const detected = await detectByPort(insts)
        if (cancelled) return
        insts = [...insts, ...detected]
      }
      if (!cancelled) setInstances(insts)
    }
    run()
    return () => { cancelled = true }
  }, [providers, gatewayUrl, remote])

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Local LLM Engines
        </span>
        <button onClick={() => setNonce(n => n + 1)} title="Re-check all" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 2 }}>
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Detected from the gateway config{!remote && ' and by probing default ports'}. Set a reachable URL per
          engine — required when the gateway runs on another host.
          {' '}
          <button onClick={() => openHelp('gateways')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}>
            How? (Tailscale)
          </button>
        </p>

        {instances.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
            No local engines found in the gateway config.
          </p>
        )}

        {instances.map(inst => (
          <EngineRow
            key={inst.key}
            inst={inst}
            remote={remote}
            nonce={nonce}
            override={overrides[inst.key]}
            onSave={url => gatewayUrl && setEngineUrl(gatewayUrl, inst.key, url)}
          />
        ))}
      </div>
    </div>
  )
}

function EngineRow({ inst, remote, override, nonce, onSave }: {
  inst: EngineInstance; remote: boolean; override?: string; nonce: number; onSave: (url: string) => void
}) {
  const [draft, setDraft] = useState(override ?? '')
  const [status, setStatus] = useState<RowStatus>('checking')

  useEffect(() => { setDraft(override ?? '') }, [override])

  const probe = async (url?: string) => {
    setStatus('checking')
    setStatus(await checkInstance(inst, !remote, (url ?? '').trim() || undefined))
  }

  // Probe on mount, when the stored override changes, and on Re-check.
  useEffect(() => { probe(override) }, [inst.key, override, nonce])  // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const v = draft.trim()
    if (v !== (override ?? '')) { onSave(v); /* effect re-probes on override change */ }
    else probe(v)
  }

  const apiLabel = inst.api === 'ollama' ? 'ollama' : 'openai'

  return (
    <div className="rounded p-2.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Server size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{inst.label}</span>
        {inst.isCron && <Tag>cron</Tag>}
        <Tag>{apiLabel}</Tag>
        <Tag>{inst.source}</Tag>
        <div className="flex-1" />
        <StatusPill status={status} remote={remote} />
      </div>

      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder={inst.baseUrl}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '5px 9px', fontSize: 11, fontFamily: 'monospace',
          borderRadius: 'var(--radius)', border: '1px solid var(--border)',
          background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none',
        }}
      />
      <p className="mt-1" style={{ fontSize: 9, color: 'var(--text-secondary)', opacity: 0.8 }}>
        {draft.trim()
          ? <>Override · config URL <code style={mono}>{inst.baseUrl}</code></>
          : <>Using config URL <code style={mono}>{inst.baseUrl}</code></>}
      </p>
    </div>
  )
}

function StatusPill({ status, remote }: { status: RowStatus; remote: boolean }) {
  if (status === 'checking') {
    return <Pill color="var(--text-secondary)"><Loader2 size={9} className="animate-spin" /> Checking…</Pill>
  }
  if (status === 'up') {
    return <Pill color="var(--success)"><CheckCircle2 size={9} /> Reachable</Pill>
  }
  if (status === 'down') {
    return <Pill color="var(--warning)"><XCircle size={9} /> Unreachable</Pill>
  }
  return <Pill color="var(--text-secondary)"><HelpCircle size={9} /> {remote ? 'Unknown — set a URL' : 'Unknown'}</Pill>
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1" style={{ fontSize: 9, fontWeight: 600, color, flexShrink: 0 }}>
      {children}
    </span>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 8, color: 'var(--text-secondary)', padding: '0 4px', borderRadius: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
      {children}
    </span>
  )
}

const mono: React.CSSProperties = { fontFamily: 'monospace' }
