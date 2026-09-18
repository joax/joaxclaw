import { describe, it, expect } from 'vitest'
import {
  parseTask, parseTaskList, taskState, isNeedsYou, kindInfo, orderItems, orderTasks, stripItems,
  dashboardItems, summaryLine, chipLabel, worstTone, taskMatchesSession, fromTask, fromScriptJob,
  scriptState, metaLine, readGatewayError, isStaleCursor, isTaskGone, addHidden, canManageTasks,
  mergeTask, stitchPages, listItems, taskAgents, trayCounts, deliveryLabel, resultText, taskChatKey, STRIP_DONE_MS, STRIP_FAILED_MS, type TaskSummary,
} from '../tasks'
import type { ScriptJob } from '../scriptJobs'

const NOW = 1_800_000_000_000
const MIN = 60_000

const task = (over: Partial<TaskSummary> = {}): TaskSummary => ({
  id: 't1', kind: 'subagent', runtime: 'subagent', status: 'running', title: 'Research', hasTranscript: true,
  sessionKey: 'agent:main:main', createdAt: NOW - 10 * MIN, startedAt: NOW - 10 * MIN, ...over,
})

const job = (over: Partial<ScriptJob> = {}): ScriptJob => ({
  id: 'j1', command: 'npm run build', running: true, done: false, exitCode: null,
  startedAt: NOW - MIN, finishedAt: null, elapsedMs: MIN, sessionKey: 'agent:main:main', ...over,
})

describe('parseTask', () => {
  it('reads number and string timestamps', () => {
    const t = parseTask({ id: 'a', status: 'running', createdAt: 1000, startedAt: '2000', endedAt: '2026-09-18T10:00:00Z' })!
    expect(t.createdAt).toBe(1000)
    expect(t.startedAt).toBe(2000)
    expect(t.endedAt).toBe(Date.parse('2026-09-18T10:00:00Z'))
  })

  it('falls back to "Background task" without a title', () => {
    expect(parseTask({ id: 'a', status: 'queued' })!.title).toBe('Background task')
    expect(parseTask({ id: 'a', status: 'queued', title: '  ' })!.title).toBe('Background task')
  })

  it('keeps unknown status and kind values', () => {
    const t = parseTask({ id: 'a', status: 'paused', kind: 'hologram_generation' })!
    expect(t.status).toBe('paused')
    expect(t.kind).toBe('hologram_generation')
  })

  it('accepts taskId when id is missing, and rejects rows with neither', () => {
    expect(parseTask({ taskId: 'x', status: 'running' })!.id).toBe('x')
    expect(parseTask({ status: 'running' })).toBeNull()
    expect(parseTask(null)).toBeNull()
  })

  it('reads the diff stat and delivery fields', () => {
    const t = parseTask({ id: 'a', status: 'completed', diffStat: { files: 3, added: 120, removed: 8 }, deliveryStatus: 'failed', terminalOutcome: 'blocked' })!
    expect(t.diffStat).toEqual({ files: 3, added: 120, removed: 8 })
    expect(isNeedsYou(t)).toBe(true)
  })

  it('parses a list page and its cursor', () => {
    const r = parseTaskList({ tasks: [{ id: 'a', status: 'running' }, { nope: 1 }], nextCursor: '1.2.3.4.x' })
    expect(r.tasks.map(t => t.id)).toEqual(['a'])
    expect(r.nextCursor).toBe('1.2.3.4.x')
    expect(parseTaskList(undefined).tasks).toEqual([])
  })
})

describe('taskState', () => {
  const cases: [Partial<TaskSummary>, string, string][] = [
    [{ status: 'queued' }, 'Queued', 'working'],
    [{ status: 'running' }, 'Running', 'working'],
    [{ status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'failed' }, 'Needs you', 'needsYou'],
    [{ status: 'completed' }, 'Done', 'done'],
    [{ status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'delivered' }, 'Done', 'done'],
    [{ status: 'failed' }, 'Failed', 'failed'],
    [{ status: 'timed_out' }, 'Timed out', 'failed'],
    [{ status: 'cancelled' }, 'Stopped', 'idle'],
    [{ status: 'on_hold' }, 'On hold', 'idle'],
  ]
  for (const [over, label, tone] of cases) {
    it(`${JSON.stringify(over)} → ${label}`, () => {
      expect(taskState(task(over))).toEqual({ label, tone })
    })
  }
})

