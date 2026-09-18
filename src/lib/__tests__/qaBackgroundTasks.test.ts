// QA (sprint 2026.9, PRD 03): push deep links against paths produced by the gateway's own
// buildControlUiSessionPath (2026.9.4, exactKey as the push sender uses it), upsert merging,
// the error forms tasks.* send, and the tray counts.
// Checklist: docs/qa/sprint-2026-9/03-background-tasks.md
import { describe, expect, it } from 'vitest'
import { pushToNavigate, sessionFromControlUiPath } from '../webPush'
import { cancelMessage, isTaskGone, mergeTask, parseTask, readGatewayError, trayCounts } from '../tasks'
import * as f from './fixtures/sprint/backgroundTasks'

// Generated with dist/session-key-PQkfotIJ.mjs buildControlUiSessionPath({ namespace: 'chat',
// sessionKey, mainKey, exactKey: true }).slice(1), as dist/server-start-DzfvczE1.mjs:2093 does.
const GATEWAY_PATHS: { sessionKey: string; mainKey: string; path: string }[] = [
  { sessionKey: 'agent:main:main', mainKey: 'main', path: 'chat/main' },
  { sessionKey: 'agent:ops:home', mainKey: 'home', path: 'chat/ops' },
  { sessionKey: 'agent:main:dashboard:39811296-b025-4a04-bead-1460681f18f4', mainKey: 'main', path: 'chat/main/dashboard/39811296-b025-4a04-bead-1460681f18f4' },
  { sessionKey: 'agent:main:subagent:5b7e0c1d-2f7a-4f39-8f0e-1d3c9b0a7e21', mainKey: 'main', path: 'chat/main/subagent/5b7e0c1d-2f7a-4f39-8f0e-1d3c9b0a7e21' },
  { sessionKey: 'agent:main:qa-bg', mainKey: 'main', path: 'chat/main/qa-bg' },
  { sessionKey: 'agent:main:4f1c2a9b', mainKey: 'main', path: 'chat/main/~key/4f1c2a9b' },
  { sessionKey: 'agent:main:new', mainKey: 'main', path: 'chat/main/new' },
  { sessionKey: 'agent:main:.', mainKey: 'main', path: 'chat/main/~dot' },
  { sessionKey: 'agent:main:v1.2:notes', mainKey: 'main', path: 'chat/main/v1%2E2/notes' },
  { sessionKey: 'agent:main:~tilde:x', mainKey: 'main', path: 'chat/main/~~tilde/x' },
  { sessionKey: 'agent:main:slack:C0123:thread:1789.001', mainKey: 'main', path: 'chat/main/slack/C0123/thread/1789%2E001' },
  { sessionKey: 'agent:research-bot:telegram:direct:12345', mainKey: 'main', path: 'chat/research-bot/telegram/direct/12345' },
  { sessionKey: 'agent:main:a b/c?d#e', mainKey: 'main', path: 'chat/main/a%20b%2Fc%3Fd%23e' },
]

describe('QA 03 · push deep links from the gateway\'s own paths', () => {
  it.each(GATEWAY_PATHS.map(c => [c.path, c] as const))('%s', (_, c) => {
    expect(sessionFromControlUiPath(c.path, c.mainKey)?.sessionKey).toBe(c.sessionKey)
  })
  it('03-PUSH: a main session names its agent, so the caller can resolve a custom mainKey', () => {
    expect(sessionFromControlUiPath('chat/ops')).toEqual({ sessionKey: 'agent:ops:main', mainOf: 'ops' })
  })
  it('03-PUSH: the relative url with the #gatewayUrl fragment, plus the task tag, opens the chat and the task', () => {
    const nav = pushToNavigate({ url: 'chat/main/qa-bg#gatewayUrl=wss%3A%2F%2Fgw.example.ts.net', tag: 'openclaw-task-failed-6c0e' })
    expect(nav).toMatchObject({ section: 'chat', sessionKey: 'agent:main:qa-bg', taskId: '6c0e' })
  })
  it('03-PUSH: a task with no session ("tasks") opens just the drawer; other categories\' "sessions" fallback is ignored', () => {
    expect(pushToNavigate({ url: 'tasks', tag: 'openclaw-task-failed-abc' })).toEqual({ taskId: 'abc' })
    expect(pushToNavigate({ url: 'sessions' })).toBeUndefined()
  })
  it('03-PUSH: every fixture expectation that names a session or a task routes to it', () => {
    for (const { input, expected } of f.PUSH_NAV_EXPECTATIONS) {
      const nav = pushToNavigate(input)
      if (!expected) { expect(nav, JSON.stringify(input)).toBeUndefined(); continue }
      if (expected.sessionKey) expect(nav?.sessionKey, JSON.stringify(input)).toBe(expected.sessionKey)
      if (expected.taskId) expect(nav?.taskId, JSON.stringify(input)).toBe(expected.taskId)
    }
  })
})

describe('QA 03 · tasks', () => {
  it('03-MERGE: an upsert (no prompt/result) keeps what tasks.get fetched; an older copy never wins', () => {
    const full = parseTask({ ...f.TASK_SUBAGENT_RUNNING, prompt: 'Compare the three pricing pages', result: 'Page B is cheapest' })!
    const upsert = parseTask({ ...f.TASK_SUBAGENT_RUNNING, updatedAt: (full.updatedAt ?? 0) + 1000, progressSummary: 'Reading page 3' })!
    const merged = mergeTask(full, upsert)
    expect(merged.prompt).toBe('Compare the three pricing pages')
    expect(merged.result).toBe('Page B is cheapest')
    const stale = parseTask({ ...f.TASK_SUBAGENT_RUNNING, updatedAt: (full.updatedAt ?? 0) - 1000 })!
    expect(mergeTask(merged, stale)).toBe(merged)
  })
  it('03-ERR: both not-found forms mean the task is gone; UNAVAILABLE on history does not', () => {
    const e = (x: unknown) => readGatewayError(Object.assign(new Error('x'), { gatewayError: x }))
    expect(isTaskGone(e(f.ERR_GET_NOT_FOUND))).toBe(true)
    expect(isTaskGone(e(f.ERR_HISTORY_NOT_FOUND))).toBe(true)
    expect(isTaskGone(e(f.ERR_HISTORY_UNAVAILABLE))).toBe(false)
  })
  it('03-CANCEL: a cancel refused without a reason still says something useful', () => {
    expect(cancelMessage(f.CANCEL_DENIED_NO_REASON)).toMatch(/Couldn't stop it: .+/)
    expect(cancelMessage(f.CANCEL_OK)).toBeNull()
  })
  it('03-TRAY: running tasks and running scripts count; needs-you counts separately', () => {
    const tasks = [f.TASK_SUBAGENT_RUNNING, f.TASK_EXEC_QUEUED, f.TASK_NEEDS_YOU, f.TASK_SUBAGENT_DONE].map(t => parseTask(t)!)
    const counts = trayCounts(tasks, [f.JOB_RUNNING_PERCENT, f.JOB_DONE_OK])
    expect(counts.tasks).toBe(3)
    expect(counts.needsYou).toBe(1)
  })
})
