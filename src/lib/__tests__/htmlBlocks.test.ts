import { describe, it, expect } from 'vitest'
import { splitHtmlBlocks, preserveLineBreaks } from '../htmlBlocks'

// A reply carried a <progress> bar and a <details> plan, and the chat showed both as
// literal tags: react-markdown escapes raw HTML. Rendering raw HTML would hand model
// output to the DOM in a privileged renderer, so these tags are parsed into data and
// drawn by React components instead — and everything else stays escaped.

const REPORTED = `<progress aria-label="Automated monitoring · 2/3" value="2" max="3"></progress>

<details> <summary>View Plan</summary>
 Verify production page accessibility via browser tool
 Develop browser-based extraction script for production sites
 Setup as automated cron job
</details>`

describe('splitHtmlBlocks — the reported reply', () => {
  it('yields a progress bar and a collapsible plan, and no literal tags', () => {
    const segs = splitHtmlBlocks(REPORTED)
    expect(segs.map(s => s.kind)).toEqual(['progress', 'details'])
    expect(segs[0]).toEqual({ kind: 'progress', value: 2, max: 3, label: 'Automated monitoring · 2/3' })
    const d = segs[1]
    if (d.kind !== 'details') throw new Error('expected details')
    expect(d.summary).toBe('View Plan')
    expect(d.open).toBe(false)
    expect(d.body.split('\n').map(l => l.trim())).toEqual([
      'Verify production page accessibility via browser tool',
      'Develop browser-based extraction script for production sites',
      'Setup as automated cron job',
    ])
  })
})

describe('splitHtmlBlocks — details', () => {
  it('keeps surrounding markdown, in order', () => {
    const segs = splitHtmlBlocks('Before.\n\n<details><summary>More</summary>Inner **bold**</details>\n\nAfter.')
    expect(segs.map(s => s.kind)).toEqual(['markdown', 'details', 'markdown'])
    expect(segs[0]).toMatchObject({ text: 'Before.\n\n' })
    expect(segs[2]).toMatchObject({ text: '\n\nAfter.' })
  })

  it('honours the open attribute', () => {
    expect(splitHtmlBlocks('<details open><summary>S</summary>b</details>')[0]).toMatchObject({ open: true })
  })

  it('defaults a missing summary, and flattens markup inside one to plain text', () => {
    expect(splitHtmlBlocks('<details>just a body</details>')[0]).toMatchObject({ summary: 'Details', body: 'just a body' })
    expect(splitHtmlBlocks('<details><summary><b>Bold</b> <img src=x onerror=alert(1)>title</summary>x</details>')[0])
      .toMatchObject({ summary: 'Bold title' })
  })

  it('handles several blocks', () => {
    const segs = splitHtmlBlocks('<details><summary>A</summary>1</details>\n<details><summary>B</summary>2</details>')
    expect(segs.filter(s => s.kind === 'details').map(s => s.kind === 'details' && s.summary)).toEqual(['A', 'B'])
  })
})

describe('splitHtmlBlocks — progress', () => {
  it('accepts the self-closing and unclosed forms', () => {
    expect(splitHtmlBlocks('<progress value="1" max="4"/>')[0]).toMatchObject({ kind: 'progress', value: 1, max: 4 })
    expect(splitHtmlBlocks('Working <progress value=3 max=10> now')
      .map(s => s.kind)).toEqual(['markdown', 'progress', 'markdown'])
  })

  it('follows HTML semantics: max defaults to 1, no value is indeterminate', () => {
    expect(splitHtmlBlocks('<progress value="0.5"></progress>')[0]).toMatchObject({ value: 0.5, max: 1 })
    expect(splitHtmlBlocks('<progress max="3"></progress>')[0]).toMatchObject({ value: null, max: 3 })
  })

  it('clamps nonsense instead of drawing a broken bar', () => {
    expect(splitHtmlBlocks('<progress value="9" max="3"></progress>')[0]).toMatchObject({ value: 3 })
    expect(splitHtmlBlocks('<progress value="-2" max="3"></progress>')[0]).toMatchObject({ value: 0 })
    expect(splitHtmlBlocks('<progress value="x" max="0"></progress>')[0]).toMatchObject({ value: null, max: 1 })
  })

  it('reads only the attributes it knows — event handlers go nowhere', () => {
    const seg = splitHtmlBlocks('<progress value="1" max="2" onclick="alert(1)" style="x"></progress>')[0]
    expect(seg).toEqual({ kind: 'progress', value: 1, max: 2 })
  })

  it('falls back to title for the label', () => {
    expect(splitHtmlBlocks('<progress title="Upload" value="1" max="2"></progress>')[0]).toMatchObject({ label: 'Upload' })
  })

  it('leaves a progress tag that sits inside a details body to that body', () => {
    const segs = splitHtmlBlocks('<details><summary>S</summary><progress value="1" max="2"></progress></details>')
    expect(segs.map(s => s.kind)).toEqual(['details'])
  })
})

describe('splitHtmlBlocks — what it must not touch', () => {
  it('is a pass-through when neither tag is present', () => {
    expect(splitHtmlBlocks('Plain *markdown* with <b>other</b> HTML.')).toEqual([
      { kind: 'markdown', text: 'Plain *markdown* with <b>other</b> HTML.' },
    ])
  })

  it('leaves tags inside fenced code alone', () => {
    const md = 'Example:\n```html\n<details><summary>S</summary>b</details>\n<progress value="1" max="2"></progress>\n```'
    expect(splitHtmlBlocks(md)).toEqual([{ kind: 'markdown', text: md }])
  })
})

describe('splitHtmlBlocks — streaming', () => {
  it('hides a <details> whose closing tag has not arrived yet', () => {
    const segs = splitHtmlBlocks('Plan:\n<details><summary>View Plan</summary>\n step one', { streaming: true })
    expect(segs).toEqual([{ kind: 'markdown', text: 'Plan:\n' }])
  })

  it('hides a half-written tag at the very end', () => {
    expect(splitHtmlBlocks('Progress: <progress value="1', { streaming: true }))
      .toEqual([{ kind: 'markdown', text: 'Progress: ' }])
  })

  it('shows the same text in full once the turn is complete', () => {
    expect(splitHtmlBlocks('<details><summary>S</summary>b</details>', { streaming: true }).map(s => s.kind))
      .toEqual(['details'])
  })
})

describe('preserveLineBreaks', () => {
  it('turns single newlines into hard breaks so plain lines stay lines', () => {
    expect(preserveLineBreaks('one\ntwo\nthree')).toBe('one  \ntwo  \nthree')
  })

  it('leaves paragraph breaks and fenced code alone', () => {
    expect(preserveLineBreaks('a\n\nb')).toBe('a\n\nb')
    expect(preserveLineBreaks('```\nx\ny\n```')).toBe('```\nx\ny\n```')
  })
})
