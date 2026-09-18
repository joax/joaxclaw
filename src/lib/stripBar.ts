// Which strip in a StripBar is open. Only one at a time: opening one closes the other,
// toggling the open one closes it, and hiding the open one (its feature has nothing to
// show any more) closes it.

export type StripAction = { type: 'toggle'; id: string } | { type: 'hide'; id: string } | { type: 'closeAll' }

export function nextOpenStrip(current: string | null, action: StripAction): string | null {
  switch (action.type) {
    case 'toggle': return current === action.id ? null : action.id
    case 'hide': return current === action.id ? null : current
    case 'closeAll': return null
  }
}
