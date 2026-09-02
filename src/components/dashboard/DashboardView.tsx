import { useEffect, useRef, useState } from 'react'
import {
  Send, ChevronDown, Loader2, CheckCircle2, XCircle,
  ArrowRight, Activity, Timer, Cpu, Clock, Zap, UsersRound, Terminal, Square, Bell, X,
} from 'lucide-react'
import { useConnectionStore, useIsRemoteGateway } from '../../store/connection'
import { gatewayHost } from '../../lib/ollamaHealth'
import { useChatStore } from '../../store/chat'
import { useAgentsStore } from '../../store/agents'
import { useSessionsStore } from '../../store/sessions'
import { useProcessesStore } from '../../store/processes'
import { useTeamsStore } from '../../store/teams'
import { useLogoUrl } from '../../lib/logo'
import { useCronsStore } from '../../store/crons'
import { useMetricsStore } from '../../store/metrics'
import { listJobs, stopJob, type ScriptJob } from '../../lib/scriptJobs'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { reminderBySession, fmtCountdown, isReminderJob } from '../../lib/reminders'
import { isManagedJob } from '../../lib/managedJobs'
import { loadedModels } from '../../lib/ollama'
import { formatRelativeDate } from '../../lib/dateUtils'
import type { NavSection } from '../../App'

// ── Helpers ───────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function fmtNextRun(ms: number): string {
  const diff = ms - Date.now()
  if (diff <= 0) return 'now'
  const s = Math.floor(diff / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function fmtLastRun(ms: number): string {
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return `${s}s ago`
}

// Running duration (input in seconds). Scales up through hours and days so a
// long-running process/team reads "2h 5m" / "1d 3h" instead of a huge minute count.
function fmtElapsed(totalSeconds: number): string {
  const s = totalSeconds
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function ResourceBar({ value, max, color }: { value: number; max?: number; color: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : Math.min(100, value)
  return (
    <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-elevated)', overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
    </div>
  )
}

// Mobile card surface + section header. Desktop keeps its bare, dense sections; the
// mobile feed wraps each one in a rounded card and uses a larger, tappable header.
function MobileCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--bg-surface)', padding: 14, ...style }}>
      {children}
    </div>
  )
}

function SectionHead({ Icon, label, iconColor = 'var(--text-secondary)', narrow, action }: {
  Icon: typeof Activity; label: string; iconColor?: string; narrow?: boolean; action?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: narrow ? 10 : 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={narrow ? 14 : 11} style={{ color: iconColor }} />
        <span style={{ fontSize: narrow ? 12 : 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      {action}
    </div>
  )
}

function SeeAll({ onClick, narrow }: { onClick: () => void; narrow?: boolean }) {
  return (
    <button onClick={onClick} style={{ fontSize: narrow ? 12 : 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: narrow ? '4px 2px' : 0 }}>
      See all →
    </button>
  )
}

// ── Health strip (desktop) ──────────────────────────────────────────────────────

function HealthStrip({ onNavigate }: { onNavigate: (s: NavSection) => void }) {
  const { status, uptimeStart, lastHeartbeat } = useConnectionStore()
  const { sessions } = useSessionsStore()
  const { runs } = useProcessesStore()
  const { blueprints } = useTeamsStore()
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const isConnected  = status === 'connected'
  const uptime       = uptimeStart ? Date.now() - uptimeStart : 0
  const hbAgo        = lastHeartbeat ? Math.round((Date.now() - lastHeartbeat) / 1000) : null
  const activeSess   = sessions.filter(s => s.hasActiveRun).length
  // Team runs share the `runs` store but aren't processes — count them separately.
  const teamIds      = new Set(blueprints.map(b => b.id))
  const runningProcs = Object.values(runs).filter(r => r.status === 'running' && !teamIds.has(r.processId)).length
  const runningTeams = Object.values(runs).filter(r => r.status === 'running' && teamIds.has(r.processId)).length

  const dotColor = status === 'connected' ? 'var(--success)'
    : status === 'connecting' ? 'var(--warning)'
    : 'var(--danger)'

  const chip = (label: string, count: number, nav: NavSection) => (
    <button
      onClick={() => onNavigate(nav)}
      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-elevated)', cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}
    >
      <span style={{ fontWeight: 600, color: count > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{count}</span>
      {label}
    </button>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0, fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
          {isConnected ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
        </span>
        {isConnected && uptime > 0 && (
          <span style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>· {fmtUptime(uptime)}</span>
        )}
        {isConnected && hbAgo !== null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-secondary)', opacity: 0.5 }}>
            <Zap size={9} /> {hbAgo}s
          </span>
        )}
      </div>
      <div style={{ flex: 1 }} />
      {chip('sessions active', activeSess, 'sessions')}
      {chip('processes running', runningProcs, 'processes')}
      {chip('teams running', runningTeams, 'teams')}
    </div>
  )
}

// ── Mobile: quick-stat tiles (replaces the cramped health strip) ─────────────────

function QuickStats({ onNavigate }: { onNavigate: (s: NavSection) => void }) {
  const { sessions } = useSessionsStore()
  const { runs } = useProcessesStore()
  const { blueprints } = useTeamsStore()

  const teamIds      = new Set(blueprints.map(b => b.id))
  const activeSess   = sessions.filter(s => s.hasActiveRun).length
  const runningProcs = Object.values(runs).filter(r => r.status === 'running' && !teamIds.has(r.processId)).length
  const runningTeams = Object.values(runs).filter(r => r.status === 'running' && teamIds.has(r.processId)).length

  const tile = (Icon: typeof Activity, count: number, label: string, nav: NavSection) => (
    <button
      onClick={() => onNavigate(nav)}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
        padding: '12px 12px', borderRadius: 12, border: '1px solid var(--border)',
        background: count > 0 ? 'color-mix(in srgb, var(--accent) 7%, var(--bg-surface))' : 'var(--bg-surface)',
        cursor: 'pointer', textAlign: 'left', minWidth: 0,
      }}
    >
      <Icon size={14} style={{ color: count > 0 ? 'var(--accent)' : 'var(--text-secondary)' }} />
      <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: count > 0 ? 'var(--text-primary)' : 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{label}</span>
    </button>
  )

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {tile(Activity, activeSess, 'Sessions', 'sessions')}
      {tile(Zap, runningProcs, 'Processes', 'processes')}
      {tile(UsersRound, runningTeams, 'Teams', 'teams')}
    </div>
  )
}

