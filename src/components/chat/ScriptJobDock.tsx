import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, Square, X, AlertTriangle } from 'lucide-react'
import type { ChatMessage } from '../../lib/types'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { collectJobRefs, jobRefsForSession, subscribeJob, listJobs, stopJob, fmtElapsed, type JobRef, type JobState } from '../../lib/scriptJobs'
import { useConnectionStore } from '../../store/connection'

// Sticky strip pinned above the message thread, showing the scripts this conversation
// has running. The inline ScriptJobCard lives wherever the model launched the script and
// scrolls away with the transcript; this stays put, so a long-running script keeps its
// status, progress and output tail reachable no matter where the user has scrolled.
//
// A job stays docked until it finishes (then it holds its result until dismissed) so an
// outcome is never lost while the user is reading further up.

export function ScriptJobDock({ messages, sessionKey }: { messages: ChatMessage[]; sessionKey?: string }) {
  const transcriptRefs = useMemo(() => collectJobRefs(messages), [messages])
  const [hostRefs, setHostRefs] = useState<JobRef[]>([])
  const connected = useConnectionStore(s => s.status) === 'connected'

  // Recovery after an app reload: history comes back without tool calls, so there is no
  // script_start result left to parse a jobId out of — but the job itself is alive on the
  // host and knows which session launched it. Ask the host which of its running jobs
  // belong to this chat and adopt them.
  useEffect(() => {
    if (!sessionKey || !connected) return
    let alive = true
    const poll = async () => {
      const mine = jobRefsForSession(await listJobs(), sessionKey)
      if (!alive || mine.length === 0) return
      setHostRefs(prev => {
        const merged = new Map(prev.map(r => [r.jobId, r]))
        for (const r of mine) if (!merged.has(r.jobId)) merged.set(r.jobId, r)
        return merged.size === prev.length ? prev : [...merged.values()]
      })
    }
    void poll()
    const t = setInterval(poll, 3000)
    return () => { alive = false; clearInterval(t) }
  }, [sessionKey, connected])

  // Adopted jobs stay in the list once discovered, so one that finishes keeps its result
  // on screen (the dock drops it only on dismiss / switching chats).
  const refs = useMemo(() => {
    const all = new Map<string, JobRef>()
    for (const r of [...transcriptRefs, ...hostRefs]) if (!all.has(r.jobId)) all.set(r.jobId, r)
    return [...all.values()]
  }, [transcriptRefs, hostRefs])
  const ids = refs.map(r => r.jobId).join(',')
  const [states, setStates] = useState<Record<string, JobState>>({})
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // Jobs this dock actually saw running — the ones whose result is worth holding onto.
  // Jobs already finished when the conversation was opened stay out of the dock.
  const sawRunning = useRef<Set<string>>(new Set())

  // Keyed by the id set, not the refs array: `messages` (and so `refs`) is rebuilt on
  // every streamed token, and resubscribing that often would restart the poll loops.
  useEffect(() => {
    const unsubs = (ids ? ids.split(',') : [])
      .map(jobId => subscribeJob(jobId, s => setStates(prev => ({ ...prev, [jobId]: s }))))
    return () => unsubs.forEach(u => u())
  }, [ids])

  useEffect(() => {
    for (const [jobId, s] of Object.entries(states)) {
      if (s.job?.running && !s.expired) sawRunning.current.add(jobId)
    }
  }, [states])

  const docked = refs.filter(r => {
    if (dismissed.has(r.jobId)) return false
    const s = states[r.jobId]
    if (!s?.job) return false
    if (s.job.running && !s.expired) return true
    return sawRunning.current.has(r.jobId)   // finished under our watch — keep the result
  })

  if (docked.length === 0) return null

  return (
    <div
      className="shrink-0"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))', background: 'var(--bg-elevated)' }}
    >
      {docked.map(ref => (
        <DockedJob
          key={ref.jobId}
          jobRef={ref}
          state={states[ref.jobId]}
          onDismiss={() => setDismissed(d => new Set(d).add(ref.jobId))}
        />
      ))}
    </div>
  )
}

function DockedJob({ jobRef, state, onDismiss }: { jobRef: JobRef; state: JobState; onDismiss: () => void }) {
  const [open, setOpen] = useState(false)   // the tail is opt-in: the dock stays a thin strip
  const [stopping, setStopping] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)
  const narrow = useIsNarrow()

  const job = state.job
  const running = !!job?.running && !state.expired
  const failed = !!job && !job.running && (job.exitCode ? job.exitCode !== 0 : !!job.error)
  const percent = job?.percent ?? null
  const cmd = job?.command ?? jobRef.command ?? 'script'

  // Follow the tail while it's open and the job is live.
  useEffect(() => {
    if (open && running && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [job?.output, open, running])

  // The job vanished from the host (GC'd or an old plugin) while we were watching it —
  // we know it ended, but not how.
  const lost = state.expired && !job?.done

  const tone = running ? 'var(--warning)' : lost ? 'var(--text-secondary)' : failed ? 'var(--danger)' : 'var(--success)'
  const StatusIcon = running ? Loader2 : lost ? AlertTriangle : failed ? XCircle : CheckCircle2
  const status = running
    ? `${fmtElapsed(job?.elapsedMs ?? 0)}${percent != null ? ` · ${percent}%` : ''}`
    : lost ? 'Ended (details expired)'
    : job?.error ? `Error${job?.exitCode != null ? ` · exit ${job.exitCode}` : ''}`
    : `Exit ${job?.exitCode ?? 0} · ${fmtElapsed(job?.elapsedMs ?? 0)}`

  const handleStop = async () => {
    setStopping(true)
    try { await stopJob(jobRef.jobId) } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <Terminal size={12} style={{ color: tone, flexShrink: 0 }} />
        {/* On a phone the icon carries this — the row only has room for the command. */}
        {!narrow && (
          <span className="font-semibold" style={{ color: 'var(--text-primary)', flexShrink: 0 }}>
            {running ? 'Script running' : lost ? 'Script ended' : 'Script finished'}
          </span>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          title={open ? 'Hide output' : 'Show output'}
          className="flex items-center gap-1 truncate font-mono"
          style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-secondary)', textAlign: 'left' }}
        >
          {open ? <ChevronDown size={11} style={{ flexShrink: 0 }} /> : <ChevronRight size={11} style={{ flexShrink: 0 }} />}
          <span className="truncate" title={cmd}>{cmd}</span>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusIcon size={12} className={running ? 'animate-spin' : ''} style={{ color: tone }} />
          <span style={{ color: tone, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{status}</span>
          {running ? (
            <button
              onClick={handleStop}
              disabled={stopping}
              title="Stop the script"
              style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 4, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--danger)', cursor: stopping ? 'default' : 'pointer', fontSize: 10, opacity: stopping ? 0.6 : 1 }}
            >
              <Square size={9} /> {stopping ? 'Stopping' : 'Stop'}
            </button>
          ) : (
            <button
              onClick={onDismiss}
              title="Dismiss"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 2, padding: 2, borderRadius: 4, border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {running && percent != null && (
        <div style={{ height: 3, background: 'var(--bg-primary)' }}>
          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--warning)', transition: 'width 0.3s' }} />
        </div>
      )}

      {open && (
        <pre
          ref={preRef}
          style={{ margin: 0, padding: '8px 12px', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5, background: 'var(--bg-primary)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 180, overflowY: 'auto', borderTop: '1px solid var(--border)' }}
        >
          {job?.outputTruncated ? '…(earlier output truncated)\n' : ''}
          {job?.output || (running ? '(waiting for output…)' : '(no output)')}
        </pre>
      )}
    </div>
  )
}
