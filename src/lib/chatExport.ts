import type { ToolCall } from './types'
import { extractToolCalls, toolResultUpdate, foldNestedToolRows, isToolResultRole, markRunningCalls } from './historyMessages'
import { argSummary, toolResultView } from './toolCall'

// A chat as a file (PRD 05): Markdown for people (tool calls folded into <details>), or
// JSON for tooling (the gateway's messages exactly as it sent them). Pure: it works on
// the raw chat.history messages, oldest first, as lib/chatHistoryReader returns them.
//
// The Markdown carries model output into GitHub, Obsidian and the like, which render
// inline HTML. So message text never gets to open a tag: a `<` that would start one is
// escaped outside code, and everything this module writes inside its own HTML (the
// <summary> lines) is escaped in full. Tool arguments and results only ever appear inside
// fenced code blocks, whose fence is longer than any backtick run in the content.

export interface ExportOptions {
  tools: boolean
  reasoning: boolean
  timestamps: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { tools: true, reasoning: false, timestamps: true }

export interface ExportMeta {
  title: string
  sessionKey: string
  agentId?: string
  /** The name replies are labelled with. */
  agentName: string
  model?: string
  exportedAt: Date
  /** A run was active when the history was read. */
  running?: boolean
}

/** One message ready to write: text, reasoning, tool calls with results, attachments. */
export interface ExportMessage {
  role: 'user' | 'assistant'
  /** Who sent a user message, when it came through a channel (Slack, WhatsApp). */
  sender?: string
  text: string
  reasoning?: string
  toolCalls: ToolCall[]
  attachments: { name: string; url?: string }[]
  at?: number
  model?: string
  /** Results the gateway replaced with its oversized placeholder, which lost their call id. */
  omittedResults?: number
}

export const TRUNCATED_MARKER = '...(truncated)...'
export const OMITTED_PLACEHOLDER = '[chat.history omitted: message too large]'
export const UNAVAILABLE_SENTINEL = '[chat.history unavailable: transcript too large to display; the full history is preserved on disk]'
/** A tool result longer than this is cut in the file. */
export const RESULT_MAX = 20_000

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

function textOf(m: Record<string, unknown>): string {
  if (typeof m.text === 'string' && m.text) return m.text
  if (typeof m.content === 'string') return m.content
  if (!Array.isArray(m.content)) return ''
  return m.content
    .map(b => { const r = rec(b); return r?.type === 'text' && typeof r.text === 'string' ? r.text : '' })
    .filter(Boolean)
    .join('\n')
}

function reasoningOf(m: Record<string, unknown>): string {
  if (!Array.isArray(m.content)) return ''
  return m.content
    .map(b => { const r = rec(b); return r?.type === 'thinking' && typeof r.thinking === 'string' ? r.thinking : '' })
    .filter(Boolean)
    .join('\n')
}

const basename = (p: string) => p.split(/[\\/]/).pop() || p
const isLink = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)

// Attachments by name, with a link when there is a web URL. Inline data is never copied.
function attachmentsOf(m: Record<string, unknown>): { name: string; url?: string }[] {
  const out: { name: string; url?: string }[] = []
  if (Array.isArray(m.content)) {
    for (const b of m.content) {
      const r = rec(b)
      if (!r || !['image', 'audio', 'video', 'file', 'document'].includes(String(r.type))) continue
      const src = rec(r.source)
      const url = r.url ?? src?.url
      const name = [r.name, r.fileName, r.filename].find(v => typeof v === 'string' && v) as string | undefined
      // The gateway strips inline data and keeps no file name for images, only the type.
      const fallback = typeof r.mimeType === 'string' && r.mimeType ? `${r.type} (${r.mimeType})` : String(r.type)
      out.push({ name: name ?? (isLink(url) ? basename(url.split('?')[0]) : fallback), ...(isLink(url) ? { url } : {}) })
    }
  }
  const paths = Array.isArray(m.MediaPaths) ? m.MediaPaths : typeof m.MediaPath === 'string' ? [m.MediaPath] : []
  for (const p of paths) if (typeof p === 'string' && p) out.push({ name: basename(p) })
  return out
}

/**
 * The gateway's messages as export messages: nested tool activity folded in, results
 * attached to their calls, system rows (compaction, reset markers) dropped. With
 * `activeRun`, the latest turn's unanswered calls are marked running, as the live view
 * would show them.
 */
