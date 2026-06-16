import { useEffect, useState, useMemo } from 'react'
import { RefreshCw, Play, Trash2, ChevronDown, Clock, CheckCircle2, XCircle, HelpCircle, SkipForward, Loader2, ToggleLeft, ToggleRight, AlertCircle, Pencil, MessageSquare, Server, Terminal, HardDrive, Zap } from 'lucide-react'
import { ModelIcon } from '../ui/ModelIcon'
import { useCronsStore } from '../../store/crons'
import { useChatStore } from '../../store/chat'
import { useConnectionStore } from '../../store/connection'
import { useModelsStore } from '../../store/models'
import type { CronJob, CronRunEntry, CronSchedule } from '../../lib/types'
import { checkOllama, gatewayHost, isLocalGateway, type OllamaStatus } from '../../lib/ollamaHealth'
import { Btn } from '../ui/Btn'
import { CronEditor } from './CronEditor'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEveryMs(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s}s`
  const m = s / 60
  if (m < 60) return m === Math.floor(m) ? `${m}m` : `${m.toFixed(1)}m`
  const h = m / 60
  if (h < 24) return h === Math.floor(h) ? `${h}h` : `${h.toFixed(1)}h`
  const d = h / 24
  return d === Math.floor(d) ? `${d}d` : `${d.toFixed(1)}d`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function describeCronExpr(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr
  const [min, hour, dom, month, dow] = parts

  const isAll = (v: string) => v === '*'
  const isNum = (v: string) => /^\d+$/.test(v)
  const num = (v: string) => parseInt(v, 10)
  const hhmm = (h: string, m: string) => {
    const hh = num(h), mm = num(m)
    if (hh === 0 && mm === 0) return 'midnight'
    if (hh === 12 && mm === 0) return 'noon'
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
  }

  // Every minute
  if (expr === '* * * * *') return 'Every minute'

  // Every N minutes: */N * * * *
  if (/^\*\/\d+$/.test(min) && isAll(hour) && isAll(dom) && isAll(month) && isAll(dow)) {
    const n = num(min.slice(2))
    return n === 1 ? 'Every minute' : `Every ${n} min`
  }

  // N times per hour: */N * * * * with N dividing 60
  // Hourly variants: fixed minute, * hour
  if (isNum(min) && isAll(hour) && isAll(dom) && isAll(month) && isAll(dow)) {
    const m = num(min)
    return m === 0 ? 'Hourly' : `Hourly at :${m.toString().padStart(2, '0')}`
  }

  // Every N hours: min */N * * *
  if (/^\*\/\d+$/.test(hour) && isAll(dom) && isAll(month) && isAll(dow)) {
    const n = num(hour.slice(2))
    const label = isNum(min) && num(min) === 0 ? `Every ${n}h` : `Every ${n}h at :${isNum(min) ? num(min).toString().padStart(2, '0') : '??'}`
    return label
  }

  // Daily: min hour * * *
  if (isNum(min) && isNum(hour) && isAll(dom) && isAll(month) && isAll(dow)) {
    return `Daily at ${hhmm(hour, min)}`
  }

  // Weekdays: min hour * * 1-5
  if (isNum(min) && isNum(hour) && isAll(dom) && isAll(month) && dow === '1-5') {
    return `Weekdays at ${hhmm(hour, min)}`
  }

  // Weekends: min hour * * 6,0 or 0,6
  if (isNum(min) && isNum(hour) && isAll(dom) && isAll(month) && (dow === '6,0' || dow === '0,6')) {
    return `Weekends at ${hhmm(hour, min)}`
  }

  // Multiple specific hours: min H,H,H * * *
  if (isNum(min) && hour.includes(',') && isAll(dom) && isAll(month) && isAll(dow)) {
    const hours = hour.split(',').map(Number)
    if (hours.every(h => !isNaN(h))) {
      const sorted = [...hours].sort((a, b) => a - b)
      // Check if evenly spaced including midnight wrap-around → "Every Nh"
      const gap = sorted[1] - sorted[0]
      const evenly = sorted.every((h, i) => i === 0 || h - sorted[i - 1] === gap)
      const wrap = 24 - sorted[sorted.length - 1] + sorted[0]
      if (evenly && wrap === gap && num(min) === 0) return `Every ${gap}h`
      // Otherwise list the hours
      const m = num(min)
      const labels = sorted.map(h => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`)
      return labels.join(', ')
    }
  }

  // Weekly on a specific day: min hour * * dow
  if (isNum(min) && isNum(hour) && isAll(dom) && isAll(month) && isNum(dow)) {
    const d = num(dow)
    if (d >= 0 && d <= 6) return `Weekly · ${DAYS[d]} at ${hhmm(hour, min)}`
  }

  // Multiple days of the week: min hour * * D,D,D
  if (isNum(min) && isNum(hour) && isAll(dom) && isAll(month) && dow.includes(',')) {
    const days = dow.split(',').map(Number)
    if (days.every(d => !isNaN(d) && d >= 0 && d <= 6)) {
      const dayNames = days.sort((a, b) => a - b).map(d => DAYS[d]).join(', ')
      return `${dayNames} at ${hhmm(hour, min)}`
    }
  }

  // Monthly on a specific day: min hour dom * *
  if (isNum(min) && isNum(hour) && isNum(dom) && isAll(month) && isAll(dow)) {
    const d = num(dom)
    const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'
    return `Monthly · ${d}${suffix} at ${hhmm(hour, min)}`
  }

  // Yearly: min hour dom month *
  if (isNum(min) && isNum(hour) && isNum(dom) && isNum(month) && isAll(dow)) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const mo = months[num(month) - 1] ?? month
    return `Yearly · ${mo} ${num(dom)} at ${hhmm(hour, min)}`
  }

  return expr
}

