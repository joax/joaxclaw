// Making a tool call readable.
//
// A call arrives as two opaque JSON strings — the args the model sent and whatever the
// host sent back — and the chat used to render both verbatim. That surfaces the
// transport instead of the event: a gateway restart read "Updating action, note,
// reason" over 19 lines of envelope, and a shell script read as one JSON string with
// literal \n escapes. Three things are wrong with that, and this module fixes all three
// as pure functions so the rendering stays declarative:
//
//   1. Headers named the arg KEYS instead of their values. `argSummary` picks the value
//      that says what happened ("restart"), never a key list and never raw JSON.
//   2. Results came wrapped in `{content:[{type:'text',text}], details}` — the tool
//      protocol's packaging — and the text was itself JSON, so the payload arrived
//      double-encoded. `toolResultView` unwraps both layers.
//   3. Everything rendered as a JSON blob. A result's top-level primitives are the
//      facts the user wants (ok, pid, exit code); they come back as `fields`, leaving
//      JSON as the fallback for genuine structure rather than the default.

export interface ResultField {
  label: string
  value: string
  tone?: 'ok' | 'bad' | 'muted'
}

export interface ToolResultView {
  /** Salient top-level primitives — rendered as chips, the outcome at a glance. */
  fields: ResultField[]
  /** A human sentence the tool returned, if it returned one. */
  text?: string
  /** Pretty JSON for structure the fields can't carry. Absent when they cover it. */
  json?: string
}

// Keys worth showing first, in the order a reader wants them: what happened, then how
// it went, then what it touched. Everything else follows in its original order.
const PRIORITY = [
  'ok', 'success', 'status', 'state', 'exitCode', 'exit_code', 'code', 'error',
  'pid', 'signal', 'sessionId', 'session_id', 'jobId', 'id',
  'path', 'file', 'size', 'count', 'total', 'model', 'reason', 'mode', 'delayMs',
]

// Envelope scaffolding and fields whose value is never interesting on its own.
const SKIP = new Set(['content', 'details', 'type', 'raw', '_meta', 'isError'])

// Generous enough that a realistic result shows every fact as a chip; the cap only
// exists so a 50-key payload doesn't turn into a wall of them.
const MAX_FIELDS = 10
const MAX_VALUE = 140

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return undefined }
}

/** Pretty-print JSON, or return the string untouched when it isn't JSON. */
export function tryPrettyJson(s: string): string {
  const parsed = parseJson(s)
  return parsed === undefined ? s : JSON.stringify(parsed, null, 2)
}

/**
 * Strip the tool-result envelope.
 *
 * Hosts return `{ content: [{ type: 'text', text }], details? }`. The text is often
 * itself a JSON document, so the payload arrives encoded twice. Returns the innermost
 * meaningful value plus any `details` that isn't just a copy of it.
 */
export function unwrapToolResult(raw: string): { value: unknown; text?: string } {
  const top = parseJson(raw)
  if (top === undefined) return { value: undefined, text: raw }
  if (!isPlainObject(top)) return { value: top }

  const content = top.content
  if (!Array.isArray(content)) return { value: top }

  const text = content
    .filter(isPlainObject)
    .map(part => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()

  const details = isPlainObject(top.details) ? top.details : undefined
  const inner = text ? parseJson(text) : undefined

  // The text parsed as JSON → that IS the payload; `details` usually repeats it.
  if (inner !== undefined) {
    const merged = isPlainObject(inner) && details ? { ...inner, ...details } : (inner ?? details)
    return { value: merged }
  }
  // The text is prose. Keep it, and keep details as the structured half.
  return { value: details, text: text || undefined }
}

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') return String(v)
  const s = String(v)
  return s.length > MAX_VALUE ? s.slice(0, MAX_VALUE - 1) + '…' : s
}

