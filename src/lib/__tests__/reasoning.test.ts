import { describe, it, expect } from 'vitest'
import { extractThinkTags, fmtThoughtDuration } from '../reasoning'

describe('extractThinkTags', () => {
  it('separates a closed <think> block from the answer', () => {
    const r = extractThinkTags('<think>let me work it out</think>The answer is 391.')
    expect(r.thinking).toBe('let me work it out')
    expect(r.text).toBe('The answer is 391.')
  })

  it('handles the other reasoning tag names', () => {
    for (const tag of ['thinking', 'reasoning', 'thought']) {
      const r = extractThinkTags(`<${tag}>pondering</${tag}>done`)
      expect(r.thinking).toBe('pondering')
      expect(r.text).toBe('done')
    }
  })

  it('streams an open tag before its close arrives (reasoning visible, no answer yet)', () => {
    const r = extractThinkTags('<think>still reasoning about the problem')
    expect(r.thinking).toBe('still reasoning about the problem')
    expect(r.text).toBe('')
  })

  it('strips a partial opening tag cut across deltas', () => {
    expect(extractThinkTags('answer so far <th').text).toBe('answer so far')
    expect(extractThinkTags('answer so far <').text).toBe('answer so far')
  })

  it('leaves normal content and unrelated tags untouched', () => {
    expect(extractThinkTags('no tags here').text).toBe('no tags here')
    expect(extractThinkTags('use the <details> element').text).toBe('use the <details> element')
    expect(extractThinkTags('compare a < b and c > d').text).toBe('compare a < b and c > d')
    expect(extractThinkTags('plain answer').thinking).toBe('')
  })

  it('collects multiple closed blocks', () => {
    const r = extractThinkTags('<think>one</think>mid<think>two</think>end')
    expect(r.thinking).toBe('one\n\ntwo')
    expect(r.text).toBe('midend')
  })
})

describe('fmtThoughtDuration', () => {
  it('formats sub-second, seconds, and rounded values', () => {
    expect(fmtThoughtDuration(400)).toBe('<1s')
    expect(fmtThoughtDuration(6200)).toBe('6.2s')
    expect(fmtThoughtDuration(12400)).toBe('12s')
  })
})