// ── Agent picker ──────────────────────────────────────────────────────────────

function AgentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { agents } = useAgentsStore()
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const selected = agents.find(a => a.id === value)

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setDropPos({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen(v => !v)
  }

  return (
    <div>
      <button
        ref={btnRef}
        onClick={handleToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'var(--text-secondary)', fontSize: 12 }}
      >
        <span style={{ fontSize: 15 }}>{selected?.identity?.emoji ?? '🤖'}</span>
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
          {selected ? (selected.identity?.name ?? selected.name ?? selected.id) : 'Select agent'}
        </span>
        <ChevronDown size={11} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 40, minWidth: 220, maxWidth: 'calc(100vw - 24px)', maxHeight: '60vh', overflowY: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
            {agents.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>No agents configured</div>
            )}
            {agents.map(a => (
              <button key={a.id} onClick={() => { onChange(a.id); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', border: 'none', background: a.id === value ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 15 }}>{a.identity?.emoji ?? '🤖'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.identity?.name ?? a.name ?? a.id}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.6 }}>{a.id}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Chat input card ───────────────────────────────────────────────────────────

function ChatInputCard({ onSend, narrow }: { onSend: (agentId: string, text: string) => void; narrow?: boolean }) {
  const { agents } = useAgentsStore()
  const [agentId, setAgentId]   = useState('')
  const [message, setMessage]   = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!agentId && agents.length > 0) setAgentId(agents[0].id)
  }, [agents.length])

  const canSend = !!agentId && message.trim().length > 0

  const handleSend = () => {
    if (!canSend) return
    onSend(agentId, message.trim())
    setMessage('')
    textRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // On a phone, Enter should insert a newline — sending is the explicit button.
    if (!narrow && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--bg-surface)', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.15)' }}>
      {/* Agent row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <AgentPicker value={agentId} onChange={setAgentId} />
      </div>

      {/* Message input */}
      <textarea
        ref={textRef}
        value={message}
        onChange={e => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything…"
        rows={narrow ? 4 : 3}
        style={{
          display: 'block', width: '100%', padding: '14px 14px 6px',
          fontSize: 14, lineHeight: 1.6, resize: 'none', outline: 'none',
          border: 'none', background: 'transparent', color: 'var(--text-primary)',
          fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />

      {/* Send row — full-width, thumb-friendly button on mobile. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: narrow ? '6px 12px 12px' : '6px 10px 10px' }}>
        <button
          onClick={handleSend}
          disabled={!canSend}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: narrow ? '11px 14px' : '6px 14px',
            width: narrow ? '100%' : 'auto',
            borderRadius: narrow ? 10 : 8, border: 'none', fontSize: narrow ? 14 : 12, fontWeight: 600,
            background: canSend ? 'var(--accent)' : 'var(--bg-elevated)',
            color: canSend ? 'var(--accent-fg)' : 'var(--text-secondary)',
            cursor: canSend ? 'pointer' : 'default', transition: 'background 0.15s',
          }}
        >
          <Send size={narrow ? 15 : 13} /> Send
        </button>
      </div>
    </div>
  )
}

// ── Recent conversations ──────────────────────────────────────────────────────

function RecentConversations({ onOpen, onNavigate, narrow }: { onOpen: (convId: string) => void; onNavigate: (s: NavSection) => void; narrow?: boolean }) {
  const conversations = useChatStore(s => s.conversations)
  const { agents } = useAgentsStore()

  const recent = [...conversations]
    .filter(c => c.lastMessage)
    .sort((a, b) => (b.lastAt ?? '') > (a.lastAt ?? '') ? 1 : -1)
    .slice(0, 5)

  if (recent.length === 0) return null

  const list = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 2 : 2 }}>
        {recent.map(conv => {
          const agent = agents.find(a => a.id === conv.agentId)
          return (
            <button key={conv.id} onClick={() => onOpen(conv.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: narrow ? '11px 8px' : '9px 12px', borderRadius: 'var(--radius)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              onMouseEnter={e => { if (!narrow) (e.currentTarget.style.background = 'var(--bg-elevated)') }}
              onMouseLeave={e => { if (!narrow) (e.currentTarget.style.background = 'none') }}
            >
              <span style={{ fontSize: narrow ? 20 : 16, flexShrink: 0 }}>{agent?.identity?.emoji ?? '🤖'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 1 }}>
                  <span style={{ fontSize: narrow ? 14 : 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>
                    {agent?.identity?.name ?? agent?.name ?? conv.agentId}
                  </span>
                  {conv.lastAt && (
                    <span style={{ fontSize: narrow ? 11 : 10, color: 'var(--text-secondary)', opacity: 0.5, flexShrink: 0, marginLeft: 'auto' }}>
                      {formatRelativeDate(conv.lastAt)}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: narrow ? 13 : 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                  {conv.lastMessage}
                </p>
              </div>
              {!narrow && <ArrowRight size={12} style={{ color: 'var(--text-secondary)', opacity: 0.3, flexShrink: 0 }} />}
            </button>
          )
        })}
      </div>
      <button onClick={() => onNavigate('chat')}
        style={{ marginTop: 6, fontSize: narrow ? 13 : 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px' }}>
        See all conversations →
      </button>
    </>
  )

  if (narrow) {
    return (
      <MobileCard>
        <SectionHead Icon={Clock} label="Recent" narrow />
        {list}
      </MobileCard>
    )
  }

  return (
    <div style={{ marginTop: 28 }}>
      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)', marginBottom: 10 }}>Recent</p>
      {list}
    </div>
  )
}

// ── Active (processes + sessions) ─────────────────────────────────────────────

function ActiveSection({ onNavigate, narrow }: { onNavigate: (s: NavSection) => void; narrow?: boolean }) {
  const { processes, runs } = useProcessesStore()
  const { blueprints } = useTeamsStore()
  const { sessions, customLabels, derivedNames } = useSessionsStore()

  // Team runs live in the same `runs` store but have their own dedicated Teams section
  // (which navigates to the Teams tab). Exclude them here so a running team isn't
  // duplicated into the processes-oriented "Active" list — and so tapping it doesn't
  // wrongly drive to the Processes tab.
  const teamIds = new Set(blueprints.map(b => b.id))
  const runningProcs = Object.values(runs)
    .filter(r => r.status === 'running' && !teamIds.has(r.processId))
    .map(r => ({ run: r, def: processes.find(p => p.id === r.processId) }))

  const activeSessions = sessions.filter(s => s.hasActiveRun)

  if (runningProcs.length === 0 && activeSessions.length === 0) return null

  const content = (
    <>
      <SectionHead Icon={Activity} label="Active" iconColor="var(--accent)" narrow />

      {runningProcs.map(({ run, def }) => {
        const name        = def?.name ?? run.processId
        const graphSteps  = def?.graph?.nodes.filter(n => n.type !== 'start' && n.type !== 'end').length ?? 0
        const elapsed     = Math.floor((Date.now() - run.startedAt) / 1000)
        const elapsedStr  = fmtElapsed(elapsed)
        const progCurrent = run.progress?.current ?? run.stepsDone
        const progTotal   = run.progress?.total   ?? graphSteps
        const progLabel   = run.progress?.label
        const hasProgress = progTotal > 0
        const progPct     = hasProgress ? Math.min(100, (progCurrent / progTotal) * 100) : 0

        return (
          <button key={run.processId} onClick={() => onNavigate('processes')}
            style={{ width: '100%', display: 'block', padding: narrow ? '12px 12px' : '10px 12px', marginBottom: 6, borderRadius: 'var(--radius)', border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))', background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-surface))', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: hasProgress ? 6 : 0 }}>
              <Loader2 size={narrow ? 13 : 11} style={{ color: 'var(--accent)', flexShrink: 0 }} className="animate-spin" />
              <span style={{ fontSize: narrow ? 14 : 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <span style={{ fontSize: narrow ? 11 : 10, color: 'var(--text-secondary)', flexShrink: 0 }}>{elapsedStr}</span>
            </div>
            {hasProgress && (
              <div style={{ marginBottom: progLabel ? 4 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progPct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.4s ease' }} />
                  </div>
                  <span style={{ fontSize: narrow ? 10 : 9, color: 'var(--text-secondary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{progCurrent}/{progTotal}</span>
                </div>
                {progLabel && (
                  <p style={{ fontSize: narrow ? 11 : 10, color: 'var(--text-secondary)', opacity: 0.7, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {progLabel}
                  </p>
                )}
              </div>
            )}
          </button>
        )
      })}

      {activeSessions.map(sess => {
        const label = customLabels[sess.key] ?? derivedNames[sess.key] ?? sess.displayName ?? sess.label ?? sess.key
        return (
          <div key={sess.key}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: narrow ? '10px 12px' : '7px 12px', marginBottom: 4, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
            <Loader2 size={narrow ? 12 : 10} style={{ color: 'var(--accent)', flexShrink: 0 }} className="animate-spin" />
            <span style={{ fontSize: narrow ? 14 : 12, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label}
            </span>
          </div>
        )
      })}
    </>
  )

  return narrow ? <MobileCard>{content}</MobileCard> : <div style={{ marginBottom: 16 }}>{content}</div>
}

// ── Crons ─────────────────────────────────────────────────────────────────────

function CronsSection({ onNavigate, narrow }: { onNavigate: (s: NavSection) => void; narrow?: boolean }) {
  const { jobs, runningNow } = useCronsStore()
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  const visible = jobs
    // Reminders are one-shot session-turn crons — shown in their own Reminders section.
    .filter(j => j.enabled && !isReminderJob(j) && !isManagedJob(j))
    .sort((a, b) => {
      const aRunning = runningNow.has(a.id) || Boolean(a.state?.runningAtMs)
      const bRunning = runningNow.has(b.id) || Boolean(b.state?.runningAtMs)
      if (aRunning !== bRunning) return aRunning ? -1 : 1
      return (a.state?.nextRunAtMs ?? Infinity) - (b.state?.nextRunAtMs ?? Infinity)
    })
    .slice(0, 4)

  if (visible.length === 0) return null

  const content = (
    <>
      <SectionHead Icon={Timer} label="Automations" narrow action={<SeeAll narrow={narrow} onClick={() => onNavigate('crons')} />} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 2 : 4 }}>
        {visible.map(job => {
          const isRunning  = runningNow.has(job.id) || Boolean(job.state?.runningAtMs)
          const nextMs     = job.state?.nextRunAtMs
          const lastMs     = job.state?.lastRunAtMs
          const lastStatus = job.state?.lastRunStatus
          const iconSz     = narrow ? 13 : 11

          return (
            <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: narrow ? '8px 0' : '5px 0' }}>
              {isRunning
                ? <Loader2 size={iconSz} style={{ color: 'var(--accent)', flexShrink: 0 }} className="animate-spin" />
                : lastStatus === 'error'
                ? <XCircle size={iconSz} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                : lastMs
                ? <CheckCircle2 size={iconSz} style={{ color: 'var(--success)', flexShrink: 0 }} />
                : <Clock size={iconSz} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              }
              <span style={{ fontSize: narrow ? 14 : 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.name}
              </span>
              <span style={{ fontSize: narrow ? 12 : 10, color: 'var(--text-secondary)', flexShrink: 0, opacity: 0.7 }}>
                {isRunning ? 'running'
                  : nextMs ? `in ${fmtNextRun(nextMs)}`
                  : lastMs ? fmtLastRun(lastMs)
                  : '—'
                }
              </span>
            </div>
          )
        })}
      </div>
    </>
  )

  return narrow ? <MobileCard>{content}</MobileCard> : <div style={{ marginBottom: 16 }}>{content}</div>
}

// ── Resources ─────────────────────────────────────────────────────────────────

function ResourcesSection({ narrow }: { narrow?: boolean }) {
  const { metrics, engineModels } = useMetricsStore()
  const remoteGateway = useIsRemoteGateway()
  const gwHost = useConnectionStore(s => gatewayHost(s.connection?.url))

  // On a remote gateway the metrics come from the HOST via the joaxclaw-fs plugin's
  // host.metrics RPC (see store/metrics). If the plugin is too old to provide it,
  // `metrics` stays null — explain that instead of showing the client machine's numbers.
  if (remoteGateway && !metrics) {
    const body = (
      <>
        <SectionHead Icon={Cpu} label="Resources" narrow />
        <p style={{ fontSize: narrow ? 13 : 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Gateway runs on <b style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{gwHost}</b>.
          Update the <b style={{ color: 'var(--text-primary)' }}>joaxclaw-fs</b> plugin on the host to see its CPU / RAM / GPU here.
        </p>
      </>
    )
    return narrow ? <MobileCard>{body}</MobileCard> : <div>{body}</div>
  }

  if (!metrics) return null

  const gpu      = metrics.gpu?.[0]
  const gpuPct   = gpu?.utilizationGpu ?? 0
  const ramUsed  = metrics.ramUsed / (1024 ** 3)
  const ramPct   = metrics.ramTotal > 0 ? (metrics.ramUsed / metrics.ramTotal) * 100 : 0
  // Across EVERY local instance: the isolated cron engine loads its own copy into the
  // same GPU, so counting only the interactive one understates VRAM by a whole model
  // whenever an automation is running.
  const loaded   = loadedModels(engineModels)

  // VRAM: prefer size_vram from Ollama /api/ps; fall back to model file size (size ≈ VRAM for quantized models)
  const modelVram = (m: typeof loaded[0]) => (m.vramUsed && m.vramUsed > 0) ? m.vramUsed : m.size
  const vramUsedBytes  = loaded.reduce((sum, m) => sum + modelVram(m), 0)
  const vramTotalBytes = gpu?.memTotal ? gpu.memTotal * 1024 * 1024 : 0   // memTotal is in MiB
  const vramUsedG      = (vramUsedBytes / (1024 ** 3)).toFixed(1)
  const vramPct        = vramTotalBytes > 0 ? (vramUsedBytes / vramTotalBytes) * 100 : 0
  const hasVram        = vramUsedBytes > 0 || vramTotalBytes > 0

  const barColor = (pct: number) => pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)'

  const labelFs: React.CSSProperties = { fontSize: narrow ? 12 : 10, color: 'var(--text-secondary)', width: narrow ? 40 : 32, flexShrink: 0 }
  const valueW: React.CSSProperties  = { fontSize: narrow ? 12 : 10, color: 'var(--text-secondary)', flexShrink: 0, whiteSpace: 'nowrap', textAlign: 'right', minWidth: 36 }

  const content = (
    <>
      <SectionHead
        Icon={Cpu} label="Resources" narrow
        action={remoteGateway ? (
          <span
            title={`Live from the gateway host ${gwHost ?? ''}`.trim()}
            style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 15%, transparent)', padding: '1px 5px', borderRadius: 4 }}
          >
            host
          </span>
        ) : undefined}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 12 : 8 }}>

        {/* GPU — utilization bar when it's measurable (NVIDIA/AMD); model name only when
            it isn't (e.g. Apple Silicon: unified memory, no util without sudo). */}
        {gpu && (gpu.memTotal > 0 || gpu.utilizationGpu > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={labelFs} title={gpu.model}>GPU</span>
            <ResourceBar value={gpuPct} color={barColor(gpuPct)} />
            <span style={valueW}>{gpuPct}%</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={labelFs}>GPU</span>
            <span style={{ fontSize: narrow ? 12 : 10, color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={gpu.model}>
              {gpu.model}
            </span>
          </div>
        ))}

        {/* VRAM — derived from THIS client's loaded Ollama models, so only meaningful for a
            local gateway. On remote we still show host GPU%/RAM above, but not this. */}
        {!remoteGateway && hasVram && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={labelFs}>VRAM</span>
            <ResourceBar value={vramTotalBytes > 0 ? vramPct : 0} color={barColor(vramPct)} />
            <span style={valueW}>{vramUsedG}G</span>
          </div>
        )}

        {/* RAM */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={labelFs}>RAM</span>
          <ResourceBar value={ramPct} color={barColor(ramPct)} />
          <span style={valueW}>{ramUsed.toFixed(1)}G</span>
        </div>

        {/* Loaded models breakdown — client-side Ollama, local gateway only (see VRAM note) */}
        {!remoteGateway && loaded.length > 0 && (
          <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: narrow ? 6 : 4 }}>
            {loaded.map(m => {
              const vram     = modelVram(m)
              const vramG    = (vram / (1024 ** 3)).toFixed(1)
              const modelPct = vramTotalBytes && vram ? Math.min(100, (vram / vramTotalBytes) * 100) : 0
              return (
                <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: narrow ? 12 : 10, color: 'var(--text-secondary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name.split(':')[0]}
                  </span>
                  {modelPct > 0 && <ResourceBar value={modelPct} color="color-mix(in srgb, var(--accent) 60%, transparent)" />}
                  <span style={{ ...valueW, fontSize: 9, opacity: 0.75 }}>{vramG}G</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )

  return narrow ? <MobileCard>{content}</MobileCard> : <div>{content}</div>
}

// ── Teams ─────────────────────────────────────────────────────────────────────

function TeamsSection({ onNavigate, narrow }: { onNavigate: (s: NavSection) => void; narrow?: boolean }) {
  const { blueprints } = useTeamsStore()
  const { runs } = useProcessesStore()
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (blueprints.length === 0) return null

  const entries = [...blueprints]
    .map(bp => ({ bp, run: runs[bp.id] }))
    .sort((a, b) => {
      const aRunning = a.run?.status === 'running'
      const bRunning = b.run?.status === 'running'
      if (aRunning !== bRunning) return aRunning ? -1 : 1
      const aActive = a.run && a.run.status !== 'idle'
      const bActive = b.run && b.run.status !== 'idle'
      if (aActive !== bActive) return aActive ? -1 : 1
      const aTime = a.run?.finishedAt ?? a.run?.startedAt ?? 0
      const bTime = b.run?.finishedAt ?? b.run?.startedAt ?? 0
      return bTime - aTime
    })
    .slice(0, 5)

  const content = (
    <>
      <SectionHead Icon={UsersRound} label="Teams" narrow action={<SeeAll narrow={narrow} onClick={() => onNavigate('teams')} />} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {entries.map(({ bp, run }) => {
          const status    = run?.status ?? 'idle'
          const isRunning = status === 'running'
          const elapsed   = isRunning && run?.startedAt ? Math.floor((Date.now() - run.startedAt) / 1000) : 0
          const elapsedStr = fmtElapsed(elapsed)
          const iconSz    = narrow ? 13 : 11

          return (
            <button key={bp.id} onClick={() => onNavigate('teams')}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: narrow ? '9px 8px' : '5px 8px',
                borderRadius: 'var(--radius)', width: '100%', textAlign: 'left', cursor: 'pointer',
                border: isRunning ? '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))' : '1px solid transparent',
                background: isRunning ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-surface))' : 'none',
              }}
              onMouseEnter={e => { if (!narrow && !isRunning) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
              onMouseLeave={e => { if (!narrow && !isRunning) (e.currentTarget as HTMLElement).style.background = 'none' }}
            >
              {isRunning
                ? <Loader2 size={iconSz} style={{ color: 'var(--accent)', flexShrink: 0 }} className="animate-spin" />
                : status === 'done'
                ? <CheckCircle2 size={iconSz} style={{ color: 'var(--success)', flexShrink: 0 }} />
                : status === 'error'
                ? <XCircle size={iconSz} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                : <Clock size={iconSz} style={{ color: 'var(--text-secondary)', opacity: 0.35, flexShrink: 0 }} />
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: narrow ? 14 : 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                  {bp.name}
                </span>
                {isRunning && run?.currentAgent && (
                  <span style={{ fontSize: narrow ? 12 : 10, color: 'var(--text-secondary)', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {run.currentAgent}
                  </span>
                )}
              </div>
              <span style={{ fontSize: narrow ? 12 : 10, color: 'var(--text-secondary)', flexShrink: 0, opacity: 0.65 }}>
                {isRunning
                  ? elapsedStr
                  : status === 'done' && run?.finishedAt
                  ? fmtLastRun(run.finishedAt)
                  : status === 'error' && run?.finishedAt
                  ? fmtLastRun(run.finishedAt)
                  : `${bp.members.length} agent${bp.members.length !== 1 ? 's' : ''}`
                }
              </span>
            </button>
          )
        })}
      </div>
    </>
  )

  return narrow ? <MobileCard>{content}</MobileCard> : <div style={{ marginBottom: 16 }}>{content}</div>
}

// ── Scripts (background jobs the model launched via script_start) ───────────────

function ScriptsSection({ narrow }: { narrow?: boolean }) {
  const status = useConnectionStore(s => s.status)
  const [jobs, setJobs] = useState<ScriptJob[]>([])

  // Poll the host for tracked script jobs. listJobs() returns [] when the plugin is too
  // old for jobs.list, and gateway.ts caches the unknown method so this stays cheap.
  useEffect(() => {
    if (status !== 'connected') { setJobs([]); return }
    let alive = true
    const poll = async () => { const list = await listJobs(); if (alive) setJobs(list) }
    poll()
    const id = setInterval(poll, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [status])

  const running = jobs.filter(j => j.running)
  if (running.length === 0) return null

  const content = (
    <>
      <SectionHead Icon={Terminal} label="Scripts" narrow />
      <div style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 2 : 4 }}>
        {running.slice(0, 5).map(job => (
          <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: narrow ? '8px 0' : '5px 0' }}>
            <Loader2 size={narrow ? 13 : 11} className="animate-spin" style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <span style={{ fontSize: narrow ? 13 : 11, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }} title={job.command}>
              {job.command}
            </span>
            <span style={{ fontSize: narrow ? 11 : 10, color: 'var(--text-secondary)', flexShrink: 0, opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
              {job.percent != null ? `${job.percent}% · ` : ''}{fmtElapsed(Math.round(job.elapsedMs / 1000))}
            </span>
            <button
              onClick={() => { void stopJob(job.id) }}
              title="Stop the script"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: narrow ? 6 : 2, flexShrink: 0 }}
            >
              <Square size={narrow ? 13 : 10} />
            </button>
          </div>
        ))}
      </div>
    </>
  )

  return narrow ? <MobileCard>{content}</MobileCard> : <div style={{ marginBottom: 16 }}>{content}</div>
}

// ── Reminders (one-shot self-pings the model scheduled) ─────────────────────────

function RemindersSection({ narrow }: { narrow?: boolean }) {
  const jobs = useCronsStore(s => s.jobs)
  const cancel = useCronsStore(s => s.remove)
  const [now, setNow] = useState(() => Date.now())

  const reminders = [...reminderBySession(jobs).values()]
    .sort((a, b) => (a.fireAtMs ?? Infinity) - (b.fireAtMs ?? Infinity))

  // Tick the countdown only while there's something to count down.
  useEffect(() => {
    if (reminders.length === 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [reminders.length])

  if (reminders.length === 0) return null

  const content = (
    <>
      <SectionHead Icon={Bell} label="Reminders" narrow />
      <div style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 2 : 4 }}>
        {reminders.slice(0, 5).map(r => (
          <div key={r.jobId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: narrow ? '8px 0' : '5px 0' }}>
            <Bell size={narrow ? 13 : 11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: narrow ? 14 : 11, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.prompt}>
              {r.prompt || 'Reminder'}
            </span>
            <span style={{ fontSize: narrow ? 12 : 10, color: 'var(--text-secondary)', flexShrink: 0, opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
              {r.fireAtMs ? `in ${fmtCountdown(r.fireAtMs, now)}` : ''}
            </span>
            <button
              onClick={() => { void cancel(r.jobId) }}
              title="Cancel this reminder"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: narrow ? 6 : 2, flexShrink: 0 }}
            >
              <X size={narrow ? 14 : 11} />
            </button>
          </div>
        ))}
      </div>
    </>
  )

  return narrow ? <MobileCard>{content}</MobileCard> : <div style={{ marginBottom: 16 }}>{content}</div>
}

// ── Desktop right panel ─────────────────────────────────────────────────────────

function RightPanel({ onNavigate }: { onNavigate: (s: NavSection) => void }) {
  return (
    <div style={{
      width: 300, flexShrink: 0,
      borderLeft: '1px solid var(--border)',
      overflowY: 'auto',
      padding: '20px 16px', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      <ActiveSection onNavigate={onNavigate} />
      <ScriptsSection />
      <RemindersSection />
      <TeamsSection onNavigate={onNavigate} />
      <CronsSection onNavigate={onNavigate} />
      <ResourcesSection />
    </div>
  )
}

// ── Desktop left panel ──────────────────────────────────────────────────────────

function LeftPanel({ onSendMessage, onOpenConversation, onNavigate }: {
  onSendMessage: (agentId: string, text: string) => void
  onOpenConversation: (convId: string) => void
  onNavigate: (s: NavSection) => void
}) {
  const logoUrl = useLogoUrl()
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 32px 32px' }}>
      <div style={{ width: '100%', maxWidth: 600 }}>
        {/* Brand header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <img src={logoUrl} alt="JoaxClaw" style={{ height: 44, width: 'auto', flexShrink: 0 }} />
          <span style={{ fontSize: 26, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1 }}>
            JoaxClaw
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 28, paddingLeft: 2 }}>
          {greeting()}
        </p>
        <ChatInputCard onSend={onSendMessage} />
        <RecentConversations onOpen={onOpenConversation} onNavigate={onNavigate} />
      </div>
    </div>
  )
}

// ── Mobile dashboard ────────────────────────────────────────────────────────────

function MobileHeader({ onNavigate }: { onNavigate: (s: NavSection) => void }) {
  const logoUrl = useLogoUrl()
  const status = useConnectionStore(s => s.status)
  const dot = status === 'connected' ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--danger)'
  const label = status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Offline'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={logoUrl} alt="JoaxClaw" style={{ height: 30, width: 'auto', flexShrink: 0 }} />
        <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em', flex: 1 }}>JoaxClaw</span>
        <button
          onClick={() => onNavigate('gateway')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer' }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
        </button>
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 }}>{greeting()}</p>
    </div>
  )
}

function MobileDashboard({ onSendMessage, onOpenConversation, onNavigate }: {
  onSendMessage: (agentId: string, text: string) => void
  onOpenConversation: (convId: string) => void
  onNavigate: (s: NavSection) => void
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 14px 28px', maxWidth: 640, margin: '0 auto' }}>
        <MobileHeader onNavigate={onNavigate} />
        <ChatInputCard onSend={onSendMessage} narrow />
        <QuickStats onNavigate={onNavigate} />
        <ActiveSection onNavigate={onNavigate} narrow />
        <RecentConversations onOpen={onOpenConversation} onNavigate={onNavigate} narrow />
        <TeamsSection onNavigate={onNavigate} narrow />
        <CronsSection onNavigate={onNavigate} narrow />
        <RemindersSection narrow />
        <ScriptsSection narrow />
        <ResourcesSection narrow />
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (s: NavSection) => void
}

export function DashboardView({ onNavigate }: Props) {
  const newConversation    = useChatStore(s => s.newConversation)
  const sendMessage        = useChatStore(s => s.sendMessage)
  const selectConversation = useChatStore(s => s.selectConversation)
  const { agents, fetch: fetchAgents }  = useAgentsStore()
  const { fetch: fetchSessions }        = useSessionsStore()
  const { fetch: fetchCrons }           = useCronsStore()
  const { load: loadProcesses }         = useProcessesStore()
  const { load: loadTeams }             = useTeamsStore()
  const narrow = useIsNarrow()

  useEffect(() => {
    fetchAgents()
    fetchSessions()
    fetchCrons()
    loadProcesses()
    loadTeams()
  }, [])

  const handleSendMessage = async (agentId: string, text: string) => {
    const agent  = agents.find(a => a.id === agentId)
    const name   = agent?.identity?.name ?? agent?.name ?? agentId
    const convId = newConversation(agentId, name)
    selectConversation(convId)
    onNavigate('chat')
    await sendMessage(convId, text)
  }

  const handleOpenConversation = (convId: string) => {
    selectConversation(convId)
    onNavigate('chat')
  }

  // Mobile: a single scrolling, card-based feed. Desktop: the two-panel layout.
  if (narrow) {
    return (
      <MobileDashboard
        onSendMessage={handleSendMessage}
        onOpenConversation={handleOpenConversation}
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <HealthStrip onNavigate={onNavigate} />
      <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, overflowY: 'hidden', overflowX: 'hidden' }}>
        <LeftPanel
          onSendMessage={handleSendMessage}
          onOpenConversation={handleOpenConversation}
          onNavigate={onNavigate}
        />
        <RightPanel onNavigate={onNavigate} />
      </div>
    </div>
  )
}
