import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { trapTab } from './focusTrap'

// A centred modal with a titled header, moved here from the Channels panel.
// - It renders through a portal to <body>, so a transformed ancestor can't trap it (the #74 lesson).
// - It's a proper dialog: labelled by its title, focus moves inside and stays there, and
//   Escape or a backdrop click closes it.
export function Overlay({ title, width, headerColor, onClose, footer, children }: {
  title: string
  width: number
  headerColor?: string
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Move focus inside on open, and hand it back to wherever it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-overlay-close]), [href], [tabindex]:not([tabindex="-1"])')
    ;(first ?? panelRef.current)?.focus()
    return () => { before?.focus?.() }
  }, [])

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={e => trapTab(e, panelRef.current)}
        className="fixed left-1/2 top-1/2 z-50 flex flex-col"
        style={{
          transform: 'translate(-50%, -50%)', width, maxWidth: '94vw', maxHeight: '84vh', outline: 'none',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}
      >
        <div className="flex items-center justify-between px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            {headerColor && <span className="w-2.5 h-2.5 rounded-full" style={{ background: headerColor }} />}
            <h2 id={titleId} className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          </div>
          <button data-overlay-close onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </>,
    document.body,
  )
}
