import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { AudioPlayer } from './AudioPlayer'
import { WorkspaceImage, VideoPlayer, IMAGE_EXT, VIDEO_EXT, toFileUrl } from './WorkspaceMedia'
import { DiffView } from './DiffView'
import { repairDetachedTableRows } from '../../lib/markdownRepair'
import { splitHtmlBlocks, preserveLineBreaks, progressPct, progressCount, type HtmlSegment, type ProgressSegment } from '../../lib/htmlBlocks'
import { ProgressTrack } from '../ui/ProgressTrack'

const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|aac|opus|webm|flac)(\?[^\s]*)?$/i
const LOCAL_PATH = /^(\/|~\/|file:\/\/)/

interface Props { text: string; streaming?: boolean }

// Shared inline-code style
const inlineCode: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '0.1em 0.4em',
  fontSize: '0.85em',
  fontFamily: 'monospace',
  color: 'var(--accent)',
  wordBreak: 'break-all'
}

const components: Components = {
  p: ({ children }) => (
    <p style={{ margin: '0.5em 0' }}>{children}</p>
  ),

  h1: ({ children }) => (
    <h1 style={{ fontSize: '1.25em', fontWeight: 700, margin: '0.8em 0 0.3em', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: '0.25em' }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: '1.1em', fontWeight: 700, margin: '0.75em 0 0.25em', color: 'var(--text-primary)' }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: '1em', fontWeight: 600, margin: '0.65em 0 0.2em', color: 'var(--text-primary)' }}>{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 style={{ fontSize: '0.95em', fontWeight: 600, margin: '0.5em 0 0.15em', color: 'var(--text-primary)' }}>{children}</h4>
  ),

  strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  del: ({ children }) => <del style={{ textDecoration: 'line-through', opacity: 0.6 }}>{children}</del>,

  ul: ({ children }) => (
    <ul style={{ paddingLeft: '1.4em', margin: '0.4em 0', listStyleType: 'disc' }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ paddingLeft: '1.4em', margin: '0.4em 0', listStyleType: 'decimal' }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ margin: '0.2em 0', lineHeight: 1.6 }}>{children}</li>
  ),

  blockquote: ({ children }) => (
    <blockquote style={{
      borderLeft: '3px solid var(--accent)',
      paddingLeft: '0.85em',
      margin: '0.6em 0',
      color: 'var(--text-secondary)',
      fontStyle: 'italic'
    }}>{children}</blockquote>
  ),

  hr: () => (
    <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1em 0' }} />
  ),

  img: ({ src, alt }) => {
    if (!src) return null
    return <WorkspaceImage src={toFileUrl(src)} alt={alt ?? undefined} />
  },

  a: ({ href, children }) => {
    if (!href) return <>{children}</>
    const isLocal = LOCAL_PATH.test(href)
    const fileUrl = isLocal ? toFileUrl(href) : href
    if (IMAGE_EXT.test(href)) {
      return <WorkspaceImage src={fileUrl} alt={typeof children === 'string' ? children : undefined} />
    }
    if (VIDEO_EXT.test(href)) {
      return <VideoPlayer src={fileUrl} name={typeof children === 'string' ? children : undefined} />
    }
    if (AUDIO_EXT.test(href)) {
      return <AudioPlayer attachment={{ type: 'audio', url: fileUrl, name: typeof children === 'string' ? children : undefined }} />
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
        {children}
      </a>
    )
  },

  // code: inline vs block differentiated by className presence + newlines
  code: ({ children, className }) => {
    const isBlock = !!className || String(children).includes('\n')
    // A ```diff fenced block → render as a rich diff instead of a plain code block.
    if (isBlock && /language-diff\b/.test(className ?? '')) {
      return <DiffView unified={String(children).replace(/\n$/, '')} />
    }
    if (isBlock) {
      return (
        <code className={className} style={{
          display: 'block',
          fontFamily: 'monospace',
          fontSize: '0.85em',
          lineHeight: 1.55,
          color: 'var(--text-primary)',
          overflowX: 'auto',
          padding: '0.75em 1em',
          whiteSpace: 'pre'
        }}>
          {children}
        </code>
      )
    }
    return <code style={inlineCode}>{children}</code>
  },

  pre: ({ children }) => {
    // A diff block renders its own framed DiffView — don't double-wrap it in the pre frame.
    const child = children as { props?: { className?: string } } | undefined
    if (/language-diff\b/.test(child?.props?.className ?? '')) return <>{children}</>
    return (
      <pre style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        margin: '0.65em 0',
        overflow: 'hidden'
      }}>
        {children}
      </pre>
    )
  },

  // Tables (GFM)
  // `width: max-content` + `minWidth: 100%` lets a wide table (a 7-column test plan in
  // a 380px Files drawer) size to its content and scroll inside the wrapper, instead of
  // being squeezed to the pane and clipping its last columns.
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', maxWidth: '100%', margin: '0.75em 0', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
      <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: '0.9em' }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: 'var(--bg-elevated)' }}>{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => {
    return (
      <tr style={{ borderTop: '1px solid var(--border)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'color-mix(in srgb, var(--accent) 5%, transparent)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
      >
        {children}
      </tr>
    )
  },
  th: ({ children, style }) => (
    <th style={{
      padding: '0.5em 0.85em',
      textAlign: (style?.textAlign as React.CSSProperties['textAlign']) ?? 'left',
      fontWeight: 600,
      fontSize: '0.85em',
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
      borderRight: '1px solid var(--border)'
    }}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={{
      padding: '0.45em 0.85em',
      color: 'var(--text-primary)',
      verticalAlign: 'top',
      borderRight: '1px solid var(--border)',
      textAlign: (style?.textAlign as React.CSSProperties['textAlign']) ?? 'left'
    }}>
      {children}
    </td>
  ),

  // Task list checkboxes (GFM)
  input: ({ type, checked }) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          style={{ accentColor: 'var(--accent)', marginRight: '0.4em', verticalAlign: 'middle' }}
        />
      )
    }
    return null
  }
}

