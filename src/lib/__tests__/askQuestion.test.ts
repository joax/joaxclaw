import { describe, it, expect } from 'vitest'
import { parseAskBlocks } from '../askQuestion'

describe('parseAskBlocks', () => {
  it('parses a single-select question with object options', () => {
    const content = 'Let me confirm one thing.\n<ask>\n{ "question": "Which DB?", "header": "Database", "options": [ { "label": "Postgres", "description": "robust" }, { "label": "SQLite" } ] }\n</ask>'
    const { questions, text } = parseAskBlocks(content)
    expect(text).toBe('Let me confirm one thing.')
    expect(questions).toHaveLength(1)
    const q = questions[0]
    expect(q.question).toBe('Which DB?')
    expect(q.header).toBe('Database')
    expect(q.multiSelect).toBe(false)
    expect(q.options).toEqual([
      { label: 'Postgres', description: 'robust' },
      { label: 'SQLite', description: undefined },
    ])
  })

  it('accepts string-array options', () => {
    const { questions } = parseAskBlocks('<ask>{ "question": "Pick", "options": ["A", "B", "C"] }</ask>')
    expect(questions[0].options.map(o => o.label)).toEqual(['A', 'B', 'C'])
  })

  it('defaults to Yes / No when options are omitted', () => {
    const { questions } = parseAskBlocks('<ask>{ "question": "Proceed?" }</ask>')
    expect(questions[0].options).toEqual([{ label: 'Yes' }, { label: 'No' }])
  })

  it('honours multiSelect', () => {
    const { questions } = parseAskBlocks('<ask>{ "question": "Which?", "multiSelect": true, "options": ["x","y"] }</ask>')
    expect(questions[0].multiSelect).toBe(true)
  })

  it('drops malformed blocks silently (bad JSON)', () => {
    const { questions, text } = parseAskBlocks('before <ask>{ not json }</ask> after')
    expect(questions).toHaveLength(0)
    expect(text).toBe('before  after')
  })

  it('drops blocks with no question', () => {
    const { questions } = parseAskBlocks('<ask>{ "options": ["a"] }</ask>')
    expect(questions).toHaveLength(0)
  })

  it('parses multiple independent blocks', () => {
    const { questions } = parseAskBlocks('<ask>{ "question": "One?" }</ask>\n<ask>{ "question": "Two?" }</ask>')
    expect(questions.map(q => q.question)).toEqual(['One?', 'Two?'])
    expect(questions.map(q => q.id)).toEqual(['q0', 'q1'])
  })

  it('hides an unclosed trailing block while streaming', () => {
    const partial = 'Working on it.\n<ask>\n{ "question": "Which'
    expect(parseAskBlocks(partial, { streaming: true }).text).toBe('Working on it.')
    // Without the streaming flag the partial tag is left as-is (nothing to remove yet)
    expect(parseAskBlocks(partial).questions).toHaveLength(0)
  })

  it('assigns positional ids and trims surrounding whitespace', () => {
    const { questions, text } = parseAskBlocks('\n\n<ask>{ "question": "Only?" }</ask>\n\n')
    expect(text).toBe('')
    expect(questions[0].id).toBe('q0')
  })
})
