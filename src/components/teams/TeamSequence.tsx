import { Users, CornerDownRight, GitBranch, Loader2, Check, Pause } from 'lucide-react'
import type { TeamBlueprint, TeamMemberDef, TeamRoute } from '../../lib/teamBlueprint'
import { BRANCH_END } from '../../lib/teamBlueprint'

// A team, read as what it is: an ordered list of steps.
//
// This replaces both the Build form's member list and the compiled-graph view. They were
// two editable representations of one thing, and the second could disagree with the first
// — the tab even warned that it would. There is one representation now; the executable
// graph is generated from it and never edited by hand.
//
// Branching is drawn on the connector it belongs to rather than in a section of its own.
// Of the teams this was designed against, most have no branches at all, so a team that
// doesn't branch shows nothing about branching.

export type StepState = 'idle' | 'done' | 'active' | 'waiting' | 'failed'

export interface StepStatus {
  state: StepState
  /** e.g. "38s", shown against a finished or running step. */
  timing?: string
  /** One line of what the step produced or is doing. */
  note?: string
}

/** The branches that fire after a given member, matched by role first then agent id. */
export function routeAfter(
  routes: TeamRoute[] | undefined,
  member: TeamMemberDef,
): TeamRoute | undefined {
  if (!routes?.length) return undefined
  // `afterRole` wins when set — the same agent can appear as several members, and the
  // role is what disambiguates them.
  return routes.find(r => (r.afterRole ? r.afterRole === member.role : r.afterMemberId === member.agentId))
}

function StepMarker({ index, status }: { index: number; status?: StepStatus }) {
  const base = {
    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 600,
  } as const

  if (status?.state === 'done') {
    return (
      <span style={{ ...base, background: 'color-mix(in srgb, var(--success) 15%, transparent)' }}>
        <Check size={12} style={{ color: 'var(--success)' }} />
      </span>
    )
  }
  if (status?.state === 'active') {
    return (
      <span style={{ ...base, background: 'color-mix(in srgb, var(--accent) 18%, transparent)' }}>
        <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />
      </span>
    )
  }
  if (status?.state === 'failed') {
    return (
      <span style={{ ...base, background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)' }}>
        !
      </span>
    )
  }
  if (status?.state === 'waiting') {
    return <span style={{ ...base, border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{index}</span>
  }
  return <span style={{ ...base, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{index}</span>
}

function Connector({ label, branch }: { label?: string; branch?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0 5px 22px' }}>
      {branch
        ? <GitBranch size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
        : <CornerDownRight size={13} style={{ color: 'var(--border)', flexShrink: 0 }} />}
      {label && (
        <span className="text-xs" style={{ color: branch ? 'var(--warning)' : 'var(--text-secondary)' }}>{label}</span>
      )}
    </div>
  )
}

/** Plain-language summary of what happens after a member, or null when it just continues. */
export function describeRoute(route: TeamRoute | undefined, members: TeamMemberDef[]): string | null {
  if (!route?.branches?.length) return null
  const name = (agentId: string) =>
    agentId === BRANCH_END ? 'finish' : members.find(m => m.agentId === agentId)?.role || agentId
  return route.branches
    .map(b => `if ${b.condition || 'it matches'} → ${name(b.nextMemberId)}`)
    .join(' · ')
}

export function TeamSequence({
  blueprint,
  status,
  compact = false,
}: {
  blueprint: TeamBlueprint
  /** Per-step run state, keyed by step index. Absent for a team that isn't running. */
  status?: Record<number, StepStatus>
  compact?: boolean
}) {
  const members = blueprint.members ?? []

  if (members.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 py-8"
        style={{ border: '1px dashed var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-secondary)' }}
      >
        <Users size={18} />
        <span className="text-sm">No steps yet — add one to build the team.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {members.map((m, i) => {
        const st = status?.[i]
        const route = describeRoute(routeAfter(blueprint.routes, m), members)
        const last = i === members.length - 1
        const activeBorder = st?.state === 'active'
          ? 'var(--accent)'
          : st?.state === 'failed' ? 'var(--danger)' : 'var(--border)'

        return (
          <div key={`${m.agentId}-${m.role}-${i}`}>
            {/* A review gate is a property of the step it precedes, so it is drawn on the
                approach to that step rather than as a node of its own. */}
            {m.reviewBefore && i > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0 5px 22px' }}>
                <Pause size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                <span className="text-xs" style={{ color: 'var(--warning)' }}>pauses for you to review</span>
              </div>
            )}

            <div
              style={{
                border: `1px solid ${activeBorder}`,
                borderRadius: 'var(--radius)',
                background: 'var(--bg-surface)',
                padding: compact ? '9px 11px' : '11px 13px',
                display: 'flex',
                gap: 11,
                alignItems: 'flex-start',
                opacity: st?.state === 'waiting' ? 0.65 : 1,
              }}
            >
              <StepMarker index={i + 1} status={st} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {m.role || m.agentId}
                  </span>
                  <span
                    className="text-xs px-1.5 rounded"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    {m.agentId}
                  </span>
                  {st?.timing && (
                    <span
                      className="text-xs"
                      style={{ marginLeft: 'auto', color: st.state === 'active' ? 'var(--accent)' : 'var(--text-secondary)' }}
                    >
                      {st.timing}
                    </span>
                  )}
                  {st?.state === 'waiting' && (
                    <span className="text-xs" style={{ marginLeft: 'auto', color: 'var(--text-secondary)' }}>waiting</span>
                  )}
                </div>

                {/* While a step is running its live note is more useful than its brief. */}
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}
                >
                  {st?.note ?? m.task}
                </div>
              </div>
            </div>

            {!last && <Connector label={route ? undefined : 'hands over'} />}
            {route && <Connector label={route} branch />}
          </div>
        )
      })}
    </div>
  )
}
