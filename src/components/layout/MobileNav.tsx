import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import type { NavSection } from '../../App'
import { NavRail } from './NavRail'

// Mobile-only navigation: a slim top bar with a hamburger that slides the full NavRail
// in as a left drawer (reusing the desktop NavRail component as-is). Selecting a
// section closes the drawer. Rendered only on narrow viewports; the desktop keeps its
// persistent side rail.

const SECTION_LABEL: Record<NavSection, string> = {
  dashboard: 'Dashboard', chat: 'Chats', talk: 'Talk', obsidian: 'Memory',
  agents: 'Agents', processes: 'Processes', teams: 'Teams', crons: 'Crons',
  gateway: 'Gateway', themes: 'Themes', settings: 'Settings',
}

interface Props { section: NavSection; onNavigate: (s: NavSection) => void; disabledSections?: NavSection[] }

export function MobileNav({ section, onNavigate, disabledSections }: Props) {
  const [open, setOpen] = useState(false)
  const go = (s: NavSection) => { onNavigate(s); setOpen(false) }

  return (
    <>
      {/* Top bar */}
      <div
        className="flex items-center gap-2 px-2 shrink-0"
        style={{ height: 44, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 'var(--radius)', border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          <Menu size={20} />
        </button>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {SECTION_LABEL[section] ?? ''}
        </span>
      </div>

      {/* Drawer + backdrop */}
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)' }}
          />
          <div
            className="animate-fade-in"
            style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 61, display: 'flex', boxShadow: '2px 0 16px rgba(0,0,0,0.4)' }}
          >
            <NavRail section={section} onNavigate={go} disabledSections={disabledSections} />
            <button
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              style={{ position: 'absolute', top: 6, right: -40, width: 34, height: 34, borderRadius: 'var(--radius)', border: 'none', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={18} />
            </button>
          </div>
        </>
      )}
    </>
  )
}
