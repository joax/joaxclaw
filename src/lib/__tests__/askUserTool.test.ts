import { describe, it, expect } from 'vitest'
import {
  isAskUserTool, questionsFromAskUserArgs, questionsFromToolCalls, renderedAsQuestionCard,
} from '../askUserTool'
import type { ToolCall } from '../types'

// The gateway exposes a real `ask_user` tool for the job JoaxClaw's `<ask>` block does,
// and a model given both reaches for the tool. Those calls used to render as a plain
// tool pill, so the buttons never appeared — the feature looked broken. These lock the
// mapping onto the same card, including the shapes models actually emit.

const call = (over: Partial<ToolCall> & { name: string }): ToolCall => ({
  id: over.id ?? 'tc-1', name: over.name, status: over.status ?? 'done', args: over.args,
})

describe('isAskUserTool', () => {
  it('matches the tool however it is spelled', () => {
    for (const n of ['ask_user', 'ask-user', 'askuser', 'AskUser', ' ask_user '])
      expect(isAskUserTool(n), n).toBe(true)
  })
  it('does not match its neighbours', () => {
    for (const n of ['ask', 'user_ask', 'ask_user_question', 'skill_workshop'])
      expect(isAskUserTool(n), n).toBe(false)
  })
})

describe('questionsFromAskUserArgs', () => {
  it('reads the nested questions array', () => {
    const [q] = questionsFromAskUserArgs(JSON.stringify({
      header: 'Publishing Route for Spain',
      questions: [{
        question: 'How are you planning to publish?',
        options: [
          { label: 'Traditional Spanish Publisher', description: 'Planeta, PRH España…' },
          { label: 'Hybrid / Self-Publishing', description: 'Higher royalties, you market it' },
        ],
      }],
    }))
    expect(q.question).toBe('How are you planning to publish?')
    expect(q.header).toBe('Publishing Route for Spain')
    expect(q.options.map(o => o.label)).toEqual(['Traditional Spanish Publisher', 'Hybrid / Self-Publishing'])
    expect(q.multiSelect).toBe(false)
  })

  it('survives `questions` arriving JSON-encoded as a string', () => {
    // Exactly what the reported failure sent.
    const qs = questionsFromAskUserArgs(JSON.stringify({
      questions: JSON.stringify([{ question: 'Pick one?', options: ['A', 'B'] }]),
    }))
    expect(qs).toHaveLength(1)
    expect(qs[0].options.map(o => o.label)).toEqual(['A', 'B'])
  })

  it('accepts the single-question form our own <ask> block uses', () => {
    const [q] = questionsFromAskUserArgs('{"question":"Proceed?","header":"Confirm"}')
    expect(q).toMatchObject({ question: 'Proceed?', header: 'Confirm' })
    expect(q.options.map(o => o.label)).toEqual(['Yes', 'No'])
  })

  it('defaults to Yes / No when no options are given', () => {
    expect(questionsFromAskUserArgs('{"question":"Ship it?"}')[0].options.map(o => o.label))
      .toEqual(['Yes', 'No'])
  })

  it('carries multiSelect and per-question headers', () => {
    const [q] = questionsFromAskUserArgs(JSON.stringify({
      questions: [{ question: 'Which?', header: 'Own', multiSelect: true, options: ['a'] }],
      header: 'Outer',
    }))
    expect(q.multiSelect).toBe(true)
    expect(q.header).toBe('Own')     // its own header wins over the outer one
  })

  it('handles several questions in one call', () => {
    const qs = questionsFromAskUserArgs(JSON.stringify({
      questions: [{ question: 'First?' }, { question: 'Second?' }],
    }))
    expect(qs.map(q => q.question)).toEqual(['First?', 'Second?'])
    expect(new Set(qs.map(q => q.id)).size).toBe(2)
  })

  it('returns nothing rather than guessing', () => {
    expect(questionsFromAskUserArgs(undefined)).toEqual([])
    expect(questionsFromAskUserArgs('not json')).toEqual([])
    expect(questionsFromAskUserArgs('{"questions":[]}')).toEqual([])
    expect(questionsFromAskUserArgs('{"header":"Only a header"}')).toEqual([])
    // Options flattened to siblings of the question — the malformed shape. There is no
    // unambiguous question here, so no card is invented.
    expect(questionsFromAskUserArgs(JSON.stringify({
      questions: [{ label: 'Target publisher type?', description: 'How are you publishing?' }],
    })).length).toBe(1)   // a lone `label` still reads as a question…
    expect(questionsFromAskUserArgs('{"questions":["just a string"]}')).toEqual([])
  })
})

describe('questionsFromToolCalls', () => {
  it('skips a call that failed — nothing was ever asked', () => {
    expect(questionsFromToolCalls([
      call({ name: 'ask_user', status: 'error', args: '{"questions":[{"question":"Pick?"}]}' }),
    ])).toEqual([])
  })

  it('ignores unrelated tools', () => {
    expect(questionsFromToolCalls([call({ name: 'bash', args: '{"command":"ls"}' })])).toEqual([])
    expect(questionsFromToolCalls(undefined)).toEqual([])
  })

  it('namespaces ids by call, so two calls in one message can coexist', () => {
    const qs = questionsFromToolCalls([
      call({ id: 'a', name: 'ask_user', args: '{"question":"One?"}' }),
      call({ id: 'b', name: 'ask_user', args: '{"question":"Two?"}' }),
    ])
    expect(qs.map(q => q.id)).toEqual(['a:t0', 'b:t0'])
  })
})

describe('renderedAsQuestionCard', () => {
  it('is true only when a card actually replaces the pill', () => {
    expect(renderedAsQuestionCard(call({ name: 'ask_user', args: '{"question":"Go?"}' }))).toBe(true)
    expect(renderedAsQuestionCard(call({ name: 'ask_user', status: 'error', args: '{"question":"Go?"}' }))).toBe(false)
    expect(renderedAsQuestionCard(call({ name: 'ask_user', args: 'garbage' }))).toBe(false)
    expect(renderedAsQuestionCard(call({ name: 'bash', args: '{}' }))).toBe(false)
  })
})
