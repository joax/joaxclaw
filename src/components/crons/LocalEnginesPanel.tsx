import { useEffect, useRef, useState } from 'react'
import { Server, CheckCircle2, XCircle, HelpCircle, ChevronDown, Zap, Boxes } from 'lucide-react'
import type { CronJob } from '../../lib/types'
import { useModelsStore } from '../../store/models'
import { useConnectionStore } from '../../store/connection'
import { gatewayHost, isLocalGateway } from '../../lib/ollamaHealth'
import {
  detectFromConfig, detectByPort, groupEngines, checkInstance,
  type EngineGroup, type EngineInstance, type EngineStatus,
} from '../../lib/localEngines'

// Generalized local-LLM-engine isolation panel. Discovers engines (Ollama, LM Studio,
// vLLM, llama.cpp, etc.) from the gateway config and, on a local gateway, by probing
// default ports — then shows main vs. isolated "cron" instance health and whether
// scheduled jobs are isolated from interactive traffic.

function statusColor(s?: EngineStatus): string {
  return s === 'up' ? 'var(--success)' : s === 'down' ? 'var(--warning)' : 'var(--text-secondary)'
}

function modelPrefix(j: CronJob): string {
  const model = j.payload?.kind === 'agentTurn' ? (j.payload.model ?? '') : ''
  return model.split('/')[0]
}

