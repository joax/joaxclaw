import { useState } from 'react'
import { X, Check, AlertCircle, ChevronDown } from 'lucide-react'
import type { CronJob, CronSchedule, CronPayload, CronDelivery } from '../../lib/types'
import { useCronsStore } from '../../store/crons'
import { Btn } from '../ui/Btn'
import { ModelPicker } from '../ui/ModelPicker'

// ── Duration helpers ──────────────────────────────────────────────────────────

function parseDurationToMs(s: string): number | null {
  const str = s.trim().toLowerCase()
  if (!str) return null
  const parts = str.match(/(\d+(?:\.\d+)?)\s*(d|h|m|s|ms)/g)
  if (!parts) {
    const n = parseFloat(str)
    return !isNaN(n) && n > 0 ? Math.round(n * 60000) : null
  }
  let total = 0
  for (const part of parts) {
    const m = part.match(/(\d+(?:\.\d+)?)\s*(d|h|m|s|ms)/)
    if (!m) return null
    const n = parseFloat(m[1])
    const unit = m[2]
    if (unit === 'ms') total += n
    else if (unit === 's') total += n * 1000
    else if (unit === 'm') total += n * 60000
    else if (unit === 'h') total += n * 3600000
    else if (unit === 'd') total += n * 86400000
  }
  return total > 0 ? total : null
}