function toneFor(key: string, v: unknown): ResultField['tone'] {
  const k = key.toLowerCase()
  if (typeof v === 'boolean' && (k === 'ok' || k === 'success')) return v ? 'ok' : 'bad'
  if ((k === 'exitcode' || k === 'exit_code' || k === 'code') && typeof v === 'number') {
    return v === 0 ? 'ok' : 'bad'
  }
  if (k === 'error' && v) return 'bad'
  if (k === 'status' || k === 'state') {
    return /fail|error/i.test(String(v)) ? 'bad' : /ok|done|success|complete/i.test(String(v)) ? 'ok' : undefined
  }
  return undefined
}

/** Top-level primitives, priority-ordered — the facts, not the shape. */
export function resultFields(value: unknown): ResultField[] {
  if (!isPlainObject(value)) return []
  const entries = Object.entries(value).filter(([k, v]) =>
    !SKIP.has(k) && v !== null && v !== undefined && v !== '' &&
    (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))

  entries.sort(([a], [b]) => {
    const ia = PRIORITY.indexOf(a), ib = PRIORITY.indexOf(b)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  return entries.slice(0, MAX_FIELDS).map(([k, v]) => ({
    label: k, value: formatValue(v), ...(toneFor(k, v) ? { tone: toneFor(k, v) } : {}),
  }))
}

/** Everything the fields didn't carry — nested objects, arrays, overflow. */
function remainingJson(value: unknown, shown: ResultField[]): string | undefined {
  if (value === undefined) return undefined
  if (!isPlainObject(value)) {
    return Array.isArray(value) && value.length ? JSON.stringify(value, null, 2) : undefined
  }
  const shownKeys = new Set(shown.map(f => f.label))
  const rest = Object.fromEntries(
    Object.entries(value).filter(([k, v]) =>
      !SKIP.has(k) && !shownKeys.has(k) && v !== null && v !== undefined && v !== ''))
  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : undefined
}

export function toolResultView(raw: string): ToolResultView {
  const { value, text } = unwrapToolResult(raw)
  const fields = resultFields(value)
  const json = remainingJson(value, fields)
  // Nothing structured survived and there's no prose — fall back to showing the raw
  // payload rather than an empty section.
  if (!fields.length && !text && !json) {
    const pretty = tryPrettyJson(raw)
    return { fields: [], ...(pretty.trim() ? { json: pretty } : {}) }
  }
  return { fields, ...(text ? { text } : {}), ...(json ? { json } : {}) }
}

// ── Header summaries ──────────────────────────────────────────────────────────

const NOISE_LINE = /^\s*(#|set\s+-|$)/

/**
 * The line of a shell script that says what it does — skipping the shebang, comments,
 * and `set -e` preamble that a generated script almost always opens with.
 */
export function commandSummary(command: string): string {
  const lines = command.split('\n')
  const meaningful = lines.find(l => !NOISE_LINE.test(l) && !l.startsWith('#!'))
  return (meaningful ?? lines.find(l => l.trim()) ?? '').trim()
}

/** How many lines a command actually spans, ignoring blanks. */
export function commandLineCount(command: string): number {
  return command.split('\n').filter(l => l.trim()).length
}

// Args that name what a call is doing, most telling first.
const SUMMARY_KEYS = [
  'action', 'command', 'cmd', 'script', 'path', 'file_path', 'filename', 'url', 'query',
  'pattern', 'name', 'id', 'key', 'message', 'prompt', 'model', 'sessionKey', 'agentId',
]

/**
 * A value-first header summary: what this call is doing, in its own words. Never a list
 * of argument names, never a JSON dump — both of which told the reader nothing.
 */
export function argSummary(args: Record<string, unknown>): string {
  for (const key of SUMMARY_KEYS) {
    const v = args[key]
    if (typeof v === 'string' && v.trim()) {
      return key === 'command' || key === 'cmd' || key === 'script' ? commandSummary(v) : v.trim()
    }
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  }
  // Nothing recognised — the first primitive is still better than the shape of the object.
  for (const [k, v] of Object.entries(args)) {
    if (SKIP.has(k)) continue
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' || typeof v === 'boolean') return `${k} ${v}`
  }
  return ''
}
