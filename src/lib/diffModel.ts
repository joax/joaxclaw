// Pure diff model — turns the two shapes a model emits a file change in into a uniform
// row list the DiffView renders:
//   • an old/new text pair (str-replace style edit tools, <edit> actions)  → diffLines
//   • a unified-diff string (```diff blocks, apply_patch patches)          → parsePatch
// No React / DOM here, so it's unit-testable.
import { diffLines, parsePatch } from 'diff'

export type DiffRowType = 'context' | 'add' | 'del'
export interface DiffRow {
  type: DiffRowType
  oldNo?: number   // 1-based line number on the old side (context + del)
  newNo?: number   // 1-based line number on the new side (context + add)
  text: string     // the line content, without the +/-/space marker
}

// Split a chunk value into lines, dropping the single empty trailing element that a
// trailing newline produces (so "a\nb\n" → ["a","b"], not ["a","b",""]).
function toLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Rows from a before/after text pair (line-level diff via jsdiff). */
export function rowsFromOldNew(oldText: string, newText: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldNo = 1, newNo = 1
  for (const c of diffLines(oldText ?? '', newText ?? '')) {
    for (const text of toLines(c.value)) {
      if (c.added) rows.push({ type: 'add', newNo: newNo++, text })
      else if (c.removed) rows.push({ type: 'del', oldNo: oldNo++, text })
      else rows.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text })
    }
  }
  return rows
}

/** Rows from a unified-diff string. Also recovers the file path from its header. */
export function rowsFromUnified(unified: string): { rows: DiffRow[]; path?: string } {
  let patches: ReturnType<typeof parsePatch>
  try { patches = parsePatch(unified) } catch { return { rows: [] } }
  const rows: DiffRow[] = []
  let path: string | undefined
  for (const p of patches) {
    const name = (p.newFileName || p.oldFileName || '').replace(/^[ab]\//, '').replace(/\t.*$/, '')
    if (!path && name && name !== '/dev/null') path = name
    for (const h of p.hunks) {
      let oldNo = h.oldStart, newNo = h.newStart
      for (const line of h.lines) {
        const sign = line[0]
        const text = line.slice(1)
        if (sign === '+') rows.push({ type: 'add', newNo: newNo++, text })
        else if (sign === '-') rows.push({ type: 'del', oldNo: oldNo++, text })
        else if (sign === '\\') { /* "\ No newline at end of file" — not a real line */ }
        else rows.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text })
      }
    }
  }
  return { rows, path }
}

export function summarize(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0, removed = 0
  for (const r of rows) { if (r.type === 'add') added++; else if (r.type === 'del') removed++ }
  return { added, removed }
}

export interface SplitRow { left?: DiffRow; right?: DiffRow }

/** Pair rows into left(old)/right(new) columns for the side-by-side view. */
export function pairForSplit(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].type === 'context') { out.push({ left: rows[i], right: rows[i] }); i++; continue }
    const dels: DiffRow[] = []
    const adds: DiffRow[] = []
    while (i < rows.length && rows[i].type === 'del') dels.push(rows[i++])
    while (i < rows.length && rows[i].type === 'add') adds.push(rows[i++])
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) out.push({ left: dels[k], right: adds[k] })
  }
  return out
}

// File extension → refractor (Prism) language id, for syntax highlighting.
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', scala: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  php: 'php', swift: 'swift', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', svg: 'xml',
  html: 'markup', htm: 'markup', vue: 'markup', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', md: 'markdown', markdown: 'markdown', graphql: 'graphql', gql: 'graphql',
}

// True for a string that's actually a unified diff (has a hunk/header marker), so we
// don't mistake an edit tool's pretty/numbered "diff" field for a parseable patch.
export function looksLikeUnifiedDiff(s: unknown): s is string {
  return typeof s === 'string' && (/^--- /m.test(s) || /^@@ /m.test(s) || /\n@@ /.test(s))
}

// Edit tools often return the change as a unified diff inside their RESULT — commonly at
// `details.patch`, sometimes a top-level `patch`/`unified`/`diff`, or the bare diff text.
// Returns the unified-diff string if one is present, else null.
export function extractResultDiff(result: string): string | null {
  let obj: Record<string, unknown> | undefined
  try { obj = JSON.parse(result) as Record<string, unknown> } catch { obj = undefined }
  if (obj) {
    const details = (obj.details ?? {}) as Record<string, unknown>
    for (const cand of [details.patch, obj.patch, details.unified, obj.unified, obj.diff, details.diff]) {
      if (looksLikeUnifiedDiff(cand)) return cand
    }
  }
  return looksLikeUnifiedDiff(result) ? result : null
}

export function langFromPath(path?: string): string | undefined {
  if (!path) return undefined
  const base = (path.split('/').pop() ?? path).toLowerCase()
  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'docker'
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
  return EXT_LANG[ext]
}
