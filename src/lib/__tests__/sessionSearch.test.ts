import { describe, it, expect } from 'vitest'
import {
  MAX_SEARCH_RESULTS, MAX_SEARCH_SESSION_KEYS,
  buildSearchParams, groupHits, trimSnippet, type SessionSearchHit,
} from '../sessionSearch'

const hit = (over: Partial<SessionSearchHit> = {}): SessionSearchHit => ({
  sessionKey: 'agent:main:main',
  sessionId: 'gen-1',
  messageId: 'm1',
  role: 'assistant',
  timestamp: 1_700_000_000_000,
  snippet: 'hello',
  score: 0.5,
  ...over,
})

describe('buildSearchParams', () => {
  it('always sends sessionKeys', () => {
    // Omitting them makes the gateway fall back to the session key "main", which on a
    // multi-agent gateway fails with "session key \"main\" has no explicit owner".
    // Verified against a live 2026.9.3 gateway.
    const built = buildSearchParams('deploy', ['a', 'b'])
    expect(built?.params.sessionKeys).toEqual(['a', 'b'])
  })

  it('is null when there is nothing to ask', () => {
    expect(buildSearchParams('   ', ['a'])).toBeNull()
    expect(buildSearchParams('deploy', [])).toBeNull()
    // A list of only empty keys is the same as no keys.
    expect(buildSearchParams('deploy', ['', ''])).toBeNull()
  })

  it('trims the query rather than searching for whitespace', () => {
    expect(buildSearchParams('  deploy  ', ['a'])?.params.query).toBe('deploy')
  })

  it('caps sessionKeys at the gateway limit and reports what it skipped', () => {
    // A longer array is a hard INVALID_REQUEST, so this must never be sent.
    const keys = Array.from({ length: 250 }, (_, i) => `k${i}`)
    const built = buildSearchParams('deploy', keys)
    expect(built?.params.sessionKeys).toHaveLength(MAX_SEARCH_SESSION_KEYS)
    expect(built?.searched).toBe(MAX_SEARCH_SESSION_KEYS)
    expect(built?.skipped).toBe(50)
    // Keys arrive most-recent-first, so the newest survive the cap.
    expect(built?.params.sessionKeys[0]).toBe('k0')
  })

  it('deduplicates keys before applying the cap', () => {
    const built = buildSearchParams('deploy', ['a', 'a', 'b'])
    expect(built?.params.sessionKeys).toEqual(['a', 'b'])
    expect(built?.skipped).toBe(0)
  })

  it('clamps limit into the range the gateway accepts', () => {
    expect(buildSearchParams('d', ['a'], 99)?.params.limit).toBe(MAX_SEARCH_RESULTS)
    expect(buildSearchParams('d', ['a'], 0)?.params.limit).toBe(1)
    expect(buildSearchParams('d', ['a'], -5)?.params.limit).toBe(1)
    expect(buildSearchParams('d', ['a'], 3.7)?.params.limit).toBe(3)
  })
})

describe('groupHits', () => {
  it('groups generations of one session together', () => {
    // A session key spans several sessionIds and hits come back from all of them, so
    // grouping by id would split one conversation across several result blocks.
    const groups = groupHits([
      hit({ sessionId: 'gen-2', messageId: 'm1' }),
      hit({ sessionId: 'gen-1', messageId: 'm2' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].hits).toHaveLength(2)
  })

  it('orders sessions by their best-ranked hit', () => {
    const groups = groupHits([
      hit({ sessionKey: 'best', score: 0.9 }),
      hit({ sessionKey: 'other', score: 0.4 }),
      hit({ sessionKey: 'best', score: 0.1 }),
    ])
    expect(groups.map(g => g.sessionKey)).toEqual(['best', 'other'])
  })

  it('is empty for no hits', () => {
    expect(groupHits([])).toEqual([])
  })
})

describe('trimSnippet', () => {
  it('collapses the whitespace a transcript carries', () => {
    expect(trimSnippet('  a\n\n  b  ')).toBe('a b')
  })

  it('caps length with an ellipsis', () => {
    expect(trimSnippet('x'.repeat(300))).toHaveLength(220)
    expect(trimSnippet('x'.repeat(300)).endsWith('…')).toBe(true)
  })

  it('leaves a short snippet alone', () => {
    expect(trimSnippet('short')).toBe('short')
  })
})