export function LocalEnginesPanel({ jobs }: { jobs: CronJob[] }) {
  const providers = useModelsStore(s => s.providers)
  const loadModels = useModelsStore(s => s.load)
  const connectionUrl = useConnectionStore(s => s.connection?.url)
  const engineUrls = useConnectionStore(s => s.connection?.engineUrls)

  const [groups, setGroups] = useState<EngineGroup[]>([])
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({})
  const [open, setOpen] = useState(false)
  const autoExpanded = useRef(false)

  const remote = !isLocalGateway(gatewayHost(connectionUrl))

  useEffect(() => { loadModels() }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const local = !remote
      let instances: EngineInstance[] = detectFromConfig(providers)
      // Discover unconfigured engines on default ports — on the client locally, or on
      // the gateway host (via the joaxclaw-fs engines.* methods) when it's remote.
      const detected = await detectByPort(instances, remote)
      if (cancelled) return
      instances = [...instances, ...detected]
      const grouped = groupEngines(instances)
      const next: Record<string, EngineStatus> = {}
      await Promise.all(instances.map(async i => { next[i.key] = await checkInstance(i, local, engineUrls?.[i.key]) }))
      if (cancelled) return
      setGroups(grouped)
      setStatuses(next)
    }
    run()
    const id = setInterval(run, 6000)
    return () => { cancelled = true; clearInterval(id) }
  }, [providers, connectionUrl, remote, engineUrls])

  // Auto-expand once if a confirmed problem exists (cron down, or job contention).
  const anyIssue = groups.some(g => {
    const cronDown = g.cron && statuses[g.cron.key] === 'down'
    const contention = !!g.cron && g.main?.source === 'config' &&
      jobs.some(j => modelPrefix(j) === g.main!.key)
    return cronDown || contention
  })
  useEffect(() => {
    if (anyIssue && !autoExpanded.current) { setOpen(true); autoExpanded.current = true }
  }, [anyIssue])

  if (groups.length === 0) return null

  const upCount = groups.filter(g => statuses[g.main?.key ?? ''] === 'up').length

  return (
    <div className="mx-2 mb-2 rounded" style={{ border: '1px solid var(--border)', overflow: 'hidden', flexShrink: 0 }}>
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-3 py-2"
        style={{ background: 'var(--bg-elevated)', cursor: 'pointer', border: 'none', textAlign: 'left' }}
      >
        <Boxes size={12} style={{ color: anyIssue ? 'var(--warning)' : 'var(--accent)', flexShrink: 0 }} />
        <span className="flex-1 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Local LLM Engines</span>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{upCount}/{groups.length} up</span>
        <ChevronDown size={11} style={{ color: 'var(--text-secondary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div className="flex flex-col gap-2 p-2.5">
          {remote && (
            <p style={{ fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              Gateway is remote — engine health is checked on the gateway host via the joaxclaw-fs plugin.
              Engines show as <em>unknown</em> until that plugin is installed (Teams/Processes → Install via agent).
            </p>
          )}
          {groups.map(g => (
            <EngineCard key={g.engineId} group={g} statuses={statuses} jobs={jobs} remote={remote} />
          ))}
        </div>
      )}
    </div>
  )
}

function EngineCard({ group, statuses, jobs, remote }: {
  group: EngineGroup; statuses: Record<string, EngineStatus>; jobs: CronJob[]; remote: boolean
}) {
  const main = group.main
  const cron = group.cron
  const mainStatus = main ? statuses[main.key] : undefined
  const cronStatus = cron ? statuses[cron.key] : undefined

  // Job isolation only applies when both instances are real config providers.
  const mainId = main?.source === 'config' ? main.key : null
  const cronId = cron?.source === 'config' ? cron.key : null
  const engineJobs = jobs.filter(j => {
    const p = modelPrefix(j)
    return p === mainId || p === cronId
  })
  const contendingJobs = mainId && cronId ? engineJobs.filter(j => modelPrefix(j) === mainId) : []
  const isolatedJobs = cronId ? engineJobs.filter(j => modelPrefix(j) === cronId) : []

  return (
    <div className="rounded p-2.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Server size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>{group.label}</span>
        {main?.source === 'detected' && (
          <span style={{ fontSize: 9, color: 'var(--text-secondary)', padding: '1px 5px', borderRadius: 3, background: 'var(--bg-elevated)' }}>
            detected · not configured
          </span>
        )}
        {cron && cronStatus === 'up' && contendingJobs.length === 0 && isolatedJobs.length > 0 && (
          <span style={{ fontSize: 9, color: 'var(--success)', padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--success) 12%, transparent)' }}>
            ✓ isolated
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {main && <InstanceLine role="Main" inst={main} status={mainStatus} />}
        {cron
          ? <InstanceLine role="CRON" inst={cron} status={cronStatus} />
          : <div className="flex items-center gap-1.5">
              <HelpCircle size={10} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>No isolated instance configured</span>
            </div>
        }
        {cronId && engineJobs.length > 0 && (
          <div className="flex items-center gap-1.5">
            {contendingJobs.length === 0
              ? <CheckCircle2 size={10} style={{ color: 'var(--success)', flexShrink: 0 }} />
              : <XCircle size={10} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', flex: 1 }}>Jobs isolated</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: contendingJobs.length === 0 ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
              {isolatedJobs.length}/{engineJobs.length}
            </span>
          </div>
        )}
      </div>

      {/* Setup hints */}
      {!remote && cron && cronStatus === 'down' && (
        <Hint icon="warn">Isolated instance is offline — start it so scheduled jobs don't preempt interactive chats.</Hint>
      )}
      {cron?.source === 'detected' && (
        <Hint icon="info">
          Isolated instance running at <code style={code}>{cron.baseUrl}</code>, but not a configured provider — add a
          <code style={code}>{group.engineId}-cron</code> provider so jobs can target it.
        </Hint>
      )}
      {!cron && engineJobs.length > 0 && (
        <Hint icon="warn">
          {engineJobs.length} job{engineJobs.length > 1 ? 's use' : ' uses'} <code style={code}>{mainId}/</code> — add an
          isolated <code style={code}>{mainId}-cron</code> provider so background runs don't interrupt chats.
        </Hint>
      )}
      {contendingJobs.length > 0 && (
        <Hint icon="warn">
          {contendingJobs.length} job{contendingJobs.length > 1 ? 's use' : ' uses'} <code style={code}>{mainId}/</code> —
          switch the prefix to <code style={code}>{cronId}/</code> to isolate.
        </Hint>
      )}
      {main?.source === 'detected' && (
        <Hint icon="info">
          Running at <code style={code}>{main.baseUrl}</code>. Add it as a provider in the gateway config to use it.
        </Hint>
      )}
    </div>
  )
}

function InstanceLine({ role, inst, status }: { role: string; inst: EngineInstance; status?: EngineStatus }) {
  const color = statusColor(status)
  const Icon = status === 'up' ? CheckCircle2 : status === 'down' ? XCircle : HelpCircle
  const text = status === 'up' ? 'running' : status === 'down' ? 'offline' : 'unknown'
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={10} style={{ color, flexShrink: 0 }} />
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', width: 38, flexShrink: 0 }}>{role}</span>
      <span className="truncate" style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)', flex: 1 }}>{inst.baseUrl}</span>
      <span style={{ fontSize: 9, color, fontWeight: 600, flexShrink: 0 }}>{text}</span>
    </div>
  )
}

function Hint({ icon, children }: { icon: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 mt-2 pt-2" style={{ borderTop: '1px dashed var(--border)' }}>
      <Zap size={10} style={{ color: icon === 'warn' ? 'var(--warning)' : 'var(--text-secondary)', flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}

const code: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 9, padding: '0 3px', borderRadius: 3,
  background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)',
}