export function toExportMessages(rawRows: unknown[], opts: { activeRun?: boolean } = {}): ExportMessage[] {
  const out: ExportMessage[] = []
  const calls = new Map<string, ToolCall>()
  for (const item of foldNestedToolRows(rawRows)) {
    const m = rec(item)
    if (!m) continue
    const update = toolResultUpdate(m)
    if (update) {
      const call = calls.get(update.callId)
      if (call) Object.assign(call, update.patch)
      continue
    }
    if (isToolResultRole(m)) {
      // An oversized result: the placeholder can't be paired, but the file says it existed.
      const host = [...out].reverse().find(x => x.role === 'assistant')
      if (host) host.omittedResults = (host.omittedResults ?? 0) + 1
      continue
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const toolCalls = m.role === 'assistant' ? extractToolCalls(m) : []
    for (const c of toolCalls) calls.set(c.id, c)
    const msg: ExportMessage = {
      role: m.role,
      text: textOf(m),
      toolCalls,
      attachments: attachmentsOf(m),
    }
    const reasoning = reasoningOf(m)
    if (reasoning) msg.reasoning = reasoning
    if (typeof m.timestamp === 'number') msg.at = m.timestamp
    // Replies carry provider and model separately ("ollama", "qwen3.6:35b").
    if (typeof m.model === 'string' && m.model) msg.model = typeof m.provider === 'string' && m.provider && !m.model.includes('/') ? `${m.provider}/${m.model}` : m.model
    if (m.role === 'user' && typeof m.senderLabel === 'string' && m.senderLabel.trim()) msg.sender = m.senderLabel.trim()
    if (!msg.text.trim() && !msg.toolCalls.length && !msg.attachments.length && !msg.reasoning) continue
    out.push(msg)
  }
  if (!opts.activeRun) return out
  // Reuse the chat's rule for which calls are still running.
  const marked = markRunningCalls(out.map(m => ({ id: '', sessionId: '', role: m.role, content: m.text, toolCalls: m.toolCalls, createdAt: '' })), true)
  return out.map((m, i) => ({ ...m, toolCalls: marked[i].toolCalls ?? m.toolCalls }))
}

// ── Markdown helpers ─────────────────────────────────────────────────────────

/** A backtick fence longer than any backtick run in `text` (at least three). */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(r => r.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** Escape text for use inside HTML (the <summary> line). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Message text, kept as the Markdown it is, except for what could act in a renderer: a
 * `<` that would open an HTML tag, comment or declaration is escaped, and a link to a
 * script URL is defused. Fenced blocks and inline code are left alone, since a renderer
 * doesn't read HTML there. A fence the text leaves open is closed, so it can't swallow
 * the rest of the file (or the </details> this module writes after it).
 */
export function neutraliseHtml(markdown: string): string {
  const escapeProse = (s: string) => codeSpans(s)
    .map(part => (part.code ? part.text : part.text
      .replace(/\]\(\s*(<[^>\n]*>|[^\s)]*)/g, (m, dest: string) => (isUnsafeUrl(dest.replace(/^<|>$/g, ''))
        ? `](#${dest.includes(':') ? dest.slice(dest.indexOf(':') + 1).replace(/>$/, '') : ''}`
        : m))
      .replace(/<(?=[A-Za-z/!?])/g, '&lt;')))
    .join('')
  const lines = markdown.split('\n')
  const out: string[] = []
  let fence: string | null = null
  for (const line of lines) {
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    // A backtick fence's info string can't contain a backtick; such a line is prose, not a fence.
    const opens = open && !(open[1][0] === '`' && open[2].includes('`'))
    if (fence) {
      out.push(line)
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null
      continue
    }
    if (opens) { fence = open[1]; out.push(line); continue }
    // A link reference definition ("[ref]: javascript:…") makes every [ref] a script link.
    const def = line.match(/^(\s{0,3}\[[^\]\n]+\]:\s*)(<[^>\n]*>|\S+)(.*)$/)
    if (def && isUnsafeUrl(def[2].replace(/^<|>$/g, ''))) { out.push(escapeProse(`${def[1]}#${def[3]}`)); continue }
    out.push(escapeProse(line))
  }
  if (fence) out.push(fence)
  return out.join('\n')
}

/**
 * A line split into code spans and prose, the way CommonMark reads it: a run of N
 * backticks opens a span only if a later run of exactly N closes it. An unmatched run is
 * literal text, so what follows it is prose (a renderer would read HTML there).
 */
