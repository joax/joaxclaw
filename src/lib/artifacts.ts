// Artifacts — the files a turn produced, lifted out of its tool calls.
//
// When an agent writes a report it says "I saved it to ~/report.md" and, on a REMOTE
// gateway, that file is on a machine the app can't see. The chat already streams the
// tool calls that wrote it, so the path is right there in the stream — this module
// turns those calls into a small, deduped list the UI can render as cards and open in
// the viewer. See docs/files-drawer.md.
//
// Framework-free on purpose (pure functions over ToolCall) so it stays testable and
// can be reused by the drawer, the cards, and the pop-out window alike.

import type { ToolCall } from './types'
import { classifyKind, type AttachmentKind } from './attachments'

export interface Artifact {
  /** Path exactly as the tool named it — may be absolute, `~/…`, or a bare filename. */
  path: string
  name: string
  kind: AttachmentKind
  /** The tool call that produced it, so a card can anchor to its status. */
  toolCallId: string
  /** Content length when the write args carried it — a size hint before we read. */
  chars?: number
  /** True when we inferred the path from a shell redirect rather than a write tool. */
  inferred?: boolean
}

// Mirrors detectKind() in AssistantMessage / kindOf() in activityLabels: the same
// vocabulary of write-ish tool names across the CLI backends we see.
const WRITE_TOOL_RE = /write_file|create_file|overwrite|str_replace|patch_file|edit_file|\bwrite\b|\bedit\b/
const BASH_TOOL_RE = /\bbash\b|shell|run_command|execute_command|run_bash|terminal|\bexec\b/

export function isFileWriteTool(name: string): boolean {
  return WRITE_TOOL_RE.test(name.toLowerCase())
}

function parseArgs(args?: string): Record<string, unknown> {
  if (!args) return {}
  try { return JSON.parse(args) as Record<string, unknown> } catch { return { raw: args } }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The path a write-ish tool was pointed at, across the arg names backends use. */
export function pathFromWriteArgs(args?: string): string {
  const a = parseArgs(args)
  return str(a.path ?? a.file_path ?? a.filename ?? a.target_file ?? a.file)
}

function charsFromWriteArgs(args?: string): number | undefined {
  const a = parseArgs(args)
  const content = str(a.content ?? a.new_content ?? a.new_string ?? a.text)
  return content ? content.length : undefined
}

// A shell redirect is not a write tool call, so `cat > report.md <<'EOF'` would
// otherwise be invisible. Catch the common shapes (`>`, `>>`, `tee`) and require an
// extension, which keeps this from matching `2>&1`, `> /dev/null`, or a bare fd.
// Deliberately conservative: the drawer lists the workspace regardless of how a file
// got written, so this only has to cover the obvious cases.
const REDIRECT_RE = /(?:>>?|\|\s*tee(?:\s+-a)?)\s+(['"]?)([^\s'"|;&<>]+\.[A-Za-z0-9]{1,8})\1/g

export function pathsFromBashCommand(command: string): string[] {
  const out: string[] = []
  REDIRECT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REDIRECT_RE.exec(command)) !== null) {
    const p = m[2]
    if (!p || p.startsWith('/dev/')) continue
    out.push(p)
  }
  return out
}

function basename(p: string): string {
  const cleaned = p.replace(/\/+$/, '')
  return cleaned.split('/').pop() || cleaned
}

/**
 * The files this turn produced, newest last, one entry per path.
 *
 * Failed and still-running calls are skipped — advertising a file that was never
 * written (or isn't written *yet*) sends the user to a card that can't open.
 */
export function extractArtifacts(calls: ToolCall[] | undefined): Artifact[] {
  if (!calls?.length) return []
  const byPath = new Map<string, Artifact>()

  for (const call of calls) {
    if (call.status !== 'done') continue
    const name = call.name.toLowerCase()

    const found: Array<{ path: string; chars?: number; inferred?: boolean }> = []
    if (isFileWriteTool(name)) {
      const p = pathFromWriteArgs(call.args)
      if (p) found.push({ path: p, chars: charsFromWriteArgs(call.args) })
    } else if (BASH_TOOL_RE.test(name)) {
      const a = parseArgs(call.args)
      const cmd = str(a.command ?? a.cmd ?? a.script ?? a.raw)
      for (const p of pathsFromBashCommand(cmd)) found.push({ path: p, inferred: true })
    }

    for (const f of found) {
      // Re-inserting moves the entry to the end of the Map, so repeated edits to one
      // file collapse into a single card ordered by its LAST write.
      byPath.delete(f.path)
      byPath.set(f.path, {
        path: f.path,
        name: basename(f.path),
        kind: classifyKind(undefined, f.path),
        toolCallId: call.id,
        ...(f.chars != null ? { chars: f.chars } : {}),
        ...(f.inferred ? { inferred: true } : {}),
      })
    }
  }

  return [...byPath.values()]
}

// ── Preview classification ────────────────────────────────────────────────────
// How the viewer should render a path. Separate from AttachmentKind (which drives
// the composer's thumbnails) because a viewer cares about markdown-vs-code-vs-plain.

export type PreviewMode = 'markdown' | 'code' | 'text' | 'image' | 'video' | 'audio' | 'binary'

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx'])
const TEXT_EXT = new Set(['txt', 'log', 'csv', 'tsv', 'rst', 'org', 'text'])
const CODE_EXT = new Set([
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go',
  'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cc', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh',
  'sql', 'html', 'htm', 'css', 'scss', 'vue', 'svelte', 'diff', 'patch',
])

export function extOf(p: string): string {
  const base = basename(p)
  const dot = base.lastIndexOf('.')
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : ''
}

export function previewMode(p: string): PreviewMode {
  const ext = extOf(p)
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (CODE_EXT.has(ext)) return 'code'
  if (TEXT_EXT.has(ext)) return 'text'
  const kind = classifyKind(undefined, p)
  if (kind === 'image') return 'image'
  if (kind === 'video') return 'video'
  if (kind === 'audio') return 'audio'
  return 'binary'
}

export const isTextual = (p: string): boolean =>
  ['markdown', 'code', 'text'].includes(previewMode(p))

export function fmtBytes(n: number | undefined): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