function msToDurationStr(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s}s`
  const m = s / 60
  if (m < 60) return m === Math.floor(m) ? `${m}m` : `${m.toFixed(1)}m`
  const h = m / 60
  if (h < 24) return h === Math.floor(h) ? `${h}h` : `${h.toFixed(1)}h`
  const d = h / 24
  return d === Math.floor(d) ? `${d}d` : `${d.toFixed(1)}d`
}

function isoToDatetimeLocal(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToIso(val: string): string {
  if (!val) return ''
  return new Date(val).toISOString()
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{hint}</p>}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono, multiline, rows }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; multiline?: boolean; rows?: number
}) {
  const style: React.CSSProperties = {
    display: 'block', width: '100%', padding: '7px 12px', fontSize: 13,
    borderRadius: 'var(--radius)', border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none',
    boxSizing: 'border-box', resize: multiline ? 'vertical' : undefined,
    fontFamily: mono ? 'monospace' : undefined
  }
  if (multiline) {
    return <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows ?? 4} style={style}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')} />
  }
  return <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={style}
    onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
    onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')} />
}

function SelectInput({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        display: 'block', width: '100%', padding: '7px 32px 7px 12px', fontSize: 13,
        borderRadius: 'var(--radius)', border: '1px solid var(--border)',
        background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none',
        boxSizing: 'border-box', appearance: 'none', cursor: 'pointer'
      }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        {children}
      </select>
      <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
    </div>
  )
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none" style={{ userSelect: 'none' }}>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 36, height: 20, borderRadius: 10, position: 'relative', flexShrink: 0,
          background: value ? 'var(--accent)' : 'var(--border)',
          transition: 'background 0.15s', cursor: 'pointer'
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16,
          borderRadius: '50%', background: 'white',
          transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
        }} />
      </div>
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
    </label>
  )
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = 'general' | 'schedule' | 'payload' | 'target'

// ── Editor component ──────────────────────────────────────────────────────────

interface Props { job: CronJob; onClose: () => void }

export function CronEditor({ job, onClose }: Props) {
  const { update } = useCronsStore()
  const [tab, setTab] = useState<Tab>('general')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── General ──
  const [name, setName] = useState(job.name)
  const [description, setDescription] = useState(job.description ?? '')
  const [enabled, setEnabled] = useState(job.enabled)
  const [deleteAfterRun, setDeleteAfterRun] = useState(job.deleteAfterRun ?? false)

  // ── Schedule ──
  const [schedKind, setSchedKind] = useState<CronSchedule['kind']>(job.schedule.kind)
  const [atVal, setAtVal] = useState(isoToDatetimeLocal(job.schedule.at))
  const [everyStr, setEveryStr] = useState(job.schedule.everyMs ? msToDurationStr(job.schedule.everyMs) : '')
  const [cronExpr, setCronExpr] = useState(job.schedule.expr ?? '')
  const [cronTz, setCronTz] = useState(job.schedule.tz ?? '')

  // ── Payload ──
  const initPayload = job.payload
  const [payloadKind, setPayloadKind] = useState<'systemEvent' | 'agentTurn'>(initPayload?.kind ?? 'agentTurn')
  const [eventText, setEventText] = useState(initPayload?.kind === 'systemEvent' ? (initPayload.text ?? '') : '')
  const [agentMessage, setAgentMessage] = useState(initPayload?.kind === 'agentTurn' ? (initPayload.message ?? '') : '')
  const [payloadModel, setPayloadModel] = useState(initPayload?.kind === 'agentTurn' ? (initPayload.model ?? '') : '')
  const [lightContext, setLightContext] = useState(initPayload?.kind === 'agentTurn' ? (initPayload.lightContext ?? false) : false)
  const [timeoutSeconds, setTimeoutSeconds] = useState(initPayload?.kind === 'agentTurn' ? String(initPayload.timeoutSeconds ?? '') : '')
  const [thinking, setThinking] = useState(initPayload?.kind === 'agentTurn' ? (initPayload.thinking ?? '') : '')

  // ── Target ──
  const [agentId, setAgentId] = useState(job.agentId ?? '')
  const [sessionTarget, setSessionTarget] = useState(job.sessionTarget ?? 'main')
  const [customSessionTarget, setCustomSessionTarget] = useState(
    job.sessionTarget?.startsWith('session:') ? job.sessionTarget : ''
  )
  const [wakeMode, setWakeMode] = useState(job.wakeMode ?? 'now')
  const [deliveryMode, setDeliveryMode] = useState<string>(job.delivery?.mode ?? 'none')
  const [deliveryChannel, setDeliveryChannel] = useState(job.delivery?.channel ?? '')
  const [deliveryTo, setDeliveryTo] = useState(job.delivery?.to ?? '')

  // Derived: is sessionTarget a custom "session:..." value?
  const isCustomSession = sessionTarget === '__custom__' || (sessionTarget.startsWith('session:') && !['main', 'isolated', 'current'].includes(sessionTarget))
  const sessionTargetSelect = isCustomSession ? '__custom__' : sessionTarget

  function buildSchedule(): CronSchedule {
    if (schedKind === 'at') return { kind: 'at', at: datetimeLocalToIso(atVal) }
    if (schedKind === 'every') {
      const ms = parseDurationToMs(everyStr)
      return { kind: 'every', everyMs: ms ?? (job.schedule.everyMs ?? 3600000) }
    }
    return { kind: 'cron', expr: cronExpr.trim(), ...(cronTz.trim() ? { tz: cronTz.trim() } : {}) }
  }

  function buildPayload(): CronPayload {
    if (payloadKind === 'systemEvent') return { kind: 'systemEvent', text: eventText }
    const p: CronPayload = { kind: 'agentTurn', message: agentMessage }
    if (payloadModel.trim()) (p as { model?: string }).model = payloadModel.trim()
    if (lightContext) (p as { lightContext?: boolean }).lightContext = true
    const ts = parseFloat(timeoutSeconds)
    if (!isNaN(ts) && ts > 0) (p as { timeoutSeconds?: number }).timeoutSeconds = ts
    if (thinking.trim()) (p as { thinking?: string }).thinking = thinking.trim()
    return p
  }

  function buildDelivery(): CronDelivery | undefined {
    if (deliveryMode === 'none') return { mode: 'none' }
    if (deliveryMode === 'announce') return {
      mode: 'announce',
      ...(deliveryChannel.trim() ? { channel: deliveryChannel.trim() } : {}),
      ...(deliveryTo.trim() ? { to: deliveryTo.trim() } : {})
    }
    if (deliveryMode === 'webhook') return {
      mode: 'webhook',
      to: deliveryTo.trim(),
      ...(deliveryChannel.trim() ? { channel: deliveryChannel.trim() } : {})
    }
    return undefined
  }

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    const resolvedSessionTarget = sessionTargetSelect === '__custom__' ? customSessionTarget.trim() : sessionTarget
    const patch: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      enabled,
      deleteAfterRun,
      agentId: agentId.trim() || null,
      schedule: buildSchedule(),
      payload: buildPayload(),
      sessionTarget: resolvedSessionTarget,
      wakeMode,
      delivery: buildDelivery()
    }
    try {
      await update(job.id, patch)
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 800)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const everyParseOk = schedKind !== 'every' || Boolean(parseDurationToMs(everyStr))

  const TABS: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'payload', label: 'Payload' },
    { id: 'target', label: 'Target' }
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div
        className="fixed right-0 bottom-0 z-50 flex flex-col"
        style={{ top: 36, width: 500, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="min-w-0">
            <h2 className="font-semibold text-base truncate" style={{ color: 'var(--text-primary)' }}>{job.name}</h2>
            <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>{job.id}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 px-5 pt-2 gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 12px', fontSize: 13, fontWeight: 500,
              color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── General ── */}
          {tab === 'general' && (
            <>
              <Field label="Name">
                <TextInput value={name} onChange={setName} placeholder="My cron job" />
              </Field>
              <Field label="Description">
                <TextInput value={description} onChange={setDescription} placeholder="Optional description" />
              </Field>
              <Field label="State">
                <Toggle value={enabled} onChange={setEnabled} label="Enabled" />
              </Field>
              <Field label="Lifecycle" hint="When enabled, the job is deleted automatically after it runs once. Useful for one-shot 'at' schedules.">
                <Toggle value={deleteAfterRun} onChange={setDeleteAfterRun} label="Delete after first run" />
              </Field>
            </>
          )}

          {/* ── Schedule ── */}
          {tab === 'schedule' && (
            <>
              <Field label="Kind">
                <SelectInput value={schedKind} onChange={v => setSchedKind(v as CronSchedule['kind'])}>
                  <option value="every">Every — fixed interval</option>
                  <option value="cron">Cron — expression-based</option>
                  <option value="at">At — run once at a time</option>
                </SelectInput>
              </Field>

              {schedKind === 'every' && (
                <Field label="Interval" hint={`e.g. "30m", "1h", "6h", "1d 12h" — ${everyStr && !everyParseOk ? '⚠ invalid format' : everyStr && everyParseOk ? `= ${parseDurationToMs(everyStr)! / 1000}s` : ''}`}>
                  <TextInput value={everyStr} onChange={setEveryStr} placeholder="1h" mono />
                </Field>
              )}

              {schedKind === 'cron' && (
                <>
                  <Field label="Cron expression" hint='Standard 5-field cron: "min hour day month weekday". e.g. "0 */6 * * *" = every 6h'>
                    <TextInput value={cronExpr} onChange={setCronExpr} placeholder="0 * * * *" mono />
                  </Field>
                  <Field label="Timezone" hint="IANA timezone name. Defaults to system timezone if blank.">
                    <TextInput value={cronTz} onChange={setCronTz} placeholder="America/New_York" />
                  </Field>
                </>
              )}

              {schedKind === 'at' && (
                <Field label="Run at" hint="The job will run once at this time. Enable 'Delete after first run' in General to auto-remove it.">
                  <input
                    type="datetime-local"
                    value={atVal}
                    onChange={e => setAtVal(e.target.value)}
                    style={{
                      display: 'block', width: '100%', padding: '7px 12px', fontSize: 13,
                      borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                      background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                  />
                </Field>
              )}
            </>
          )}

          {/* ── Payload ── */}
          {tab === 'payload' && (
            <>
              <Field label="Kind">
                <SelectInput value={payloadKind} onChange={v => setPayloadKind(v as 'systemEvent' | 'agentTurn')}>
                  <option value="agentTurn">Agent turn — send a prompt to the agent</option>
                  <option value="systemEvent">System event — inject an event into the session</option>
                </SelectInput>
              </Field>

              {payloadKind === 'systemEvent' && (
                <Field label="Event text" hint="The text injected as a system event into the agent session.">
                  <TextInput value={eventText} onChange={setEventText} multiline rows={5}
                    placeholder="Run the following periodic tasks…" />
                </Field>
              )}

              {payloadKind === 'agentTurn' && (
                <>
                  <Field label="Message" hint="The user-turn message sent to the agent when the job fires.">
                    <TextInput value={agentMessage} onChange={setAgentMessage} multiline rows={6}
                      placeholder="Check for new tasks and update the status." />
                  </Field>
                  <Field label="Model" hint="Override the agent's default model for this job. Leave blank to use the agent default.">
                    <ModelPicker value={payloadModel} onChange={setPayloadModel} placeholder="Leave blank to use agent default" inputStyle={{ fontSize: 13 }} />
                  </Field>
                  <Field label="Options">
                    <div className="space-y-3">
                      <Toggle value={lightContext} onChange={setLightContext} label="Light context (trim history to reduce token usage)" />
                    </div>
                  </Field>
                  <Field label="Timeout (seconds)" hint="Max seconds the agent run may take. Leave blank for the default.">
                    <TextInput value={timeoutSeconds} onChange={setTimeoutSeconds} placeholder="120" />
                  </Field>
                  <Field label="Extended thinking" hint="Optional thinking budget hint passed to the model (e.g. 'budget_tokens:4096').">
                    <TextInput value={thinking} onChange={setThinking} placeholder="budget_tokens:4096" mono />
                  </Field>
                </>
              )}
            </>
          )}

          {/* ── Target ── */}
          {tab === 'target' && (
            <>
              <Field label="Agent" hint="Which agent runs this job. Leave blank to use the gateway default agent.">
                <TextInput value={agentId} onChange={setAgentId} placeholder="personal-assistant" mono />
              </Field>

              <Field label="Session target" hint="Where the job runs. 'Main' uses the agent's persistent main session. 'Isolated' creates a new session per run.">
                <SelectInput value={sessionTargetSelect} onChange={v => {
                  if (v === '__custom__') { setSessionTarget('__custom__') }
                  else { setSessionTarget(v); setCustomSessionTarget('') }
                }}>
                  <option value="main">Main — agent's persistent main session</option>
                  <option value="isolated">Isolated — fresh session per run</option>
                  <option value="current">Current — last active session</option>
                  <option value="__custom__">Custom session key…</option>
                </SelectInput>
                {isCustomSession && (
                  <div className="mt-2">
                    <TextInput value={customSessionTarget} onChange={setCustomSessionTarget}
                      placeholder="session:agent-id:session-name" mono />
                  </div>
                )}
              </Field>

              <Field label="Wake mode" hint="'Now' fires immediately. 'Next heartbeat' queues until the next scheduled heartbeat tick.">
                <SelectInput value={wakeMode} onChange={setWakeMode}>
                  <option value="now">Now — fire immediately</option>
                  <option value="next-heartbeat">Next heartbeat — queue for next tick</option>
                </SelectInput>
              </Field>

              <Field label="Delivery" hint="Where to post the agent's response. 'Announce' posts to a channel. 'None' suppresses output.">
                <SelectInput value={deliveryMode} onChange={setDeliveryMode}>
                  <option value="none">None — suppress output</option>
                  <option value="announce">Announce — post to a channel</option>
                  <option value="webhook">Webhook — post to a URL</option>
                </SelectInput>
              </Field>

              {(deliveryMode === 'announce' || deliveryMode === 'webhook') && (
                <Field label="Channel / destination" hint={deliveryMode === 'webhook' ? 'Webhook URL to POST the response to.' : 'Channel name (e.g. slack, whatsapp). Leave blank for last-used channel.'}>
                  <TextInput
                    value={deliveryMode === 'webhook' ? deliveryTo : deliveryChannel}
                    onChange={deliveryMode === 'webhook' ? setDeliveryTo : setDeliveryChannel}
                    placeholder={deliveryMode === 'webhook' ? 'https://…' : 'slack'}
                    mono={deliveryMode === 'webhook'}
                  />
                </Field>
              )}

              {deliveryMode === 'announce' && (
                <Field label="To (optional)" hint="Specific recipient/thread within the channel.">
                  <TextInput value={deliveryTo} onChange={setDeliveryTo} placeholder="+1234567890 or @username" />
                </Field>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {error && (
            <div className="flex items-center gap-1.5 flex-1 text-xs" style={{ color: 'var(--danger)' }}>
              <AlertCircle size={12} />
              <span className="truncate">{error}</span>
            </div>
          )}
          {!error && <div className="flex-1" />}
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn
            onClick={handleSave}
            loading={saving}
            disabled={!everyParseOk}
            icon={saved ? <Check size={13} /> : undefined}
          >
            {saved ? 'Saved' : 'Save changes'}
          </Btn>
        </div>
      </div>
    </>
  )
}
