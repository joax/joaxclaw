import { describe, it, expect } from 'vitest'
import {
  toExportMessages, toMarkdown, toJson, exportFilename, fenceFor, countTruncated, neutraliseHtml,
  isUnavailableSentinel, resetStart, DEFAULT_EXPORT_OPTIONS, TRUNCATED_MARKER, OMITTED_PLACEHOLDER, UNAVAILABLE_SENTINEL,
  type ExportMeta,
} from '../chatExport'
import {
  EXPORT_HISTORY_MESSAGES, CHAT_TITLE, AGENT_ID, SESSION_KEY as FX_SESSION_KEY, LONG_RESULT_TEXT, EXPECTED_TRUNCATED_COUNT,
  RESET_MARKER_ROW, EXPECTED_JSON_ENVELOPE, EXPECTED_FILENAME_MD, EXPECTED_FILENAME_JSON, UNAVAILABLE_SENTINEL_ROW,
} from './fixtures/sprint/chatExport'

// Chat export (PRD 05): the gateway's chat.history messages as a Markdown file with tool
// calls folded, or as JSON. Shapes follow OpenClaw 2026.9.4's history projection: tool
// calls are `toolCall` blocks with `arguments`, results are separate `toolResult` rows.

const T0 = new Date(2026, 8, 18, 10, 41).getTime()

const history: unknown[] = [
  { role: 'user', content: [{ type: 'text', text: 'Research what the three competitors charge' }], timestamp: T0 },
  {
    role: 'assistant', timestamp: T0 + 60_000, model: 'ollama/qwen3.6:35b',
    content: [
      { type: 'thinking', thinking: 'Start with Acme.' },
      { type: 'toolCall', id: 'c1', name: 'web_fetch', arguments: { url: 'https://acme.com/pricing' } },
      { type: 'toolCall', id: 'c2', name: 'exec', arguments: { command: 'false' } },
    ],
  },
  { role: 'toolResult', toolCallId: 'c1', toolName: 'web_fetch', content: [{ type: 'text', text: 'Acme Pro is $29 / seat' }] },
  { role: 'toolResult', toolCallId: 'c2', toolName: 'exec', isError: true, content: [{ type: 'text', text: 'exit 1' }] },
  { role: 'assistant', timestamp: T0 + 120_000, content: [{ type: 'text', text: 'Acme charges $29 per seat.' }] },
]

const meta: ExportMeta = {
  title: 'Pricing research', sessionKey: 'agent:researcher:main-7f3a', agentName: 'researcher',
  exportedAt: new Date(2026, 8, 18, 10, 55),
}

const md = (raw = history, opts = DEFAULT_EXPORT_OPTIONS, m: Partial<ExportMeta> = {}) =>
  toMarkdown(toExportMessages(raw), { ...meta, ...m }, opts)

