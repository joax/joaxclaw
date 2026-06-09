import { useEffect, useRef, useState } from 'react'
import {
  Plus, RefreshCw, UsersRound, Play, X, Trash2, ChevronDown,
  Upload, Download, GripVertical, Loader2, CheckCircle2, XCircle,
  Clock, ArrowRight, FileText, AlertTriangle, GitBranch,
} from 'lucide-react'
import { useTeamsStore, teamsDir } from '../../store/teams'
import { useProcessesStore } from '../../store/processes'
import { useAgentsStore } from '../../store/agents'
import { Btn } from '../ui/Btn'
import { ProcessMonitor } from '../processes/ProcessMonitor'
import { ProcessGraphEditor } from '../processes/ProcessGraphEditor'
import type { ProcessDef } from '../../lib/processParser'
import { serializeProcess } from '../../lib/processParser'
import type { TeamBlueprint, TeamMemberDef, TeamRevision, TeamRoute, TeamBranch } from '../../lib/teamBlueprint'
import { bumpBlueprint, newBlueprint, MAX_REVISIONS, BRANCH_END } from '../../lib/teamBlueprint'
import { validateTeamForLaunch } from '../../lib/teamValidation'

// ── Shared helpers ────────────────────────────────────────────────────────────

function statusColor(s: string): string {
  if (s === 'running') return 'var(--accent)'
  if (s === 'done')    return 'var(--success)'
  if (s === 'error')   return 'var(--danger)'
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

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// ── Agent picker ──────────────────────────────────────────────────────────────

function AgentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { agents } = useAgentsStore()
  const [open, setOpen] = useState(false)
  const selected = agents.find(a => a.id === value)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', background: 'var(--bg-elevated)',
          color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
          cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 160,
        }}
      >
        <span>{selected?.identity?.emoji ?? '🤖'}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected ? (selected.identity?.name ?? selected.name ?? selected.id) : 'Pick agent…'}
        </span>
        <ChevronDown size={9} style={{ flexShrink: 0, opacity: 0.5 }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 40,
            width: 220, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', marginTop: 4, maxHeight: 220, overflowY: 'auto',
          }}>
            {agents.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
                No agents configured
              </div>
            )}
            {agents.map(a => (
              <button key={a.id} onClick={() => { onChange(a.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '7px 10px',
                  background: a.id === value ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                }}
              >
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

// ── Member row ────────────────────────────────────────────────────────────────

function MemberRow({
  member, index, total, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  member: TeamMemberDef; index: number; total: number
  onChange: (m: TeamMemberDef) => void
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void
}) {
  const inp: React.CSSProperties = {
    padding: '4px 8px', fontSize: 12,
    borderRadius: 'var(--radius)', border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none',
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '20px 1fr 1fr 1fr 1fr 24px',
      gap: 6, alignItems: 'start',
      padding: '8px 10px',
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
    }}>
      {/* Order controls */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, paddingTop: 2 }}>
        <GripVertical size={12} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
        <button onClick={onMoveUp} disabled={index === 0}
          style={{ background: 'none', border: 'none', cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? 0.2 : 0.5, padding: 0, lineHeight: 1 }}>▲</button>
        <button onClick={onMoveDown} disabled={index === total - 1}
          style={{ background: 'none', border: 'none', cursor: index === total - 1 ? 'default' : 'pointer', opacity: index === total - 1 ? 0.2 : 0.5, padding: 0, lineHeight: 1 }}>▼</button>
      </div>

      {/* Agent */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Agent</label>
        <AgentPicker value={member.agentId} onChange={v => onChange({ ...member, agentId: v })} />
      </div>

      {/* Role */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Role</label>
        <input value={member.role} onChange={e => onChange({ ...member, role: e.target.value })}
          placeholder="e.g. Researcher" style={{ ...inp, width: '100%' }} />
      </div>

      {/* Task */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Task</label>
        <textarea value={member.task} onChange={e => onChange({ ...member, task: e.target.value })}
          placeholder="What this agent should do…" rows={2}
          style={{ ...inp, resize: 'vertical', fontFamily: 'inherit', width: '100%' }} />
      </div>

      {/* Review gate */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Review gate</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.35 : 1 }}>
          <input type="checkbox" checked={!!member.reviewBefore} disabled={index === 0}
            onChange={e => onChange({ ...member, reviewBefore: e.target.checked })} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Before this step</span>
        </label>
      </div>

      {/* Remove */}
      <button onClick={onRemove} title="Remove member"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', opacity: 0.6, paddingTop: 18, alignSelf: 'start' }}>
        <X size={13} />
      </button>
    </div>
  )
}

// ── Revision helpers ──────────────────────────────────────────────────────────

function computeRevisionSummary(prev: TeamBlueprint | null, next: TeamBlueprint): string {
  if (!prev) return 'Initial version'
  const parts: string[] = []
  if (prev.name !== next.name) parts.push(`renamed to "${next.name}"`)
  if (prev.controllerAgentId !== next.controllerAgentId) parts.push('controller changed')
  const memDiff = next.members.length - prev.members.length
  if (memDiff !== 0)
    parts.push(`${memDiff > 0 ? '+' : ''}${memDiff} member${Math.abs(memDiff) !== 1 ? 's' : ''}`)
  else if (prev.members.some((m, i) => m.agentId !== next.members[i]?.agentId || m.role !== next.members[i]?.role))
    parts.push('members updated')
  if (prev.outputContract !== next.outputContract) parts.push('output contract updated')
  const prevRoutes = prev.routes?.length ?? 0
  const nextRoutes = next.routes?.length ?? 0
  if (prevRoutes !== nextRoutes) parts.push(nextRoutes === 0 ? 'routing removed' : `${nextRoutes} route${nextRoutes !== 1 ? 's' : ''} configured`)
  if (!prev.graphCustomized && next.graphCustomized) parts.push('graph edited manually')
  else if (prev.graphCustomized && !next.graphCustomized) parts.push('graph regenerated from blueprint')
  return parts.length > 0 ? parts.join(' · ') : 'Blueprint updated'
}

function RevisionRow({ revision, isCurrent, prevRevision }: {
  revision: TeamRevision; isCurrent: boolean; prevRevision: TeamRevision | null
}) {
  const [expanded, setExpanded] = useState(false)
  const bp = revision.blueprint
  const summary = computeRevisionSummary(prevRevision?.blueprint ?? null, bp)

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden',
      background: isCurrent ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-elevated))' : 'var(--bg-elevated)',
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{
          fontSize: 10, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
          background: isCurrent ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg-surface)',
          border: `1px solid ${isCurrent ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--border)'}`,
          color: isCurrent ? 'var(--accent)' : 'var(--text-secondary)',
          fontWeight: isCurrent ? 600 : 400,
        }}>v{bp.version}</span>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </span>
        {isCurrent && <span style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0 }}>current</span>}
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6, flexShrink: 0 }}>{fmtDate(revision.savedAt)}</span>
        <ChevronDown size={10} style={{ opacity: 0.4, flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {expanded && (
        <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 16, margin: '8px 0', fontSize: 11 }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              Controller: <span style={{ color: 'var(--text-primary)' }}>{bp.controllerAgentId || '—'}</span>
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Members: <span style={{ color: 'var(--text-primary)' }}>{bp.members.length}</span>
            </span>
            {bp.graphCustomized && <span style={{ color: 'var(--warning)' }}>graph customized</span>}
          </div>
          {bp.members.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {bp.members.map((m, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 3,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                }}>{m.role || m.agentId}</span>
              ))}
            </div>
          )}
          <details>
            <summary style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 6 }}>
              Show full blueprint JSON
            </summary>
            <pre style={{
              fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)',
              background: 'var(--bg-surface)', padding: 10, borderRadius: 'var(--radius)',
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 280, overflowY: 'auto',
            }}>{JSON.stringify(bp, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  )
}

