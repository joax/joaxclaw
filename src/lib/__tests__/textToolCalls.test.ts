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


// The second reported message: tool name as the outer tag, arguments as children. A
// fixed list of tag names missed it — models invent names freely — so detection keys on
// the shape of a call instead.
const REPORTED_LS = `You're right — the vault path I was checking doesn't exist at that location. Let me find where your Obsidian vaults are actually stored.

<ls> <path> /home/joaxap </path> <limit> 50 </limit> </ls>`

describe('call shapes', () => {
  it('lifts the reported <ls> call, arguments from its children', () => {
    const { attempts, text } = extractTextToolAttempts(REPORTED_LS)
    expect(text).toBe("You're right — the vault path I was checking doesn't exist at that location. Let me find where your Obsidian vaults are actually stored.")
    expect(attempts).toEqual([{ kind: 'action', tag: 'ls', attrs: { path: '/home/joaxap', limit: '50' } }])
  })

  it('reads Hermes/Qwen <tool_call> JSON', () => {
    const { attempts, text } = extractTextToolAttempts('Checking.\n<tool_call>\n{"name": "read_file", "arguments": {"path": "a.md", "lines": 20}}\n</tool_call>')
    expect(text).toBe('Checking.')
    expect(attempts[0]).toMatchObject({ tag: 'read_file', attrs: { path: 'a.md', lines: '20' } })
  })

  it('reads <tool_call> arguments that arrive as a JSON string', () => {
    const { attempts } = extractTextToolAttempts('<tool_call>{"name":"grep","arguments":"{\\"pattern\\":\\"Calla\\"}"}</tool_call>')
    expect(attempts[0]).toMatchObject({ tag: 'grep', attrs: { pattern: 'Calla' } })
  })

  it('keeps an unparseable <tool_call> as an attempt rather than dropping it', () => {
    const { attempts } = extractTextToolAttempts('<tool_call>{not json</tool_call>')
    expect(attempts[0]).toMatchObject({ tag: 'tool_call', body: '{not json' })
  })

  it('reads <invoke name> with named parameters, and drops the emptied wrapper', () => {
    const { attempts, text } = extractTextToolAttempts('Searching.\n<function_calls>\n<invoke name="grep">\n<parameter name="pattern">Calla</parameter>\n<parameter name="path">~/vault</parameter>\n</invoke>\n</function_calls>')
    expect(text).toBe('Searching.')
    expect(attempts[0]).toMatchObject({ tag: 'grep', attrs: { pattern: 'Calla', path: '~/vault' } })
  })

  it('reads Qwen-coder <function=…> calls', () => {
    const { attempts } = extractTextToolAttempts('<function=glob>\n<parameter=pattern>**/*.md</parameter>\n</function>')
    expect(attempts[0]).toMatchObject({ tag: 'glob', attrs: { pattern: '**/*.md' } })
  })

  it('reads child-tag arguments on a known action tag instead of treating them as a body', () => {
    const { attempts } = extractTextToolAttempts('<bash><command>ls -la ~/vault</command></bash>')
    expect(attempts[0]).toEqual({ kind: 'action', tag: 'bash', attrs: { command: 'ls -la ~/vault' } })
  })

  it('leaves HTML with the same nested shape alone', () => {
    for (const html of [
      '<ul><li>one</li><li>two</li></ul>',
      '<details><summary>More</summary></details>',
      '<p><b>bold</b></p>',
      '<table><tr><td>1</td></tr></table>',
    ]) {
      const { attempts, text } = extractTextToolAttempts(html)
      expect(attempts, html).toEqual([])
      expect(text, html).toBe(html)
    }
  })

  it('leaves a lone inline tag alone — no children, not a call', () => {
    expect(extractTextToolAttempts('This is <b>important</b>.').attempts).toEqual([])
  })

  it('ignores every shape inside fenced code', () => {
    const md = '```\n<ls><path>/x</path></ls>\n<tool_call>{"name":"a"}</tool_call>\n```'
    expect(extractTextToolAttempts(md).attempts).toEqual([])
  })

  it('classifies fences independently when there are several', () => {
    // Regression guard: the first version classified parts with a stateful /g regex.
    const md = 'a\n```\nx\n```\n<ls><path>/one</path></ls>\n```\ny\n```\n<ls><path>/two</path></ls>'
    expect(extractTextToolAttempts(md).attempts.map(a => a.attrs.path)).toEqual(['/one', '/two'])
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

  it('summarises a generic call by its most telling argument', () => {
    expect(one("<ls> <path> /home/joaxap </path> <limit> 50 </limit> </ls>")).toBe('ls · /home/joaxap')
    expect(one('<tool_call>{"name":"web_search","arguments":{"query":"Calla Ventures"}}</tool_call>')).toBe('web_search · Calla Ventures')
  })

  it('summarises a bash call given as an argument', () => {
    expect(one('<bash><command>ls -la</command></bash>')).toBe('ls -la')
  })

  it('falls back to tag and action', () => {
    expect(one('<cron action="list" x="1" />')).toBe('cron · list')
  })
})