function codeSpans(line: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = []
  let last = 0
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') { i++; continue }
    let j = i
    while (line[j] === '`') j++
    const n = j - i
    let close = -1
    for (let k = j; k < line.length;) {
      if (line[k] !== '`') { k++; continue }
      let m = k
      while (line[m] === '`') m++
      if (m - k === n) { close = k; break }
      k = m
    }
    if (close < 0) { i = j; continue }
    if (i > last) out.push({ code: false, text: line.slice(last, i) })
    out.push({ code: true, text: line.slice(i, close + n) })
    i = last = close + n
  }
  if (last < line.length) out.push({ code: false, text: line.slice(last) })
  return out
}

/** A link target that would run script: javascript:, vbscript: or data:, even entity-encoded or split by whitespace. */
function isUnsafeUrl(url: string): boolean {
  const decoded = url
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ':')
    .replace(/&(?:tab|newline);/gi, '')
  // eslint-disable-next-line no-control-regex
  return /^(?:javascript|vbscript|data):/i.test(decoded.replace(/[\s -]+/g, ''))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')
/** "18 Sep 10:41" */
export function formatStamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** "18 Sep 2026, 10:55" */
export function formatExportDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const oneLine = (s: string, max = 80) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function parseArgs(args?: string): Record<string, unknown> | undefined {
  if (!args) return undefined
  try {
    const v = JSON.parse(args)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined
  } catch { return undefined }
}

function callSummary(call: ToolCall): string {
  const args = parseArgs(call.args)
  const status = call.status === 'error' ? 'error' : call.status === 'running' ? 'running' : 'done'
  // A spawn is a sub-agent, named by its label (or the agent it started) rather than its long brief.
  if (call.name === 'sessions_spawn' || call.name === 'sessions_yield') {
    const who = [args?.label, args?.agentId, args?.sessionKey].find(v => typeof v === 'string' && v) as string | undefined
    return ['sub-agent', ...(who ? [oneLine(who, 60)] : []), status].join(' · ')
  }
  const what = args ? oneLine(argSummary(args)) : ''
  return [call.name, ...(what ? [what] : []), status].join(' · ')
}

function block(text: string, lang: string): string {
  const fence = fenceFor(text)
  return `${fence}${lang}\n${text}\n${fence}`
}

