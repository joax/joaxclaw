// Tool calls a model wrote as TEXT — and that therefore never ran.
//
// Models sometimes write a call into their reply instead of making it. Two reported
// examples:
//
//   Let me check what we have in the vault regarding Calla Ventures.
//   <read-files> /home/…/2026-09-10.md,~/.obsidian/vaults/ </read-files>
//
//   Let me find where your Obsidian vaults are actually stored.
//   <ls> <path> /home/joaxap </path> <limit> 50 </limit> </ls>
//
// The first copies the gateway itself: older gateways (seen on 2026.6.5) summarise a
// compacted transcript's file activity in `<read-files>` / `<modified-files>` tags, and
// after compaction the model imitates the shape. (2026.9.3 no longer emits them, but the
// transcripts that taught it can outlive the upgrade.) The second is the generic
// "tool name as the outer tag, arguments as children" form models fall back to when
// their tool calling breaks down.
//
// No gateway we checked (2026.6.5, 2026.9.3) parses tool calls out of model text or
// executes XML tags from it, so the honest rendering is "this was written, not run".
//
// Detection keys on the SHAPE of a call, not a list of tool names — models invent names
// freely (`ls`, `glob`, `web_search`…), which is why a fixed list missed the second
// example. Pure and framework-free so every shape is testable.

import { argSummary } from './toolCall'

export interface TextToolAttempt {
  /** 'files' for a <read-files>/<modified-files> list, 'action' for everything else. */
  kind: 'files' | 'action'
  /** The tool or tag name as written: 'read-files', 'ls', 'bash', 'cron', … */
  tag: string
  action?: string
  /** Arguments, from attributes or from child `<param>value</param>` tags. */
  attrs: Record<string, string>
  /** Free-form inner text, when the call carried a body rather than arguments. */
  body?: string
  /** Paths listed inside a file-list tag. */
  paths?: string[]
}

export interface ExtractedTextTools {
  attempts: TextToolAttempt[]
  /** The content with the recognised calls removed. */
  text: string
}

// ── Shapes ────────────────────────────────────────────────────────────────────

const NAME = '[a-zA-Z_][\\w-]*'
const NS = '(?:[\\w-]+:)?'   // optional namespace prefix on a tag name

// Hermes / Qwen: <tool_call>{"name": …, "arguments": {…}}</tool_call>
const TOOL_CALL_JSON_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi

// <invoke name="x"><parameter name="k">v</parameter></invoke>, often in a wrapper.
const INVOKE_RE = new RegExp(`<${NS}invoke\\s+name=["']([^"']+)["']\\s*>([\\s\\S]*?)<\\/${NS}invoke>`, 'gi')
const PARAM_NAMED_RE = new RegExp(`<${NS}parameter\\s+name=["']([^"']+)["']\\s*>([\\s\\S]*?)<\\/${NS}parameter>`, 'gi')
const CALLS_WRAPPER_RE = new RegExp(`<\\/?${NS}function_calls>`, 'gi')

// Qwen-coder: <function=x><parameter=k>v</parameter></function>
const FUNCTION_EQ_RE = /<function=([\w.-]+)>([\s\S]*?)<\/function>/gi
const PARAM_EQ_RE = /<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/gi

// The gateway's compaction metadata.
const FILE_LIST_RE = /<(read-files|modified-files)>([\s\S]*?)<\/\1>/gi

// Tags that mean "run this" even with a free-form body. The attribute group must start
// with whitespace, so `<read-files>` is never half-matched as a `<read>`.
const CONTENT_TAGS = ['edit', 'write', 'create', 'bash', 'shell', 'read', 'search', 'delete', 'move']
const CONTENT_TAG_RE = new RegExp(`<(${CONTENT_TAGS.join('|')})((?:\\s[^>]*)?)>([\\s\\S]*?)<\\/\\1>`, 'gi')

// Generic: an outer tag whose content is nothing but `<param>value</param>` children —
// the `<ls><path>…</path><limit>…</limit></ls>` form. Leaf values only (no `<`).
const NESTED_RE = new RegExp(`<(${NAME})>((?:\\s*<(${NAME})>[^<]*<\\/\\3>)+)\\s*<\\/\\1>`, 'g')
const CHILD_PARAM_RE = new RegExp(`<(${NAME})>([^<]*)<\\/\\1>`, 'g')
const PARAMS_ONLY_RE = new RegExp(`^(?:\\s*<(${NAME})>[^<]*<\\/\\1>)+\\s*$`)

// Self-closing `<cron action="list" />`. At least one attribute: `<br/>` is markup.
const SELFCLOSE_RE = /<([a-zA-Z][a-zA-Z0-9_-]*)((?:\s+[a-zA-Z][a-zA-Z0-9_-]*=(?:"[^"]*"|'[^']*'))+)\s*\/>/g

// Real HTML — models write it in markdown, and `<ul><li>…</li></ul>` has exactly the
// nested shape. Also our own tags, which other parsers own.
const NOT_A_TOOL = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del',
  'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture', 'pre', 'q', 's', 'samp',
  'section', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var', 'video', 'audio', 'center', 'font',
  'ask', 'think', 'thinking', 'final',
])

