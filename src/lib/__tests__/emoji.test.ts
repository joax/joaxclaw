import { describe, it, expect } from 'vitest'
import { EMOJI, searchEmoji, activeEmojiToken, completedEmojiAt } from '../emoji'

describe('searchEmoji', () => {
  it('ranks an exact code first', () => {
    const hits = searchEmoji('joy')
    expect(hits[0]).toEqual({ code: 'joy', char: '😂' })
  })

  it('prefers prefix matches over substrings', () => {
    const hits = searchEmoji('heart')
    // 'heart' (exact) leads; all prefix hits ('heart_eyes'…) come before pure
    // substrings like 'green_heart'.
    expect(hits[0].code).toBe('heart')
    const prefixIdx = hits.findIndex(h => h.code === 'heartbeat')
    const subIdx = hits.findIndex(h => h.code === 'green_heart')
    if (prefixIdx >= 0 && subIdx >= 0) expect(prefixIdx).toBeLessThan(subIdx)
  })

  it('returns nothing for an empty query and caps results', () => {
    expect(searchEmoji('')).toEqual([])
    expect(searchEmoji('a', 3).length).toBeLessThanOrEqual(3)
  })

  it('maps common aliases to a glyph', () => {
    expect(EMOJI['+1']).toBe('👍')
    expect(EMOJI['thumbsup']).toBe('👍')
  })
})

describe('activeEmojiToken', () => {
  it('detects a token at the caret after a colon', () => {
    const text = 'hello :sm'
    expect(activeEmojiToken(text, text.length)).toEqual({ start: 6, query: 'sm' })
  })

  it('fires at the very start of the input', () => {
    expect(activeEmojiToken(':gr', 3)).toEqual({ start: 0, query: 'gr' })
  })

  it('does not fire on a colon glued to a word (urls, times)', () => {
    expect(activeEmojiToken('http://foo', 8)).toBeNull()
    expect(activeEmojiToken('12:30', 5)).toBeNull()
    expect(activeEmojiToken('note:hi', 7)).toBeNull()
  })

  it('is null with no query or once a closing colon is typed', () => {
    expect(activeEmojiToken('hi :', 4)).toBeNull()
    expect(activeEmojiToken('hi :smile:', 10)).toBeNull()
  })

  it('reads the token relative to the caret, not the end of text', () => {
    // caret sits right after ':sm', with trailing text after it
    expect(activeEmojiToken(':smXYZ', 3)).toEqual({ start: 0, query: 'sm' })
  })
})

describe('completedEmojiAt', () => {
  it('converts a fully-typed shortcode when the closing colon lands', () => {
    const text = 'yay :tada:'
    expect(completedEmojiAt(text, text.length)).toEqual({ start: 4, end: 10, char: '🎉' })
  })

  it('is case-insensitive on the code', () => {
    const text = ':JOY:'
    expect(completedEmojiAt(text, text.length)).toEqual({ start: 0, end: 5, char: '😂' })
  })

  it('returns null for an unknown code or a non-word colon', () => {
    expect(completedEmojiAt(':notanemoji:', 12)).toBeNull()
    expect(completedEmojiAt('a:joy:', 6)).toBeNull() // opening colon glued to a word
    expect(completedEmojiAt('joy:', 4)).toBeNull()   // no opening colon
  })
})
