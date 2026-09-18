import { describe, it, expect } from 'vitest'
import { toneColor, toneTint } from '../stateTone'

// One mapping from state to colour, so "running" is the same colour in the chat list,
// Sessions, strips and pills (it used to be green in some places and amber in others).

describe('toneColor', () => {
  it('maps each state to its token', () => {
    expect(toneColor('working')).toBe('var(--accent)')
    expect(toneColor('needsYou')).toBe('var(--warning)')
    expect(toneColor('failed')).toBe('var(--danger)')
    expect(toneColor('done')).toBe('var(--success)')
    expect(toneColor('idle')).toBe('var(--text-secondary)')
  })

  it('reads anything unrecognised as idle', () => {
    expect(toneColor('running')).toBe('var(--text-secondary)')
    expect(toneColor('')).toBe('var(--text-secondary)')
  })
})

describe('toneTint', () => {
  it('tints at 13% over transparent by default', () => {
    expect(toneTint('working')).toBe('color-mix(in srgb, var(--accent) 13%, transparent)')
  })

  it('takes a percentage and a base', () => {
    expect(toneTint('failed', 20, 'var(--bg-surface)')).toBe('color-mix(in srgb, var(--danger) 20%, var(--bg-surface))')
  })
})