describe('isNeedsYou', () => {
  it('is true only for a blocked outcome whose delivery failed', () => {
    expect(isNeedsYou({ terminalOutcome: 'blocked', deliveryStatus: 'failed' })).toBe(true)
    for (const d of ['dismissed', 'pending', 'delivered']) {
      expect(isNeedsYou({ terminalOutcome: 'blocked', deliveryStatus: d })).toBe(false)
    }
    expect(isNeedsYou({ terminalOutcome: 'succeeded', deliveryStatus: 'failed' })).toBe(false)
  })
})

describe('kindInfo', () => {
  const cases: [Partial<TaskSummary>, string][] = [
    [{ kind: 'subagent', runtime: 'subagent' }, 'Subagent'],
    [{ kind: 'exec', runtime: 'cli' }, 'Background command'],
    [{ kind: 'automation_run', runtime: 'cron' }, 'Automation'],
    [{ kind: 'cron', runtime: 'cron' }, 'Automation'],
    [{ kind: 'image_generation' }, 'Image'],
    [{ kind: 'music_generation' }, 'Music'],
    [{ kind: 'video_generation' }, 'Video'],
    [{ kind: 'context_engine_turn_maintenance' }, 'Maintenance'],
    [{ kind: 'acp', runtime: 'acp' }, 'Coding agent'],
    [{ kind: 'cli', runtime: 'cli' }, 'CLI run'],
  ]
  for (const [over, label] of cases) {
    it(`${over.kind} → ${label}`, () => expect(kindInfo(over).label).toBe(label))
  }
  it('falls back to the runtime, then to "Task"', () => {
    expect(kindInfo({ kind: 'mystery', runtime: 'subagent' }).label).toBe('Subagent')
    expect(kindInfo({ kind: 'mystery', runtime: 'other' })).toEqual({ label: 'Task', icon: 'task' })
    expect(kindInfo({})).toEqual({ label: 'Task', icon: 'task' })
  })
})

describe('orderItems', () => {
  it('puts running first (oldest start first), then needs-you, then the rest newest-ended first', () => {
    const tasks = [
      task({ id: 'done-old', status: 'completed', endedAt: NOW - 50 * MIN }),
      task({ id: 'run-new', status: 'running', startedAt: NOW - 1 * MIN }),
      task({ id: 'needs', status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'failed', endedAt: NOW - 90 * MIN }),
      task({ id: 'fail-new', status: 'failed', endedAt: NOW - 2 * MIN }),
      task({ id: 'run-old', status: 'running', startedAt: NOW - 20 * MIN }),
      task({ id: 'queued', status: 'queued', startedAt: undefined, createdAt: NOW - 5 * MIN }),
    ]
    expect(orderTasks(tasks).map(i => i.id)).toEqual(['run-old', 'queued', 'run-new', 'needs', 'fail-new', 'done-old'])
  })

  it('breaks ties by id', () => {
    const tasks = [task({ id: 'b' }), task({ id: 'a' })]
    expect(orderTasks(tasks).map(i => i.id)).toEqual(['a', 'b'])
  })

  it('orders merged scripts with tasks', () => {
    const items = orderItems([fromTask(task({ startedAt: NOW - 30 * MIN })), fromScriptJob(job({ startedAt: NOW - 40 * MIN }))])
    expect(items.map(i => i.key)).toEqual(['script:j1', 'task:t1'])
  })
})

