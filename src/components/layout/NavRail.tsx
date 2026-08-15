import { MessageSquare, Bot, Settings, Server, HelpCircle, Timer, Brain, GitBranch, LayoutDashboard, UsersRound, Mic, Palette, Wallet, type LucideIcon } from 'lucide-react'
import type { NavSection } from '../../App'
import { HelpModal } from '../help/HelpModal'
import { useHelpStore } from '../../store/help'

interface NavItem { id: NavSection; Icon: LucideIcon; label: string }

const GROUP_1: NavItem[] = [
  { id: 'dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'chat',      Icon: MessageSquare,   label: 'Chats' },
  { id: 'talk',      Icon: Mic,             label: 'Talk' },
  { id: 'obsidian',  Icon: Brain,           label: 'Memory' },
]

const GROUP_2: NavItem[] = [
  { id: 'agents',     Icon: Bot,        label: 'Agents' },
  { id: 'processes',  Icon: GitBranch,  label: 'Processes' },
  { id: 'teams',      Icon: UsersRound, label: 'Teams' },
  { id: 'crons',      Icon: Timer,      label: 'Crons' },
]

const GROUP_3: NavItem[] = [
  { id: 'billing',  Icon: Wallet,   label: 'Billing' },
  { id: 'gateway',  Icon: Server,   label: 'Gateway' },
  { id: 'themes',   Icon: Palette,  label: 'Themes' },
  { id: 'settings', Icon: Settings, label: 'Settings' },
]

// 'rail' = the 52px icon-only desktop rail (tooltip labels). 'list' = a wider, touch
// sized list with larger icons + labels, used in the mobile nav drawer.
type Variant = 'rail' | 'list'

interface Props { section: NavSection; onNavigate: (s: NavSection) => void; disabledSections?: NavSection[]; variant?: Variant }

export function NavRail({ section, onNavigate, disabledSections = [], variant = 'rail' }: Props) {
  const { open: helpOpen, tab: helpTab, openHelp, closeHelp } = useHelpStore()
  const list = variant === 'list'
  const renderGroup = (group: NavItem[]) =>
    group.map(item => (
      <NavBtn key={item.id} Icon={item.Icon} label={item.label} variant={variant}
        active={section === item.id} disabled={disabledSections.includes(item.id)}
        onClick={() => onNavigate(item.id)} />
    ))

  return (
    <nav
      className="flex flex-col shrink-0"
      style={{
        width: list ? '100%' : 52,
        height: '100%',
        alignItems: list ? 'stretch' : 'center',
        padding: list ? '8px 0' : '8px 0',
        background: 'var(--bg-surface)',
        borderRight: list ? 'none' : '1px solid var(--border)',
        overflowY: 'auto',
      }}
    >
      <div className="flex flex-col gap-1 w-full" style={{ padding: list ? '4px 8px 0' : '4px 8px 0' }}>
        {renderGroup(GROUP_1)}
      </div>

      <Divider />

      <div className="flex flex-col gap-1 w-full" style={{ padding: '0 8px' }}>
        {renderGroup(GROUP_2)}
      </div>

      {/* Spacer pushes group 3 + help to the bottom */}
      <div className="flex-1" style={{ minHeight: 8 }} />

      <Divider />

      <div className="flex flex-col gap-1 w-full" style={{ padding: '0 8px 4px' }}>
        {renderGroup(GROUP_3)}
        <NavBtn Icon={HelpCircle} label="Help" variant={variant} active={helpOpen} onClick={() => openHelp()} />
      </div>

      {helpOpen && <HelpModal initialTab={helpTab} onClose={closeHelp} />}
    </nav>
  )
}

function Divider() {
  return (
    <div className="w-full my-1 px-3">
      <div style={{ height: 1, background: 'var(--border)', borderRadius: 1 }} />
    </div>
  )
}

function NavBtn({
  Icon, active, disabled, label, onClick, variant,
}: { Icon: LucideIcon; active?: boolean; disabled?: boolean; label: string; onClick: () => void; variant: Variant }) {
  const list = variant === 'list'
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={list ? undefined : label}
      className="relative flex items-center transition-all group"
      style={{
        width: '100%',
        height: list ? 48 : 40,
        gap: list ? 14 : 0,
        justifyContent: list ? 'flex-start' : 'center',
        padding: list ? '0 14px' : 0,
        borderRadius: 'var(--radius)',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        background: active ? 'color-mix(in srgb, var(--accent) 20%, var(--bg-elevated))' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
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
        <span className="absolute left-0" style={{ top: 8, bottom: 8, width: 3, borderRadius: '0 2px 2px 0', background: 'var(--accent)' }} />
      )}
      <Icon size={list ? 22 : 20} style={{ flexShrink: 0 }} />
      {list && <span style={{ fontSize: 15, fontWeight: 500 }}>{label}</span>}

      {/* Tooltip — rail only (list shows the label inline) */}
      {!list && (
        <span
          className="absolute left-full ml-2 px-2 py-1 text-xs rounded whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          {disabled ? `${label} (plugin disabled)` : label}
        </span>
      )}
    </button>
  )
}
