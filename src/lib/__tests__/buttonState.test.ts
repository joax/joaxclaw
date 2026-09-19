import { describe, it, expect, vi } from 'vitest'
import { buttonAriaState, guardedClick, isButtonInert } from '../buttonState'

// The shared Btn: a disabled or loading button is announced as unavailable and does
// nothing when activated, by mouse or keyboard (both reach it as one click).

const click = () => ({ preventDefault: vi.fn() })

describe('buttonAriaState', () => {
  it('says nothing for a usable button', () => {
    expect(buttonAriaState({})).toEqual({})
    expect(buttonAriaState({ disabled: false, loading: false })).toEqual({})
  })

  it('marks a disabled button aria-disabled (QA: "Join" was announced as enabled)', () => {
    expect(buttonAriaState({ disabled: true })).toEqual({ 'aria-disabled': true })
  })

  it('marks a loading button both unavailable and busy', () => {
    expect(buttonAriaState({ loading: true })).toEqual({ 'aria-disabled': true, 'aria-busy': true })
    expect(buttonAriaState({ disabled: true, loading: true })).toEqual({ 'aria-disabled': true, 'aria-busy': true })
  })
})

describe('guardedClick', () => {
  it('runs the action on a usable button', () => {
    const onClick = vi.fn(), e = click()
    guardedClick({}, onClick)(e)
    expect(onClick).toHaveBeenCalledOnce()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('swallows the click, and a form submit, on a disabled or loading button', () => {
    for (const state of [{ disabled: true }, { loading: true }]) {
      const onClick = vi.fn(), e = click()
      guardedClick(state, onClick)(e)
      expect(onClick).not.toHaveBeenCalled()
      expect(e.preventDefault).toHaveBeenCalledOnce()
    }
  })

  it('tolerates a button with no action', () => {
    expect(() => guardedClick({})(click())).not.toThrow()
  })
})

describe('isButtonInert', () => {
  it('is inert when disabled or loading', () => {
    expect(isButtonInert({})).toBe(false)
    expect(isButtonInert({ disabled: true })).toBe(true)
    expect(isButtonInert({ loading: true })).toBe(true)
  })
})
