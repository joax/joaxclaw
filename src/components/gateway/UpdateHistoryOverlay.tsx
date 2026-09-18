import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, Circle, Copy, Check, ExternalLink, History, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Overlay } from '../ui/Overlay'
import { Btn } from '../ui/Btn'
import { Pill } from '../ui/Pill'
import { EmptyState } from '../ui/EmptyState'
import { PhaseIcon, PhaseMarks } from './UpdatePhases'
import { useGatewayUpdateStore } from '../../store/gatewayUpdate'
import { useConnectionStore } from '../../store/connection'
import { gatewayClient } from '../../lib/gateway'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { toneColor } from '../../lib/stateTone'
import {
  failureMarkdown, formatDowntime, formatWhen, isFailedRun, phaseProgress, resultLabel, runTone, triggerLabel, verificationChecks, versionLine,
  type CheckValue, type PhaseMark, type ReportPreview, type ReportResult, type UpdateRun,
} from '../../lib/gatewayUpdate'

// Update history (Gateway → Gateway → History, or a result banner's Details): the last 20
// runs from update.runs.list, and one run's phases, checks, steps and repair attempts. It
// opens in an Overlay because that tab's body is the config editor. A failed run's details
// can be copied as Markdown; "Report on GitHub" shows only for the gateway's latest run and
// only when update.report's preview says it's ready (it needs owner authority).

/** "Copy failure details": a text button that says "Copied" for 1.2 s. */
export function CopyFailureButton({ run, size = 'sm' }: { run: UpdateRun; size?: 'sm' | 'md' }) {
  const ownRunIds = useGatewayUpdateStore(s => s.ownRunIds)
  const [done, setDone] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(failureMarkdown(run, triggerLabel(run.trigger, run.runId, ownRunIds)))
    setDone(true)
    setTimeout(() => setDone(false), 1200)
  }
  return (
    <Btn size={size} variant="outline" icon={done ? <Check size={12} style={{ color: toneColor('done') }} /> : <Copy size={12} />} onClick={copy}>
      {done ? 'Copied' : 'Copy failure details'}
    </Btn>
  )
}

export function UpdateHistoryOverlay() {
  const open = useGatewayUpdateStore(s => s.historyOpen)
  const runId = useGatewayUpdateStore(s => s.historyRunId)
  const history = useGatewayUpdateStore(s => s.history)
  const resultRun = useGatewayUpdateStore(s => s.resultRun)
  const close = useGatewayUpdateStore(s => s.closeHistory)
  const showRun = useGatewayUpdateStore(s => s.showRun)
  if (!open) return null

  // A result banner's Details may open before the list has loaded; its own record will do.
  const run = runId ? history.runs.find(r => r.runId === runId) ?? (resultRun?.runId === runId ? resultRun : null) : null
  const title = run ? `Update on ${formatWhen(run.createdAtMs, Date.now())}` : 'Update history'
  return (
    <Overlay title={title} width={680} onClose={close}>
      <div className="flex flex-col gap-3 px-5 py-4 overflow-y-auto text-sm" style={{ color: 'var(--text-primary)' }}>
        {runId ? (
          <>
            <div>
              <Btn size="sm" variant="ghost" icon={<ArrowLeft size={12} />} onClick={() => showRun(null)}>All updates</Btn>
            </div>
            {run ? <RunDetails run={run} latest={history.runs[0]?.runId === run.runId} />
              : history.loading ? <LoadingRow /> : <p style={{ color: 'var(--text-secondary)' }}>This update is no longer in the gateway's history.</p>}
          </>
        ) : <RunList />}
      </div>
    </Overlay>
  )
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--text-secondary)' }}>
      <Loader2 size={14} className="animate-spin" /> Loading update history…
    </div>
  )
}