describe('stripItems', () => {
  const opened = NOW - 60 * MIN
  const run = (tasks: TaskSummary[], opts: { jobs?: ReturnType<typeof fromScriptJob>[]; hidden?: string[]; openedAtMs?: number } = {}) =>
    stripItems({ tasks, jobs: opts.jobs ?? [], now: NOW, openedAtMs: opts.openedAtMs ?? opened, hidden: new Set(opts.hidden ?? []) }).map(i => i.id)

  it('keeps completed work for 10 minutes', () => {
    expect(run([task({ status: 'completed', endedAt: NOW - STRIP_DONE_MS + 1000 })], { openedAtMs: NOW })).toEqual(['t1'])
    expect(run([task({ status: 'completed', endedAt: NOW - STRIP_DONE_MS - 1000 })], { openedAtMs: NOW })).toEqual([])
  })

  it('keeps failures for 24 hours', () => {
    expect(run([task({ status: 'failed', endedAt: NOW - STRIP_FAILED_MS + 1000 })], { openedAtMs: NOW })).toEqual(['t1'])
    expect(run([task({ status: 'timed_out', endedAt: NOW - STRIP_FAILED_MS - 1000 })], { openedAtMs: NOW })).toEqual([])
  })

  it('keeps anything that ended while the chat was open, past 10 minutes', () => {
    expect(run([task({ status: 'completed', endedAt: NOW - 30 * MIN })], { openedAtMs: NOW - 45 * MIN })).toEqual(['t1'])
  })

  it('drops hidden items, but never a needs-you item', () => {
    const done = task({ id: 'd', status: 'completed', endedAt: NOW - MIN })
    const needs = task({ id: 'n', status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'failed', endedAt: NOW - 3 * 24 * 60 * MIN })
    expect(run([done, needs], { hidden: ['task:d', 'task:n'] })).toEqual(['n'])
  })

  it('always keeps running and queued items', () => {
    expect(run([task({ status: 'queued', startedAt: undefined }), task({ id: 't2' })], { hidden: ['task:t1'] })).toEqual(['t1', 't2'])
  })

  it('merges script jobs and dedupes them by jobId', () => {
    const j = fromScriptJob(job())
    expect(run([task()], { jobs: [j, fromScriptJob(job({ command: 'dup' }))] })).toEqual(['t1', 'j1'])
    const ids = stripItems({ tasks: [], jobs: [j, j], now: NOW, openedAtMs: opened, hidden: new Set() })
    expect(ids).toHaveLength(1)
  })
})

describe('dashboardItems', () => {
  it('lists running, needs-you and failures from the last day', () => {
    const items = dashboardItems({
      now: NOW,
      tasks: [
        task({ id: 'r' }),
        task({ id: 'n', status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'failed', endedAt: NOW - 3 * 24 * 60 * MIN }),
        task({ id: 'f', status: 'failed', endedAt: NOW - 60 * MIN }),
        task({ id: 'old-f', status: 'failed', endedAt: NOW - STRIP_FAILED_MS - MIN }),
        task({ id: 'd', status: 'completed', endedAt: NOW - MIN }),
      ],
      jobs: [fromScriptJob(job())],
    })
    expect(items.map(i => i.id).sort()).toEqual(['f', 'j1', 'n', 'r'])
  })
})

describe('summaryLine / chipLabel / worstTone', () => {
  const items = [
    fromTask(task({ id: 'a' })),
    fromTask(task({ id: 'b', status: 'queued' })),
    fromTask(task({ id: 'c', status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'failed' })),
    fromTask(task({ id: 'd', status: 'completed', endedAt: NOW })),
    fromTask(task({ id: 'e', status: 'cancelled', endedAt: NOW })),
  ]

  it('leaves out zero parts, in the order running · needs you · failed · done', () => {
    expect(summaryLine(items)).toBe('2 running · 1 needs you · 2 done')
    expect(summaryLine([fromTask(task({ status: 'failed' }))])).toBe('1 failed')
    expect(summaryLine([])).toBe('')
  })

  it('builds the phone chip', () => {
    expect(chipLabel(items)).toBe('Background 2 · 1 ⚠')
    expect(chipLabel([fromTask(task())])).toBe('Background 1')
    expect(chipLabel([fromTask(task({ status: 'completed' }))])).toBe('Background')
  })

  it('ranks failed > needsYou > working > done > idle', () => {
    expect(worstTone(items)).toBe('needsYou')
    expect(worstTone([...items, fromTask(task({ status: 'failed' }))])).toBe('failed')
    expect(worstTone([fromTask(task())])).toBe('working')
    expect(worstTone([fromTask(task({ status: 'completed' }))])).toBe('done')
    expect(worstTone([fromTask(task({ status: 'cancelled' }))])).toBe('idle')
    expect(worstTone([])).toBe('idle')
  })
})

describe('taskMatchesSession', () => {
  it('matches the requester, child and owner sessions', () => {
    const t = { sessionKey: 'agent:main:main', childSessionKey: 'agent:researcher:subagent:x', ownerKey: 'agent:ops:dashboard:1' }
    expect(taskMatchesSession(t, 'agent:main:main')).toBe(true)
    expect(taskMatchesSession(t, 'agent:researcher:subagent:x')).toBe(true)
    expect(taskMatchesSession(t, 'agent:ops:dashboard:1')).toBe(true)
    expect(taskMatchesSession(t, 'AGENT:MAIN:MAIN')).toBe(true)
  })
  it("doesn't match unrelated keys", () => {
    expect(taskMatchesSession({ sessionKey: 'agent:main:main' }, 'agent:main:other')).toBe(false)
    expect(taskMatchesSession({}, 'agent:main:main')).toBe(false)
  })
})

