import { useEffect, useRef, useState } from 'react'
import {
  Plus, RefreshCw, UsersRound, Play, X, Trash2, ChevronDown,
  Upload, Download, GripVertical, Loader2, CheckCircle2, XCircle,
  Clock, FileText, AlertTriangle,
  History, Bot, Pencil,
} from 'lucide-react'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { useTeamsStore } from '../../store/teams'
import { useProcessesStore, runsDir, type ProcessRun } from '../../store/processes'
import { useAgentsStore } from '../../store/agents'
import { useConnectionStore } from '../../store/connection'
import { RemotePluginNotice } from '../common/RemotePluginNotice'
import { Btn } from '../ui/Btn'
import type { ProcessDef } from '../../lib/processParser'
import type { TeamBlueprint, TeamMemberDef, TeamRevision, TeamRoute, TeamBranch } from '../../lib/teamBlueprint'
import { bumpBlueprint, newBlueprint, BRANCH_END } from '../../lib/teamBlueprint'
import { validateTeamForLaunch } from '../../lib/teamValidation'
import { TeamSequence } from './TeamSequence'
import { describeRun, fmtElapsed, stepStatuses } from '../../lib/teamRunSteps'

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
  if ((prev.workspace ?? '') !== (next.workspace ?? '')) parts.push(next.workspace ? 'workspace set' : 'workspace cleared')
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
  workspace: string
}

function emptyDraft(): TeamDraft {
  return { name: '', description: '', controllerAgentId: '', members: [], routes: [], outputContract: '', workspace: '' }
}