function formatSchedule(s: CronSchedule): string {
  if (s.kind === 'at') return `Once · ${s.at ? new Date(s.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?'}`
  if (s.kind === 'every') return `Every ${formatEveryMs(s.everyMs ?? 0)}`
  if (s.kind === 'cron') return describeCronExpr(s.expr ?? '')
  return '?'
}

function formatAgo(ms: number | undefined): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(ms).toLocaleDateString()
}

function formatIn(ms: number | undefined): string {
  if (!ms) return '—'
  const diff = ms - Date.now()
  if (diff <= 0) return 'overdue'
  if (diff < 60000) return `in ${Math.ceil(diff / 1000)}s`
  if (diff < 3600000) return `in ${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return `in ${Math.floor(diff / 3600000)}h`
  return new Date(ms).toLocaleDateString()
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function formatAbsoluteTs(ms: number | undefined): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Status helpers ─────────────────────────────────────────────────────────────

type RunStatus = 'ok' | 'error' | 'skipped' | 'running' | undefined

function statusColor(status: RunStatus): string {
  if (status === 'ok') return 'var(--success)'
  if (status === 'error') return 'var(--danger)'
  if (status === 'skipped') return 'var(--warning)'
  if (status === 'running') return 'var(--accent)'
  return 'var(--text-secondary)'
}

function StatusIcon({ status, size = 13 }: { status: RunStatus; size?: number }) {
  if (status === 'ok') return <CheckCircle2 size={size} style={{ color: 'var(--success)' }} />
  if (status === 'error') return <XCircle size={size} style={{ color: 'var(--danger)' }} />
  if (status === 'skipped') return <SkipForward size={size} style={{ color: 'var(--warning)' }} />
  if (status === 'running') return <Loader2 size={size} className="animate-spin" style={{ color: 'var(--accent)' }} />
  return <Clock size={size} style={{ color: 'var(--text-secondary)' }} />
}

// ── Job list item ─────────────────────────────────────────────────────────────

function jobModel(job: CronJob): string | undefined {
  if (job.payload?.kind === 'agentTurn' && job.payload.model) {
    const m = job.payload.model
    const slash = m.lastIndexOf('/')
    return slash >= 0 ? m.slice(slash + 1) : m
  }
  return undefined
}

function JobRow({ job, active, onClick }: { job: CronJob; active: boolean; onClick: () => void }) {
  const isRunning = Boolean(job.state.runningAtMs)
  const lastStatus = isRunning ? 'running' : job.state.lastRunStatus as RunStatus
  const model = jobModel(job)
  const modelFull = job.payload?.kind === 'agentTurn' ? (job.payload.model ?? '') : ''

  // Time hint: running > last run > next run
  const timeLabel = isRunning
    ? 'running…'
    : job.state.lastRunAtMs
      ? formatAgo(job.state.lastRunAtMs)
      : job.state.nextRunAtMs
        ? formatIn(job.state.nextRunAtMs)
        : null

  return (
    <div
      onClick={onClick}
      className="flex flex-col px-3 py-2 cursor-pointer"
      style={{
        background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))' : 'transparent',
        borderRadius: 'var(--radius)',
        borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        marginBottom: 1,
        gap: 3,
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      {/* ── Row 1: status · name · badges ── */}
      <div className="flex items-center gap-2 min-w-0">
        <StatusIcon status={lastStatus} size={12} />
        <span
          className="flex-1 text-sm font-medium truncate"
          style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}
        >
          {job.name}
        </span>
        {!job.enabled && (
          <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', flexShrink: 0 }}>
            off
          </span>
        )}
      </div>

      {/* ── Row 2: model ── */}
      {model && (
        <div className="flex items-center gap-1.5 ml-5">
          <ModelIcon model={modelFull} size={9} />
          <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
            {modelFull || model}
          </span>
        </div>
      )}

      {/* ── Row 3: schedule · time ── */}
      <div className="flex items-center gap-1.5 min-w-0 ml-5">
        <span className="text-xs shrink-0" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
          {formatSchedule(job.schedule)}
        </span>
        {timeLabel && (
          <span className="text-xs shrink-0 ml-auto" style={{ color: statusColor(lastStatus) }}>
            {timeLabel}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Run history entry ─────────────────────────────────────────────────────────

function RunEntryRow({ entry, onViewConversation }: { entry: CronRunEntry; onViewConversation?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const status = entry.status as RunStatus
  const hasDetails = Boolean(entry.error || entry.summary || entry.model || entry.usage)

  return (
    <div
      className="px-4 py-3"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={status} size={13} />
        <span className="text-xs font-medium" style={{ color: statusColor(status) }}>
          {status ?? 'unknown'}
        </span>
        {entry.durationMs !== undefined && (
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {formatDuration(entry.durationMs)}
          </span>
        )}
        <span
          className="ml-auto text-xs"
          style={{ color: 'var(--text-secondary)' }}
          title={formatAbsoluteTs(entry.runAtMs ?? entry.ts)}
        >
          {formatAgo(entry.runAtMs ?? entry.ts)}
        </span>
        {onViewConversation && (
          <button
            onClick={onViewConversation}
            title="View conversation"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            <MessageSquare size={13} />
          </button>
        )}
        {hasDetails && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}
          >
            <ChevronDown size={13} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>
        )}
      </div>

      {entry.summary && (
        <p
          className="text-xs mt-1.5 ml-5"
          style={{
            color: 'var(--text-secondary)',
            display: '-webkit-box',
            WebkitLineClamp: expanded ? undefined : 2,
            WebkitBoxOrient: 'vertical',
            overflow: expanded ? 'visible' : 'hidden'
          }}
        >
          {entry.summary}
        </p>
      )}

      {expanded && (
        <div className="mt-2 ml-5 flex flex-col gap-1">
          {entry.error && (
            <div
              className="flex items-start gap-1.5 px-2 py-1.5 rounded text-xs"
              style={{
                background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                color: 'var(--danger)',
                border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)'
              }}
            >
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              <span style={{ wordBreak: 'break-word' }}>{entry.error}</span>
            </div>
          )}
          {entry.errorReason && (
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Reason: {entry.errorReason}</span>
          )}
          {entry.model && (
            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>Model: {entry.model}</span>
          )}
          {entry.usage && (
            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              Tokens: {entry.usage.input_tokens ?? 0} in / {entry.usage.output_tokens ?? 0} out
              {entry.usage.cache_read_tokens ? ` / ${entry.usage.cache_read_tokens} cache` : ''}
            </span>
          )}
          {entry.sessionKey && (
            <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
              Session: {entry.sessionKey}
            </span>
          )}
          {(entry.runAtMs ?? entry.ts) && (
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {formatAbsoluteTs(entry.runAtMs ?? entry.ts)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Job detail panel ──────────────────────────────────────────────────────────

function JobDetail({ job, onOpenChat }: { job: CronJob; onOpenChat?: () => void }) {
  const { fetchRuns, toggle, runNow, remove, runs, runsHasMore, loadingRuns, runningNow } = useCronsStore()
  const { loadSessionMessages } = useChatStore()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)

  function viewConversation(sessionKey: string) {
    const agentId = job.agentId ?? (sessionKey.includes('@') ? sessionKey.slice(0, sessionKey.indexOf('@')) : sessionKey)
    loadSessionMessages(sessionKey, agentId, job.name).then(() => onOpenChat?.())
  }
  const jobRuns = runs[job.id] ?? []
  const isLoadingRuns = loadingRuns.has(job.id)
  const isRunningNow = runningNow.has(job.id)
  const isRunning = Boolean(job.state.runningAtMs) || isRunningNow

  useEffect(() => {
    fetchRuns(job.id, true)
  }, [job.id])

  return (
    <>
    {editing && <CronEditor job={job} onClose={() => setEditing(false)} />}
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div
        className="px-5 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {job.name}
            </h2>
            {job.description && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{job.description}</p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Edit */}
            <Btn size="sm" variant="outline" icon={<Pencil size={12} />} onClick={() => setEditing(true)}>
              Edit
            </Btn>
            {/* Toggle enabled */}
            <button
              onClick={() => toggle(job.id, !job.enabled)}
              title={job.enabled ? 'Disable job' : 'Enable job'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs"
              style={{
                background: job.enabled
                  ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                  : 'var(--bg-elevated)',
                border: `1px solid ${job.enabled ? 'color-mix(in srgb, var(--success) 35%, transparent)' : 'var(--border)'}`,
                color: job.enabled ? 'var(--success)' : 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              {job.enabled ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
              {job.enabled ? 'Enabled' : 'Disabled'}
            </button>

            {/* Run Now */}
            <Btn
              size="sm"
              variant="outline"
              icon={isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              loading={isRunningNow}
              onClick={() => runNow(job.id)}
              disabled={isRunning}
            >
              Run now
            </Btn>

            {/* Delete */}
            {confirmDelete ? (
              <>
                <Btn size="sm" variant="danger" onClick={() => { remove(job.id); setConfirmDelete(false) }}>Delete</Btn>
                <Btn size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Btn>
              </>
            ) : (
              <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => setConfirmDelete(true)} style={{ color: 'var(--danger)' }} />
            )}
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          <InfoChip label="Schedule" value={formatSchedule(job.schedule)} mono />
          {job.state.nextRunAtMs && (
            <InfoChip label="Next run" value={formatIn(job.state.nextRunAtMs)} />
          )}
          {job.state.lastRunAtMs && (
            <InfoChip label="Last run" value={formatAgo(job.state.lastRunAtMs)} />
          )}
          {job.agentId && (
            <InfoChip label="Agent" value={job.agentId} mono />
          )}
          <InfoChip label="Wake" value={job.wakeMode} />
        </div>

        {isRunning && (
          <div
            className="flex items-center gap-2 mt-3 px-3 py-2 rounded text-xs"
            style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }}
          >
            <Loader2 size={11} className="animate-spin" />
            Running…
          </div>
        )}

        {job.state.consecutiveErrors !== undefined && job.state.consecutiveErrors > 0 && (
          <div
            className="flex items-center gap-2 mt-2 px-3 py-2 rounded text-xs"
            style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)' }}
          >
            <AlertCircle size={11} />
            {job.state.consecutiveErrors} consecutive error{job.state.consecutiveErrors > 1 ? 's' : ''}
            {job.state.lastError ? ` — ${job.state.lastError}` : ''}
          </div>
        )}
      </div>

      {/* Run history */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          Run history {jobRuns.length > 0 && `(${jobRuns.length})`}
        </span>
        <Btn
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={11} />}
          loading={isLoadingRuns && jobRuns.length === 0}
          onClick={() => fetchRuns(job.id, true)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoadingRuns && jobRuns.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />
          </div>
        )}

        {!isLoadingRuns && jobRuns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Clock size={24} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No runs recorded yet</p>
          </div>
        )}

        {jobRuns.map((entry, i) => (
          <RunEntryRow
            key={`${entry.runAtMs ?? entry.ts}-${i}`}
            entry={entry}
            onViewConversation={entry.sessionKey ? () => viewConversation(entry.sessionKey!) : undefined}
          />
        ))}

        {runsHasMore[job.id] && (
          <div className="flex justify-center py-3">
            <Btn
              size="sm"
              variant="outline"
              loading={isLoadingRuns}
              onClick={() => fetchRuns(job.id)}
            >
              Load more
            </Btn>
          </div>
        )}
      </div>
    </div>
    </>
  )
}

function InfoChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}:</span>
      <span
        className={`text-xs ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Ollama isolation panel ────────────────────────────────────────────────────

function ollamaStatusColor(state: OllamaStatus): string {
  return state === 'up' ? 'var(--success)' : state === 'down' ? 'var(--warning)' : 'var(--text-secondary)'
}

function OllamaServerBox({ port, label, role, state }: { port: number; label: string; role: string; state: OllamaStatus }) {
  const up = state === 'up'
  const unknown = state === 'unknown'
  const color = ollamaStatusColor(state)
  const borderC = up
    ? 'color-mix(in srgb, var(--success) 30%, transparent)'
    : unknown ? 'var(--border)' : 'color-mix(in srgb, var(--warning) 35%, transparent)'
  const bg = up
    ? 'color-mix(in srgb, var(--success) 5%, var(--bg-elevated))'
    : unknown ? 'var(--bg-elevated)' : 'color-mix(in srgb, var(--warning) 5%, var(--bg-elevated))'
  return (
    <div
      className="flex flex-col items-center gap-1 px-2 py-2 rounded flex-1"
      style={{ border: `1px solid ${borderC}`, background: bg }}
    >
      <Server size={14} style={{ color, opacity: up ? 1 : 0.65 }} />
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{label}</span>
      <code style={{ fontSize: 8, color, fontFamily: 'monospace' }}>:{port}</code>
      <span style={{ fontSize: 8, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.3 }}>{role}</span>
      <span style={{ fontSize: 8, color, fontWeight: 600 }}>{up ? '● running' : unknown ? '◐ unknown' : '○ offline'}</span>
    </div>
  )
}

function StatusLine({ label, state, badge }: { label: string; state: OllamaStatus; badge?: string }) {
  const color = ollamaStatusColor(state)
  const Icon = state === 'up' ? CheckCircle2 : state === 'down' ? XCircle : HelpCircle
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={10} style={{ color, flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
      {badge && (
        <span style={{ fontSize: 9, fontFamily: 'monospace', color, fontWeight: 600 }}>
          {badge}
        </span>
      )}
    </div>
  )
}

function SetupStep({ n, text, code }: { n: number; text: string; code?: string }) {
  return (
    <div className="flex gap-2">
      <span
        style={{
          fontSize: 8, minWidth: 15, height: 15, borderRadius: '50%',
          background: 'var(--accent)', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, flexShrink: 0, marginTop: 1,
        }}
      >
        {n}
      </span>
      <div className="flex flex-col gap-1 min-w-0">
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{text}</span>
        {code && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            <Terminal size={9} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <code style={{ fontSize: 9, color: 'var(--text-primary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {code}
            </code>
          </div>
        )}
      </div>
    </div>
  )
}

function OllamaIsolationPanel({ jobs }: { jobs: CronJob[] }) {
  const connection = useConnectionStore(s => s.connection)
  const savedConnections = useConnectionStore(s => s.savedConnections)
  const setOllamaUrls = useConnectionStore(s => s.setOllamaUrls)
  const providers = useModelsStore(s => s.providers)
  const loadModels = useModelsStore(s => s.load)

  const gatewayUrl = connection?.url
  const remote = !isLocalGateway(gatewayHost(gatewayUrl))
  // Read overrides from the live connection first, then the persisted saved entry.
  const saved = savedConnections.find(c => c.url === gatewayUrl)
  const mainOverride = connection?.ollamaUrls?.main ?? saved?.ollamaUrls?.main
  const cronOverride = connection?.ollamaUrls?.cron ?? saved?.ollamaUrls?.cron

  // Is the isolated CRON provider configured on the GATEWAY (independent of liveness)?
  const cronConfigured = useMemo(
    () => Object.entries(providers).some(([id, p]) =>
      id === 'ollama-cron' || id.startsWith('ollama-cron') || (p.baseUrl ?? '').includes(':11435')
    ),
    [providers]
  )

  const [mainStatus, setMainStatus] = useState<OllamaStatus>('unknown')
  const [cronStatus, setCronStatus] = useState<OllamaStatus>('unknown')
  const [open, setOpen] = useState(false)
  const [showUrlForm, setShowUrlForm] = useState(false)

  useEffect(() => { loadModels() }, [])

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const [main, cron] = await Promise.all([
        checkOllama('main', gatewayUrl, mainOverride),
        checkOllama('cron', gatewayUrl, cronOverride),
      ])
      if (cancelled) return
      setMainStatus(main)
      setCronStatus(cron)
      // Auto-expand once if there's a confirmed problem (not merely "unknown")
      setOpen(prev => {
        if (prev) return prev
        const hasContention = jobs.some(j => (j.payload?.kind === 'agentTurn' ? j.payload.model ?? '' : '').startsWith('ollama/'))
        return cron === 'down' || hasContention
      })
    }
    check()
    const id = setInterval(check, 6000)
    return () => { cancelled = true; clearInterval(id) }
  }, [gatewayUrl, mainOverride, cronOverride])

  const getModel = (j: CronJob) => j.payload?.kind === 'agentTurn' ? (j.payload.model ?? '') : ''
  const ollamaJobs = jobs.filter(j => getModel(j).startsWith('ollama'))
  const contentingJobs = ollamaJobs.filter(j => getModel(j).startsWith('ollama/'))
  const isolatedJobs = ollamaJobs.filter(j => getModel(j).startsWith('ollama-cron/'))

  // Hide the panel only when there's nothing Ollama-related to show.
  if (mainStatus !== 'up' && !cronConfigured && ollamaJobs.length === 0) return null

  const fullyIsolated = cronStatus === 'up' && contentingJobs.length === 0 && isolatedJobs.length > 0
  const cronDown = cronStatus === 'down'                       // confirmed down (local/explicit probe failed)
  const cronUnknown = cronStatus === 'unknown'                 // can't verify (remote, firewalled)
  // "needs setup" only on a *confirmed* problem — never on an inconclusive remote probe.
  const hasIssue = contentingJobs.length > 0 || cronDown

  const borderColor = hasIssue
    ? 'color-mix(in srgb, var(--warning) 50%, transparent)'
    : 'color-mix(in srgb, var(--success) 30%, transparent)'
  const headerBg = hasIssue
    ? 'color-mix(in srgb, var(--warning) 8%, var(--bg-elevated))'
    : 'color-mix(in srgb, var(--success) 6%, var(--bg-elevated))'

  return (
    <div
      className="mx-2 mb-2 rounded"
      style={{ border: `1px solid ${borderColor}`, overflow: 'hidden', flexShrink: 0 }}
    >
      {/* ── Collapsed header ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-3 py-2"
        style={{ background: headerBg, cursor: 'pointer', border: 'none', textAlign: 'left' }}
      >
        <Server size={11} style={{ color: hasIssue ? 'var(--warning)' : 'var(--success)', flexShrink: 0 }} />
        <span className="flex-1 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          Ollama Isolation
        </span>
        {fullyIsolated && (
          <span style={{
            fontSize: 9, color: 'var(--success)', padding: '1px 5px', borderRadius: 3,
            background: 'color-mix(in srgb, var(--success) 12%, transparent)', flexShrink: 0,
          }}>
            ✓ active
          </span>
        )}
        {!fullyIsolated && !hasIssue && cronUnknown && (
          <span style={{
            fontSize: 9, color: 'var(--text-secondary)', padding: '1px 5px', borderRadius: 3,
            background: 'var(--bg-elevated)', flexShrink: 0,
          }}>
            {cronConfigured ? 'configured' : remote ? 'remote' : 'unknown'}
          </span>
        )}
        {hasIssue && (
          <span style={{
            fontSize: 9, color: 'var(--warning)', padding: '1px 5px', borderRadius: 3,
            background: 'color-mix(in srgb, var(--warning) 12%, transparent)', flexShrink: 0,
          }}>
            ⚠ needs setup
          </span>
        )}
        <ChevronDown
          size={11}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', color: 'var(--text-secondary)', flexShrink: 0 }}
        />
      </button>

      {/* ── Expanded body ── */}
      {open && (
        <div
          className="flex flex-col gap-3 px-3 pt-3 pb-3"
          style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}
        >

          {/* ── Problem diagram (only when contention exists) ── */}
          {contentingJobs.length > 0 && (
            <div className="flex flex-col gap-2 px-2.5 py-2 rounded" style={{
              background: 'color-mix(in srgb, var(--danger) 5%, var(--bg-elevated))',
              border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
            }}>
              <div className="flex items-center gap-1.5">
                <Zap size={10} style={{ color: 'var(--danger)' }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Without isolation
                </span>
              </div>
              {/* Diagram: two sources → one Ollama → conflict */}
              <div className="flex items-center gap-1.5">
                {/* Sources */}
                <div className="flex flex-col gap-1" style={{ flexShrink: 0 }}>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }}>
                    <MessageSquare size={8} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: 8, color: 'var(--accent)' }}>Chat</span>
                  </div>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)' }}>
                    <Clock size={8} style={{ color: 'var(--warning)' }} />
                    <span style={{ fontSize: 8, color: 'var(--warning)' }}>CRON</span>
                  </div>
                </div>
                {/* Merge arrows */}
                <div className="flex flex-col items-end" style={{ color: 'var(--border)', fontSize: 9, lineHeight: 1.8, flexShrink: 0 }}>
                  <span>─┐</span>
                  <span>─┘</span>
                </div>
                <span style={{ fontSize: 9, color: 'var(--border)', flexShrink: 0 }}>▶</span>
                {/* Single Ollama */}
                <div className="flex flex-col items-center gap-0.5 px-2 py-1 rounded flex-1" style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                  <Server size={12} style={{ color: 'var(--text-secondary)' }} />
                  <code style={{ fontSize: 8, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>:11434</code>
                </div>
                {/* Conflict symbol */}
                <div className="flex flex-col items-center gap-0.5" style={{ flexShrink: 0 }}>
                  <Zap size={14} style={{ color: 'var(--danger)' }} />
                  <span style={{ fontSize: 7, color: 'var(--danger)', fontWeight: 700, textAlign: 'center' }}>session<br />cancelled</span>
                </div>
              </div>
              <p style={{ fontSize: 9, color: 'var(--danger)', margin: 0, lineHeight: 1.4 }}>
                Last request wins — CRON jobs interrupt active chat sessions.
              </p>
            </div>
          )}

          {/* ── Solution diagram ── */}
          <div className="flex flex-col gap-2 px-2.5 py-2 rounded" style={{
            background: fullyIsolated
              ? 'color-mix(in srgb, var(--success) 5%, var(--bg-elevated))'
              : 'var(--bg-elevated)',
            border: `1px solid ${fullyIsolated ? 'color-mix(in srgb, var(--success) 25%, transparent)' : 'var(--border)'}`,
          }}>
            <div className="flex items-center gap-1.5">
              <Server size={10} style={{ color: fullyIsolated ? 'var(--success)' : 'var(--text-secondary)' }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: fullyIsolated ? 'var(--success)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                With isolation
              </span>
            </div>

            {/* Source row */}
            <div className="flex justify-between px-2">
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }}>
                <MessageSquare size={8} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 8, color: 'var(--accent)' }}>Chat & Agents</span>
              </div>
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)' }}>
                <Clock size={8} style={{ color: 'var(--warning)' }} />
                <span style={{ fontSize: 8, color: 'var(--warning)' }}>CRON Jobs</span>
              </div>
            </div>

            {/* Arrow row */}
            <div className="flex justify-between px-6">
              <span style={{ fontSize: 10, color: 'var(--accent)', lineHeight: 1 }}>↓</span>
              <span style={{ fontSize: 10, color: 'var(--warning)', lineHeight: 1 }}>↓</span>
            </div>

            {/* Instance boxes */}
            <div className="flex items-stretch gap-1.5">
              <OllamaServerBox port={11434} label="Main" role="Interactive" state={mainStatus} />
              <div className="flex flex-col items-center justify-center gap-1" style={{ flexShrink: 0 }}>
                <div style={{ flex: 1, width: 1, borderLeft: '1px dashed var(--border)' }} />
                <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontWeight: 700, padding: '1px 2px' }}>≠</span>
                <div style={{ flex: 1, width: 1, borderLeft: '1px dashed var(--border)' }} />
              </div>
              <OllamaServerBox port={11435} label="CRON" role="Background" state={cronStatus} />
            </div>

            {/* Shared disk footer */}
            <div className="flex items-center justify-center gap-1.5 pt-1.5" style={{ borderTop: '1px dashed var(--border)' }}>
              <HardDrive size={9} style={{ color: 'var(--text-secondary)', opacity: 0.6 }} />
              <span style={{ fontSize: 8, color: 'var(--text-secondary)', opacity: 0.7 }}>
                Shared model files on disk · separate GPU queues
              </span>
            </div>
          </div>

          {/* ── Live status ── */}
          <div
            className="flex flex-col gap-1.5 px-2.5 py-2 rounded"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            <StatusLine label=":11434 Main Ollama" state={mainStatus} />
            <StatusLine label=":11435 CRON Ollama" state={cronStatus} />
            {ollamaJobs.length > 0 && (
              <StatusLine
                label="Jobs isolated"
                state={contentingJobs.length === 0 ? 'up' : 'down'}
                badge={`${isolatedJobs.length}/${ollamaJobs.length}`}
              />
            )}
          </div>

          {/* ── Remote gateway notice ── */}
          {remote && cronUnknown && (
            <div className="flex flex-col gap-1 px-2.5 py-2 rounded" style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            }}>
              <p style={{ fontSize: 9, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                The gateway is remote — Ollama runs on the server and isn't reachable from this client,
                so liveness can't be verified here.
                {cronConfigured
                  ? ' The CRON provider is configured in the gateway config.'
                  : ' No isolated CRON provider was found in the gateway config.'}
              </p>
              <button
                onClick={() => setShowUrlForm(v => !v)}
                style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 9, padding: 0 }}
              >
                {showUrlForm ? 'Hide' : 'Set a reachable Ollama URL'}
              </button>
              {showUrlForm && gatewayUrl && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <OllamaUrlField label="Main :11434" placeholder={`http://${gatewayHost(gatewayUrl) ?? 'host'}:11434`}
                    value={mainOverride ?? ''} onSave={v => setOllamaUrls(gatewayUrl, { main: v || undefined })} />
                  <OllamaUrlField label="CRON :11435" placeholder={`http://${gatewayHost(gatewayUrl) ?? 'host'}:11435`}
                    value={cronOverride ?? ''} onSave={v => setOllamaUrls(gatewayUrl, { cron: v || undefined })} />
                </div>
              )}
            </div>
          )}

          {/* ── Setup steps (only when needed) ── */}
          {!fullyIsolated && (contentingJobs.length > 0 || (cronDown && !remote)) && (
            <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Setup
              </span>
              {cronDown && !remote && (
                <>
                  <SetupStep
                    n={1}
                    text="Start the isolated CRON Ollama service"
                    code="systemctl --user start ollama-cron"
                  />
                  <SetupStep
                    n={2}
                    text="Enable it on boot"
                    code="systemctl --user enable ollama-cron"
                  />
                </>
              )}
              {contentingJobs.length > 0 && (
                <SetupStep
                  n={cronDown && !remote ? 3 : 1}
                  text={`${contentingJobs.length} job${contentingJobs.length > 1 ? 's use' : ' uses'} ollama/ — change prefix to ollama-cron/ to isolate`}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Small inline URL field that commits on blur / Enter.
function OllamaUrlField({ label, value, placeholder, onSave }: {
  label: string; value: string; placeholder: string; onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <label className="flex items-center gap-2">
      <span style={{ fontSize: 9, color: 'var(--text-secondary)', minWidth: 64, flexShrink: 0 }}>{label}</span>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() !== value.trim()) onSave(draft.trim()) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder={placeholder}
        style={{
          flex: 1, minWidth: 0, padding: '3px 7px', fontSize: 10, fontFamily: 'monospace',
          borderRadius: 'var(--radius)', border: '1px solid var(--border)',
          background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none',
        }}
      />
    </label>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function CronsView({ onOpenChat }: { onOpenChat?: () => void }) {
  const { jobs, loadingJobs, error, fetch } = useCronsStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => { fetch() }, [])

  // Auto-select first job when list loads
  useEffect(() => {
    if (!selectedId && jobs.length > 0) setSelectedId(jobs[0].id)
  }, [jobs.length])

  const filtered = jobs.filter(j =>
    !search || j.name.toLowerCase().includes(search.toLowerCase()) || j.agentId?.includes(search)
  )

  const selectedJob = jobs.find(j => j.id === selectedId)

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <div
        className="flex flex-col shrink-0"
        style={{ width: 300, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
      >
        {/* Sidebar header */}
        <div
          className="flex items-center gap-2 px-3 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Cron Jobs
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            {jobs.length}
          </span>
          <Btn
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={13} />}
            loading={loadingJobs}
            onClick={fetch}
          />
        </div>

        {/* Search */}
        <div className="px-3 py-2 shrink-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{
              width: '100%', padding: '5px 10px', fontSize: 12,
              borderRadius: 'var(--radius)', border: '1px solid var(--border)',
              background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none'
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-3 mb-2 px-3 py-2 rounded text-xs" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }}>
            {error}
          </div>
        )}

        {/* Job list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {!loadingJobs && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <Clock size={22} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
              <p className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
                {search ? 'No jobs match' : 'No cron jobs configured'}
              </p>
            </div>
          )}
          {filtered.map(job => (
            <JobRow
              key={job.id}
              job={job}
              active={job.id === selectedId}
              onClick={() => setSelectedId(job.id)}
            />
          ))}
        </div>

        {/* Ollama isolation help */}
        <OllamaIsolationPanel jobs={jobs} />
      </div>

      {/* Detail panel */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0" style={{ background: 'var(--bg-primary)' }}>
        {selectedJob ? (
          <JobDetail key={selectedJob.id} job={selectedJob} onOpenChat={onOpenChat} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <Clock size={40} style={{ color: 'var(--text-secondary)', opacity: 0.3 }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Select a job to view run history
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
