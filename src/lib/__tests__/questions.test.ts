import { describe, it, expect } from 'vitest'
import {
  isComplete, isPending, isRenderable, pendingForSession, resolveParams, toAskQuestions,
  type QuestionRecord,
} from '../questions'

const NOW = 1_700_000_000_000

function record(over: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: 'q-1',
    questions: [{
      questionId: 'db',
      question: 'Which database?',
      header: 'Database',
      options: [{ label: 'PostgreSQL' }, { label: 'SQLite', description: 'File-based' }],
    }],
    sessionKey: 'main',
    createdAtMs: NOW - 1000,
    expiresAtMs: NOW + 60_000,
    status: 'pending',
    ...over,
  }
}

describe('isPending', () => {
  it('is true only while pending and unexpired', () => {
    expect(isPending(record(), NOW)).toBe(true)
    expect(isPending(record({ status: 'answered' }), NOW)).toBe(false)
    expect(isPending(record({ status: 'cancelled' }), NOW)).toBe(false)
    expect(isPending(record({ expiresAtMs: NOW - 1 }), NOW)).toBe(false)
  })
})

describe('isRenderable', () => {
  it('accepts an ordinary option-based question', () => {
    expect(isRenderable(record())).toBe(true)
  })

  it('refuses a secret prompt — the card has no masked input', () => {
    expect(isRenderable(record({
      questions: [{ questionId: 'key', question: 'API key?', isSecret: true, options: [{ label: 'x' }] }],
    }))).toBe(false)
  })

  it('refuses a question with no options, which would render as an empty card', () => {
    expect(isRenderable(record({ questions: [{ questionId: 'free', question: 'Anything?' }] }))).toBe(false)
  })
})

describe('pendingForSession', () => {
  it('picks the oldest pending question for that session', () => {
    const older = record({ id: 'old', createdAtMs: NOW - 5000 })
    const newer = record({ id: 'new', createdAtMs: NOW - 100 })
    expect(pendingForSession([newer, older], 'main', NOW)?.id).toBe('old')
  })

  it('ignores other sessions', () => {
    expect(pendingForSession([record({ sessionKey: 'other' })], 'main', NOW)).toBeUndefined()
  })

  it('ignores gateway-wide questions with no session of their own', () => {
    // A channel turn or automation asked this; it belongs to no conversation here.
    expect(pendingForSession([record({ sessionKey: undefined })], 'main', NOW)).toBeUndefined()
  })

  it('returns nothing without an active session', () => {
    expect(pendingForSession([record()], undefined, NOW)).toBeUndefined()
  })
})

describe('toAskQuestions', () => {
  it('keys the card by questionId, since that is what answers are filed under', () => {
    const [q] = toAskQuestions(record())
    expect(q.id).toBe('db')
    expect(q.header).toBe('Database')
    expect(q.multiSelect).toBe(false)     // optional on the wire, required on the card
    expect(q.options).toHaveLength(2)
  })

  it('omits an absent header rather than passing undefined through', () => {
    const [q] = toAskQuestions(record({
      questions: [{ questionId: 'x', question: 'Pick', options: [{ label: 'a' }] }],
    }))
    expect('header' in q).toBe(false)
  })
})

describe('isComplete / resolveParams', () => {
  const multi = record({
    questions: [
      { questionId: 'db', question: 'Which database?', options: [{ label: 'PostgreSQL' }] },
      { questionId: 'orm', question: 'Which ORM?', options: [{ label: 'Prisma' }] },
    ],
  })

  it('holds the resolve until every question has an answer', () => {
    // The gateway resolves a record in one call, so a partial answer must not send.
    expect(isComplete(multi, { db: ['PostgreSQL'] })).toBe(false)
    expect(isComplete(multi, { db: ['PostgreSQL'], orm: ['Prisma'] })).toBe(true)
  })

  it('treats an empty selection as unanswered', () => {
    expect(isComplete(record(), { db: [] })).toBe(false)
  })

  it('builds the double-nested payload the method expects', () => {
    expect(resolveParams(record(), { db: ['SQLite'] })).toEqual({
      id: 'q-1',
      answers: { answers: { db: ['SQLite'] } },
    })
  })

  it('drops answers for questions not in the record', () => {
    // The schema is closed; a stray key is a hard INVALID_REQUEST.
    const params = resolveParams(record(), { db: ['SQLite'], stale: ['nope'] })
    expect(Object.keys(params.answers.answers)).toEqual(['db'])
  })

  it('carries every selected label for a multi-select', () => {
    const params = resolveParams(record(), { db: ['PostgreSQL', 'SQLite'] })
    expect(params.answers.answers.db).toEqual(['PostgreSQL', 'SQLite'])
  })
})
