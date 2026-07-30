// Minimal Markdown → HTML for the joaxclaw.ai site build. Deliberately not a general
// renderer: it covers exactly what CHANGELOG.md and site/*.md use (headings, lists,
// paragraphs, rules, and inline bold/italic/code/links), so the site needs no runtime
// dependency and no build-time markdown library. Unit-tested in
// src/lib/__tests__/siteMarkdown.test.ts — extend both together if the docs grow syntax.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

export function escapeHtml(text) {
  return text.replace(/[&<>"]/g, c => ESCAPES[c])
}

// Only allow link targets that can't execute script: a relative link (no scheme at all)
// or an explicit http/https/mailto one. `javascript:` and `data:` render as plain text,
// so a hostile link degrades instead of shipping.
function safeHref(url) {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  if (!scheme) return url                                    // relative — always fine
  return /^(https?|mailto)$/i.test(scheme[1]) ? url : null
}

// Inline spans, applied to already-escaped text. Code first, so `**` inside backticks
// isn't treated as emphasis.
export function renderInline(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
      const href = safeHref(url)
      return href ? `<a href="${href}">${label}</a>` : whole
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
}

export function renderMarkdown(source) {
  const out = []
  let inList = false
  let paragraph = []

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`)
      paragraph = []
    }
  }
  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false }
  }

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd()

    if (!line.trim()) { flushParagraph(); closeList(); continue }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph(); closeList()
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`)
      continue
    }

    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      flushParagraph(); closeList()
      out.push('<hr>')
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${renderInline(escapeHtml(bullet[1]))}</li>`)
      continue
    }

    // A continuation line inside a list item belongs to that item, not a new paragraph.
    if (inList) {
      const last = out.length - 1
      out[last] = out[last].replace(/<\/li>$/, ` ${renderInline(escapeHtml(line.trim()))}</li>`)
      continue
    }

    paragraph.push(line.trim())
  }

  flushParagraph()
  closeList()
  return out.join('\n')
}