function RunList() {
  const history = useGatewayUpdateStore(s => s.history)
  const ownRunIds = useGatewayUpdateStore(s => s.ownRunIds)
  const load = useGatewayUpdateStore(s => s.loadHistory)
  const showRun = useGatewayUpdateStore(s => s.showRun)
  const narrow = useIsNarrow()

  if (history.loading && !history.runs.length) return <LoadingRow />
  if (history.error) {
    return (
      <div className="flex flex-col items-start gap-2 py-2">
        <p style={{ color: toneColor('failed') }}>Couldn't load the update history: {history.error}</p>
        <Btn size="sm" variant="outline" icon={<RefreshCw size={12} />} onClick={() => void load()}>Retry</Btn>
      </div>
    )
  }
  if (!history.runs.length) return <EmptyState icon={History} label="No updates yet." hint="Updates started anywhere appear here." />

  const now = Date.now()
  const th = 'text-left font-medium py-1.5 pr-3'
  return (
    // Scrolls sideways rather than clipping Details on a narrow phone.
    <div style={{ overflowX: 'auto' }}>
    <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
      <thead style={{ color: 'var(--text-secondary)' }}>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th scope="col" className={th}>When</th>
          <th scope="col" className={th}>Version</th>
          <th scope="col" className={th}>Started by</th>
          <th scope="col" className={th}>Result</th>
          {!narrow && <th scope="col" className={th}>Down</th>}
          <th scope="col" className={th}><span className="sr-only">Details</span></th>
        </tr>
      </thead>
      <tbody>
        {history.runs.map(r => (
          <tr key={r.runId} style={{ borderBottom: '1px solid var(--border)' }}>
            <td className="py-1.5 pr-3 whitespace-nowrap">{formatWhen(r.createdAtMs, now)}</td>
            <td className="py-1.5 pr-3 font-mono">{versionLine(r)}</td>
            <td className="py-1.5 pr-3">{triggerLabel(r.trigger, r.runId, ownRunIds)}</td>
            <td className="py-1.5 pr-3"><Pill tone={runTone(r.status)}>{resultLabel(r.status)}</Pill></td>
            {!narrow && <td className="py-1.5 pr-3 font-mono">{formatDowntime(r.downtimeMs) || '—'}</td>}
            <td className="py-1 text-right">
              <Btn size="sm" variant="ghost" onClick={() => showRun(r.runId)} style={narrow ? { minHeight: 40 } : undefined}>Details</Btn>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

const CHECK_MARK: Record<CheckValue, PhaseMark> = { Passed: 'done', Failed: 'failed', 'Not checked': 'pending' }

const STEP_ICON: Record<string, ReactNode> = {
  completed: <CheckCircle2 size={12} style={{ color: toneColor('done') }} />,
  failed: <XCircle size={12} style={{ color: toneColor('failed') }} />,
  in_progress: <Loader2 size={12} className="animate-spin" style={{ color: toneColor('working') }} />,
}

function RunDetails({ run, latest }: { run: UpdateRun; latest: boolean }) {
  const ownRunIds = useGatewayUpdateStore(s => s.ownRunIds)
  const admin = useConnectionStore(s => s.grantedScopes.includes('operator.admin'))
  const failed = isFailedRun(run)
  const checks = verificationChecks(run.verification)
  const label = { fontSize: 11, color: 'var(--text-secondary)', width: 64, flexShrink: 0 }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono">{versionLine(run)}</span>
        <span style={{ color: 'var(--text-secondary)' }}>· {triggerLabel(run.trigger, run.runId, ownRunIds)} ·</span>
        <Pill tone={runTone(run.status)}>{resultLabel(run.status)}</Pill>
        {run.downtimeMs != null && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>down for {formatDowntime(run.downtimeMs)}</span>}
      </div>
      {run.reason && (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Reason: <code className="font-mono px-1 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{run.reason}</code>
        </p>
      )}
      {run.nextAction && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{run.nextAction}</p>}

      <div className="flex items-start gap-3">
        <span style={label}>Phases</span>
        <PhaseMarks progress={phaseProgress(run)} />
      </div>
      <div className="flex items-start gap-3">
        <span style={label}>Checks</span>
        <ul className="flex items-center flex-wrap gap-x-3 gap-y-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {checks.map(c => (
            <li key={c.label} className="inline-flex items-center gap-1 text-xs" title={c.value}>
              <span aria-hidden style={{ display: 'flex' }}><PhaseIcon mark={CHECK_MARK[c.value]} /></span>
              {c.label}{c.note ? ` (${c.note})` : ''}
              <span className="sr-only">: {c.value}</span>
            </li>
          ))}
        </ul>
      </div>
      {!!run.verification.pluginErrors?.length && (
        <ul className="text-xs font-mono flex flex-col gap-0.5" style={{ color: toneColor('failed'), paddingLeft: 76, margin: 0, listStyle: 'none' }}>
          {run.verification.pluginErrors.map((e, i) => <li key={i} style={{ wordBreak: 'break-word' }}>{e}</li>)}
        </ul>
      )}

      <details className="text-xs">
        <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>Steps ({run.steps.length})</summary>
        <ol className="mt-1.5 flex flex-col gap-1" style={{ listStyle: 'none', padding: 0 }}>
          {run.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span aria-hidden style={{ display: 'flex', marginTop: 2 }}>{STEP_ICON[s.status] ?? <Circle size={12} style={{ color: toneColor('idle'), opacity: 0.6 }} />}</span>
              <span className="min-w-0">
                <span className="font-mono">{s.step}</span>
                <span className="sr-only"> ({s.status})</span>
                {s.detail && <span className="block whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      </details>
      {run.repair.length > 0 && (
        <details className="text-xs">
          <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>Repair attempts ({run.repair.length})</summary>
          <ol className="mt-1.5 flex flex-col gap-1" style={{ listStyle: 'none', padding: 0 }}>
            {run.repair.map(r => (
              <li key={r.attempt} className="flex items-start gap-2">
                <span aria-hidden style={{ display: 'flex', marginTop: 2 }}>{STEP_ICON[r.status === 'succeeded' ? 'completed' : r.status] ?? <Circle size={12} style={{ color: toneColor('idle') }} />}</span>
                <span>#{r.attempt} {r.summary ?? r.status}{r.reason ? <span style={{ color: 'var(--text-secondary)' }}> · {r.reason}</span> : null}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* Only the latest run: it's the one still worth acting on, and the only one the gateway will report. */}
      {failed && latest && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <CopyFailureButton run={run} />
            {admin && gatewayClient.hasMethod('update.report') && <ReportControls runId={run.runId} />}
          </div>
        </div>
      )}
    </div>
  )
}

// "Report on GitHub": the gateway builds the issue and only reports its latest failed run,
// for an owner. The preview is asked for once when the details open; anything but "ready"
// (FORBIDDEN, stale) just means no button.
function ReportControls({ runId }: { runId: string }) {
  const previewReport = useGatewayUpdateStore(s => s.previewReport)
  const submitReport = useGatewayUpdateStore(s => s.submitReport)
  const [preview, setPreview] = useState<ReportPreview | null>(null)
  const [showing, setShowing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ReportResult | null>(null)

  useEffect(() => {
    let live = true
    void previewReport(runId).then(p => { if (live) setPreview(p) })
    return () => { live = false }
  }, [runId, previewReport])

  if (!preview) return null
  const submit = async () => {
    setSubmitting(true)
    setResult(await submitReport(preview))
    setSubmitting(false)
  }

  if (!showing) return <Btn size="sm" icon={<ExternalLink size={12} />} onClick={() => setShowing(true)}>Report on GitHub</Btn>
  return (
    <div className="flex flex-col gap-2 w-full">
      <p className="font-semibold text-sm">{preview.title}</p>
      <pre className="text-xs font-mono whitespace-pre-wrap p-2 rounded overflow-y-auto" style={{ maxHeight: 240, background: 'var(--bg-primary)', border: '1px solid var(--border)', wordBreak: 'break-word' }}>
        {preview.body}
      </pre>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {result ? <ReportOutcome result={result} onRetry={submit} retrying={submitting} />
          : <Btn size="sm" loading={submitting} onClick={() => void submit()}>Submit report</Btn>}
      </div>
    </div>
  )
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{children}</a>
}

function ReportOutcome({ result, onRetry, retrying }: { result: ReportResult; onRetry: () => void; retrying: boolean }) {
  switch (result.status) {
    case 'created':
      return <span className="text-xs">Reported. {result.url && <ExtLink href={result.url}>View issue ↗</ExtLink>}</span>
    case 'fallback':
      return <span className="text-xs">{result.fallbackUrl ? <ExtLink href={result.fallbackUrl}>Open the prefilled issue ↗</ExtLink> : result.message}</span>
    case 'duplicate': {
      const link = result.url ?? result.fallbackUrl
      return <span className="text-xs">Already reported{link ? <> · <ExtLink href={link}>View issue ↗</ExtLink></> : null}</span>
    }
    default:
      return (
        <span className="flex items-center gap-2 text-xs">
          <span style={{ color: 'var(--text-secondary)' }}>{result.message ?? "The report wasn't sent."}</span>
          <Btn size="sm" variant="outline" loading={retrying} icon={<RefreshCw size={12} />} onClick={onRetry}>Retry</Btn>
        </span>
      )
  }
}
