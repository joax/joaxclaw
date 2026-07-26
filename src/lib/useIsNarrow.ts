import { useEffect, useState } from 'react'

// True on narrow (phone-width) viewports. Drives the mobile-adaptive layout: the
// desktop chrome (side nav rail, chat sidebar, right panels) collapses into drawers
// below this breakpoint. Everything above it is the unchanged desktop layout.
export function useIsNarrow(breakpointPx = 768): boolean {
  const query = `(max-width: ${breakpointPx - 1}px)`
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setNarrow(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return narrow
}