function draftFromBlueprint(bp: TeamBlueprint): TeamDraft {
  return {
    name: bp.name,
    description: bp.description ?? '',
    controllerAgentId: bp.controllerAgentId,
    members: bp.members.map(m => ({ ...m })),
    routes: (bp.routes ?? []).map(r => ({ ...r, branches: r.branches.map(b => ({ ...b })) })),
    outputContract: bp.outputContract ?? '',
    workspace: bp.workspace ?? '',
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

  // Target a member by its index (unique even when an agentId is reused for several
  // members). We write the member's role (primary) and agentId (legacy fallback) so the
  // compiler/validation resolve the exact step. Resolve a route target back to an index
  // for the controlled <select> value, role first then agentId.
  const idxOf = (role: string | undefined, agentId: string): number => {
    if (role) { const i = members.findIndex(m => m.role === role); if (i !== -1) return i }
    return members.findIndex(m => m.agentId === agentId)
  }

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
          value={String(Math.max(0, idxOf(route.afterRole, route.afterMemberId)))}
          onChange={e => { const m = members[Number(e.target.value)]; if (m) onChange({ ...route, afterRole: m.role, afterMemberId: m.agentId }) }}
          style={{ ...inp, flex: 1, maxWidth: 160 }}
        >
          {members.map((m, idx) => (
            <option key={idx} value={idx}>{m.role || m.agentId}</option>
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
            value={branch.nextMemberId === BRANCH_END ? BRANCH_END : String(Math.max(0, idxOf(branch.nextRole, branch.nextMemberId)))}
            onChange={e => {
              const v = e.target.value
              if (v === BRANCH_END) updateBranch(i, { ...branch, nextMemberId: BRANCH_END, nextRole: undefined })
              else { const m = members[Number(v)]; if (m) updateBranch(i, { ...branch, nextRole: m.role, nextMemberId: m.agentId }) }
            }}
            style={inp}
          >
            {members.map((m, idx) => (
              <option key={idx} value={idx}>{m.role || m.agentId}</option>
            ))}
            <option value={BRANCH_END}>⛳ End (finish)</option>
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
  graphCustomized,
  onSaved,
  onCancel,
}: {
  initialBlueprint?: TeamBlueprint
  teamId?: string
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
  }, [initialBlueprint])

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
      workspace: draft.workspace.trim() || undefined,
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

      {/* Shared workspace (repo) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Shared Workspace (repository)</label>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>
          A directory all members edit together (e.g. a code repo). Members are spawned with this as their working dir, so their file changes are shared on disk and flow across the handoff. Leave blank for non-coding teams.
        </p>
        <input
          value={draft.workspace}
          onChange={e => setDraft(d => ({ ...d, workspace: e.target.value }))}
          placeholder="/home/you/repos/my-project"
          spellCheck={false}
          style={{ ...inp, fontFamily: 'monospace', marginTop: 4 }}
        />
        {!draft.workspace.trim() && draft.members.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.75, margin: '2px 0 0' }}>
            No workspace — members run in isolated sandboxes and can't edit a shared repo; only text passes between them.
          </p>
        )}
        {draft.workspace.trim() && draft.routes.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--warning)', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertTriangle size={11} style={{ flexShrink: 0 }} />
            Branching/parallel members may edit the same files at once and conflict — sequential teams are safest on a shared repo.
          </p>
        )}
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

// The one line under a team's name in the list: its size, and what it is doing.
function teamRowState(bp: TeamBlueprint, run: ProcessRun | undefined): string {
  const steps = `${bp.members.length} step${bp.members.length === 1 ? '' : 's'}`
  if (!run) return `${steps} · never run`
  if (run.status === 'running') {
    const at = bp.members.length ? (Math.max(0, run.stepsDone) % bp.members.length) + 1 : 0
    return at ? `running · step ${at} of ${bp.members.length}` : 'running'
  }
  const when = fmtDate(run.finishedAt ?? run.startedAt)
  if (run.status === 'error') return `failed ${when}`
  // An attempt recorded by teams.launchPrompt — a prompt was handed out, but nothing has
  // reported back. Saying it "ran" would be a claim the record does not support.
  if (run.status === 'idle' && !run.finishedAt) return `${steps} · launch requested ${when}`
  return `${steps} · ran ${when}`
}

function TeamItem({
  bp, active, runStatus, run, onClick, onDelete,
}: {
  bp: TeamBlueprint; active: boolean; runStatus?: string; run?: ProcessRun
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
            // Idle visibility is controlled by the Tailwind classes below; an inline
            // opacity:0 would override the group-hover rule and keep the delete button
            // permanently invisible. Force visible only while confirming/deleting.
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
          {phase === 'confirm'  && <span style={{ fontSize: 10 }}>Confirm?</span>}
          {phase === 'deleting' && <span style={{ fontSize: 10 }}>Deleting…</span>}
        </button>
      </div>

      {/* What state this team is in, without opening it. */}
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', paddingLeft: 14, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {teamRowState(bp, run)}
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


// ── Team detail panel ─────────────────────────────────────────────────────────

// One page per team, in two states.
//
// It used to be five tabs — Build, Graph, Monitor, Docs, History — for a single object,
// with the thing people do most (run it with a task) buried inside the editing form. Two
// of those tabs edited the same team through different representations, and the second
// could disagree with the first; the tooltip said so and the model carried a flag to
// track it. That representation is gone: the sequence below IS the team, and the
// executable graph is generated from it.
//
//   reading  — task box and Run at the top, the sequence, runs down the side
//   editing  — the same sequence, editable in place
function TeamDetail({
  blueprint, compiledDef, onUpdated,
}: {
  blueprint: TeamBlueprint
  compiledDef: ProcessDef | undefined
  onUpdated: (bp: TeamBlueprint) => void
}) {
  const { runs, startRun, stopRun } = useProcessesStore()
  const { exportBundle, loadRevisions, revisions, runRequests, refreshRunRequest, consumeRunRequest, importBundle } = useTeamsStore()
  const { agents } = useAgentsStore()
  const narrow = useIsNarrow()
  const run = runs[blueprint.id]
  const teamRevisions = revisions[blueprint.id] ?? []
  const runRequest = runRequests[blueprint.id] ?? null

  const [editing, setEditing] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // The task for THIS run — what makes a reusable team concrete. Pre-filled with the
  // team's last-used task so re-running is one click.
  const [task, setTask] = useState<string>(() => useProcessesStore.getState().runs[blueprint.id]?.objective ?? '')
  const [diskRun, setDiskRun] = useState<ProcessRun | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const handledNonceRef = useRef<string | null>(null)
  // Re-renders while a run is live so the elapsed time on the active step advances.
  const [, tick] = useState(0)

  useEffect(() => {
    setDiskRun(null)
    setEditing(false)
    setShowHistory(false)
    handledNonceRef.current = null
    setTask(useProcessesStore.getState().runs[blueprint.id]?.objective ?? '')
  }, [blueprint.id])

  const running = run?.status === 'running'

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(iv)
  }, [running])

  // Poll for an agent's run request (teams.run) while this team is open and idle, so it
  // surfaces live in the task box without a reload.
  useEffect(() => {
    if (running) return
    const iv = setInterval(() => { void refreshRunRequest(blueprint.id) }, 5000)
    return () => clearInterval(iv)
  }, [blueprint.id, running, refreshRunRequest])

  useEffect(() => {
    if (!showHistory) return
    void loadRevisions(blueprint.id)
  }, [showHistory, blueprint.id, loadRevisions])

  // A run from a previous app session lives on disk, not in memory.
  useEffect(() => {
    if (run) return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileApi = (window as any)?.api?.file as { read: (p: string) => Promise<{ ok: boolean; text?: string }> } | null
    void fileApi?.read(`${runsDir()}/${blueprint.id}.json`).then(res => {
      if (cancelled || !res.ok || !res.text) return
      try { setDiskRun(JSON.parse(res.text) as ProcessRun) } catch { /* malformed run file */ }
    })
    return () => { cancelled = true }
  }, [blueprint.id, run])

  const lastRun = run ?? diskRun ?? undefined
  const controllerAgent = agents.find(a => a.id === blueprint.controllerAgentId)
  const launchValidation = validateTeamForLaunch(blueprint, compiledDef)

  // A team is "templated" when a member task or its output contract references
  // {objective}: those need a task, teams with baked-in tasks don't.
  const usesObjective = blueprint.members.some(m => m.task?.includes('{objective}'))
    || (blueprint.outputContract?.includes('{objective}') ?? false)
  const taskMissing = usesObjective && !task.trim()
  const canRun = launchValidation.valid && !taskMissing && !!compiledDef

  const handleRun = async (override?: string) => {
    const t = (override ?? task).trim()
    if (!launchValidation.valid || (usesObjective && !t) || !compiledDef) return
    const hadRequest = !!runRequests[blueprint.id]
    setIsStarting(true)
    try {
      await startRun(blueprint.id, compiledDef, blueprint.controllerAgentId, t)
    } finally {
      setIsStarting(false)
      if (hadRequest) await consumeRunRequest(blueprint.id)
    }
  }

  // Apply an agent's run request once: drop its task in, and launch if it asked to.
  useEffect(() => {
    if (!runRequest || runRequest.nonce === handledNonceRef.current || running) return
    handledNonceRef.current = runRequest.nonce
    setTask(runRequest.task)
    if (runRequest.autorun) void handleRun(runRequest.task)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runRequest, running])

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const imported = await importBundle(text, file.name)
    if (imported) onUpdated(imported)
    e.target.value = ''
  }

  // ── Editing ───────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div style={{
          padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
          display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0,
        }}>
          <Pencil size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Editing {blueprint.name}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <TeamBuilder
            initialBlueprint={blueprint}
            teamId={blueprint.id}
            onSaved={bp => { onUpdated(bp); setEditing(false) }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    )
  }

  const statuses = stepStatuses(lastRun, blueprint.members.length)
  const runLine = describeRun(run, blueprint.members)

  const sequence = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>THE TEAM</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {blueprint.members.length} step{blueprint.members.length === 1 ? '' : 's'}
          {controllerAgent ? `, run in order by ${controllerAgent.name ?? controllerAgent.id}` : ''}
        </span>
      </div>
      <TeamSequence blueprint={blueprint} status={running || lastRun ? statuses : undefined} />
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div style={{
          padding: '14px 20px 12px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)', display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {blueprint.name}
              </h2>
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 4, flexShrink: 0, fontWeight: 600,
                background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', color: 'var(--accent)',
              }}>v{blueprint.version}</span>
            </div>
            {blueprint.description && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>
                {blueprint.description}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <Btn size="sm" variant="outline" icon={<Pencil size={12} />} onClick={() => setEditing(true)}>Edit</Btn>
            <Btn size="sm" variant="ghost" title="Export this team" icon={<Download size={12} />} onClick={() => void exportBundle(blueprint.id)} />
            <Btn size="sm" variant="ghost" title="Import a team bundle" icon={<Upload size={12} />} onClick={() => importRef.current?.click()} />
            <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* The run, or the way to start one — always the first thing on the page. */}
          {running ? (
            <div style={{
              border: '1px solid var(--accent)', borderRadius: 'var(--radius)',
              background: 'color-mix(in srgb, var(--accent) 9%, transparent)',
              padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 11,
            }}>
              <Loader2 size={15} className="animate-spin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{runLine}</div>
                {run?.objective && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>{run.objective}</div>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>
                {fmtElapsed(Date.now() - (run?.startedAt ?? Date.now()))}
              </span>
              <Btn size="sm" variant="danger" onClick={() => stopRun(blueprint.id)}>Stop</Btn>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 7 }}>
                WHAT SHOULD THE TEAM DO?
              </div>
              {runRequest && (
                <div style={{
                  fontSize: 11, color: 'var(--accent)', marginBottom: 6,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Bot size={12} /> An agent asked for this run.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <textarea
                  value={task}
                  onChange={e => setTask(e.target.value)}
                  placeholder={usesObjective ? 'The task for this run…' : 'Optional — this team has its own tasks built in'}
                  rows={2}
                  style={{
                    flex: 1, padding: '9px 11px', fontSize: 13, lineHeight: 1.5, resize: 'vertical',
                    borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                    background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                <Btn
                  size="md"
                  loading={isStarting}
                  disabled={!canRun}
                  icon={<Play size={13} />}
                  title={!launchValidation.valid ? launchValidation.errors.join(' · ') : taskMissing ? 'This team needs a task' : undefined}
                  onClick={() => void handleRun()}
                >
                  Run
                </Btn>
              </div>
              {!launchValidation.valid ? (
                <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>
                  {launchValidation.errors.join(' · ')}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                  Runs on the gateway — you can close JoaxClaw and it keeps going.
                </div>
              )}
            </div>
          )}

          {sequence}

          {/* On a phone the runs rail folds in here rather than existing twice. */}
          {narrow && <TeamRuns blueprint={blueprint} lastRun={lastRun} revisions={teamRevisions} showHistory={showHistory} onToggleHistory={() => setShowHistory(v => !v)} />}
        </div>
      </div>

      {!narrow && (
        <div style={{
          width: 288, flexShrink: 0, borderLeft: '1px solid var(--border)',
          background: 'var(--bg-surface)', padding: '16px 14px', overflowY: 'auto',
        }}>
          <TeamRuns blueprint={blueprint} lastRun={lastRun} revisions={teamRevisions} showHistory={showHistory} onToggleHistory={() => setShowHistory(v => !v)} />
        </div>
      )}
    </div>
  )
}

// Runs and versions — what used to be the Monitor and History tabs. Monitor's live view
// now happens on the sequence itself, so what is left here is the record: when it ran,
// how long it took, and how it ended.
function TeamRuns({
  blueprint, lastRun, revisions, showHistory, onToggleHistory,
}: {
  blueprint: TeamBlueprint
  lastRun: ProcessRun | undefined
  revisions: TeamRevision[]
  showHistory: boolean
  onToggleHistory: () => void
}) {
  // A record with status 'idle' is a launch the app never saw start: teams.launchPrompt
  // writes one when an agent asks for a team's prompt from Slack or a schedule, so a
  // headless run leaves a trace instead of nothing. It is an attempt, not a run — so it
  // gets no duration, which would otherwise tick up forever against a run that may never
  // have begun.
  const pending = (r: ProcessRun): boolean => r.status === 'idle' && !r.finishedAt

  const label = (r: ProcessRun): string =>
    r.status === 'running' ? 'Running now'
      : pending(r) ? 'Launch requested'
      : r.finishedAt ? fmtDate(r.finishedAt)
      : fmtDate(r.startedAt)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>RUNS</div>

      {lastRun ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <StatusDot status={lastRun.status} />
            <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{label(lastRun)}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
              {pending(lastRun)
                ? fmtDate(lastRun.startedAt)
                : fmtElapsed((lastRun.finishedAt ?? Date.now()) - lastRun.startedAt)}
            </span>
          </div>
          {lastRun.objective && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{lastRun.objective}</div>
          )}
          {lastRun.error && (
            <div style={{ fontSize: 11, color: 'var(--danger)', lineHeight: 1.5 }}>{lastRun.error}</div>
          )}
          {pending(lastRun) && lastRun.log.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {lastRun.log[lastRun.log.length - 1].text}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Never run.</div>
      )}

      <div style={{ marginTop: 6, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onToggleHistory}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0,
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)',
          }}
        >
          <History size={13} />
          Version {blueprint.version}
          <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>{showHistory ? 'Hide' : 'History'}</span>
        </button>

        {showHistory && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {revisions.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>No earlier versions saved.</span>
            ) : revisions.map((rev, i) => (
              <RevisionRow
                key={rev.savedAt}
                revision={rev}
                isCurrent={i === 0}
                prevRevision={revisions[i + 1] ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


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
            onSaved={onCreated}
            onCancel={onCancel}
          />
        </div>
      </div>
    </>
  )
}

// ── Main TeamsView ─────────────────────────────────────────────────────────────

// ── Mobile team detail ────────────────────────────────────────────────────────
// The desktop TeamDetail is a 5-tab builder (canvas editing). On a phone that doesn't
// fit, so this is a read-and-run view: the flow as a vertical list of members, a task
// box, and Run/Stop. Structural editing stays on desktop.
export function TeamsView({ onOpenChat }: { onOpenChat?: () => void } = {}) {
  const { blueprints, compiledDefs, loading, error, needsPlugin, load, deleteTeam, importBundle } = useTeamsStore()
  const { runs, _startEventListening } = useProcessesStore()
  const { fetch: fetchAgents } = useAgentsStore()
  const status = useConnectionStore(s => s.status)
  const narrow = useIsNarrow()

  const [selectedId, setSelectedId]  = useState<string | null>(null)
  const [search,     setSearch]      = useState('')
  const [showNew,    setShowNew]     = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  // load() picks its own backend: the joaxclaw-fs plugin over the WS (local OR
  // remote), or local files on a local gateway. It only sets needsPlugin when a
  // remote gateway lacks the plugin. Re-run on every (re)connect so the notice
  // re-probes and clears itself after the plugin is installed + gateway restarts.
  useEffect(() => {
    if (status !== 'connected') return
    load()
    fetchAgents()
    _startEventListening()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    // Desktop auto-selects the first/active team (side-by-side). On mobile, land on the
    // list first (master-detail).
    if (!narrow && !selectedId && blueprints.length > 0) {
      const active = blueprints.find(b => runs[b.id]?.status === 'running')
      setSelectedId(active?.id ?? blueprints[0].id)
    }
  }, [blueprints.length, narrow])

  const filtered = blueprints.filter(bp =>
    !search ||
    bp.name.toLowerCase().includes(search.toLowerCase()) ||
    bp.id.toLowerCase().includes(search.toLowerCase())
  )

  const selectedBp  = blueprints.find(b => b.id === selectedId)
  const selectedDef = selectedId ? compiledDefs[selectedId] : undefined
  const showList = !narrow || !selectedBp
  const showDetail = !narrow || !!selectedBp

  const handleTopImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const imported = await importBundle(text, file.name)
    if (imported) { setSelectedId(imported.id) }
    e.target.value = ''
  }

  if (needsPlugin) return <RemotePluginNotice feature="Teams" onRetry={() => load()} onOpenChat={onOpenChat} />

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {showNew && (
        <NewTeamModal
          onCreated={bp => { setShowNew(false); setSelectedId(bp.id) }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {/* Sidebar (team list) — full-width on mobile when no team is open */}
      {showList && (
      <div style={{ width: narrow ? '100%' : 280, borderRight: narrow ? 'none' : '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
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
              run={runs[bp.id]}
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
      )}

      {/* Detail */}
      {showDetail && (
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
      )}
    </div>
  )
}
