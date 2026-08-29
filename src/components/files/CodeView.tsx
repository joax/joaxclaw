import { useMemo } from 'react'
import { highlightLine } from '../../lib/diffHighlight'
import { langFromPath } from '../../lib/diffModel'

// Syntax-highlighted source for the file viewer. Reuses the diff view's tokenizer
// (refractor/Prism) and its token palette rather than introducing a second highlighter,
// so a file reads the same whether it arrives as a diff in chat or as a file here.
//
// Highlighting is best-effort by design: an unsupported language returns null tokens and
// the line renders as plain text, which is exactly what the viewer did before.

// Above this many lines we skip highlighting entirely. Tokenizing is per-line and cached,
// but a 20k-line log would still cost more than the colour is worth — and logs, the usual
// giants, have no grammar to show anyway.
const MAX_HIGHLIGHT_LINES = 5000

interface Props { text: string; path: string; wrap?: boolean }

export function CodeView({ text, path, wrap = false }: Props) {
  const lang = useMemo(() => langFromPath(path), [path])
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text])
  const highlight = !!lang && lines.length <= MAX_HIGHLIGHT_LINES
  const gutterWidth = `${String(lines.length).length}ch`

  return (
    <div
      className="codeview"
      style={{
        fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85em', lineHeight: 1.55,
        color: 'var(--text-primary)', overflowX: wrap ? 'hidden' : 'auto',
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>
          <span
            aria-hidden
            style={{
              width: gutterWidth, flexShrink: 0, textAlign: 'right', paddingRight: 12,
              color: 'var(--text-secondary)', opacity: 0.4, userSelect: 'none',
            }}
          >{i + 1}</span>
          <span style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: wrap ? 'break-word' : 'normal', flex: 1, minWidth: 0 }}>
            <Line text={line} lang={highlight ? lang : undefined} />
          </span>
        </div>
      ))}
    </div>
  )
}

// An empty line still needs a space, or the row collapses to zero height and the
// gutter numbering visibly drifts out of step with the file.
function Line({ text, lang }: { text: string; lang?: string }) {
  const toks = lang ? highlightLine(text, lang) : null
  if (!toks) return <>{text === '' ? ' ' : text}</>
  return <>{toks.map((t, i) => <span key={i} className={t.className}>{t.value}</span>)}</>
}
