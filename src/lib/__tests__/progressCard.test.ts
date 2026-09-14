import { describe, it, expect } from 'vitest'
import { parseProgressCard, isSameSession, summarizeProgressCard, type ProgressCard } from '../progressCard'

// The gateway's progress card (the `progress_card` tool, OpenClaw 2026.8+) lives next to
// the session, not in the transcript, so JoaxClaw showed nothing of it. These cover
// reading the wire shape, matching the `progressCard.changed` event to a chat, and
// boiling a card down to the one-line strip shown above the thread.

const card = (over: Partial<ProgressCard>): ProgressCard => ({ sessionKey: 'agent:main:dashboard:abc', revision: 1, ...over })

describe('parseProgressCard', () => {
  it('reads the gateway card shape', () => {
    const wire = { sessionKey: 'agent:main:x', revision: 4, updatedAt: 10, markdown: 'note', steps: [{ step: 'a', status: 'completed' }] }
    expect(parseProgressCard(wire)).toEqual(wire)
  })

  it('is null for no card, a cleared card, or junk', () => {
    expect(parseProgressCard(null)).toBeNull()
    expect(parseProgressCard({ sessionKey: 'k', revision: 3 })).toBeNull()
    expect(parseProgressCard({ sessionKey: 'k', revision: 3, markdown: '   ' })).toBeNull()
    expect(parseProgressCard({ revision: 'x', markdown: 'm' })).toBeNull()
    expect(parseProgressCard([])).toBeNull()
  })

  it('drops malformed steps rather than the whole card', () => {
    const parsed = parseProgressCard({
      revision: 1,
      steps: [{ step: 'ok', status: 'pending' }, { step: 'bad', status: 'done' }, { step: '', status: 'pending' }, 7],
    })
    expect(parsed?.steps).toEqual([{ step: 'ok', status: 'pending' }])
  })
})

describe('isSameSession', () => {
  it('matches agent-scoped keys exactly', () => {
    expect(isSameSession('agent:main:dashboard:abc', 'agent:main:dashboard:abc')).toBe(true)
    expect(isSameSession('agent:main:dashboard:abc', 'agent:main:dashboard:abd')).toBe(false)
  })

  it('matches a bare local key against its agent-prefixed scope key', () => {
    expect(isSameSession('agent:main:my-chat', 'my-chat')).toBe(true)
    expect(isSameSession('agent:main:other', 'my-chat')).toBe(false)
  })

  it('does not strip the prefix off a key that is already agent-scoped', () => {
    expect(isSameSession('agent:ops:agent:main:x', 'agent:main:x')).toBe(false)
  })
})

describe('summarizeProgressCard', () => {
  const plan = [
    { step: 'Inspect the failing route', status: 'completed' as const },
    { step: 'Repair the session owner', status: 'in_progress' as const },
    { step: 'Run focused verification', status: 'pending' as const },
  ]

  it('a plan: headline is the step in progress, measured by completed steps', () => {
    const s = summarizeProgressCard(card({ steps: plan }))
    expect(s.headline).toBe('Repair the session owner')
    expect(s.count).toBe('1/3')
    expect(s.track?.pct).toBeCloseTo(33.33, 1)
    expect(s.done).toBe(false)
    expect(s.note).toBe('')
  })

  it('a finished plan reads as done', () => {
    const s = summarizeProgressCard(card({ steps: plan.map(p => ({ ...p, status: 'completed' as const })) }))
    expect(s).toMatchObject({ headline: 'All steps done', count: '3/3', done: true })
  })

  it('a plan not started names the next step', () => {
    const s = summarizeProgressCard(card({ steps: [{ step: 'Clone the repo', status: 'pending' }] }))
    expect(s.headline).toBe('Next: Clone the repo')
  })

  it("a note with a pinned bar: the bar's label, value and count, and the bar leaves the note", () => {
    const s = summarizeProgressCard(card({
      markdown: '<progress aria-label="Tests · 3/7" value="3" max="7"></progress>\n\nTests are running.',
    }))
    expect(s.headline).toBe('Tests · 3/7')
    expect(s.count).toBe('3/7')
    expect(s.track?.pct).toBeCloseTo((3 / 7) * 100, 5)
    expect(s.note).toBe('Tests are running.')
    expect(s.done).toBe(false)
  })

  it('the bar is the measure even alongside a plan; the headline stays the current step', () => {
    const s = summarizeProgressCard(card({ steps: plan, markdown: '<progress aria-label="CI · 4/6" value="4" max="6"></progress>' }))
    expect(s.headline).toBe('Repair the session owner')
    expect(s.count).toBe('4/6')
    expect(s.steps).toHaveLength(3)
  })

  it('a bar with no value is indeterminate', () => {
    const s = summarizeProgressCard(card({ markdown: '<progress aria-label="Indexing"></progress>' }))
    expect(s.track).toEqual({ pct: null })
    expect(s.count).toBeNull()
  })

  it('a note alone: no bar, and its first line as the headline', () => {
    const s = summarizeProgressCard(card({ markdown: '**Blocked** on review from `infra`\n\nMore detail.' }))
    expect(s.track).toBeUndefined()
    expect(s.count).toBeNull()
    expect(s.headline).toBe('Blocked on review from infra')
  })

  it('ignores a bar that sits inside a code block', () => {
    const s = summarizeProgressCard(card({ markdown: '```html\n<progress value="1" max="2"></progress>\n```' }))
    expect(s.track).toBeUndefined()
  })
})
