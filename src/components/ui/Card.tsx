import type { ReactNode } from 'react'

// The two titled panels used across the app, moved here unchanged:
// - `Card`: the Gateway view's panel, with its header on --bg-elevated.
// - `Section`: the Settings view's panel, with a plain uppercase header.

export function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div
        className={`px-3 py-2.5 text-xs font-semibold${action ? ' flex items-center justify-between gap-2' : ''}`}
        style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {action ? <><span>{title}</span><span style={{ textTransform: 'none', letterSpacing: 'normal' }}>{action}</span></> : title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div className="px-4 py-2.5 text-xs font-semibold" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}
