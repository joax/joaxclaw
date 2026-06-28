import { describe, it, expect } from 'vitest'
import { highlightLine, langSupported } from '../diffHighlight'

describe('highlightLine', () => {
  it('tokenizes a known language and preserves the exact text', () => {
    const line = 'const x = 1 // hi'
    const toks = highlightLine(line, 'typescript')
    expect(toks).not.toBeNull()
    // The reassembled token values must equal the input — no text dropped or duplicated.
    expect(toks!.map(t => t.value).join('')).toBe(line)
    // …and at least one token carries a Prism class (e.g. the `const` keyword).
    expect(toks!.some(t => /\bkeyword\b/.test(t.className ?? ''))).toBe(true)
  })

  it('preserves text for a few more languages', () => {
    for (const [code, lang] of [['def f(): pass', 'python'], ['{"a": 1}', 'json'], ['echo hi', 'bash']] as const) {
      const toks = highlightLine(code, lang)
      expect(toks!.map(t => t.value).join('')).toBe(code)
    }
  })

  it('returns null for an unknown language (caller falls back to plain text)', () => {
    expect(highlightLine('whatever', 'klingon')).toBeNull()
    expect(highlightLine('whatever', undefined)).toBeNull()
    expect(langSupported('klingon')).toBe(false)
    expect(langSupported('typescript')).toBe(true)
  })
})
