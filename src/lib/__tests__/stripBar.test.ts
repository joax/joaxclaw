import { describe, it, expect } from 'vitest'
import { nextOpenStrip } from '../stripBar'

// One strip open at a time in a StripBar.
describe('nextOpenStrip', () => {
  it('opens a strip from nothing', () => {
    expect(nextOpenStrip(null, { type: 'toggle', id: 'a' })).toBe('a')
  })
  it('opening another closes the open one', () => {
    expect(nextOpenStrip('a', { type: 'toggle', id: 'b' })).toBe('b')
  })
  it('toggling the open one closes it', () => {
    expect(nextOpenStrip('a', { type: 'toggle', id: 'a' })).toBeNull()
  })
  it('hiding the open strip closes it; hiding another leaves it open', () => {
    expect(nextOpenStrip('a', { type: 'hide', id: 'a' })).toBeNull()
    expect(nextOpenStrip('a', { type: 'hide', id: 'b' })).toBe('a')
  })
  it('closeAll closes everything', () => {
    expect(nextOpenStrip('a', { type: 'closeAll' })).toBeNull()
  })
})