// Fenced code is the model SHOWING markup, not attempting it. Split keeps the fences;
// the non-global check below classifies each part without shared lastIndex state.
const FENCE_SPLIT_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/g
const IS_FENCE_RE = /^(```|~~~)/

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out[m[1]] = m[2] ?? m[3]
  return out
}

function collect(re: RegExp, body: string): Record<string, string> {
  const out: Record<string, string> = {}
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2].trim()
  return out
}

const asText = (v: unknown): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v)

function jsonArgs(v: unknown): Record<string, string> {
  let o = v
  if (typeof o === 'string') { try { o = JSON.parse(o) } catch { return { input: o as string } } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, val]) => [k, asText(val)]))
}

function splitPaths(body: string): string[] {
  return body.split(/[\n,]/).map(p => p.trim()).filter(Boolean)
}

function extractFromProse(segment: string, attempts: TextToolAttempt[]): string {
  const push = (a: TextToolAttempt) => { attempts.push(a); return '' }

  let t = segment.replace(TOOL_CALL_JSON_RE, (_m, raw: string) => {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>
      const fn = (o.function ?? {}) as Record<string, unknown>
      const name = asText(o.name ?? fn.name).trim() || 'tool_call'
      return push({ kind: 'action', tag: name, attrs: jsonArgs(o.arguments ?? o.parameters ?? fn.arguments) })
    } catch {
      return push({ kind: 'action', tag: 'tool_call', attrs: {}, body: raw.trim() })
    }
  })
  t = t.replace(INVOKE_RE, (_m, name: string, body: string) =>
    push({ kind: 'action', tag: name.trim(), attrs: collect(PARAM_NAMED_RE, body) }))
  t = t.replace(FUNCTION_EQ_RE, (_m, name: string, body: string) =>
    push({ kind: 'action', tag: name.trim(), attrs: collect(PARAM_EQ_RE, body) }))
  t = t.replace(FILE_LIST_RE, (_m, tag: string, body: string) =>
    push({ kind: 'files', tag: tag.toLowerCase(), attrs: {}, paths: splitPaths(body) }))
  t = t.replace(CONTENT_TAG_RE, (_m, tag: string, attrStr: string, body: string) => {
    const { action, ...attrs } = parseAttrs(attrStr ?? '')
    // `<bash><command>ls</command></bash>` carries arguments, not a free-form body.
    if (PARAMS_ONLY_RE.test(body)) Object.assign(attrs, collect(CHILD_PARAM_RE, body))
    const free = PARAMS_ONLY_RE.test(body) ? undefined : body.trim()
    return push({ kind: 'action', tag: tag.toLowerCase(), ...(action ? { action } : {}), attrs, ...(free ? { body: free } : {}) })
  })
  t = t.replace(NESTED_RE, (m, tag: string, body: string) =>
    NOT_A_TOOL.has(tag.toLowerCase()) ? m
      : push({ kind: 'action', tag, attrs: collect(CHILD_PARAM_RE, body) }))
  t = t.replace(SELFCLOSE_RE, (_m, tag: string, attrStr: string) => {
    const { action, ...attrs } = parseAttrs(attrStr)
    return push({ kind: 'action', tag, ...(action ? { action } : {}), attrs })
  })
  // A wrapper left empty once its calls were lifted out.
  return t.replace(CALLS_WRAPPER_RE, '')
}

export function extractTextToolAttempts(content: string): ExtractedTextTools {
  if (!content.includes('<')) return { attempts: [], text: content.trim() }
  const attempts: TextToolAttempt[] = []
  const text = content
    .split(FENCE_SPLIT_RE)
    .map(part => (IS_FENCE_RE.test(part) ? part : extractFromProse(part, attempts)))
    .join('')
  return { attempts, text: text.trim() }
}

// ── Summaries ─────────────────────────────────────────────────────────────────

function firstLine(s: string | undefined): string {
  return (s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
}

/** A short plain-language label: what the model was trying to do. */
export function summarizeAttempt(a: TextToolAttempt): string {
  if (a.kind === 'files') {
    const n = a.paths?.length ?? 0
    const verb = a.tag === 'modified-files' ? 'Modify' : 'Read'
    return `${verb} ${n} ${n === 1 ? 'file' : 'files'}`
  }
  if (a.tag === 'edit' || a.tag === 'write' || a.tag === 'create') {
    const path = /path:\s*["']?([^\n"']+)/.exec(a.body ?? '')?.[1]?.trim() ?? a.attrs.path ?? a.attrs.file_path
    return path ? `${a.tag} ${path}` : a.tag
  }
  const hasArgs = Object.keys(a.attrs).length > 0
  if (a.tag === 'bash' || a.tag === 'shell') return firstLine(a.body) || (hasArgs ? argSummary(a.attrs) : '') || a.tag
  // Value-first, like the tool pills: `ls · /home/joaxap`, not `ls · path, limit`.
  const detail = a.action ?? (hasArgs ? argSummary(a.attrs) : firstLine(a.body))
  return detail ? `${a.tag} · ${detail}` : a.tag
}
