// Tool calls a model wrote as TEXT — and that therefore never ran.
//
// Models sometimes write an action into their reply instead of calling a tool: a
// `<bash>` block, an `<edit>`, a self-closing `<cron action="list" />`, or a
// `<read-files>` list. The last one is copied from the gateway itself: older gateways
// (seen on 2026.6.5) summarise a compacted transcript's file activity in
// `<read-files>` / `<modified-files>` tags, so after compaction the model sees that
// shape beside files it really read and imitates it. (2026.9.3 no longer emits them,
// but the transcripts that taught it can outlive the upgrade.)
//
// No gateway we checked (2026.6.5, 2026.9.3) parses tool calls out of model text or
// executes XML tags from it. So the honest rendering is "this was written, not run".
// Presenting these as actions — which the chat used to do, with a lightning icon —
// told the user something happened when nothing did.
//
// Pure and framework-free so the detection is testable.

export interface TextToolAttempt {
  /** 'files' for a <read-files>/<modified-files> list, 'action' for everything else. */
  kind: 'files' | 'action'
  /** The tag name as written: 'read-files', 'bash', 'edit', 'cron', … */
  tag: string
  action?: string
  attrs: Record<string, string>
  /** Inner text of a content-bearing tag. */
  body?: string
  /** Paths listed inside a file-list tag. */
  paths?: string[]
}

export interface ExtractedTextTools {
  attempts: TextToolAttempt[]
  /** The content with the recognised tags removed. */
  text: string
}

const FILE_LIST_RE = /<(read-files|modified-files)>([\s\S]*?)<\/\1>/gi

// Tags a model writes when it means "run this". Word-boundary on the name so
// `<read-files>` is never mistaken for a `<read>`.
const CONTENT_TAGS = ['edit', 'write', 'create', 'bash', 'shell', 'read', 'search', 'delete', 'move']
const CONTENT_TAG_RE = new RegExp(`<(${CONTENT_TAGS.join('|')})((?:\\s[^>]*)?)>([\\s\\S]*?)<\\/\\1>`, 'gi')

// Self-closing `<cron action="list" />`. At least ONE attribute is required: an
// attribute-less `<br/>` is markup, not an attempted action.
const SELFCLOSE_RE = /<([a-zA-Z][a-zA-Z0-9_-]*)((?:\s+[a-zA-Z][a-zA-Z0-9_-]*=(?:"[^"]*"|'[^']*'))+)\s*\/>/g

// Fenced code is the model SHOWING markup, not attempting it.
const FENCE_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/g

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Both quoting styles, so a single-quoted value can carry double quotes and vice versa.
  const re = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out[m[1]] = m[2] ?? m[3]
  return out
}

function splitPaths(body: string): string[] {
  return body.split(/[\n,]/).map(p => p.trim()).filter(Boolean)
}

function extractFromProse(segment: string, attempts: TextToolAttempt[]): string {
  let text = segment.replace(FILE_LIST_RE, (_m, tag: string, body: string) => {
    attempts.push({ kind: 'files', tag: tag.toLowerCase(), attrs: {}, paths: splitPaths(body) })
    return ''
  })
  text = text.replace(CONTENT_TAG_RE, (_m, tag: string, attrStr: string, body: string) => {
    const { action, ...attrs } = parseAttrs(attrStr ?? '')
    attempts.push({ kind: 'action', tag: tag.toLowerCase(), ...(action ? { action } : {}), attrs, body: body.trim() })
    return ''
  })
  text = text.replace(SELFCLOSE_RE, (_m, tag: string, attrStr: string) => {
    const { action, ...attrs } = parseAttrs(attrStr)
    attempts.push({ kind: 'action', tag, ...(action ? { action } : {}), attrs })
    return ''
  })
  return text
}

export function extractTextToolAttempts(content: string): ExtractedTextTools {
  if (!content.includes('<')) return { attempts: [], text: content.trim() }
  const attempts: TextToolAttempt[] = []
  // Only prose segments are scanned; fenced code passes through untouched.
  const text = content
    .split(FENCE_RE)
    .map(part => (FENCE_RE.test(part) ? part : extractFromProse(part, attempts)))
    .join('')
  FENCE_RE.lastIndex = 0
  return { attempts, text: text.trim() }
}

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
    const path = /path:\s*["']?([^\n"']+)/.exec(a.body ?? '')?.[1]?.trim() ?? a.attrs.path
    return path ? `${a.tag} ${path}` : a.tag
  }
  if (a.tag === 'bash' || a.tag === 'shell') return firstLine(a.body) || a.tag
  const detail = a.action ?? firstLine(a.body)
  return detail ? `${a.tag} · ${detail}` : a.tag
}
