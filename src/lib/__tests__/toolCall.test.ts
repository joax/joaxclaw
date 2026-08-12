import { describe, it, expect } from 'vitest'
import {
  unwrapToolResult, resultFields, toolResultView, commandSummary, commandLineCount, argSummary,
} from '../toolCall'

// The two payloads below are the ones from the reported screenshots, verbatim. They're
// what the pills rendered as 19 lines of envelope and a JSON-escaped shell script, so
// they're the cases the redesign has to answer.

const GATEWAY_ARGS = {
  action: 'restart',
  note: 'User requested restart to load the newly installed joaxclaw-fs plugin.',
  reason: 'User requested restart to load the newly installed joaxclaw-fs plugin.',
}

// Note the payload is JSON *inside* the text field — encoded twice on the wire.
const GATEWAY_RESULT = JSON.stringify({
  content: [{
    type: 'text',
    text: JSON.stringify({
      ok: true, pid: 504495, signal: 'SIGUSR1', delayMs: 2000,
      reason: 'User requested restart to load the newly installed joaxclaw-fs plugin.',
      mode: 'emit', coalesced: false, cooldownMsApplied: 0, emitHooksQueued: true,
    }, null, 2),
  }],
  details: { ok: true, pid: 504495, signal: 'SIGUSR1' },
})

const EXEC_COMMAND = `# Install or upgrade the JoaxClaw joaxclaw-fs gateway plugin from npm.
set -e
openclaw plugins install --force openclaw-joaxclaw-fs
openclaw plugins enable joaxclaw-fs
# Hard guard: inspect exits non-zero if the plugin did not register.
openclaw plugins inspect joaxclaw-fs`

const EXEC_RESULT = JSON.stringify({
  content: [{
    type: 'text',
    text: 'Command still running (session swift-haven, pid 503829). Use process (list/poll/log/write/send-keys/submit/paste/kill/clear/remove) for follow-up.',
  }],
  details: { status: 'running', sessionId: 'swift-haven', pid: 503829, startedAt: 1786527185968 },
})

describe('unwrapToolResult', () => {
  it('unwraps the envelope AND the JSON encoded inside its text', () => {
    const { value } = unwrapToolResult(GATEWAY_RESULT)
    expect(value).toMatchObject({ ok: true, pid: 504495, signal: 'SIGUSR1' })
  })

  it('keeps prose as text and details as the structured half', () => {
    const { value, text } = unwrapToolResult(EXEC_RESULT)
    expect(text).toContain('Command still running')
    expect(value).toMatchObject({ status: 'running', sessionId: 'swift-haven' })
  })

  it('passes through a plain JSON result', () => {
    expect(unwrapToolResult('{"ok":true}').value).toEqual({ ok: true })
  })

  it('treats a non-JSON result as text', () => {
    expect(unwrapToolResult('just a string').text).toBe('just a string')
  })
})

describe('resultFields', () => {
  it('leads with the outcome, then identity, then the rest', () => {
    const fields = resultFields(unwrapToolResult(GATEWAY_RESULT).value)
    expect(fields.slice(0, 3).map(f => f.label)).toEqual(['ok', 'pid', 'signal'])
  })

  it('tones success and failure', () => {
    expect(resultFields({ ok: true })[0].tone).toBe('ok')
    expect(resultFields({ ok: false })[0].tone).toBe('bad')
    expect(resultFields({ exitCode: 0 })[0].tone).toBe('ok')
    expect(resultFields({ exitCode: 1 })[0].tone).toBe('bad')
    expect(resultFields({ status: 'failed' })[0].tone).toBe('bad')
    expect(resultFields({ status: 'running' })[0].tone).toBeUndefined()
  })

  it('renders booleans as words, not raw true/false', () => {
    expect(resultFields({ ok: true })[0].value).toBe('yes')
  })

  it('skips envelope scaffolding and empty values', () => {
    expect(resultFields({ type: 'text', content: 'x', ok: true, note: '' }).map(f => f.label))
      .toEqual(['ok'])
  })

  it('leaves nested structure to the JSON section', () => {
    expect(resultFields({ ok: true, nested: { a: 1 } }).map(f => f.label)).toEqual(['ok'])
  })

  it('truncates a runaway string', () => {
    expect(resultFields({ note: 'x'.repeat(400) })[0].value).toHaveLength(140)
  })
})

describe('toolResultView', () => {
  it('turns the gateway restart into facts, with nothing left as JSON noise', () => {
    const view = toolResultView(GATEWAY_RESULT)
    expect(view.fields.map(f => `${f.label}=${f.value}`)).toContain('pid=504495')
    expect(view.text).toBeUndefined()
    expect(view.json).toBeUndefined()   // 9 primitives all fit as chips
  })

  it('keeps the exec sentence and the fields side by side', () => {
    const view = toolResultView(EXEC_RESULT)
    expect(view.text).toContain('Command still running')
    expect(view.fields.map(f => f.label)).toEqual(['status', 'pid', 'sessionId', 'startedAt'])
  })

  it('falls back to raw JSON when there are no primitives to show', () => {
    const view = toolResultView('{"items":[1,2,3]}')
    expect(view.json).toContain('items')
  })

  it('survives an empty result', () => {
    expect(toolResultView('')).toEqual({ fields: [] })
  })
})

describe('commandSummary', () => {
  it('skips the comment and set -e preamble a generated script opens with', () => {
    expect(commandSummary(EXEC_COMMAND)).toBe('openclaw plugins install --force openclaw-joaxclaw-fs')
  })

  it('skips a shebang', () => {
    expect(commandSummary('#!/bin/bash\nls -la')).toBe('ls -la')
  })

  it('falls back to the first line when everything is a comment', () => {
    expect(commandSummary('# only a comment')).toBe('# only a comment')
  })

  it('counts the lines that matter', () => {
    expect(commandLineCount(EXEC_COMMAND)).toBe(6)
    expect(commandLineCount('ls\n\n\n')).toBe(1)
  })
})

describe('argSummary', () => {
  it('says what a gateway call did, not which keys it carried', () => {
    // This is the regression: the header read "Updating action, note, reason".
    expect(argSummary(GATEWAY_ARGS)).toBe('restart')
  })

  it('summarises a shell call by its first real command', () => {
    expect(argSummary({ command: EXEC_COMMAND, timeout: 120 }))
      .toBe('openclaw plugins install --force openclaw-joaxclaw-fs')
  })

  it('prefers a path, url or query when there is one', () => {
    expect(argSummary({ file_path: '/tmp/a.md' })).toBe('/tmp/a.md')
    expect(argSummary({ url: 'https://example.com' })).toBe('https://example.com')
  })

  it('falls back to the first primitive rather than dumping the object', () => {
    expect(argSummary({ weird: 'value' })).toBe('value')
    expect(argSummary({ count: 3 })).toBe('count 3')
  })

  it('is empty when there is genuinely nothing to say', () => {
    expect(argSummary({})).toBe('')
    expect(argSummary({ nested: { a: 1 } })).toBe('')
  })
})