describe('toMarkdown', () => {
  it('writes the heading and meta line', () => {
    const out = md()
    expect(out.startsWith('# Pricing research\n\nagent: researcher · model: ollama/qwen3.6:35b · session: agent:researcher:main-7f3a · exported 18 Sep 2026, 10:55\n')).toBe(true)
  })

  it('labels the user "You" and replies with the agent name, with timestamps', () => {
    const out = md()
    expect(out).toContain('**You** · 18 Sep 10:41')
    expect(out).toContain('**researcher** · 18 Sep 10:42')
  })

  it('folds a tool call into a closed <details> with an argSummary summary', () => {
    const out = md()
    expect(out).toContain('<details><summary>🔧 web_fetch · https://acme.com/pricing · done</summary>')
    expect(out).toContain('"url": "https://acme.com/pricing"')
    expect(out).toContain('Result:\n\n```text\nAcme Pro is $29 / seat\n```')
    expect(out.match(/<details>/g)?.length).toBe(out.match(/<\/details>/g)?.length)
  })

  it('marks a failed call as error with its text', () => {
    const out = md()
    expect(out).toContain('<summary>🔧 exec · false · error</summary>')
    expect(out).toContain('Error:\n\n```text\nexit 1\n```')
  })

  it('leaves tool calls out when the option is off', () => {
    expect(md(history, { ...DEFAULT_EXPORT_OPTIONS, tools: false })).not.toContain('<details>')
  })

  it('folds reasoning when asked', () => {
    expect(md()).not.toContain('Start with Acme.')
    expect(md(history, { ...DEFAULT_EXPORT_OPTIONS, reasoning: true })).toContain('<details><summary>Reasoning</summary>\n\nStart with Acme.\n\n</details>')
  })

  it('drops timestamps when the option is off', () => {
    expect(md(history, { ...DEFAULT_EXPORT_OPTIONS, timestamps: false })).toContain('**You**\n')
  })

  it('uses a longer fence when the content has one', () => {
    const raw = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'write', arguments: { path: 'a.md' } }] },
      { role: 'toolResult', toolCallId: 'x', content: [{ type: 'text', text: 'has ```code``` inside' }] },
    ]
    expect(md(raw)).toContain('````text\nhas ```code``` inside\n````')
  })

  it('shortens a result over 20,000 characters', () => {
    const raw = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'read', arguments: { path: 'big' } }] },
      { role: 'toolResult', toolCallId: 'x', content: [{ type: 'text', text: 'y'.repeat(25_000) }] },
    ]
    const out = md(raw)
    expect(out).toContain('…(shortened in export)')
    expect(out).not.toContain('y'.repeat(20_001))
  })

  it('lists attachments by name, links web URLs, and never embeds data', () => {
    const raw = [{
      role: 'user', content: [
        { type: 'text', text: 'see these' },
        { type: 'image', fileName: 'screenshot.png', data: 'iVBORw0KGgo=' },
        { type: 'file', name: 'spec.pdf', url: 'https://example.com/spec.pdf' },
      ],
    }]
    const out = md(raw)
    expect(out).toContain('*Attachments: screenshot.png, [spec.pdf](https://example.com/spec.pdf)*')
    expect(out).not.toContain('iVBORw0KGgo')
  })

  it('adds the still-running line', () => {
    expect(md(history, DEFAULT_EXPORT_OPTIONS, { running: true })).toContain('> Still running when exported: the last reply may be incomplete.')
    expect(md()).not.toContain('Still running')
  })

  it('uses a channel sender label for user messages', () => {
    expect(md([{ role: 'user', senderLabel: 'Ana (Slack)', content: 'hi' }])).toContain('**Ana (Slack)**')
  })

  it("doesn't let message text open HTML", () => {
    const raw = [{ role: 'assistant', content: 'Hi <img src=x onerror=alert(1)> and </details> and `<b>ok</b>`' }]
    const out = md(raw)
    expect(out).toContain('Hi &lt;img src=x onerror=alert(1)> and &lt;/details> and `<b>ok</b>`')
  })

  it('escapes tool arguments inside the summary', () => {
    const raw = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'web_fetch', arguments: { url: '<script>' } }] }]
    expect(md(raw)).toContain('<summary>🔧 web_fetch · &lt;script&gt; · done</summary>')
  })

  it('keeps the gateway truncation markers verbatim', () => {
    const raw = [{ role: 'assistant', content: `long text\n${TRUNCATED_MARKER}` }]
    expect(md(raw)).toContain(TRUNCATED_MARKER)
  })

  it('names a sub-agent spawn by its agent', () => {
    const raw = [{ role: 'assistant', content: [{ type: 'toolCall', id: 's', name: 'sessions_spawn', arguments: { agentId: 'researcher-2', task: 'a long brief' } }] }]
    expect(md(raw)).toContain('<summary>🔧 sub-agent · researcher-2 · done</summary>')
  })
})

describe('neutraliseHtml', () => {
  it('leaves fenced code alone and closes a fence left open', () => {
    expect(neutraliseHtml('```html\n<div>\n```\n<p>')).toBe('```html\n<div>\n```\n&lt;p>')
    expect(neutraliseHtml('```\n<b>')).toBe('```\n<b>\n```')
  })

  it('keeps a plain comparison readable and defuses script links', () => {
    expect(neutraliseHtml('a < b')).toBe('a < b')
    expect(neutraliseHtml('[x](javascript:alert(1))')).toBe('[x](#alert(1))')
  })
})

describe('fenceFor', () => {
  it('is longer than any backtick run', () => {
    expect(fenceFor('plain')).toBe('```')
    expect(fenceFor('a ```` b')).toBe('`````')
  })
})

describe('countTruncated and sentinels', () => {
  it('counts shortened and omitted messages', () => {
    expect(countTruncated([
      { role: 'assistant', content: `x\n${TRUNCATED_MARKER}` },
      { role: 'assistant', content: [{ type: 'text', text: OMITTED_PLACEHOLDER }], __openclaw: { truncated: true, reason: 'oversized' } },
      { role: 'user', content: 'fine' },
    ])).toBe(2)
  })

  it('spots the transcript-unavailable sentinel', () => {
    expect(isUnavailableSentinel({ role: 'assistant', content: [{ type: 'text', text: UNAVAILABLE_SENTINEL }] })).toBe(true)
    expect(isUnavailableSentinel({ role: 'assistant', content: 'hello' })).toBe(false)
  })

  it('reads a leading reset marker', () => {
    expect(resetStart([{ role: 'system', timestamp: 5, __openclaw: { kind: 'reset' } }])).toBe(5)
    expect(resetStart([{ role: 'system', __openclaw: { kind: 'compaction' } }])).toBeUndefined()
  })
})

