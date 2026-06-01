import { useEffect, useState } from 'react'
import { RefreshCw, Play, Trash2, ChevronDown, Clock, CheckCircle2, XCircle, SkipForward, Loader2, ToggleLeft, ToggleRight, AlertCircle, Pencil } from 'lucide-react'
import { ModelIcon } from '../ui/ModelIcon'
import { useCronsStore } from '../../store/crons'
import type { CronJob, CronRunEntry, CronSchedule } from '../../lib/types'
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

function RunEntryRow({ entry }: { entry: CronRunEntry }) {
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

function JobDetail({ job }: { job: CronJob }) {
  const { fetchRuns, toggle, runNow, remove, runs, runsHasMore, loadingRuns, runningNow } = useCronsStore()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
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
          <RunEntryRow key={`${entry.runAtMs ?? entry.ts}-${i}`} entry={entry} />
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

// ── Main view ─────────────────────────────────────────────────────────────────

export function CronsView() {
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
      </div>

      {/* Detail panel */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0" style={{ background: 'var(--bg-primary)' }}>
        {selectedJob ? (
          <JobDetail key={selectedJob.id} job={selectedJob} />
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
