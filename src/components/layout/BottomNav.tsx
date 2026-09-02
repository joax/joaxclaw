import { useState } from 'react'
import {
  LayoutDashboard, MessageSquare, Bot, Mic, MoreHorizontal,
  Brain, GitBranch, UsersRound, Timer, Server, Palette, Settings, HelpCircle, Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { NavSection } from '../../App'
import { HelpModal } from '../help/HelpModal'
import { useHelpStore } from '../../store/help'

// Mobile primary navigation: a fixed bottom tab bar (thumb zone) with the four
// day-to-day surfaces + a "More" tab that opens a bottom sheet with everything
// else, grouped like the desktop rail. Replaces the hamburger top drawer on
// narrow screens; the desktop keeps its persistent side rail.

interface NavItem { id: NavSection; Icon: LucideIcon; label: string }

const PRIMARY: NavItem[] = [
  { id: 'dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'chat',      Icon: MessageSquare,   label: 'Chats' },
  { id: 'agents',    Icon: Bot,             label: 'Agents' },
  { id: 'talk',      Icon: Mic,             label: 'Talk' },
]

// Everything not on the primary bar, grouped the same way the side rail groups it.
const MORE_GROUPS: { heading: string; items: NavItem[] }[] = [
  { heading: 'Agent system', items: [
    { id: 'processes', Icon: GitBranch,  label: 'Processes' },
    { id: 'teams',     Icon: UsersRound, label: 'Teams' },
    { id: 'crons',     Icon: Timer,      label: 'Automations' },
  ] },
  { heading: 'Workspace', items: [
    { id: 'obsidian',  Icon: Brain,      label: 'Memory' },
  ] },
  { heading: 'Configuration', items: [
    { id: 'billing',   Icon: Wallet,     label: 'Billing' },
    { id: 'gateway',   Icon: Server,     label: 'Gateway' },
    { id: 'themes',    Icon: Palette,    label: 'Themes' },
    { id: 'settings',  Icon: Settings,   label: 'Settings' },
  ] },
]

const MORE_IDS = new Set<NavSection>(MORE_GROUPS.flatMap(g => g.items.map(i => i.id)))

interface Props { section: NavSection; onNavigate: (s: NavSection) => void; disabledSections?: NavSection[] }

export function BottomNav({ section, onNavigate, disabledSections = [] }: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const { open: helpOpen, tab: helpTab, openHelp, closeHelp } = useHelpStore()
  // "More" reads as active whenever the current section lives inside the sheet.
  const moreActive = MORE_IDS.has(section)

  const go = (s: NavSection) => { onNavigate(s); setMoreOpen(false) }

  return (
    <>
      <nav
        style={{
          display: 'flex', alignItems: 'stretch', flexShrink: 0,
          background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {PRIMARY.map(t => (
          <TabButton
            key={t.id} Icon={t.Icon} label={t.label}
            active={section === t.id} disabled={disabledSections.includes(t.id)}
            onClick={() => go(t.id)}
          />
        ))}
        <TabButton
          Icon={MoreHorizontal} label="More" active={moreActive || moreOpen}
          onClick={() => setMoreOpen(v => !v)}
        />
      </nav>

      {/* More sheet — same bottom-sheet treatment as the system monitor. */}
      {moreOpen && (
        <>
          <div
            className="animate-fade-in"
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="animate-slide-up"
            style={{
              position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61,
              background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.45)',
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, paddingBottom: 4 }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)' }} />
            </div>
            <div style={{ padding: '4px 12px 8px' }}>
              {MORE_GROUPS.map(g => (
                <div key={g.heading} style={{ marginBottom: 10 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', padding: '6px 8px' }}>
                    {g.heading}
                  </p>
                  {g.items.map(it => (
                    <MoreRow
                      key={it.id} Icon={it.Icon} label={it.label}
                      active={section === it.id} disabled={disabledSections.includes(it.id)}
                      onClick={() => go(it.id)}
                    />
                  ))}
                </div>
              ))}
              {/* Help opens the modal rather than routing to a section. */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <MoreRow Icon={HelpCircle} label="Help" active={helpOpen} onClick={() => { setMoreOpen(false); openHelp() }} />
              </div>
            </div>
          </div>
        </>
      )}

      {helpOpen && <HelpModal initialTab={helpTab} onClose={closeHelp} />}
    </>
  )
}

function TabButton({ Icon, label, active, disabled, onClick }: {
  Icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 3, padding: '7px 2px', minHeight: 56,
        background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer',
        color: active ? 'var(--accent)' : 'var(--text-secondary)', opacity: disabled ? 0.4 : 1,
        borderTop: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
      }}
    >
      <Icon size={21} strokeWidth={active ? 2.4 : 2} />
      <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500, lineHeight: 1 }}>{label}</span>
    </button>
  )
}

function MoreRow({ Icon, label, active, disabled, onClick }: {
  Icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '10px 8px', minHeight: 48, borderRadius: 'var(--radius)',
        border: 'none', textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
        background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-primary)', opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon size={18} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 14, fontWeight: active ? 600 : 500 }}>{label}</span>
    </button>
  )
}
