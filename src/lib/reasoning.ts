// Helpers for separating model reasoning (chain-of-thought) from the answer, and for
// presenting it. Some models stream reasoning inside content tags rather than on a
// dedicated channel; we pull those out so the UI can show them apart from the reply.

// Tag names models commonly use to wrap reasoning in content.
const REASONING_TAGS = 'think|thinking|reasoning|thought'

// Extract reasoning blocks embedded in content. Handles closed <tag>…</tag> blocks, a
// still-open tag mid-stream (reasoning visible before its close arrives), and a partial
// opening tag cut across deltas.
export function extractThinkTags(content: string): { thinking: string; text: string } {
  const parts: string[] = []
  let cleaned = content.replace(new RegExp(`<(${REASONING_TAGS})>([\\s\\S]*?)</\\1>`, 'gi'), (_m, _tag, inner: string) => {
    parts.push(inner.trim())
    return ''
  })
  const openRe = new RegExp(`<(${REASONING_TAGS})>`, 'gi')
  let lastOpen = -1, lastLen = 0, mm: RegExpExecArray | null
  while ((mm = openRe.exec(cleaned)) !== null) { lastOpen = mm.index; lastLen = mm[0].length }
  if (lastOpen !== -1) {
    const inner = cleaned.slice(lastOpen + lastLen).trim()
    if (inner) parts.push(inner)
    cleaned = cleaned.slice(0, lastOpen)
  }
  // Strip a trailing partial tag (e.g. "<", "<th", "</reason") cut mid-stream.
  cleaned = cleaned.replace(/<\/?[a-z]{0,9}$/i, '')
  return { thinking: parts.join('\n\n'), text: cleaned.trim() }
}

// "Thought for 6.2s" / "Thought for 12s" / "Thought for <1s".
export function fmtThoughtDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const s = ms / 1000
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`
}