// ── Team builder (edit form) ──────────────────────────────────────────────────

interface TeamDraft {
  name: string
  description: string
  controllerAgentId: string
  members: TeamMemberDef[]
  routes: TeamRoute[]
  outputContract: string
}

function emptyDraft(): TeamDraft {
  return { name: '', description: '', controllerAgentId: '', members: [], routes: [], outputContract: '' }
}

function draftFromBlueprint(bp: TeamBlueprint): TeamDraft {
  return {
    name: bp.name,
    description: bp.description ?? '',
    controllerAgentId: bp.controllerAgentId,
    members: bp.members.map(m => ({ ...m })),
    routes: (bp.routes ?? []).map(r => ({ ...r, branches: r.branches.map(b => ({ ...b })) })),
    outputContract: bp.outputContract ?? '',
  }
}

// ── Routing UI ────────────────────────────────────────────────────────────────

function RouteRow({ route, members, onChange, onRemove }: {
  route: TeamRoute
  members: TeamMemberDef[]
  onChange: (r: TeamRoute) => void
  onRemove: () => void
}) {
  const inp: React.CSSProperties = {
    padding: '4px 8px', fontSize: 12, borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
    color: 'var(--text-primary)', outline: 'none', width: '100%',
  }

  const nextOptions = [
    ...members.map(m => ({ value: m.agentId, label: m.role || m.agentId })),
    { value: BRANCH_END, label: '⛳ End (finish)' },
  ]

  const updateBranch = (i: number, b: TeamBranch) => {
    const next = [...route.branches]; next[i] = b
    onChange({ ...route, branches: next })
  }
  const removeBranch = (i: number) =>
    onChange({ ...route, branches: route.branches.filter((_, idx) => idx !== i) })
  const addBranch = () =>
    onChange({ ...route, branches: [...route.branches, { condition: '', nextMemberId: BRANCH_END }] })

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      padding: '10px 12px', background: 'var(--bg-elevated)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>After</span>
        <select
          value={route.afterMemberId}
          onChange={e => onChange({ ...route, afterMemberId: e.target.value })}
          style={{ ...inp, flex: 1, maxWidth: 160 }}
        >
          {members.map(m => (
            <option key={m.agentId} value={m.agentId}>{m.role || m.agentId}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>route to:</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', opacity: 0.6, padding: 0, marginLeft: 'auto' }}>
          <X size={12} />
        </button>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 20px', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', paddingLeft: 2 }}>Condition (empty = default)</span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Go to</span>
        <span />
      </div>

      {/* Branch rows */}
      {route.branches.map((branch, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 20px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input
            value={branch.condition}
            onChange={e => updateBranch(i, { ...branch, condition: e.target.value })}
            placeholder={i === route.branches.length - 1 && !branch.condition ? 'otherwise…' : 'if condition…'}
            style={inp}
          />
          <select
            value={branch.nextMemberId}
            onChange={e => updateBranch(i, { ...branch, nextMemberId: e.target.value })}
            style={inp}
          >
            {nextOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={() => removeBranch(i)}
            disabled={route.branches.length <= 1}
            style={{ background: 'none', border: 'none', cursor: route.branches.length <= 1 ? 'default' : 'pointer', color: 'var(--danger)', opacity: route.branches.length <= 1 ? 0.2 : 0.5, padding: 0 }}
          >
            <X size={11} />
          </button>
        </div>
      ))}

      <Btn size="sm" variant="ghost" icon={<Plus size={10} />} onClick={addBranch}>Add Branch</Btn>
    </div>
  )
}

function RoutesSection({ members, routes, onChange }: {
  members: TeamMemberDef[]
  routes: TeamRoute[]
  onChange: (r: TeamRoute[]) => void
}) {
  const validMembers = members.filter(m => m.agentId)

  const addRoute = () => {
    const firstUnrouted = validMembers.find(m => !routes.some(r => r.afterMemberId === m.agentId))
    if (!firstUnrouted) return
    onChange([...routes, {
      afterMemberId: firstUnrouted.agentId,
      branches: [{ condition: '', nextMemberId: BRANCH_END }],
    }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, flex: 1 }}>
          Conditional Routing
        </label>
        <Btn size="sm" variant="ghost" icon={<Plus size={11} />} onClick={addRoute}
          disabled={validMembers.length === 0 || routes.length >= validMembers.length}>
          Add Route
        </Btn>
      </div>

      {routes.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, opacity: 0.6 }}>
          No routes — team runs linearly. Add a route to branch after any member.
        </p>
      ) : (
        routes.map((route, i) => (
          <RouteRow
            key={i}
            route={route}
            members={validMembers}
            onChange={r => { const next = [...routes]; next[i] = r; onChange(next) }}
            onRemove={() => onChange(routes.filter((_, idx) => idx !== i))}
          />
        ))
      )}
    </div>
  )
}

