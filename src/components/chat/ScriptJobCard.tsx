import { useEffect, useRef, useState } from 'react'
import { Terminal, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, Square, AlertTriangle } from 'lucide-react'
import { jobStatus, stopJob, type ScriptJob } from '../../lib/scriptJobs'

// Live card for a background script started via the joaxclaw-fs `script_start` tool.
// Polls jobs.get on the host while the job runs; shows status, elapsed, a % bar when
// the script prints one, and a streaming output tail. Because the job lives on the
// host, this reconnects to live progress even after an app reload.

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function ScriptJobCard({ jobId, command }: { jobId: string; command?: string }) {
  const [job, setJob] = useState<ScriptJob | null>(null)
  const [expired, setExpired] = useState(false)   // job unknown / GC'd — we lost track
  const [open, setOpen] = useState(true)          // output visible while running
  const [stopping, setStopping] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const j = await jobStatus(jobId)
        if (!alive) return
        setJob(j)
        setExpired(false)
        if (!j.done) timer = setTimeout(poll, 1500)
        else setOpen(false)   // collapse the log once it finishes
      } catch {
        // Unknown jobId (finished + cleaned up, or plugin too old) — stop polling and
        // show whatever we last had.
        if (alive) setExpired(true)
      }
    }
    poll()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [jobId])

  // Follow the tail while the log is open and the job is live.
  useEffect(() => {
    if (open && job?.running && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [job?.output, open, job?.running])

  const running = !!job?.running && !expired
  const failed = !!job && !job.running && (job.exitCode ? job.exitCode !== 0 : !!job.error)
  const cmd = job?.command ?? command ?? ''
  const percent = job?.percent ?? null

  const tone = running ? 'var(--warning)' : expired ? 'var(--text-secondary)' : failed ? 'var(--danger)' : 'var(--success)'
  const StatusIcon = running ? Loader2 : expired ? AlertTriangle : failed ? XCircle : CheckCircle2
  const statusText = running
    ? `Running · ${fmtElapsed(job?.elapsedMs ?? 0)}${percent != null ? ` · ${percent}%` : ''}`
    : expired && !job?.done ? 'Ended (details expired)'
    : job?.error ? `Error${job?.exitCode != null ? ` · exit ${job.exitCode}` : ''}`
    : job ? `Exit ${job.exitCode ?? 0} · ${fmtElapsed(job.elapsedMs)}`
    : 'Starting…'

  const handleStop = async () => {
    setStopping(true)
    try { await stopJob(jobId) } catch { /* ignore */ }
  }

  return (
    <div className="mb-2" style={{ border: `1px solid ${running ? 'color-mix(in srgb, var(--warning) 40%, var(--border))' : 'var(--border)'}`, borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
        <Terminal size={12} style={{ color: 'var(--warning)', flexShrink: 0 }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)', flexShrink: 0 }}>Script</span>
        {cmd && (
          <span className="text-xs truncate font-mono" style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 0 }} title={cmd}>
            {cmd}
          </span>
        )}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <StatusIcon size={12} className={running ? 'animate-spin' : ''} style={{ color: tone }} />
          <span className="text-xs" style={{ color: tone, whiteSpace: 'nowrap' }}>{statusText}</span>
          {running && (
            <button
              onClick={handleStop}
              disabled={stopping}
              title="Stop the script"
              style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 4, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--danger)', cursor: stopping ? 'default' : 'pointer', fontSize: 10, opacity: stopping ? 0.6 : 1 }}
            >
              <Square size={9} /> {stopping ? 'Stopping' : 'Stop'}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar (only when the script emits a percentage) */}
      {running && percent != null && (
        <div style={{ height: 3, background: 'var(--bg-primary)' }}>
          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--warning)', transition: 'width 0.3s' }} />
        </div>
      )}

      {/* Output tail (collapsible) */}
      {(job?.output || running) && (
        <div>
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', width: '100%' }}
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {open ? 'Hide output' : 'Show output'}
          </button>
          {open && (
            <pre
              ref={preRef}
              style={{ margin: 0, padding: '8px 12px', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5, background: 'var(--bg-primary)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 240, overflowY: 'auto', borderTop: '1px solid var(--border)' }}
            >
              {job?.outputTruncated ? '…(earlier output truncated)\n' : ''}
              {job?.output || (running ? '(waiting for output…)' : '(no output)')}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
