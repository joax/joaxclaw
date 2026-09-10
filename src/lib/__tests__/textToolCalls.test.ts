import { describe, it, expect } from 'vitest'
import { extractTextToolAttempts, summarizeAttempt } from '../textToolCalls'

// A model wrote "Let me check what we have in the vault regarding Calla Ventures." and
// then a <read-files> block — an imitation of the gateway's own compaction metadata.
// Nothing executes tags written as text, so the chat must say nothing ran rather than
// show raw XML or dress the tag up as an action.

const REPORTED = `Let me check what we have in the vault regarding Calla Ventures.

<read-files> /home/joaxap/.openclaw/workspace/memory/2026-09-10.md,~/.obsidian/vaults/,/home/joaxap/.openclaw/workspace/ </read-files>`

describe('extractTextToolAttempts', () => {
  it('lifts the reported <read-files> block out of the prose', () => {
    const { attempts, text } = extractTextToolAttempts(REPORTED)
    expect(text).toBe('Let me check what we have in the vault regarding Calla Ventures.')
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ kind: 'files', tag: 'read-files' })
    expect(attempts[0].paths).toEqual([
      '/home/joaxap/.openclaw/workspace/memory/2026-09-10.md',
      '~/.obsidian/vaults/',
      '/home/joaxap/.openclaw/workspace/',
    ])
  })

  it('reads newline-separated lists too', () => {
    const { attempts } = extractTextToolAttempts('<modified-files>\na.ts\nb.ts\n</modified-files>')
    expect(attempts[0]).toMatchObject({ tag: 'modified-files', paths: ['a.ts', 'b.ts'] })
  })

  it('never mistakes <read-files> for a <read> tag', () => {
    const { attempts } = extractTextToolAttempts('<read-files>x.md</read-files>')
    expect(attempts.map(a => a.tag)).toEqual(['read-files'])
  })

  it('catches content-bearing action tags', () => {
    const { attempts, text } = extractTextToolAttempts('Running it now.\n<bash>ls -la ~/vault\necho done</bash>')
    expect(text).toBe('Running it now.')
    expect(attempts[0]).toMatchObject({ kind: 'action', tag: 'bash', body: 'ls -la ~/vault\necho done' })
  })

  it('catches a self-closing tag with attributes, keeping action separate', () => {
    const { attempts } = extractTextToolAttempts('<cron action="list" filter="daily" />')
    expect(attempts[0]).toMatchObject({ tag: 'cron', action: 'list', attrs: { filter: 'daily' } })
  })

  it('leaves attribute-less self-closing markup alone', () => {
    const { attempts, text } = extractTextToolAttempts('line one<br/>line two')
    expect(attempts).toEqual([])
    expect(text).toBe('line one<br/>line two')
  })

  it('ignores tags inside fenced code — the model is showing markup, not attempting it', () => {
    const md = 'Use this form:\n```xml\n<bash>ls</bash>\n<read-files>a.md</read-files>\n```\nThat is all.'
    const { attempts, text } = extractTextToolAttempts(md)
    expect(attempts).toEqual([])
    expect(text).toBe(md)
  })

  it('still catches a tag after a fence has closed', () => {
    const { attempts } = extractTextToolAttempts('```\ncode\n```\n<bash>whoami</bash>')
    expect(attempts.map(a => a.tag)).toEqual(['bash'])
  })

  it('handles several attempts in one reply, in order', () => {
    const { attempts } = extractTextToolAttempts('<read-files>a.md</read-files> then <bash>cat a.md</bash>')
    expect(attempts.map(a => a.tag)).toEqual(['read-files', 'bash'])
  })

  it('is a no-op on ordinary prose', () => {
    expect(extractTextToolAttempts('Plain answer, 3 < 4.')).toEqual({ attempts: [], text: 'Plain answer, 3 < 4.' })
  })
})

describe('summarizeAttempt', () => {
  const one = (s: string) => summarizeAttempt(extractTextToolAttempts(s).attempts[0])

  it('counts files', () => {
    expect(one('<read-files>a.md,b.md,c.md</read-files>')).toBe('Read 3 files')
    expect(one('<modified-files>a.md</modified-files>')).toBe('Modify 1 file')
  })

  it('shows the first line of a command', () => {
    expect(one('<bash>\n\nls -la\npwd</bash>')).toBe('ls -la')
  })

  it('names the path of an edit', () => {
    expect(one('<edit>path: "/tmp/x.md"\noldText: "a" newText: "b"</edit>')).toBe('edit /tmp/x.md')
  })

  it('falls back to tag and action', () => {
    expect(one('<cron action="list" x="1" />')).toBe('cron · list')
  })
})
