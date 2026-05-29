import { MessageSquare, Bot, ClipboardList, Settings, Palette, HelpCircle, Puzzle, Timer, Brain, Cpu } from 'lucide-react'
import type { NavSection } from '../../App'

interface NavItem { id: NavSection; icon: React.ReactNode; label: string; disabled?: boolean }

const GROUP_1: NavItem[] = [
  { id: 'chat',     icon: <MessageSquare size={20} />, label: 'Chats' },
  { id: 'sessions', icon: <ClipboardList size={20} />, label: 'Sessions' },
  { id: 'obsidian', icon: <Brain size={20} />,         label: 'Memory' },
]

const GROUP_2: NavItem[] = [
  { id: 'agents',     icon: <Bot size={20} />,    label: 'Agents' },
  { id: 'extensions', icon: <Puzzle size={20} />, label: 'Plugins' },
  { id: 'crons',      icon: <Timer size={20} />,  label: 'Crons' },
  { id: 'models',     icon: <Cpu size={20} />,    label: 'Models' },
]

const GROUP_3: NavItem[] = [
  { id: 'gateway',  icon: <Settings size={20} />, label: 'Settings' },
  { id: 'settings', icon: <Palette size={20} />,  label: 'Theme' },
]

interface Props { section: NavSection; onNavigate: (s: NavSection) => void; disabledSections?: NavSection[] }

export function NavRail({ section, onNavigate, disabledSections = [] }: Props) {
  return (
    <nav
      className="flex flex-col items-center py-2 shrink-0"
      style={{
        width: 52,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)'
      }}
    >
      {/* Group 1: Chats, Sessions, Memory */}
      <div className="flex flex-col gap-1 w-full px-2 pt-1">
        {GROUP_1.map(item => (
          <NavBtn key={item.id} active={section === item.id} disabled={disabledSections.includes(item.id)} label={item.label} onClick={() => onNavigate(item.id)}>
            {item.icon}
          </NavBtn>
        ))}
      </div>

      <Divider />

      {/* Group 2: Agents, Plugins, Crons */}
      <div className="flex flex-col gap-1 w-full px-2">
        {GROUP_2.map(item => (
          <NavBtn key={item.id} active={section === item.id} disabled={disabledSections.includes(item.id)} label={item.label} onClick={() => onNavigate(item.id)}>
            {item.icon}
          </NavBtn>
        ))}
      </div>

      {/* Spacer pushes group 3 + help to the bottom */}
      <div className="flex-1" />

      <Divider />

      {/* Group 3: Settings, Theme + Help */}
      <div className="flex flex-col gap-1 w-full px-2 pb-1">
        {GROUP_3.map(item => (
          <NavBtn key={item.id} active={section === item.id} disabled={disabledSections.includes(item.id)} label={item.label} onClick={() => onNavigate(item.id)}>
            {item.icon}
          </NavBtn>
        ))}
        <NavBtn label="Help" onClick={() => {}}>
          <HelpCircle size={20} />
        </NavBtn>
      </div>
    </nav>
  )
}

function Divider() {
  return (
    <div
      className="w-full my-1 px-3"
    >
      <div style={{ height: 1, background: 'var(--border)', borderRadius: 1 }} />
    </div>
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