function resultBody(raw: string): string {
  const view = toolResultView(raw)
  const text = view.text
    ?? view.json
    ?? (view.fields.length ? view.fields.map(f => `${f.label}: ${f.value}`).join('\n') : raw)
  return text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}\n…(shortened in export)` : text
}

function toolDetails(call: ToolCall): string {
  const parts = [`<details><summary>🔧 ${escapeHtml(callSummary(call))}</summary>`, '']
  const args = parseArgs(call.args)
  if (call.args) parts.push(block(args ? JSON.stringify(args, null, 2) : call.args, args ? 'json' : 'text'), '')
  if (call.status === 'error') {
    parts.push('Error:', '', block(call.error || call.result || 'The tool reported an error.', 'text'), '')
  } else if (call.result) {
    parts.push('Result:', '', block(resultBody(call.result), 'text'), '')
  }
  parts.push('</details>')
  return parts.join('\n')
}

/** The document: a heading, a meta line, then one section per message. */
export function toMarkdown(messages: ExportMessage[], meta: ExportMeta, opts: ExportOptions, extra?: { startsAtReset?: number }): string {
  const model = [...messages].reverse().find(m => m.model)?.model ?? meta.model
  const metaLine = [
    `agent: ${meta.agentName}`,
    ...(model ? [`model: ${model}`] : []),
    `session: ${meta.sessionKey}`,
    `exported ${formatExportDate(meta.exportedAt)}`,
  ].join(' · ')
  const out: string[] = [`# ${neutraliseHtml(oneLine(meta.title, 200) || 'Chat')}`, '', neutraliseHtml(metaLine)]
  if (meta.running) out.push('> Still running when exported: the last reply may be incomplete.')
  if (extra?.startsAtReset) out.push(`> History starts at a reset on ${formatExportDate(new Date(extra.startsAtReset))}.`)
  out.push('', '---', '')

  for (const m of messages) {
    const who = m.role === 'user' ? (m.sender ?? 'You') : meta.agentName
    const head = `**${neutraliseHtml(who)}**${opts.timestamps && m.at ? ` · ${formatStamp(m.at)}` : ''}`
    const body: string[] = []
    if (opts.reasoning && m.reasoning?.trim()) {
      body.push('<details><summary>Reasoning</summary>', '', neutraliseHtml(m.reasoning.trim()), '', '</details>')
    }
    if (opts.tools) for (const c of m.toolCalls) body.push(toolDetails(c))
    if (opts.tools && m.omittedResults) {
      body.push(`*${m.omittedResults === 1 ? 'A tool result was' : `${m.omittedResults} tool results were`} too large for the gateway to include.*`)
    }
    if (m.text.trim()) body.push(neutraliseHtml(m.text.trim()))
    if (m.attachments.length) {
      const list = m.attachments.map(a => {
        const name = neutraliseHtml(a.name).replace(/[[\]]/g, '\\$&')
        return a.url ? `[${name}](${a.url.replace(/[()\s]/g, encodeURIComponent)})` : name
      })
      body.push(`*Attachments: ${list.join(', ')}*`)
    }
    // A message that was only tool calls, with tools left out, has nothing to show.
    if (!body.length) continue
    out.push(head, '', body.join('\n\n'), '')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** The JSON export: an envelope around the gateway's messages, untouched. */
export function toJson(raw: unknown[], meta: ExportMeta & { totalMessages?: number }): string {
  return JSON.stringify({
    exportedAt: meta.exportedAt.toISOString(),
    sessionKey: meta.sessionKey,
    title: meta.title,
    ...(meta.agentId ? { agentId: meta.agentId } : {}),
    totalMessages: meta.totalMessages ?? raw.length,
    messages: raw,
  }, null, 2) + '\n'
}

/** "pricing-research-2026-09-18.md", or "chat-2026-09-18.md" when the title has nothing usable. */
export function exportFilename(title: string, date: Date, ext: 'md' | 'json'): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${slug || 'chat'}-${day}.${ext}`
}

function messageTexts(m: Record<string, unknown>): string[] {
  if (typeof m.content === 'string') return [m.content]
  const texts = typeof m.text === 'string' ? [m.text] : []
  if (Array.isArray(m.content)) {
    for (const b of m.content) {
      const r = rec(b)
      if (typeof r?.text === 'string') texts.push(r.text)
      if (typeof r?.thinking === 'string') texts.push(r.thinking)
    }
  }
  return texts
}

/** Messages the gateway shortened (text cut at maxChars) or replaced (over 128 KiB). */
export function countTruncated(raw: unknown[]): number {
  let n = 0
  for (const item of raw) {
    const m = rec(item)
    if (!m) continue
    const meta = rec(m.__openclaw)
    if (meta?.truncated === true || messageTexts(m).some(t => t.endsWith(TRUNCATED_MARKER) || t === OMITTED_PLACEHOLDER)) n++
  }
  return n
}

export function isUnavailableSentinel(item: unknown): boolean {
  const m = rec(item)
  return !!m && messageTexts(m).some(t => t === UNAVAILABLE_SENTINEL)
}

/** When the history begins at an in-session reset (/new, /reset), that reset's time. */
export function resetStart(raw: unknown[]): number | undefined {
  const first = rec(raw[0])
  const meta = rec(first?.__openclaw)
  if (first?.role !== 'system' || meta?.kind !== 'reset') return undefined
  return typeof first.timestamp === 'number' ? first.timestamp : undefined
}

export type ExportFormat = 'md' | 'json'

/** "ollama/qwen3.6:35b" from chat.history's sessionInfo, when the replies don't say. */
export function sessionModel(sessionInfo: Record<string, unknown> | undefined): string | undefined {
  const model = typeof sessionInfo?.model === 'string' ? sessionInfo.model : undefined
  const provider = typeof sessionInfo?.modelProvider === 'string' ? sessionInfo.modelProvider : undefined
  if (!model) return undefined
  return provider && !model.includes('/') ? `${provider}/${model}` : model
}

/**
 * The file for a read history, in either format. `meta.model` is only a fallback: the
 * Markdown names the model the latest reply used. Hidden rows and the reset marker are
 * the gateway's; the reset only shows as the "History starts at a reset" line.
 */
export function renderExport(
  history: { raw: unknown[]; activeRun: boolean; total: number; sessionInfo?: Record<string, unknown> },
  meta: Omit<ExportMeta, 'running'>,
  format: ExportFormat,
  opts: ExportOptions,
): string {
  const full = { ...meta, running: history.activeRun, model: meta.model ?? sessionModel(history.sessionInfo) }
  if (format === 'json') return toJson(history.raw, { ...full, totalMessages: history.total })
  return toMarkdown(toExportMessages(history.raw, { activeRun: history.activeRun }), full, opts, { startsAtReset: resetStart(history.raw) })
}

/** Whether a read history has anything to export (user or assistant rows). */
export function hasExportableMessages(raw: unknown[]): boolean {
  return raw.some(m => { const role = rec(m)?.role; return role === 'user' || role === 'assistant' })
}