function TeamBuilder({
  initialBlueprint,
  teamId,
  teamsDirectory,
  graphCustomized,
  onSaved,
  onCancel,
}: {
  initialBlueprint?: TeamBlueprint
  teamId?: string
  teamsDirectory: string
  graphCustomized?: boolean
  onSaved: (bp: TeamBlueprint) => void
  onCancel?: () => void
}) {
  const { saveBlueprint } = useTeamsStore()
  const [draft, setDraft] = useState<TeamDraft>(
    initialBlueprint ? draftFromBlueprint(initialBlueprint) : emptyDraft()
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync if the blueprint changes externally (e.g. after save)
  useEffect(() => {
    if (initialBlueprint) setDraft(draftFromBlueprint(initialBlueprint))
  }, [initialBlueprint?.version, initialBlueprint?.updatedAt])

  const inp: React.CSSProperties = {
    padding: '6px 10px', fontSize: 13, borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
    color: 'var(--text-primary)', outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  const addMember = () => {
    setDraft(d => ({ ...d, members: [...d.members, { agentId: '', role: '', task: '', reviewBefore: false }] }))
  }
  const updateMember = (i: number, m: TeamMemberDef) =>
    setDraft(d => { const next = [...d.members]; next[i] = m; return { ...d, members: next } })
  const removeMember = (i: number) =>
    setDraft(d => ({ ...d, members: d.members.filter((_, idx) => idx !== i) }))
  const moveMember = (i: number, dir: -1 | 1) =>
    setDraft(d => {
      const next = [...d.members]; const j = i + dir
      if (j < 0 || j >= next.length) return d
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...d, members: next }
    })

  const handleSave = async () => {
    if (!draft.name.trim())                              { setError('Team name is required'); return }
    if (draft.members.length === 0)                      { setError('Add at least one member'); return }
    if (draft.members.some(m => !m.agentId))             { setError('Each member needs an agent selected'); return }
    if (!draft.controllerAgentId)                        { setError('Select a controller agent'); return }

    setSaving(true)
    setError(null)

    const id = teamId
      ?? draft.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    // Clean routes: strip empties, require at least one valid branch each
    const cleanRoutes = draft.routes
      .filter(r => r.afterMemberId && r.branches.some(b => b.nextMemberId))
      .map(r => ({ ...r, branches: r.branches.filter(b => b.nextMemberId) }))

    const patch = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      controllerAgentId: draft.controllerAgentId,
      members: draft.members,
      routes: cleanRoutes.length > 0 ? cleanRoutes : undefined,
      outputContract: draft.outputContract.trim() || undefined,
    }

    // New teams: build at version 1 without bumping. Edits: bump version.
    const bpToSave = initialBlueprint
      ? bumpBlueprint(initialBlueprint, patch)
      : { ...newBlueprint(id, patch.name), ...patch }

    const ok = await saveBlueprint(bpToSave)
    setSaving(false)
    if (ok) onSaved(bpToSave)
    else setError('Failed to save team')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      {/* Graph customized warning */}
      {graphCustomized && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '8px 12px', borderRadius: 'var(--radius)',
          background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
          color: 'var(--warning)', fontSize: 12,
        }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            This team's graph has been manually edited in the Graph tab.
            Saving from here will <strong>recompile the graph from the members list</strong> and discard those edits.
          </span>
        </div>
      )}

      {/* Name + description */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Team Name *</label>
          <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="My Research Team" style={inp} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Description</label>
          <input value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            placeholder="What this team does…" style={inp} />
        </div>
      </div>

      {/* Controller */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Controller Agent *</label>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>
          Orchestrates the team — spawns sub-agents and handles handoffs. Pick a capable, instruction-following agent.
        </p>
        <div style={{ marginTop: 4 }}>
          <AgentPicker value={draft.controllerAgentId} onChange={v => setDraft(d => ({ ...d, controllerAgentId: v }))} />
        </div>
      </div>

      {/* Members */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, flex: 1 }}>
            Team Members *
          </label>
          <Btn size="sm" variant="ghost" icon={<Plus size={11} />} onClick={addMember}>Add Member</Btn>
        </div>

        {draft.members.length === 0 && (
          <div style={{
            padding: 16, textAlign: 'center', border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--text-secondary)', fontSize: 12,
          }}>
            No members yet — click "Add Member" to define the team
          </div>
        )}

        {draft.members.map((m, i) => (
          <MemberRow
            key={i} member={m} index={i} total={draft.members.length}
            onChange={updated => updateMember(i, updated)}
            onRemove={() => removeMember(i)}
            onMoveUp={() => moveMember(i, -1)}
            onMoveDown={() => moveMember(i, 1)}
          />
        ))}
      </div>

      {/* Conditional routing */}
      {draft.members.length > 0 && (
        <RoutesSection
          members={draft.members}
          routes={draft.routes}
          onChange={routes => setDraft(d => ({ ...d, routes }))}
        />
      )}

      {/* Output contract */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Output Contract</label>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>
          Describe the expected final output. Included verbatim in the controller's launch prompt.
        </p>
        <textarea
          value={draft.outputContract}
          onChange={e => setDraft(d => ({ ...d, outputContract: e.target.value }))}
          placeholder="e.g. A structured report with an executive summary, findings, and recommendations."
          rows={3}
          style={{ ...inp, resize: 'vertical', fontFamily: 'inherit', marginTop: 4 }}
        />
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 12,
          background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
          color: 'var(--danger)',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Btn loading={saving} icon={<CheckCircle2 size={13} />} onClick={handleSave} disabled={saving}>
          Save Team
        </Btn>
        {onCancel && <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>}
      </div>
    </div>
  )
}

