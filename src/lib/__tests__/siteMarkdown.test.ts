import { describe, it, expect } from 'vitest'
import { renderMarkdown, renderInline, escapeHtml } from '../../../scripts/markdown.mjs'

// The site build renders CHANGELOG.md and site/*.md with this — no markdown library.
// These lock the subset it has to keep supporting.

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml('<script>alert("x") & co</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;) &amp; co&lt;/script&gt;')
  })
})

describe('renderInline', () => {
  it('renders bold, italic, code, and links', () => {
    expect(renderInline('**bold** and *soft* and `code`'))
      .toBe('<strong>bold</strong> and <em>soft</em> and <code>code</code>')
    expect(renderInline('see [the docs](https://example.com/x)'))
      .toBe('see <a href="https://example.com/x">the docs</a>')
  })

  it('leaves emphasis markers inside code spans alone', () => {
    expect(renderInline('`a ** b`')).toBe('<code>a ** b</code>')
  })

  it('refuses script-bearing links, keeping them as text', () => {
    const out = renderInline('[click](javascript:alert(1))')
    expect(out).not.toContain('<a')
    expect(out).toContain('[click]')
  })

  it('allows relative and mailto targets', () => {
    expect(renderInline('[a](privacy.html)')).toContain('href="privacy.html"')
    expect(renderInline('[b](mailto:x@y.z)')).toContain('href="mailto:x@y.z"')
  })
})

describe('renderMarkdown', () => {
  it('renders headings, paragraphs, lists, and rules', () => {
    const html = renderMarkdown([
      '# Title',
      '',
      'A paragraph.',
      '',
      '---',
      '',
      '## [0.21.0] - Unreleased',
      '',
      '### Added',
      '',
      '- **A thing.** It does something.',
      '- Another thing.',
    ].join('\n'))

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>A paragraph.</p>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<h2>[0.21.0] - Unreleased</h2>')
    expect(html).toContain('<h3>Added</h3>')
    expect(html).toContain('<li><strong>A thing.</strong> It does something.</li>')
    expect((html.match(/<ul>/g) ?? []).length).toBe(1)
    expect((html.match(/<\/ul>/g) ?? []).length).toBe(1)
  })

  it('folds a wrapped bullet into the same list item', () => {
    const html = renderMarkdown('- first line\n  continued here\n- second')
    expect(html).toContain('<li>first line continued here</li>')
    expect(html).toContain('<li>second</li>')
  })

  it('joins wrapped paragraph lines and closes the list before a heading', () => {
    const html = renderMarkdown('- item\n\n## Next\n\nwrapped\nparagraph')
    expect(html).toBe('<ul>\n<li>item</li>\n</ul>\n<h2>Next</h2>\n<p>wrapped paragraph</p>')
  })

  it('escapes HTML in the source', () => {
    expect(renderMarkdown('a <b>tag</b>')).toBe('<p>a &lt;b&gt;tag&lt;/b&gt;</p>')
  })
})
