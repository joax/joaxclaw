import { describe, it, expect } from 'vitest'
import { parseJobId, collectJobRefs, jobRefsForSession, type ScriptJob } from '../scriptJobs'
import type { ChatMessage, ToolCall } from '../types'

describe('parseJobId', () => {
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

  it('extracts the jobId from a script_start result', () => {
    const result = `Script started in the background.\njobId: ${uuid}\nPoll script_status…`
    expect(parseJobId(result)).toBe(uuid)
  })

  it('is case-insensitive on the label and hex', () => {
    expect(parseJobId(`JOBID: ${uuid.toUpperCase()}`)).toBe(uuid.toUpperCase())
  })

  it('returns null when there is no jobId', () => {
    expect(parseJobId('Could not start script: ENOENT')).toBeNull()
    expect(parseJobId('')).toBeNull()
    expect(parseJobId(undefined)).toBeNull()
  })

  it('ignores a malformed (non-uuid) id', () => {
    expect(parseJobId('jobId: not-a-uuid')).toBeNull()
  })
})

describe('collectJobRefs', () => {
  const id = (n: number) => `3f2504e0-4f89-41d3-9a0c-0305e82c330${n}`
  const call = (over: Partial<ToolCall>): ToolCall =>
    ({ id: 'c1', name: 'script_start', status: 'done', ...over })
  const msg = (over: Partial<ChatMessage>): ChatMessage =>
    ({ id: 'm1', sessionId: 's', role: 'assistant', content: '', createdAt: '', ...over })

  it('collects script_start jobs with their command, oldest first', () => {
    const refs = collectJobRefs([
      msg({ id: 'm1', toolCalls: [call({ args: '{"command":"./build.sh"}', result: `jobId: ${id(1)}` })] }),
      msg({ id: 'm2', toolCalls: [call({ id: 'c2', args: '{"command":"./test.sh"}', result: `jobId: ${id(2)}` })] }),
    ])
    expect(refs).toEqual([
      { jobId: id(1), command: './build.sh' },
      { jobId: id(2), command: './test.sh' },
    ])
  })

  it('finds jobs started inside sub-agent threads', () => {
    const refs = collectJobRefs([
      msg({
        threads: [{
          id: 't1', status: 'running', content: '', startedAt: '',
          toolCalls: [call({ args: '{"command":"./sub.sh"}', result: `jobId: ${id(3)}` })],
        }],
      }),
    ])
    expect(refs).toEqual([{ jobId: id(3), command: './sub.sh' }])
  })

  it('dedupes a job referenced twice and skips other tools / pending starts', () => {
    const refs = collectJobRefs([
      msg({ toolCalls: [
        call({ args: '{"command":"./build.sh"}', result: `jobId: ${id(1)}` }),
        call({ id: 'c2', result: `jobId: ${id(1)}` }),                        // same job again
        call({ id: 'c3', name: 'bash', result: `jobId: ${id(2)}` }),          // not a script_start
        call({ id: 'c4', status: 'running' }),                                // no jobId yet
      ] }),
    ])
    expect(refs).toEqual([{ jobId: id(1), command: './build.sh' }])
  })

  it('recovers a session\'s running jobs from the host list', () => {
    const job = (over: Partial<ScriptJob>): ScriptJob =>
      ({ id: id(1), command: './build.sh', running: true, done: false, exitCode: null, startedAt: 0, finishedAt: null, elapsedMs: 0, ...over })

    const jobs = [
      job({ id: id(1), sessionKey: 'main:chat' }),
      job({ id: id(2), sessionKey: 'main:other', command: './other.sh' }),          // another chat
      job({ id: id(3), sessionKey: 'main:chat', running: false, done: true }),      // already finished
      job({ id: id(4) }),                                                           // pre-0.11.5 plugin
    ]
    expect(jobRefsForSession(jobs, 'main:chat')).toEqual([{ jobId: id(1), command: './build.sh' }])
  })

  it('tolerates unparseable args and messages with no tool calls', () => {
    const refs = collectJobRefs([
      msg({ toolCalls: [call({ args: 'not json', result: `jobId: ${id(4)}` })] }),
      msg({ id: 'm2', role: 'user', content: 'hi' }),
    ])
    expect(refs).toEqual([{ jobId: id(4), command: undefined }])
  })
})