// ── Sidebar item ──────────────────────────────────────────────────────────────

function TeamItem({
  bp, active, runStatus, onClick, onDelete,
}: {
  bp: TeamBlueprint; active: boolean; runStatus?: string
  onClick: () => void; onDelete: () => Promise<boolean>
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

  const status = runStatus ?? 'idle'

  return (
    <div
      className="group relative flex flex-col px-3 py-2.5 cursor-pointer"
      style={{
        background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'transparent',
        borderRadius: 'var(--radius)',
        borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        marginBottom: 1, gap: 3,
      }}
      onClick={onClick}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'
        if (phase !== 'deleting') setPhase('idle')
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatusDot status={status} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: active ? 'var(--accent)' : 'var(--text-primary)' }}>
          {bp.name}
        </span>
        {/* Version chip */}
        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', flexShrink: 0 }}>
          v{bp.version}
        </span>
        <button
          onClick={handleDelete} disabled={phase === 'deleting'}
          style={{
            opacity: phase !== 'idle' ? 1 : 0,
            background: phase === 'confirm' ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : 'none',
            border: phase === 'confirm' ? '1px solid color-mix(in srgb, var(--danger) 40%, transparent)' : 'none',
            borderRadius: 4, cursor: phase === 'deleting' ? 'default' : 'pointer',
            padding: '2px 5px', display: 'flex', alignItems: 'center', gap: 3,
            color: 'var(--danger)', flexShrink: 0,
          }}
          className="group-hover:[opacity:1]"
        >
          <Trash2 size={11} />
          {phase === 'confirm'  && <span style={{ fontSize: 10 }}>Confirm?</span>}
          {phase === 'deleting' && <span style={{ fontSize: 10 }}>Deleting…</span>}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 17 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6 }}>
          {bp.members.length} member{bp.members.length !== 1 ? 's' : ''}
        </span>
        {bp.members.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            · {bp.members.map(m => m.role || m.agentId).join(' → ')}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Workflow pill preview ─────────────────────────────────────────────────────

function WorkflowPreview({ bp }: { bp: TeamBlueprint }) {
  const routedIds = new Set((bp.routes ?? []).map(r => r.afterMemberId))
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {bp.members.map((m, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            padding: '3px 9px', fontSize: 11, borderRadius: 'var(--radius)',
            border: `1px solid ${routedIds.has(m.agentId) ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
            background: routedIds.has(m.agentId) ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-elevated))' : 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
          }}>
            {m.reviewBefore && i > 0 && <span style={{ opacity: 0.5, marginRight: 4 }}>🔍</span>}
            {routedIds.has(m.agentId) && <GitBranch size={9} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent)', opacity: 0.7 }} />}
            {m.role || m.agentId}
          </div>
          {i < bp.members.length - 1 && (
            <ArrowRight size={11} style={{ color: 'var(--text-secondary)', opacity: 0.3 }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Team detail panel ─────────────────────────────────────────────────────────

type DetailTab = 'build' | 'graph' | 'monitor' | 'docs' | 'history'

function TeamDetail({
  blueprint, compiledDef, onUpdated,
}: {
  blueprint: TeamBlueprint
  compiledDef: ProcessDef | undefined
  onUpdated: (bp: TeamBlueprint) => void
}) {
  const { runs, startRun, stopRun } = useProcessesStore()
  const { saveCompiledDef, exportBundle, loadRevisions, revisions } = useTeamsStore()
  const { agents } = useAgentsStore()
  const run = runs[blueprint.id]
  const teamRevisions = revisions[blueprint.id] ?? []

  const [tab, setTab] = useState<DetailTab>('build')
  const [isStarting, setIsStarting] = useState(false)
  const [graphSaveError, setGraphSaveError] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const { importBundle } = useTeamsStore()

  // Auto-switch to monitor when run starts
  useEffect(() => {
    if (run?.status === 'running') setTab('monitor')
  }, [run?.status])

  // Lazy-load revision history when the History tab opens
  useEffect(() => {
    if (tab === 'history') loadRevisions(blueprint.id)
  }, [tab, blueprint.id])

  const controllerAgent = agents.find(a => a.id === blueprint.controllerAgentId)
  const isRunning = run?.status === 'running'
  const launchValidation = validateTeamForLaunch(blueprint, compiledDef)

  const handleRun = async () => {
    if (!launchValidation.valid) return
    setIsStarting(true)
    await startRun(blueprint.id, compiledDef, blueprint.controllerAgentId)
    setIsStarting(false)
  }

  const handleStop = () => stopRun(blueprint.id)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const imported = await importBundle(text, file.name)
    if (imported) onUpdated(imported)
    e.target.value = ''
  }

  const handleGraphSave = async (updated: ProcessDef) => {
    setGraphSaveError(null)
    const ok = await saveCompiledDef(updated)
    if (!ok) {
      setGraphSaveError('Failed to save graph — check that the file system is accessible')
      return
    }
    onUpdated({ ...blueprint, graphCustomized: true, updatedAt: Date.now() })
  }

  const TAB: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '6px 12px', fontSize: 12, fontWeight: 500, marginBottom: -1,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{blueprint.name}</h2>
              {/* Version + customized badge */}
              <span style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                color: 'var(--accent)', fontWeight: 600, flexShrink: 0,
              }}>v{blueprint.version}</span>
              {blueprint.graphCustomized && (
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 4,
                  background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-elevated))',
                  border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
                  color: 'var(--warning)', flexShrink: 0,
                }} title="Graph has been manually edited">graph edited</span>
              )}
            </div>
            {blueprint.description && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{blueprint.description}</p>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <input ref={importRef} type="file" accept=".team.json,.json,.md" style={{ display: 'none' }} onChange={handleImport} />
            <Btn size="sm" variant="ghost" icon={<Upload size={11} />} onClick={() => importRef.current?.click()} title="Import team" />
            <Btn size="sm" variant="ghost" icon={<Download size={11} />} onClick={() => exportBundle(blueprint.id)} title="Export team as .team.json" />
            {isRunning ? (
              <Btn size="sm" variant="outline" icon={<X size={12} />} onClick={handleStop} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>Stop</Btn>
            ) : (
              <Btn size="sm" loading={isStarting} icon={<Play size={12} />} onClick={handleRun}
                disabled={!launchValidation.valid || isStarting}
                title={launchValidation.valid ? undefined : launchValidation.errors[0]}>
                Run
              </Btn>
            )}
          </div>
        </div>

        {/* Meta line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
          <span>{blueprint.members.length} member{blueprint.members.length !== 1 ? 's' : ''}</span>
          {controllerAgent && (
            <span style={{ opacity: 0.6 }}>Controller: {controllerAgent.identity?.name ?? controllerAgent.id}</span>
          )}
          <span style={{ opacity: 0.4 }}>Updated {fmtDate(blueprint.updatedAt)}</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'monospace', opacity: 0.3, fontSize: 10 }}>
            {blueprint.id}
          </span>
        </div>

        {/* Workflow pills */}
        {blueprint.members.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <WorkflowPreview bp={blueprint} />
          </div>
        )}

        {/* Run status banner */}
        {run && run.status !== 'idle' && tab !== 'monitor' && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
              padding: '6px 12px', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
              background: `color-mix(in srgb, ${statusColor(run.status)} 8%, transparent)`,
              border: `1px solid color-mix(in srgb, ${statusColor(run.status)} 25%, transparent)`,
              color: statusColor(run.status),
            }}
            onClick={() => setTab('monitor')}
          >
            <StatusDot status={run.status} />
            {run.status === 'running' && <>Running · {run.currentAgent ?? 'Starting…'} — <u>view monitor</u></>}
            {run.status === 'done'    && <>Completed · {run.stepsDone} steps · {fmtDuration((run.finishedAt ?? Date.now()) - run.startedAt)} — <u>view monitor</u></>}
            {run.status === 'error'   && <>Error: {run.error ?? 'unknown'} — <u>view monitor</u></>}
          </div>
        )}
      </div>

      {/* Launch validation errors — shown above tabs when team can't run */}
      {!launchValidation.valid && !isRunning && (
        <div style={{
          padding: '5px 20px', flexShrink: 0, fontSize: 11,
          background: 'color-mix(in srgb, var(--warning) 7%, var(--bg-surface))',
          borderBottom: '1px solid color-mix(in srgb, var(--warning) 20%, transparent)',
          color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertTriangle size={11} style={{ flexShrink: 0 }} />
          <span>
            <strong>Run disabled</strong> — {launchValidation.errors[0]}
            {launchValidation.errors.length > 1 && ` (+${launchValidation.errors.length - 1} more)`}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '0 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {(['build', 'graph', 'monitor', 'docs', 'history'] as DetailTab[]).map(t => (
          <button key={t}
            title={
              t === 'build'   ? 'Edit Blueprint — canonical source of truth (.team.json)' :
              t === 'graph'   ? 'Edit compiled execution graph — changes diverge from Blueprint' :
              t === 'history' ? 'View save history for this team' : undefined
            }
            style={{
              ...TAB,
              color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
              textTransform: 'capitalize',
            }} onClick={() => setTab(t)}>
            {t === 'graph'   && <GitBranch size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
            {t}
            {t === 'monitor' && run && run.status !== 'idle' && (
              <span style={{ marginLeft: 4, display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: statusColor(run.status), verticalAlign: 'middle' }} />
            )}
          </button>
        ))}
      </div>

      {/* Source / compiled artifact info banner — shown below tabs for build and graph */}
      {(tab === 'build' || tab === 'graph') && (
        <div style={{
          padding: '4px 20px', flexShrink: 0, fontSize: 11,
          borderBottom: '1px solid var(--border)',
          background: tab === 'graph'
            ? 'color-mix(in srgb, var(--warning) 5%, var(--bg-surface))'
            : 'color-mix(in srgb, var(--accent) 4%, var(--bg-surface))',
          color: 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {tab === 'build' ? (
            <>
              <FileText size={10} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>
                <strong style={{ color: 'var(--text-primary)' }}>Blueprint source</strong>
                {' '}— edits here are saved as <code style={{ fontFamily: 'monospace', fontSize: 10 }}>.team.json</code> and recompile the execution graph.
              </span>
            </>
          ) : (
            <>
              <GitBranch size={10} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <span>
                <strong style={{ color: 'var(--text-primary)' }}>Compiled execution artifact</strong>
                {' '}— changes here diverge from the Blueprint source. To revert, save from the <strong>Build</strong> tab.
              </span>
            </>
          )}
        </div>
      )}

      {/* Graph save error banner */}
      {tab === 'graph' && graphSaveError && (
        <div style={{
          padding: '6px 20px', flexShrink: 0, fontSize: 11,
          background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-surface))',
          borderBottom: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)',
          color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertTriangle size={11} style={{ flexShrink: 0 }} />
          <span>{graphSaveError}</span>
          <button
            onClick={() => setGraphSaveError(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', opacity: 0.6, padding: 0 }}
          ><X size={11} /></button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: (tab === 'monitor' || tab === 'graph') ? 'hidden' : 'auto' }}>
        {tab === 'build' && (
          <TeamBuilder
            key={blueprint.id + '-' + blueprint.version}
            initialBlueprint={blueprint}
            teamId={blueprint.id}
            teamsDirectory={teamsDir()}
            graphCustomized={blueprint.graphCustomized}
            onSaved={onUpdated}
          />
        )}

        {tab === 'graph' && compiledDef ? (
          <ProcessGraphEditor
            key={blueprint.id + '-graph'}
            def={compiledDef}
            onSave={handleGraphSave}
            onClose={() => setTab('build')}
          />
        ) : tab === 'graph' && (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: 13 }}>
            Save the team first to view and edit the compiled graph.
          </div>
        )}

        {tab === 'monitor' && (
          <ProcessMonitor def={compiledDef ?? { id: blueprint.id, name: blueprint.name, agents: [], workflow: { startAgent: '', transitions: [] }, path: '', body: '', raw: '' }} run={run} onStop={handleStop} />
        )}

        {tab === 'docs' && (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {blueprint.outputContract && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>Output Contract</p>
                <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{blueprint.outputContract}</p>
              </div>
            )}
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                Blueprint Source <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}>{blueprint.id}.team.json</span>
              </p>
              <pre style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: 12, borderRadius: 'var(--radius)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(blueprint, null, 2)}
              </pre>
            </div>
            {compiledDef && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Compiled Execution Artifact <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}>{blueprint.id}.md</span>
                  {blueprint.graphCustomized && (
                    <span style={{ marginLeft: 6, color: 'var(--warning)', fontWeight: 400 }}>⚠ diverges from source</span>
                  )}
                </p>
                <pre style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: 12, borderRadius: 'var(--radius)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {serializeProcess(compiledDef)}
                </pre>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div style={{ padding: '16px 20px', overflowY: 'auto', height: '100%' }}>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Last {MAX_REVISIONS} saved revisions. Newest first.
            </p>
            {teamRevisions.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12, padding: '32px 0', opacity: 0.6 }}>
                No revisions recorded yet — history is captured on every save.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[...teamRevisions].reverse().map((r, i, arr) => (
                  <RevisionRow
                    key={i}
                    revision={r}
                    isCurrent={r.blueprint.version === blueprint.version}
                    prevRevision={arr[i + 1] ?? null}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── New team modal ─────────────────────────────────────────────────────────────

function NewTeamModal({ onCreated, onCancel }: { onCreated: (bp: TeamBlueprint) => void; onCancel: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onCancel} />
      <div className="fixed z-50" style={{
        top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 780, maxWidth: '96vw', maxHeight: '90vh',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <UsersRound size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0, flex: 1 }}>New Team</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <TeamBuilder
            teamsDirectory={teamsDir()}
            onSaved={onCreated}
            onCancel={onCancel}
          />
        </div>
      </div>
    </>
  )
}

// ── Main TeamsView ─────────────────────────────────────────────────────────────

export function TeamsView() {
  const { blueprints, compiledDefs, loading, error, load, deleteTeam, importBundle } = useTeamsStore()
  const { runs, _startEventListening } = useProcessesStore()
  const { fetch: fetchAgents } = useAgentsStore()

  const [selectedId, setSelectedId]  = useState<string | null>(null)
  const [search,     setSearch]      = useState('')
  const [showNew,    setShowNew]     = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    load()
    fetchAgents()
    _startEventListening()
  }, [])

  useEffect(() => {
    if (!selectedId && blueprints.length > 0) setSelectedId(blueprints[0].id)
  }, [blueprints.length])

  const filtered = blueprints.filter(bp =>
    !search ||
    bp.name.toLowerCase().includes(search.toLowerCase()) ||
    bp.id.toLowerCase().includes(search.toLowerCase())
  )

  const selectedBp  = blueprints.find(b => b.id === selectedId)
  const selectedDef = selectedId ? compiledDefs[selectedId] : undefined

  const handleTopImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const imported = await importBundle(text, file.name)
    if (imported) { setSelectedId(imported.id) }
    e.target.value = ''
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {showNew && (
        <NewTeamModal
          onCreated={bp => { setShowNew(false); setSelectedId(bp.id) }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {/* Sidebar */}
      <div style={{ width: 280, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Teams</span>
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{blueprints.length}</span>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={loading} onClick={load} />
          <input ref={importRef} type="file" accept=".team.json,.json,.md" style={{ display: 'none' }} onChange={handleTopImport} />
          <Btn size="sm" variant="ghost" icon={<Upload size={13} />} onClick={() => importRef.current?.click()} title="Import team" />
          <Btn size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setShowNew(true)} />
        </div>

        <div style={{ padding: '8px 12px', flexShrink: 0 }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ width: '100%', padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}
          />
        </div>

        {error && (
          <div style={{ margin: '0 12px 8px', padding: '6px 10px', borderRadius: 'var(--radius)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
          {!loading && filtered.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, gap: 10, padding: '0 16px', textAlign: 'center' }}>
              <FileText size={28} style={{ color: 'var(--text-secondary)', opacity: 0.2 }} />
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                {search ? 'No teams match' : 'No teams yet'}
              </p>
              {!search && (
                <Btn size="sm" icon={<Plus size={11} />} onClick={() => setShowNew(true)}>Create your first team</Btn>
              )}
            </div>
          )}
          {filtered.map(bp => (
            <TeamItem
              key={bp.id} bp={bp} active={bp.id === selectedId}
              runStatus={runs[bp.id]?.status}
              onClick={() => setSelectedId(bp.id)}
              onDelete={async () => {
                const ok = await deleteTeam(bp.id)
                if (ok && selectedId === bp.id) setSelectedId(null)
                return ok
              }}
            />
          ))}
        </div>
      </div>

      {/* Detail */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        {selectedBp ? (
          <TeamDetail
            key={selectedBp.id}
            blueprint={selectedBp}
            compiledDef={selectedDef}
            onUpdated={updated => {
              // Re-read from store — the store is already updated by saveBlueprint/saveCompiledDef
              load()
              setSelectedId(updated.id)
            }}
          />
        ) : (
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <UsersRound size={40} style={{ color: 'var(--text-secondary)', opacity: 0.2 }} />
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {loading ? 'Loading teams…' : 'Select a team or create one'}
            </p>
            {!loading && <Btn size="sm" icon={<Plus size={11} />} onClick={() => setShowNew(true)}>New Team</Btn>}
          </div>
        )}
      </div>
    </div>
  )
}
