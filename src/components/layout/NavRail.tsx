import { MessageSquare, Bot, ClipboardList, Settings, Palette, HelpCircle, Puzzle, Timer, Brain } from 'lucide-react'
import type { NavSection } from '../../App'

interface NavItem { id: NavSection; icon: React.ReactNode; label: string; disabled?: boolean }

const NAV_ITEMS: NavItem[] = [
  { id: 'chat',       icon: <MessageSquare size={20} />, label: 'Chats' },
  { id: 'agents',     icon: <Bot size={20} />,           label: 'Agents' },
  { id: 'extensions', icon: <Puzzle size={20} />,        label: 'Extensions' },
  { id: 'sessions',   icon: <ClipboardList size={20} />, label: 'Sessions' },
  { id: 'crons',      icon: <Timer size={20} />,         label: 'Crons' },
  { id: 'obsidian',   icon: <Brain size={20} />,         label: 'Memory' },
  { id: 'gateway',    icon: <Settings size={20} />,      label: 'Gateway' },
  { id: 'settings',   icon: <Palette size={20} />,       label: 'Settings' }
]

interface Props { section: NavSection; onNavigate: (s: NavSection) => void; disabledSections?: NavSection[] }

export function NavRail({ section, onNavigate, disabledSections = [] }: Props) {
  return (
    <nav
      className="flex flex-col items-center py-2 shrink-0 relative"
      style={{
        width: 52,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)'
      }}
    >
      <div className="flex flex-col gap-1 flex-1 w-full px-2 pt-1">
        {NAV_ITEMS.map(item => (
          <NavBtn
            key={item.id}
            active={section === item.id}
            disabled={disabledSections.includes(item.id)}
            label={item.label}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon}
          </NavBtn>
        ))}
      </div>

      <div className="px-2 pb-1">
        <NavBtn label="Help" onClick={() => {}}>
          <HelpCircle size={20} />
        </NavBtn>
      </div>
    </nav>
  )
}

function NavBtn({
  children, active, disabled, label, onClick
}: { children: React.ReactNode; active?: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={label}
      className="relative flex items-center justify-center transition-all group"
      style={{
        width: '100%',
        height: 40,
        borderRadius: 'var(--radius)',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        background: active ? 'color-mix(in srgb, var(--accent) 20%, var(--bg-elevated))' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)'
      }}
      onMouseEnter={e => {
        if (!active && !disabled) {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
        }
      }}
      onMouseLeave={e => {
        if (!active && !disabled) {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
        }
      }}
    >
      {active && !disabled && (
        <span
          className="absolute left-0 top-2 bottom-2"
          style={{ width: 3, borderRadius: '0 2px 2px 0', background: 'var(--accent)' }}
        />
      )}
      {children}

      {/* Tooltip */}
      <span
        className="absolute left-full ml-2 px-2 py-1 text-xs rounded whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      >
        {disabled ? `${label} (plugin disabled)` : label}
      </span>
    </button>
  )
}