describe('exportFilename', () => {
  const d = new Date(2026, 8, 18)
  it('slugs the title and dates the file', () => {
    expect(exportFilename('Pricing research', d, 'md')).toBe('pricing-research-2026-09-18.md')
    expect(exportFilename('Café: plans / Q3!', d, 'json')).toBe('cafe-plans-q3-2026-09-18.json')
  })

  it('falls back to chat-<date> when nothing usable is left', () => {
    expect(exportFilename('🤖🤖', d, 'md')).toBe('chat-2026-09-18.md')
    expect(exportFilename('', d, 'md')).toBe('chat-2026-09-18.md')
  })
})

describe('toJson', () => {
  it('wraps the raw messages unchanged', () => {
    const parsed = JSON.parse(toJson(history, { ...meta, agentId: 'researcher', totalMessages: 5 }))
    expect(parsed.messages).toEqual(history)
    expect(parsed).toMatchObject({ sessionKey: meta.sessionKey, title: 'Pricing research', agentId: 'researcher', totalMessages: 5 })
    expect(typeof parsed.exportedAt).toBe('string')
  })
})

describe('fixtures: a 2026.9.4 chat.history page', () => {
  const fxMeta: ExportMeta = {
    title: CHAT_TITLE, sessionKey: FX_SESSION_KEY, agentId: AGENT_ID, agentName: 'researcher',
    exportedAt: new Date(2026, 8, 18, 10, 55), running: true,
  }
  const out = toMarkdown(toExportMessages(EXPORT_HISTORY_MESSAGES, { activeRun: true }), fxMeta, { tools: true, reasoning: true, timestamps: true })

  it('takes the model from the reply (provider and model are separate fields)', () => {
    expect(out).toContain('model: ollama/qwen3.6:35b')
  })

  it('labels the Slack row with its sender', () => {
    expect(out).toContain('**Maria (Slack)**')
  })

  it('folds every call, including the nested one, and closes every <details>', () => {
    for (const id of ['acme.com/pricing', 'globex.example/pricing', 'notes/pricing.md', 'hooli.example/pricing']) expect(out).toContain(id)
    expect(out.match(/<details>/g)?.length).toBe(out.match(/<\/details>/g)?.length)
    expect(out).toContain('<summary>🔧 web_fetch · https://hooli.example/pricing · running</summary>')
    expect(out).toContain('<summary>🔧 sub-agent · Initech pricing · done</summary>')
  })

  it('shortens the long result and keeps the error', () => {
    expect(out).toContain('…(shortened in export)')
    expect(out).not.toContain(LONG_RESULT_TEXT)
    expect(out).toContain('fetch failed: 403 Forbidden (https://globex.example/pricing)')
  })

  it('notes the result the gateway left out', () => {
    expect(out).toContain('*A tool result was too large for the gateway to include.*')
  })

  it('writes the reply with nested fences intact', () => {
    expect(out).toContain('````md\n| vendor | price |')
    expect(out).toContain('```python\ndef per_seat')
  })

  it('never embeds the stripped image and names it by type', () => {
    expect(out).toContain('*Attachments: image (image/png)*')
  })

  it('drops the compaction marker and counts the shortened rows', () => {
    expect(out).not.toContain('Compaction')
    expect(countTruncated(EXPORT_HISTORY_MESSAGES)).toBe(EXPECTED_TRUNCATED_COUNT)
  })

  it('starts at a reset when the history does', () => {
    expect(resetStart([RESET_MARKER_ROW, ...EXPORT_HISTORY_MESSAGES])).toBe(RESET_MARKER_ROW.timestamp)
  })

  it('builds the JSON envelope and file names', () => {
    const json = JSON.parse(toJson(EXPORT_HISTORY_MESSAGES, { ...fxMeta, exportedAt: new Date(EXPECTED_JSON_ENVELOPE.exportedAt), totalMessages: 18 }))
    expect(json).toEqual(EXPECTED_JSON_ENVELOPE)
    expect(exportFilename(CHAT_TITLE, new Date(2026, 8, 18), 'md')).toBe(EXPECTED_FILENAME_MD)
    expect(exportFilename(CHAT_TITLE, new Date(2026, 8, 18), 'json')).toBe(EXPECTED_FILENAME_JSON)
  })

  it('spots the unavailable sentinel row', () => {
    expect(isUnavailableSentinel(UNAVAILABLE_SENTINEL_ROW)).toBe(true)
  })
})
