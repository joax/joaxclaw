// QA (sprint 2026.9, PRDs 04 + 05): the Markdown export's HTML/script defusing (incl. what the
// isolated 2026.9.4 gateway's real transcript showed), goal error classes over every error
// form the gateway sends, and retries staying byte-identical.
// Checklists: docs/qa/sprint-2026-9/04-chat-goals.md, 05-chat-export.md
import { describe, expect, it } from 'vitest'
import { neutraliseHtml, toExportMessages, toMarkdown } from '../chatExport'
import { buildStartParams, buildUpdateParams, classifyGoalError, goalErrorPolicy, parseGoal, validateObjective } from '../goals'
import * as g from './fixtures/sprint/chatGoals'
import * as x from './fixtures/sprint/chatExport'

/** No tag, event handler or script URL can survive outside code in the exported Markdown. */
function assertInert(md: string) {
  const prose = md.split('\n').filter(l => !/^\s*(`{3,}|~{3,})/.test(l))
  for (const line of prose) {
    const spanless = line.replace(/(`+)(?:(?!\1)[\s\S])*?\1(?!`)/g, '')
    expect(spanless, line).not.toMatch(/<(script|img|iframe|svg|a|style)\b/i)
  }
  expect(md).not.toMatch(/\]\(\s*javascript:/i)
  expect(md).not.toMatch(/^\s{0,3}\[[^\]]+\]:\s*javascript:/im)
}

describe('QA 05 · neutraliseHtml', () => {
  it('05-SEC: a backtick run with no matching closer is not code; the HTML after it is escaped', () => {
    const out = neutraliseHtml('`` <img src=y onerror=alert(2)> `')
    expect(out).toContain('&lt;img')
  })
  it('05-SEC: a real code span keeps its contents', () => {
    expect(neutraliseHtml('use `<b>` for bold and ``a ` <i> b``')).toBe('use `<b>` for bold and ``a ` <i> b``')
  })
  it('05-SEC: a javascript: link reference definition is defused', () => {
    expect(neutraliseHtml('[ref]\n\n[ref]: javascript:alert(4)')).toBe('[ref]\n\n[ref]: #')
    expect(neutraliseHtml('[r]: <javascript:alert(1)> "t"')).toBe('[r]: # "t"')
  })
  it('05-SEC: entity-encoded and spaced script schemes are defused too', () => {
    expect(neutraliseHtml('[x](javascript&#58;alert(1))')).not.toMatch(/javascript/i)
    expect(neutraliseHtml('[x](  JaVaScRiPt:alert(1))')).toBe('[x](#alert(1))')
    expect(neutraliseHtml('[x](data:text/html;base64,PHNjcmlwdD4=)')).not.toMatch(/\]\(data:/i)
  })
  it('05-SEC: a "fence" whose info string has a backtick is prose, so the HTML under it is escaped', () => {
    const out = neutraliseHtml('```x`\n<img src=x onerror=alert(1)>\n```')
    expect(out).toContain('&lt;img')
  })
  it('05-SEC: safe links and comparisons are untouched', () => {
    expect(neutraliseHtml('[docs](https://example.com/a_(b)) and 1 < 2')).toBe('[docs](https://example.com/a_(b)) and 1 < 2')
  })
  it('QA live: the reply the isolated gateway stored exports inert', () => {
    // chat.history row from the isolated 2026.9.4 gateway (mock model "html" reply).
    const row = {
      role: 'assistant', model: 'qa-mock', provider: 'qamock', timestamp: 1789757000000,
      content: [{ type: 'text', text: 'Tricky output follows.\n<script>alert("x")</script>\n<img src=x onerror=alert(1)>\n`` <img src=y onerror=alert(2)> `\n[click](javascript:alert(3)) and [ref]\n\n[ref]: javascript:alert(4)\n\n```js\nconst a = "<b>fine in code</b>"\n```' }],
    }
    const md = toMarkdown(toExportMessages([{ role: 'user', content: 'show me html please', timestamp: 1789756999000 }, row]), {
      title: 'main', sessionKey: 'agent:main:main', agentName: 'main', exportedAt: new Date(1789757100000),
    }, { tools: true, reasoning: true, timestamps: true })
    assertInert(md)
    expect(md).toContain('const a = "<b>fine in code</b>"')
  })
  it('05-SEC: the whole fixture chat exports inert', () => {
    const md = toMarkdown(toExportMessages(x.EXPORT_HISTORY_MESSAGES as unknown[]), {
      title: x.CHAT_TITLE, sessionKey: x.SESSION_KEY, agentName: 'Research', exportedAt: new Date(x.T0),
    }, { tools: true, reasoning: true, timestamps: true })
    assertInert(md)
  })
})

describe('QA 04 · goal errors and retries', () => {
  it.each(Object.entries(g.goalErrors))('04-ERR: %s classifies without falling to generic where the gateway said why', (name, frame) => {
    const cls = classifyGoalError(g.asAppGatewayError(frame as never))
    // Only the genuinely unexpected, plain validation errors and 2026.6.5 answers (the
    // control is gated off there) may be generic.
    if (!/unexpected|invalidParams|startOverride|startInvalid|_2026_6_5/.test(name)) expect(cls, name).not.toBe('generic')
  })
  it('04-ERR: missing write scope and the admin-only thinking patch are scope errors', () => {
    expect(classifyGoalError(g.asAppGatewayError(g.goalErrors.missingWriteScope as never))).toBe('scope')
    expect(classifyGoalError(g.asAppGatewayError(g.goalErrors.thinkingPatchNeedsAdmin as never))).toBe('scope')
  })
  it('04-RETRY: an operation conflict is reissued once, then stops', () => {
    const e = g.asAppGatewayError(g.goalErrors.operationConflict as never)
    expect(goalErrorPolicy(e, { admitting: false, conflict: false }).next).toBe('reissue')
    expect(goalErrorPolicy(e, { admitting: false, conflict: true }).next).toBe('stop')
  })
  it('04-RETRY: a network failure keeps the op for a byte-identical Retry', () => {
    const p = goalErrorPolicy(new Error('Connection closed'), { admitting: false, conflict: false })
    expect(p).toMatchObject({ cls: 'network', next: 'stop', retryable: true })
  })
  it('04-RETRY: the param builders are deterministic, so a stored op resends the same bytes', () => {
    const a = JSON.stringify(buildStartParams(g.SESSION_KEY, g.OBJECTIVE, g.OP_START, g.NOW))
    const b = JSON.stringify(buildStartParams(g.SESSION_KEY, g.OBJECTIVE, g.OP_START, g.NOW))
    expect(a).toBe(b)
    const p1 = JSON.stringify(buildUpdateParams(parseGoal(g.goalActive)!, g.SESSION_KEY, 'pause', {}, g.OP_PAUSE, g.NOW))
    const p2 = JSON.stringify(buildUpdateParams(parseGoal(g.goalActive)!, g.SESSION_KEY, 'pause', {}, g.OP_PAUSE, g.NOW))
    expect(p1).toBe(p2)
  })
  it('04-VAL: the objective is sent NFC with control characters removed', () => {
    const v = validateObjective(g.OBJECTIVE_NFD)
    expect(v.ok && v.value).toBe(g.OBJECTIVE_NFC.trim())
    const c = validateObjective(g.OBJECTIVE_WITH_CONTROL_CHAR)
    expect(c.ok && /[\x0b\x0c]/.test(c.value)).toBe(false)
  })
})
