// A small, fixed set of HTML blocks models write into replies — rendered, not escaped.
//
// Models reach for HTML when markdown has no equivalent: a collapsible section, a
// progress indicator. Reported example:
//
//   <progress aria-label="Automated monitoring · 2/3" value="2" max="3"></progress>
//   <details> <summary>View Plan</summary>
//    Verify production page accessibility via browser tool
//    …
//   </details>
//
// react-markdown escapes raw HTML, so these arrived as literal tags. Turning raw HTML on
// (rehype-raw) would hand model output to the DOM inside an Electron renderer that has a
// preload bridge — a `<script>` or `onerror=` would run with the app's privileges, and a
// sanitizer then becomes the only thing standing between a model and the machine.
//
// So this does the opposite: it recognises exactly these tags, reads only the
// attributes it understands (value, max, aria-label, open), and hands back plain data for
// React components to render. No HTML string ever reaches the page. Same pattern as the
// `<ask>` parser (askQuestion.ts) and the text-tool-call detector (textToolCalls.ts).

export type HtmlSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'details'; summary: string; body: string; open: boolean }
  | { kind: 'progress'; value: number | null; max: number; label?: string }

// <details [open]> [<summary>…</summary>] body </details>. Non-greedy, so nested details
// are not supported — the inner closing tag ends the outer block.
const DETAILS_RE = /<details(\s[^>]*)?>\s*(?:<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>)?([\s\S]*?)<\/details>/gi
// <progress …></progress>, <progress …/>, or a bare <progress …> with no close.
const PROGRESS_RE = /<progress((?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>/]+))?)*)\s*\/?>(?:\s*<\/progress>)?/gi
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g

// A trailing block still being streamed: an opened <details> with no close yet, or a
// <progress tag whose `>` hasn't arrived. Hidden until complete, so half a block never
// flashes as literal tags.
const UNCLOSED_DETAILS_RE = /<details(\s[^>]*)?>(?![\s\S]*<\/details>)[\s\S]*$/i
const PARTIAL_TAG_RE = /<(?:details|summary|progress)\b[^>]*$/i

// Fenced code is the model SHOWING markup; leave it alone. Split keeps the fences; the
// non-global check classifies each part without shared lastIndex state.
const FENCE_SPLIT_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/g
const IS_FENCE_RE = /^(```|~~~)/

function parseAttrs(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(raw)) !== null) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

/** Summary is shown as plain text — any markup inside it is dropped, not rendered. */
function plainText(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function toNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export type ProgressSegment = Extract<HtmlSegment, { kind: 'progress' }>

function progressFrom(attrs: Record<string, string>): ProgressSegment {
  // HTML semantics: max defaults to 1; no value means indeterminate.
  const rawMax = toNumber(attrs.max)
  const max = rawMax !== null && rawMax > 0 ? rawMax : 1
  const rawValue = toNumber(attrs.value)
  const value = rawValue === null ? null : Math.min(Math.max(rawValue, 0), max)
  const label = (attrs['aria-label'] ?? attrs.title ?? '').trim()
  return { kind: 'progress', value, max, ...(label ? { label } : {}) }
}

/**
 * Keep a plain list of lines as lines. Models put one step per line inside <details>
 * without list markers, and markdown would otherwise join them into one run-on
 * paragraph. Trailing double spaces are markdown's hard break; they're inert on list
 * items, headings and table rows.
 */
export function preserveLineBreaks(body: string): string {
  return body
    .split(FENCE_SPLIT_RE)
    .map(part => (IS_FENCE_RE.test(part) ? part : part.replace(/([^\n])\n(?=[^\n])/g, '$1  \n')))
    .join('')
}

function splitProse(text: string, out: HtmlSegment[]): void {
  const pushMd = (t: string) => { if (t.trim()) out.push({ kind: 'markdown', text: t }) }
  // Tokenise both tag kinds in document order.
  const tokens: Array<{ start: number; end: number; seg: HtmlSegment }> = []
  DETAILS_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DETAILS_RE.exec(text)) !== null) {
    const attrs = parseAttrs(m[1])
    tokens.push({
      start: m.index, end: m.index + m[0].length,
      seg: { kind: 'details', summary: plainText(m[2] ?? '') || 'Details', body: (m[3] ?? '').trim(), open: 'open' in attrs },
    })
  }
  PROGRESS_RE.lastIndex = 0
  while ((m = PROGRESS_RE.exec(text)) !== null) {
    const at = m.index
    if (tokens.some(t => at >= t.start && at < t.end)) continue   // inside a details body
    tokens.push({ start: at, end: at + m[0].length, seg: progressFrom(parseAttrs(m[1])) })
  }
  tokens.sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const t of tokens) {
    pushMd(text.slice(cursor, t.start))
    out.push(t.seg)
    cursor = t.end
  }
  pushMd(text.slice(cursor))
}

export function splitHtmlBlocks(text: string, opts?: { streaming?: boolean }): HtmlSegment[] {
  if (!/<(details|progress)\b/i.test(text)) return [{ kind: 'markdown', text }]
  let source = text
  if (opts?.streaming) source = source.replace(UNCLOSED_DETAILS_RE, '').replace(PARTIAL_TAG_RE, '')

  const out: HtmlSegment[] = []
  for (const part of source.split(FENCE_SPLIT_RE)) {
    if (!part) continue
    if (IS_FENCE_RE.test(part)) out.push({ kind: 'markdown', text: part })
    else splitProse(part, out)
  }
  // Fence splitting can leave neighbouring markdown pieces; join them so a list or
  // table that straddles a fence boundary still renders as one block.
  const merged: HtmlSegment[] = []
  for (const seg of out) {
    const prev = merged[merged.length - 1]
    if (seg.kind === 'markdown' && prev?.kind === 'markdown') prev.text += seg.text
    else merged.push(seg)
  }
  return merged.length ? merged : [{ kind: 'markdown', text: '' }]
}

/** A bar's fill, 0–100, or null when it has no value (indeterminate). */
export function progressPct(p: ProgressSegment): number | null {
  return p.value === null ? null : (p.value / p.max) * 100
}

/** The count beside a bar: whole-number steps read as "2/3", fractions of 1 as a percentage. */
export function progressCount(p: ProgressSegment): string | null {
  if (p.value === null) return null
  return Number.isInteger(p.value) && Number.isInteger(p.max) && p.max > 1
    ? `${p.value}/${p.max}`
    : `${Math.round((p.value / p.max) * 100)}%`
}

/**
 * The first <progress> bar in `text` (outside fenced code) and the text without it. A
 * progress card pins its bar above the note, so the note is shown without it.
 */
export function takeFirstProgress(text: string): { progress: ProgressSegment | null; rest: string } {
  const parts = text.split(FENCE_SPLIT_RE)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part || IS_FENCE_RE.test(part)) continue
    PROGRESS_RE.lastIndex = 0
    const m = PROGRESS_RE.exec(part)
    if (!m) continue
    parts[i] = part.slice(0, m.index) + part.slice(m.index + m[0].length)
    return { progress: progressFrom(parseAttrs(m[1])), rest: parts.join('').trim() }
  }
  return { progress: null, rest: text }
}
