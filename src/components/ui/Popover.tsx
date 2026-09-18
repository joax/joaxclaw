import { useEffect, useRef, type ReactNode, type Ref } from 'react'
import { Check } from 'lucide-react'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { BottomSheet } from './BottomSheet'

// Popover menus. The pieces here were private to the chat header (ChatHeaderControls)
// and moved here unchanged, so every feature's menus look and behave the same. `Popover`
// is the full component, with keyboard support. The existing header menus still compose
// the pieces by hand and move onto it as they're next changed.

/** Calls `onClose` on a mousedown outside the returned ref. */
export function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  return ref
}

/** The compact bordered trigger button the chat header menus use. */
export const triggerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '3px 7px', fontSize: 11, maxWidth: 200,
  borderRadius: 'var(--radius)', border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
  cursor: 'pointer', whiteSpace: 'nowrap',
}

/** The menu panel: right-anchored under its trigger. */
export const menuStyle: React.CSSProperties = {
  position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 100,
  minWidth: 220, maxHeight: 320, overflowY: 'auto', paddingBlock: 4,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
}

/**
 * One menu row. With `selected` set it's a choice in a set (a check shows on the chosen
 * one); without it, a plain action. `danger` colours a destructive action.
 */
export function MenuRow({ selected, danger, disabled, icon, onClick, children }: {
  selected?: boolean
  danger?: boolean
  disabled?: boolean
  icon?: ReactNode
  onClick: () => void
  children: ReactNode
}) {
  const color = danger ? 'var(--danger)' : selected ? 'var(--accent)' : 'var(--text-primary)'
  return (
    <button
      role={selected === undefined ? 'menuitem' : 'menuitemradio'}
      {...(selected === undefined ? {} : { 'aria-checked': selected })}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 12px', background: 'none', border: 'none',
        cursor: disabled ? 'default' : 'pointer', textAlign: 'left',
        color, opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--bg-primary)' }}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {icon}
      {children}
      {selected && <Check size={12} style={{ flexShrink: 0 }} />}
    </button>
  )
}

/** A multi-select row: a check column, an icon and a label. */
export function CheckRow({ label, icon, checked, disabled, onToggle }: {
  label: string; icon: ReactNode; checked: boolean; disabled?: boolean; onToggle: () => void
}) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-xs"
      style={{
        background: 'none', border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? 'var(--text-secondary)' : 'var(--text-primary)',
        opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-primary)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      <span style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        {checked && <Check size={12} style={{ color: 'var(--accent)' }} />}
      </span>
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  )
}

/** A small uppercase group heading inside a menu. */
export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-secondary)', padding: '4px 10px 2px' }}>
      {children}
    </p>
  )
}

export function MenuDivider() {
  return <div role="separator" style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
}

export interface PopoverTriggerProps {
  ref: Ref<HTMLButtonElement>
  onClick: () => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
}

/**
 * A menu under a trigger. It closes on an outside click or Escape (focus goes back to
 * the trigger), and Arrow Up/Down move between rows. With `sheetOnNarrow`, the menu
 * opens as a bottom sheet on a phone.
 */
export function Popover({ trigger, open, onOpenChange, align = 'right', width, title, sheetOnNarrow, children }: {
  trigger: (props: PopoverTriggerProps) => ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  align?: 'left' | 'right'
  width?: number
  /** Accessible name for the menu, and the sheet's title on a phone. */
  title?: string
  sheetOnNarrow?: boolean
  children: ReactNode
}) {
  const narrow = useIsNarrow()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const wrapRef = useClickOutside(() => { if (open) onOpenChange(false) })
  const asSheet = open && sheetOnNarrow && narrow

  // Focus the menu when it opens, so the arrow keys work straight away.
  useEffect(() => { if (open && !asSheet) menuRef.current?.focus() }, [open, asSheet])

  const close = () => { onOpenChange(false); triggerRef.current?.focus() }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1)
    items[next].focus()
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {trigger({ ref: triggerRef, onClick: () => onOpenChange(!open), 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {asSheet && <BottomSheet title={title} onClose={() => onOpenChange(false)}>{children}</BottomSheet>}
      {open && !asSheet && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={title}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          style={{
            ...menuStyle,
            ...(align === 'left' ? { left: 0, right: 'auto' } : {}),
            ...(width ? { minWidth: width } : {}),
            outline: 'none',
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
