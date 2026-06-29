import { useEffect, useState } from 'react'
import { Play, Plus, RefreshCw, GitBranch, Users, ArrowRight, FileText, Loader2, CheckCircle2, XCircle, Clock, X, Trash2, ChevronDown } from 'lucide-react'
import { useProcessesStore, processesDir, type ProcessRun } from '../../store/processes'
import { useAgentsStore } from '../../store/agents'
import { useConnectionStore } from '../../store/connection'
import { ModelIcon } from '../ui/ModelIcon'
import { Btn } from '../ui/Btn'
import type { ProcessDef } from '../../lib/processParser'
import { processTemplate, serializeProcess } from '../../lib/processParser'
import { ProcessGraphEditor } from './ProcessGraphEditor'
import { ProcessMonitor } from './ProcessMonitor'
import { RemotePluginNotice } from '../common/RemotePluginNotice'

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  if (status === 'running') return 'var(--accent)'
  if (status === 'done')    return 'var(--success)'
  if (status === 'error')   return 'var(--danger)'
  return 'var(--text-secondary)'
}

function StatusDot({ status }: { status: string }) {
  if (status === 'running') return <Loader2 size={11} className="animate-spin" style={{ color: statusColor(status) }} />
  if (status === 'done')    return <CheckCircle2 size={11} style={{ color: statusColor(status) }} />
  if (status === 'error')   return <XCircle size={11} style={{ color: statusColor(status) }} />
  return <Clock size={11} style={{ color: statusColor(status) }} />
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ── Process sidebar item ──────────────────────────────────────────────────────

function ProcessItem({ def, active, run, onClick, onDelete }: {
  def: ProcessDef
  active: boolean
  run?: ProcessRun
  onClick: () => void
  onDelete: () => Promise<boolean>
}) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'deleting'>('idle')

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (phase === 'confirm') {
      setPhase('deleting')
      await onDelete()
      setPhase('idle')
    } else if (phase === 'idle') {
      setPhase('confirm')
    }
  }

  return (
    <div
      className="group relative flex flex-col px-3 py-2.5 cursor-pointer"
      style={{
        background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'transparent',
        borderRadius: 'var(--radius)',
        borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        marginBottom: 1,
        gap: 3,
      }}
      onClick={onClick}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'
        if (phase !== 'deleting') setPhase('idle')
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <StatusDot status={run?.status ?? 'idle'} />
        <span className="flex-1 text-sm font-medium truncate" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}>
          {def.name}
        </span>
        <button
          onClick={handleDelete}
          disabled={phase === 'deleting'}
          style={{
            // When idle, let the Tailwind classes below drive the hover-reveal. An
            // inline opacity:0 here would override the group-hover class (inline styles
            // beat stylesheet rules), leaving the button permanently invisible — i.e.
            // "no way to delete". Force it visible only while confirming/deleting.
            ...(phase !== 'idle' ? { opacity: 1 } : null),
            background: phase === 'confirm' ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : 'none',
            border: phase === 'confirm' ? '1px solid color-mix(in srgb, var(--danger) 40%, transparent)' : 'none',
            borderRadius: 4, cursor: phase === 'deleting' ? 'default' : 'pointer',
            padding: '2px 5px', display: 'flex', alignItems: 'center', gap: 3,
            color: 'var(--danger)', flexShrink: 0, transition: 'opacity 0.15s',
          }}
          className="opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={11} />
          {phase === 'confirm'  && <span style={{ fontSize: 10, whiteSpace: 'nowrap' }}>Confirm?</span>}
          {phase === 'deleting' && <span style={{ fontSize: 10, whiteSpace: 'nowrap' }}>Deleting…</span>}
        </button>
      </div>
      <div className="flex items-center gap-1.5 ml-5 min-w-0">
        <Users size={9} style={{ color: 'var(--text-secondary)', opacity: 0.6, flexShrink: 0 }} />
        <span className="text-xs truncate" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
          {def.agents.map(a => a.role ?? a.id).join(' → ')}
        </span>
        {run?.status === 'running' && run.currentAgent && (
          <span className="ml-auto text-xs shrink-0 font-mono" style={{ color: 'var(--accent)', opacity: 0.8 }}>
            {run.currentAgent}
          </span>
        )}
      </div>
      {run?.status === 'running' && (() => {
        const graphSteps = def.graph?.nodes.filter(n => n.type !== 'start' && n.type !== 'end').length ?? 0
        const total   = run.progress?.total   ?? graphSteps
        const current = run.progress?.current ?? run.stepsDone
        if (!total) return null
        return (
          <div style={{ marginLeft: 5, marginTop: 4, height: 2, borderRadius: 1, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, (current / total) * 100)}%`, background: 'var(--accent)', borderRadius: 1, transition: 'width 0.4s ease' }} />
          </div>
        )
      })()}
    </div>
  )
}

// ── Workflow graph (overview) ─────────────────────────────────────────────────

function WorkflowGraph({ def, currentAgent }: { def: ProcessDef; currentAgent?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      {def.agents.map((agent, i) => {
        const isActive = currentAgent === agent.id
        const isStart  = def.workflow.startAgent === agent.id
        return (
          <div key={agent.id} className="flex items-center gap-1.5">
            <div
              className="flex flex-col items-center px-2.5 py-1.5 rounded text-xs"
              style={{
                border: `1px solid ${isActive ? 'var(--accent)' : isStart ? 'color-mix(in srgb, var(--accent) 30%, var(--border))' : 'var(--border)'}`,
                background: isActive ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : isStart ? 'color-mix(in srgb, var(--accent) 6%, var(--bg-elevated))' : 'var(--bg-elevated)',
                minWidth: 80,
              }}
            >
              {agent.model && <ModelIcon model={agent.model} size={9} style={{ marginBottom: 2 }} />}
              <span className="font-semibold truncate max-w-[100px]" style={{ color: isActive ? 'var(--accent)' : 'var(--text-primary)' }}>
                {agent.role ?? agent.id}
              </span>
              <span className="font-mono truncate max-w-[100px]" style={{ color: 'var(--text-secondary)', opacity: 0.6, fontSize: 9 }}>
                {agent.id}
              </span>
            </div>
            {i < def.agents.length - 1 && <ArrowRight size={12} style={{ color: 'var(--text-secondary)', opacity: 0.4, flexShrink: 0 }} />}
          </div>
        )
      })}
      {def.agents.length > 0 && (
        <>
          <ArrowRight size={12} style={{ color: 'var(--text-secondary)', opacity: 0.4, flexShrink: 0 }} />
          <span className="text-xs px-2 py-1 rounded" style={{ border: '1px dashed var(--border)', color: 'var(--text-secondary)', opacity: 0.5 }}>END</span>
        </>
      )}
    </div>
  )
}

// ── Controller agent picker ───────────────────────────────────────────────────

function ControllerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { agents } = useAgentsStore()
  const [open, setOpen] = useState(false)
  const selected = agents.find(a => a.id === value)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Controller Agent — Team Lead for this process"
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: selected ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 13 }}>{selected?.identity?.emoji ?? '🤖'}</span>
        <span className="truncate" style={{ maxWidth: 120 }}>{selected ? (selected.identity?.name ?? selected.name ?? selected.id) : 'Team Lead…'}</span>
        <ChevronDown size={10} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 40, width: 220, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
            {agents.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>No agents configured</div>}
            {agents.map(a => (
              <button key={a.id} onClick={() => { onChange(a.id); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', background: a.id === value ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span>{a.identity?.emoji ?? '🤖'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.identity?.name ?? a.name ?? a.id}
                  </div>
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.6 }}>{a.id}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function ProcessDetail({ def }: { def: ProcessDef }) {
  const { runs, startRun, stopRun, save } = useProcessesStore()
  const { agents } = useAgentsStore()
  const run = runs[def.id]

  const [tab,          setTab         ] = useState<'design' | 'monitor' | 'docs'>('design')
  const [controllerAgentId, setControllerAgentId] = useState(def.controllerAgentId ?? '')
  const [isStarting,   setIsStarting  ] = useState(false)

  // Sync picker if def changes
  useEffect(() => {
    if (def.controllerAgentId && !controllerAgentId) setControllerAgentId(def.controllerAgentId)
  }, [def.controllerAgentId])

  // Auto-switch to Monitor tab when a run starts
  useEffect(() => {
    if (run?.status === 'running') setTab('monitor')
  }, [run?.status])

  const handleSave = async (updated: ProcessDef) => {
    await save(updated.path, serializeProcess(updated))
  }

  const handleControllerChange = async (agentId: string) => {
    setControllerAgentId(agentId)
    // Persist controller choice to the process file
    const updated: ProcessDef = { ...def, controllerAgentId: agentId }
    await save(updated.path, serializeProcess(updated))
  }

  const handleRun = async () => {
    if (!controllerAgentId) return
    setIsStarting(true)
    await startRun(def.id, def, controllerAgentId)
    setIsStarting(false)
  }

  const handleStop = () => stopRun(def.id)

  const isRunning = run?.status === 'running'
  const controllerAgent = agents.find(a => a.id === controllerAgentId)

  const TAB_STYLE = (t: typeof tab): React.CSSProperties => ({
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '6px 12px', fontSize: 12, fontWeight: 500,
    color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
    borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
    marginBottom: -1,
  })

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{def.name}</h2>
            {def.description && (
              <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{def.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ControllerPicker value={controllerAgentId} onChange={handleControllerChange} />
            {isRunning ? (
              <Btn size="sm" variant="outline" icon={<X size={12} />} onClick={handleStop} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                Stop
              </Btn>
            ) : (
              <Btn size="sm" loading={isStarting} icon={<Play size={12} />} onClick={handleRun} disabled={!controllerAgentId || isStarting}
                title={!controllerAgentId ? 'Select a controller agent first' : undefined}>
                Run
              </Btn>
            )}
          </div>
        </div>

        {/* Meta chips */}
        <div className="flex items-center gap-3 mt-2.5 flex-wrap text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span className="flex items-center gap-1">
            <Users size={10} /> {def.agents.length} agent{def.agents.length !== 1 ? 's' : ''}
          </span>
          {def.trigger && def.trigger !== 'manual' && (
            <span className="px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 10 }}>
              {def.trigger}
            </span>
          )}
          {def.tags?.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))', color: 'var(--accent)', fontSize: 10 }}>
              {t}
            </span>
          ))}
          {controllerAgent && (
            <span className="flex items-center gap-1 ml-auto" style={{ opacity: 0.6, fontSize: 10 }}>
              Team Lead: {controllerAgent.identity?.name ?? controllerAgent.id}
            </span>
          )}
          <span className="font-mono truncate" style={{ opacity: 0.4, fontSize: 10 }}>{def.path.split('/').slice(-2).join('/')}</span>
        </div>

        {/* Run status banner (non-monitor tabs) */}
        {run && run.status !== 'idle' && tab !== 'monitor' && (
          <div
            className="flex items-center gap-2 mt-3 px-3 py-2 rounded text-xs"
            style={{ background: `color-mix(in srgb, ${statusColor(run.status)} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${statusColor(run.status)} 25%, transparent)`, color: statusColor(run.status), cursor: 'pointer' }}
            onClick={() => setTab('monitor')}
          >
            <StatusDot status={run.status} />
            {run.status === 'running'
              ? <>Running · {run.currentAgent ? <span className="font-mono">{run.currentAgent}</span> : 'Starting…'} — <span style={{ textDecoration: 'underline' }}>view monitor</span></>
              : run.status === 'done'
              ? <>Completed · {run.stepsDone} steps · {fmtDuration((run.finishedAt ?? Date.now()) - run.startedAt)} — <span style={{ textDecoration: 'underline' }}>view monitor</span></>
              : run.status === 'error'
              ? <>Error: {run.error ?? 'unknown'} — <span style={{ textDecoration: 'underline' }}>view monitor</span></>
              : run.status
            }
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 px-5 pt-1 gap-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button style={TAB_STYLE('design')}  onClick={() => setTab('design')}>Design</button>
        <button style={TAB_STYLE('monitor')} onClick={() => setTab('monitor')}>
          Monitor
          {run && run.status !== 'idle' && (
            <span style={{ marginLeft: 4, display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: statusColor(run.status), verticalAlign: 'middle' }} />
          )}
        </button>
        <button style={TAB_STYLE('docs')} onClick={() => setTab('docs')}>Docs</button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0" style={{ overflow: tab === 'design' ? 'hidden' : tab === 'monitor' ? 'hidden' : 'auto' }}>

        {tab === 'design' && (
          <ProcessGraphEditor def={def} onSave={handleSave} onClose={() => setTab('docs')} />
        )}

        {tab === 'monitor' && (
          <ProcessMonitor def={def} run={run} onStop={handleStop} />
        )}

        {tab === 'docs' && (
          <div className="p-5 flex flex-col gap-5">
            {def.graph && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Workflow</p>
                <WorkflowGraph def={def} currentAgent={run?.currentAgent} />
              </div>
            )}
            {def.body && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Documentation</p>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                  {def.body}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── New process dialog ────────────────────────────────────────────────────────

function NewProcessModal({ onDone }: { onDone: () => void }) {
  const { save } = useProcessesStore()
  const [name,     setName    ] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    const id   = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const path = `${processesDir()}/${id}.md`
    await save(path, processTemplate(name.trim(), id))
    setCreating(false)
    onDone()
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onDone} />
      <div className="fixed z-50 top-1/2 left-1/2" style={{ transform: 'translate(-50%,-50%)', width: 360, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20 }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>New Process</h3>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="Process name…"
          style={{ width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
        />
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
          Creates <span className="font-mono">{name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'process-name'}.md</span> in <span className="font-mono">~/.openclaw/processes/</span>
        </p>
        <div className="flex gap-2 mt-3">
          <Btn size="sm" loading={creating} icon={<Plus size={12} />} onClick={handleCreate} disabled={!name.trim()}>Create</Btn>
          <Btn size="sm" variant="ghost" onClick={onDone}>Cancel</Btn>
        </div>
      </div>
    </>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ProcessesView({ onOpenChat }: { onOpenChat?: () => void } = {}) {
  const { processes, runs, loading, error, needsPlugin, load, delete: deleteProcess } = useProcessesStore()
  const { fetch: fetchAgents } = useAgentsStore()
  const status = useConnectionStore(s => s.status)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search,     setSearch    ] = useState('')
  const [showNew,    setShowNew   ] = useState(false)

  // (Re)load whenever the gateway connects — so the needsPlugin notice re-probes
  // and clears itself after the joaxclaw-fs plugin is installed + the gateway
  // restarts (the "Install via agent" flow), with no manual Retry needed.
  useEffect(() => {
    if (status !== 'connected') return
    load()
    fetchAgents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    if (!selectedId && processes.length > 0) setSelectedId(processes[0].id)
  }, [processes.length])

  const filtered = processes.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.id.toLowerCase().includes(search.toLowerCase()) ||
    p.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
  )

  const selectedProcess = processes.find(p => p.id === selectedId)

  if (needsPlugin) return <RemotePluginNotice feature="Processes" onRetry={() => load()} onOpenChat={onOpenChat} />

  return (
    <div className="flex flex-1 min-h-0">
      {showNew && <NewProcessModal onDone={() => { setShowNew(false); load() }} />}

      {/* Sidebar */}
      <div className="flex flex-col shrink-0" style={{ width: 280, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2 px-3 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Processes</span>
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            {processes.length}
          </span>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={loading} onClick={load} />
          <Btn size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setShowNew(true)} />
        </div>

        <div className="px-3 py-2 shrink-0">
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ width: '100%', padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}
          />
        </div>

        {error && (
          <div className="mx-3 mb-2 px-3 py-2 rounded text-xs" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }}>
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 gap-3 px-4 text-center">
              <FileText size={28} style={{ color: 'var(--text-secondary)', opacity: 0.25 }} />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {search ? 'No processes match' : 'No processes yet'}
              </p>
              {!search && (
                <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
                  Add <span className="font-mono">.md</span> files to<br />
                  <span className="font-mono">~/.openclaw/processes/</span>
                </p>
              )}
            </div>
          )}
          {filtered.map(def => (
            <ProcessItem
              key={def.id} def={def} active={def.id === selectedId} run={runs[def.id]}
              onClick={() => setSelectedId(def.id)}
              onDelete={async () => {
                const ok = await deleteProcess(def.path)
                if (ok && selectedId === def.id) setSelectedId(null)
                return ok
              }}
            />
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0" style={{ background: 'var(--bg-primary)' }}>
        {selectedProcess ? (
          <ProcessDetail key={selectedProcess.id} def={selectedProcess} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <GitBranch size={40} style={{ color: 'var(--text-secondary)', opacity: 0.2 }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {loading ? 'Loading processes…' : 'Select a process'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
