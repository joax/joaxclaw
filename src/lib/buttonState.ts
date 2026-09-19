// How the shared Btn (components/ui/Btn.tsx) tells assistive tech it can't be used.
//
// Btn used to only dim a disabled button and drop its click, so a screen reader still
// announced it as a working button (meetings' "Join", say). The native `disabled`
// attribute would fix the announcement but costs two things callers rely on: a disabled
// button leaves the tab order, so its reason is unreachable by keyboard, and it fires no
// mouse events, so browsers show its `title` tooltip ("Install a meeting plugin first")
// inconsistently. So Btn stays focusable and says `aria-disabled`, and blocks activation
// itself: mouse, Enter and Space all arrive as one `click`, which is where it's stopped.

export interface ButtonState {
  disabled?: boolean
  loading?: boolean
}

/** Whether the button must not act: disabled, or busy with the action it started. */
export function isButtonInert({ disabled, loading }: ButtonState): boolean {
  return !!disabled || !!loading
}

/**
 * The button's click handler. An inert button swallows the click, and cancels its
 * default too, so a submit-type Btn doesn't submit its form either.
 */
export function guardedClick(state: ButtonState, onClick?: () => void): (e: { preventDefault(): void }) => void {
  return e => {
    if (isButtonInert(state)) { e.preventDefault(); return }
    onClick?.()
  }
}

/** The ARIA attributes for a button's state. `aria-busy` tells a loading button from a disabled one. */
export function buttonAriaState(state: ButtonState): { 'aria-disabled'?: true; 'aria-busy'?: true } {
  return {
    ...(isButtonInert(state) ? { 'aria-disabled': true as const } : {}),
    ...(state.loading ? { 'aria-busy': true as const } : {}),
  }
}
