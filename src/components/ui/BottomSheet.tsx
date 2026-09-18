import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { trapTab } from './focusTrap'

// The phone bottom sheet, previously copied in BottomNav's More menu and the system
// monitor: a backdrop, a drag handle, a rounded surface sliding up from the bottom, and
// safe-area padding. It renders through a portal, is a labelled dialog, and closes on
// Escape or a backdrop tap. A `title` adds a header row with a close button.
export function BottomSheet({ title, onClose, children, maxHeight = '80vh', handleGap = 4, bottomPad = 'calc(env(safe-area-inset-bottom) + 8px)' }: {
  title?: string
  onClose: () => void
  children: ReactNode
  maxHeight?: string
  /** Space under the drag handle. The monitor sheet uses 2. */
  handleGap?: number
  /** Bottom padding. The monitor sheet uses the bare safe-area inset. */
  bottomPad?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { ref.current?.focus() }, [])

  return createPortal(
    <>
      <div className="animate-fade-in" style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={e => trapTab(e, ref.current)}
        className="animate-slide-up"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61, outline: 'none',
          background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          maxHeight, overflowY: 'auto',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.45)',
          paddingBottom: bottomPad,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, paddingBottom: handleGap }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)' }} />
        </div>
        {title && (
          <div className="flex items-center justify-between px-4 pb-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </>,
    document.body,
  )
}
