import { useMemo, useState } from 'react'
import { FileDiff, ChevronDown, ChevronRight, Columns2, Rows3, Copy, Check } from 'lucide-react'
import {
  rowsFromOldNew, rowsFromUnified, summarize, pairForSplit, langFromPath, type DiffRow,
} from '../../lib/diffModel'
import { highlightLine } from '../../lib/diffHighlight'

interface Props {
  // Provide either an old/new text pair OR a unified-diff string.
  oldText?: string
  newText?: string
  unified?: string
  path?: string
  defaultExpanded?: boolean
}

const ROW_BG: Record<DiffRow['type'], string | undefined> = {
  add: 'color-mix(in srgb, var(--success) 13%, transparent)',
  del: 'color-mix(in srgb, var(--danger) 13%, transparent)',
  context: undefined,
}
const SIGN: Record<DiffRow['type'], string> = { add: '+', del: '−', context: ' ' }
const SIGN_COLOR: Record<DiffRow['type'], string> = {
  add: 'var(--success)', del: 'var(--danger)', context: 'var(--text-secondary)',
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre' }
const gutter: React.CSSProperties = { ...mono, color: 'var(--text-secondary)', opacity: 0.5, textAlign: 'right', padding: '0 6px', userSelect: 'none', minWidth: 34, flexShrink: 0 }

// One line of code, syntax-highlighted when the language is known, else plain.
function Code({ text, lang }: { text: string; lang?: string }) {
  const toks = lang ? highlightLine(text, lang) : null
  if (!toks) return <>{text === '' ? ' ' : text}</>
  return <>{toks.map((t, i) => <span key={i} className={t.className}>{t.value}</span>)}{text === '' ? ' ' : ''}</>
}

function UnifiedRows({ rows, lang }: { rows: DiffRow[]; lang?: string }) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', background: ROW_BG[r.type] }}>
          <span style={gutter}>{r.oldNo ?? ''}</span>
          <span style={gutter}>{r.newNo ?? ''}</span>
          <span style={{ ...mono, color: SIGN_COLOR[r.type], padding: '0 4px', flexShrink: 0, userSelect: 'none' }}>{SIGN[r.type]}</span>
          <span style={{ ...mono, color: 'var(--text-primary)', paddingRight: 12 }}><Code text={r.text} lang={lang} /></span>
        </div>
      ))}
    </>
  )
}

function SplitRows({ rows, lang }: { rows: DiffRow[]; lang?: string }) {
  const pairs = useMemo(() => pairForSplit(rows), [rows])
  const cell = (row?: DiffRow) => (
    <>
      <span style={gutter}>{(row?.oldNo ?? row?.newNo) ?? ''}</span>
      <span style={{ ...mono, color: 'var(--text-primary)', paddingRight: 12, flex: 1, background: row ? ROW_BG[row.type] : undefined }}>
        {row ? <Code text={row.text} lang={lang} /> : ' '}
      </span>
    </>
  )
  return (
    <>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
          <div style={{ display: 'flex', borderRight: '1px solid var(--border)', background: p.left ? ROW_BG[p.left.type] : undefined }}>{cell(p.left)}</div>
          <div style={{ display: 'flex', background: p.right ? ROW_BG[p.right.type] : undefined }}>{cell(p.right)}</div>
        </div>
      ))}
    </>
  )
}

export function DiffView({ oldText, newText, unified, path, defaultExpanded = true }: Props) {
  const [open, setOpen] = useState(defaultExpanded)
  const [split, setSplit] = useState(false)
  const [copied, setCopied] = useState(false)

  const { rows, filePath } = useMemo(() => {
    if (unified != null) { const u = rowsFromUnified(unified); return { rows: u.rows, filePath: path ?? u.path } }
    return { rows: rowsFromOldNew(oldText ?? '', newText ?? ''), filePath: path }
  }, [unified, oldText, newText, path])

  const lang = langFromPath(filePath)
  const { added, removed } = useMemo(() => summarize(rows), [rows])

  // Not a parseable diff (e.g. a ```diff block that wasn't really one) — show raw.
  if (rows.length === 0) {
    return (
      <pre className="mb-2 text-xs" style={{ ...mono, whiteSpace: 'pre-wrap', padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-secondary)' }}>
        {unified ?? ''}
      </pre>
    )
  }

  const filename = filePath ? (filePath.split('/').pop() ?? filePath) : 'diff'
  const copyText = unified ?? (newText ?? '')

  return (
    <div className="diffview mb-2" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--bg-elevated)', borderBottom: open ? '1px solid var(--border)' : 'none' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, minWidth: 0, flex: 1 }}>
          {open ? <ChevronDown size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} /> : <ChevronRight size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />}
          <FileDiff size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={filePath}>{filename}</span>
        </button>
        {added > 0 && <span className="text-xs" style={{ color: 'var(--success)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>+{added}</span>}
        {removed > 0 && <span className="text-xs" style={{ color: 'var(--danger)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>−{removed}</span>}
        {open && (
          <>
            <button onClick={() => setSplit(s => !s)} title={split ? 'Unified view' : 'Split view'} style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2, flexShrink: 0 }}>
              {split ? <Rows3 size={13} /> : <Columns2 size={13} />}
            </button>
            <button onClick={() => { void navigator.clipboard.writeText(copyText); setCopied(true); setTimeout(() => setCopied(false), 1200) }} title="Copy" style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-secondary)', padding: 2, flexShrink: 0 }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </>
        )}
      </div>

      {/* Body */}
      {open && (
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 460, paddingTop: 2, paddingBottom: 2 }}>
          {split ? <SplitRows rows={rows} lang={lang} /> : <UnifiedRows rows={rows} lang={lang} />}
        </div>
      )}
    </div>
  )
}