// ── HTML blocks models write ─────────────────────────────────────────────────
// <details> and <progress> are parsed into data (lib/htmlBlocks.ts) and drawn here as
// components. Raw HTML never reaches the DOM — react-markdown still escapes every other
// tag — so a model can't inject markup, scripts or event handlers through these.

function DetailsBlock({ summary, body, open }: Extract<HtmlSegment, { kind: 'details' }>) {
  return (
    <details
      open={open}
      style={{ margin: '0.6em 0', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-elevated)' }}
    >
      <summary style={{ cursor: 'pointer', padding: '6px 10px', fontWeight: 600, fontSize: '0.92em', color: 'var(--text-primary)' }}>
        {summary}
      </summary>
      <div style={{ padding: '0 12px 6px', borderTop: '1px solid var(--border)' }}>
        {/* Back through markdown, so a plan written as a list — or as plain lines — reads
            as one. Nested blocks inside the body are handled by this same component. */}
        <MarkdownContent text={preserveLineBreaks(body)} />
      </div>
    </details>
  )
}

function ProgressBar(seg: ProgressSegment) {
  const count = progressCount(seg)
  return (
    <div style={{ margin: '0.6em 0' }}>
      {(seg.label || count) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: 4 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seg.label}</span>
          {count && <span className="font-mono" style={{ flexShrink: 0 }}>{count}</span>}
        </div>
      )}
      {/* The same track as the context bar and the progress card, so all three read alike. */}
      <div style={{ display: 'flex' }}>
        <ProgressTrack pct={progressPct(seg)} label={seg.label} />
      </div>
    </div>
  )
}

export function MarkdownContent({ text, streaming }: Props) {
  // Models write long tables as one header plus detached per-section runs of rows,
  // which GFM parses as a paragraph of pipes. Re-attach them before rendering — a
  // no-op for every well-formed document. See lib/markdownRepair.ts.
  const source = repairDetachedTableRows(text)
  // <details> and <progress> become components; everything else stays markdown. A
  // reply with neither is a single markdown segment, rendered exactly as before.
  const segments = splitHtmlBlocks(source, { streaming })
  return (
    <div
      className={streaming ? 'streaming-cursor' : ''}
      style={{ lineHeight: 1.7, wordBreak: 'break-word', minWidth: 0 }}
    >
      {segments.map((seg, i) =>
        seg.kind === 'markdown'
          ? <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={components}>{seg.text}</ReactMarkdown>
          : seg.kind === 'details'
            ? <DetailsBlock key={i} {...seg} />
            : <ProgressBar key={i} {...seg} />
      )}
    </div>
  )
}
