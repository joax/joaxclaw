import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { repairDetachedTableRows } from '../markdownRepair'

// Reproduces the shape that broke the Files viewer: a QA test-plan template written as
// one header up top and then per-section runs of rows. remark-gfm parses that as a
// header-only table plus a paragraph of pipes, so 19 test cases rendered as one run-on
// line. These lock the repair — and, just as importantly, lock what it refuses to touch.

const HEADER = '| Test ID | Test case | Priority |'
const DELIM = '| --- | --- | --- |'

describe('repairDetachedTableRows', () => {
  it('re-attaches rows separated from their header by a heading', () => {
    const out = repairDetachedTableRows(
      `${HEADER}\n${DELIM}\n\n## Global chrome\n\n| GC-01 | Logo home | P0 |\n| GC-02 | Sticky nav | P1 |\n`,
    )
    expect(out).toBe(
      `## Global chrome\n\n${HEADER}\n${DELIM}\n| GC-01 | Logo home | P0 |\n| GC-02 | Sticky nav | P1 |\n`,
    )
  })

  it('re-attaches rows separated only by a blank line', () => {
    const out = repairDetachedTableRows(`${HEADER}\n${DELIM}\n\n| GC-01 | Logo home | P0 |\n`)
    expect(out).toBe(`${HEADER}\n${DELIM}\n| GC-01 | Logo home | P0 |\n`)
  })

  it('repairs every section, repeating the header for each', () => {
    const out = repairDetachedTableRows(
      `${HEADER}\n${DELIM}\n\n## A\n\n| A-01 | one | P0 |\n\n## B\n\n| B-01 | two | P1 |\n`,
    )
    expect(out.match(/Test ID/g)).toHaveLength(2)
    expect(out).not.toContain('## A\n\n| A-01')  // the header now sits between them
  })

  it('drops the empty header-only table it borrowed from', () => {
    const out = repairDetachedTableRows(`${HEADER}\n${DELIM}\n\n## A\n\n| A-01 | one | P0 |\n`)
    expect(out.startsWith('## A')).toBe(true)
  })

  it('keeps a header-only table that was never reused', () => {
    const md = `${HEADER}\n${DELIM}\n\nJust prose, no rows.\n`
    expect(repairDetachedTableRows(md)).toBe(md)
  })

  it('leaves a well-formed table exactly as written', () => {
    const md = `${HEADER}\n${DELIM}\n| GC-01 | Logo home | P0 |\n| GC-02 | Sticky nav | P1 |\n`
    expect(repairDetachedTableRows(md)).toBe(md)
  })

  it('refuses a run whose column count does not match the header', () => {
    const md = `${HEADER}\n${DELIM}\n\n## A\n\n| only | two |\n`
    expect(repairDetachedTableRows(md)).toBe(md)
  })

  it('refuses rows with no preceding header at all', () => {
    const md = '| GC-01 | Logo home | P0 |\n| GC-02 | Sticky nav | P1 |\n'
    expect(repairDetachedTableRows(md)).toBe(md)
  })

  it('never touches fenced code', () => {
    const md = `${HEADER}\n${DELIM}\n\n\`\`\`\n| GC-01 | Logo home | P0 |\n\`\`\`\n`
    expect(repairDetachedTableRows(md)).toBe(md)
  })

  it('handles a tilde fence too', () => {
    const md = `${HEADER}\n${DELIM}\n\n~~~text\n| GC-01 | Logo home | P0 |\n~~~\n`
    expect(repairDetachedTableRows(md)).toBe(md)
  })

  it('counts escaped pipes as content, not columns', () => {
    const md = `${HEADER}\n${DELIM}\n\n## A\n\n| GC-01 | a \\| b | P0 |\n`
    const out = repairDetachedTableRows(md)
    expect(out).toContain('| GC-01 | a \\| b | P0 |')
    expect(out).toContain(HEADER)  // still three columns → repaired
  })

  it('passes through markdown with no tables untouched', () => {
    const md = '# Title\n\nSome prose with a | pipe in it.\n'
    expect(repairDetachedTableRows(md)).toBe(md)
  })

  it('is a no-op on empty input', () => {
    expect(repairDetachedTableRows('')).toBe('')
  })

  it('supports alignment markers in the delimiter row', () => {
    const delim = '| :--- | :---: | ---: |'
    const out = repairDetachedTableRows(`${HEADER}\n${delim}\n\n## A\n\n| A-01 | one | P0 |\n`)
    expect(out).toContain(delim)
    expect(out.startsWith('## A')).toBe(true)
  })
})

// The string assertions above say what the repair emits; these say what the renderer
// then *sees*, by running the same parser MarkdownContent uses. Without the repair the
// QA template parsed as one header-only table plus a paragraph — 19 test cases on a
// single run-on line, which is exactly what the screenshot showed.

const parse = (md: string) => {
  const proc = unified().use(remarkParse).use(remarkGfm)
  const tree = proc.runSync(proc.parse(md)) as unknown as { children: Array<{ type: string; children?: unknown[] }> }
  return tree.children.map(n => n.type === 'table' ? `table(${n.children?.length ?? 0})` : n.type)
}

const QA_TEMPLATE = `# QA Manual Test Cases — Template

| Test ID | Test case | Steps | Expected result | Priority | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## Global chrome (3 tests)

| GC-01 | Logo returns home | Click the site logo | Lands on / | P0 |  |  |
| GC-02 | Sticky navigation | Scroll a long page | Nav stays visible | P1 |  |  |
| GC-03 | Desktop megamenus | Hover Services | Panel opens | P0 |  |  |

## Search (1 test)

| SR-01 | Search opens | Click the search icon | Sheet opens | P0 |  |  |
`

describe('what remark-gfm sees', () => {
  it('parsed the QA template as a run-on paragraph before the repair', () => {
    expect(parse(QA_TEMPLATE)).toEqual([
      'heading', 'table(1)', 'heading', 'paragraph', 'heading', 'paragraph',
    ])
  })

  it('parses it as one real table per section after the repair', () => {
    expect(parse(repairDetachedTableRows(QA_TEMPLATE))).toEqual([
      'heading', 'heading', 'table(4)', 'heading', 'table(2)',
    ])
  })

  it('leaves a well-formed document parsing identically', () => {
    const md = `# T\n\n${HEADER}\n${DELIM}\n| A-01 | one | P0 |\n\nProse.\n`
    expect(parse(repairDetachedTableRows(md))).toEqual(parse(md))
  })
})