describe('fromScriptJob / scriptState', () => {
  it('maps running, exit 0, exit ≠ 0 and expired', () => {
    expect(scriptState(job(), false)).toEqual({ label: 'Running', tone: 'working' })
    expect(scriptState(job({ running: false, done: true, exitCode: 0, finishedAt: NOW }), false)).toEqual({ label: 'Done', tone: 'done' })
    expect(scriptState(job({ running: false, done: true, exitCode: 2, finishedAt: NOW }), false)).toEqual({ label: 'Failed · exit 2', tone: 'failed' })
    expect(scriptState(job({ running: false, done: true, exitCode: null, error: 'terminated by SIGTERM' }), false)).toEqual({ label: 'Failed', tone: 'failed' })
    expect(scriptState(job(), true)).toEqual({ label: 'Ended', tone: 'idle' })
    expect(scriptState(null, true)).toEqual({ label: 'Ended', tone: 'idle' })
  })

  it('carries the percentage only while running, and an end time once done', () => {
    const r = fromScriptJob(job({ percent: 41 }))
    expect(r).toMatchObject({ key: 'script:j1', source: 'script', active: true, percent: 41, endedAt: undefined })
    expect(r.kind.label).toBe('Script')
    const d = fromScriptJob(job({ running: false, done: true, exitCode: 0, finishedAt: NOW, percent: 100 }))
    expect(d).toMatchObject({ active: false, percent: null, endedAt: NOW })
    const e = fromScriptJob(job(), { expired: true, expiredAt: NOW - 5 })
    expect(e).toMatchObject({ active: false, endedAt: NOW - 5 })
  })
})

describe('metaLine', () => {
  it('lists kind, agent, elapsed, tools, current tool and changes', () => {
    const i = fromTask(task({ agentId: 'researcher', startedAt: NOW - (3 * 60 + 12) * 1000, toolUseCount: 14, lastToolName: 'web_fetch' }))
    expect(metaLine(i, NOW)).toBe('Subagent · researcher · 3m 12s · 14 tools · now: web_fetch')
    const d = fromTask(task({ status: 'completed', agentId: 'researcher', startedAt: NOW - 124_000, endedAt: NOW, lastToolName: 'x', diffStat: { files: 3, added: 120, removed: 8 } }))
    expect(metaLine(d, NOW)).toBe('Subagent · researcher · 2m 04s · +120 −8 in 3 files')
  })
  it('explains a needs-you task instead', () => {
    const n = fromTask(task({ kind: 'automation_run', status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'failed' }))
    expect(metaLine(n, NOW)).toBe("Automation · Completed, but the result couldn't be delivered back")
  })
})

describe('errors and scopes', () => {
  it('reads a structured gateway error', () => {
    const e = Object.assign(new Error('x'), { gatewayError: { code: 'UNAVAILABLE', message: 'Task activity did not stabilize.', retryable: true, retryAfterMs: 250 } })
    expect(readGatewayError(e)).toEqual({ code: 'UNAVAILABLE', message: 'Task activity did not stabilize.', retryAfterMs: 250 })
    expect(readGatewayError(new Error('Not connected'))).toEqual({ message: 'Not connected' })
  })
  it('spots a stale cursor and a missing task', () => {
    expect(isStaleCursor({ code: 'INVALID_REQUEST', message: 'invalid or expired tasks.list cursor; restart pagination without a cursor' })).toBe(true)
    expect(isStaleCursor({ code: 'UNAVAILABLE', message: 'x' })).toBe(false)
    expect(isTaskGone({ message: 'task not found: abc' })).toBe(true)
    expect(isTaskGone({ message: 'Task not found.' })).toBe(true)
  })
  it('needs write or admin to manage tasks', () => {
    expect(canManageTasks(['operator.read'])).toBe(false)
    expect(canManageTasks(['operator.read', 'operator.write'])).toBe(true)
    expect(canManageTasks(['operator.admin'])).toBe(true)
  })
})

describe('mergeTask', () => {
  it('keeps the copy updated later, and carries prompt and result over', () => {
    const older = task({ updatedAt: 100, status: 'running', prompt: 'p', result: 'r' })
    const newer = task({ updatedAt: 200, status: 'completed' })
    expect(mergeTask(undefined, newer)).toBe(newer)
    expect(mergeTask(newer, older)).toBe(newer)
    expect(mergeTask(older, newer)).toMatchObject({ status: 'completed', prompt: 'p', result: 'r' })
  })
})

describe('stitchPages', () => {
  const m = (id: string, text = id) => ({ role: 'assistant', id, content: text })
  it('joins [newest, older…] pages chronologically without the overlap', () => {
    const pages = [[m('c'), m('d', 'd2')], [m('a'), m('b'), m('c')]]
    expect(stitchPages(pages).map(x => (x as { id: string }).id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('keeps the newest copy of a message seen twice, and messages without ids', () => {
    const out = stitchPages([[m('a', 'new'), { role: 'user', content: 'no id' }], [m('a', 'old')]])
    expect(out).toEqual([m('a', 'new'), { role: 'user', content: 'no id' }])
  })
})

describe('trayCounts', () => {
  it('counts running and queued tasks plus running scripts, and needs-you separately', () => {
    const tasks = [
      task({ id: 'a' }), task({ id: 'b', status: 'queued' }), task({ id: 'c', status: 'completed' }),
      task({ id: 'n', status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'failed' }),
    ]
    const jobs = [job(), job({ id: 'j2', running: false, done: true, exitCode: 0 })]
    expect(trayCounts(tasks, jobs)).toEqual({ tasks: 3, needsYou: 1 })
    expect(trayCounts([], [])).toEqual({ tasks: 0, needsYou: 0 })
  })
})

describe('listItems / taskAgents', () => {
  const tasks = [
    task({ id: 'r', agentId: 'researcher' }),
    task({ id: 'n', agentId: 'main', status: 'completed', terminalOutcome: 'blocked', deliveryStatus: 'failed', endedAt: NOW }),
    task({ id: 'f', agentId: 'main', status: 'timed_out', endedAt: NOW }),
    task({ id: 'd', agentId: 'researcher', status: 'completed', endedAt: NOW }),
  ]
  const jobs = [fromScriptJob(job())]
  const ids = (filter: 'running' | 'needsYou' | 'failed' | 'all', agentId?: string) =>
    listItems({ tasks, jobs, filter, agentId }).map(i => i.id)

  it('filters by tab', () => {
    expect(ids('running')).toEqual(['r', 'j1'])
    expect(ids('needsYou')).toEqual(['n'])
    expect(ids('failed')).toEqual(['f'])
    expect(ids('all')).toHaveLength(5)
  })
  it('filters by agent, which leaves scripts out', () => {
    expect(ids('all', 'researcher').sort()).toEqual(['d', 'r'])
    expect(taskAgents(tasks)).toEqual(['main', 'researcher'])
  })
})

describe('drawer text', () => {
  it('labels every delivery status', () => {
    expect(['pending', 'delivered', 'session_queued', 'failed', 'dismissed', 'parent_missing', 'not_applicable', undefined].map(deliveryLabel))
      .toEqual(['Pending', 'Delivered', 'Queued in chat', "Couldn't deliver", 'Dismissed', 'Chat is gone', '—', '—'])
  })
  it('picks the result, then the terminal summary, then progress', () => {
    expect(resultText({ result: 'r', terminalSummary: 't' })).toBe('r')
    expect(resultText({ terminalSummary: 't', progressSummary: 'p' })).toBe('t')
    expect(resultText({ progressSummary: 'p' })).toBe('p')
    expect(resultText({})).toBeUndefined()
  })
  it("opens a subagent's own chat, otherwise the requester's", () => {
    expect(taskChatKey({ runtime: 'subagent', childSessionKey: 'c', sessionKey: 's' })).toBe('c')
    expect(taskChatKey({ runtime: 'cli', childSessionKey: 'c', sessionKey: 's' })).toBe('s')
    expect(taskChatKey({ runtime: 'subagent', sessionKey: 's' })).toBe('s')
  })
})

describe('addHidden', () => {
  it('adds per session and caps the total', () => {
    let m: Record<string, string[]> = {}
    m = addHidden(m, 's1', 'a', 3)
    m = addHidden(m, 's1', 'a', 3)
    expect(m).toEqual({ s1: ['a'] })
    m = addHidden(m, 's1', 'b', 3)
    m = addHidden(m, 's2', 'c', 3)
    m = addHidden(m, 's2', 'd', 3)
    expect(Object.values(m).flat()).toHaveLength(3)
    expect(m.s2).toContain('d')
  })
})
