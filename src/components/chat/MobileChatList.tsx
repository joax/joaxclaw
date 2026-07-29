import { useState } from 'react'
import { Search, Plus, MoreVertical, Pencil, Trash2, Check, X } from 'lucide-react'
import type { ChatItem } from './ChatView'

// Purpose-built mobile chat list (replaces the stretched desktop sidebar on phones).
// Full-width tappable rows with an avatar, name, last-message preview and time; a
// persistent ⋯ menu for Rename/Delete (touch has no hover); and a thumb-reachable
// ＋ FAB for a new chat. Grouped by the same Active / Scheduled / date sections.

export interface MobileGroup { label: string; tone?: 'success' | 'muted'; items: ChatItem[] }

interface Props {
  search: string
  setSearch: (s: string) => void
  groups: MobileGroup[]
  onNewChat: () => void
  emptyHint: string
  footer?: React.ReactNode
}

export function MobileChatList({ search, setSearch, groups, onNewChat, emptyHint, footer }: Props) {
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [renameKey, setRenameKey] = useState<string | null>(null)
  const isEmpty = groups.every(g => g.items.length === 0)

  return (
    <div className="flex flex-col min-h-0 flex-1 relative" style={{ background: 'var(--bg-primary)' }}>
      {/* Search */}
      <div className="px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search chats…"
            style={{ width: '100%', padding: '9px 10px 9px 34px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 88 }}>
        {isEmpty && (
          <div className="flex flex-col items-center justify-center gap-2 px-6" style={{ minHeight: '40vh', color: 'var(--text-secondary)' }}>
            <p className="text-sm">{emptyHint}</p>
          </div>
        )}

        {groups.filter(g => g.items.length).map(group => (
          <div key={group.label}>
            <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase" style={{ letterSpacing: '0.05em', color: group.tone === 'success' ? 'var(--success)' : 'var(--text-secondary)' }}>
              {group.label}
              <span style={{ opacity: 0.6 }}> · {group.items.length}</span>
            </div>
            {group.items.map(item => (
              <Row
                key={item.key}
                item={item}
                menuOpen={menuKey === item.key}
                renaming={renameKey === item.key}
                onMenu={() => setMenuKey(k => k === item.key ? null : item.key)}
                onStartRename={() => { setRenameKey(item.key); setMenuKey(null) }}
                onEndRename={() => setRenameKey(null)}
                onCloseMenu={() => setMenuKey(null)}
              />
            ))}
          </div>
        ))}

        {footer && <div className="px-4 py-2">{footer}</div>}
      </div>

      {/* New-chat FAB */}
      <button
        onClick={onNewChat}
        aria-label="New chat"
        style={{
          position: 'absolute', right: 18, bottom: 18, width: 56, height: 56, borderRadius: 28,
          border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        }}
      >
        <Plus size={26} />
      </button>
    </div>
  )
}

function Row({ item, menuOpen, renaming, onMenu, onStartRename, onEndRename, onCloseMenu }: {
  item: ChatItem
  menuOpen: boolean
  renaming: boolean
  onMenu: () => void
  onStartRename: () => void
  onEndRename: () => void
  onCloseMenu: () => void
}) {
  const [draft, setDraft] = useState(item.name)

  if (renaming && item.onRename) {
    return (
      <div className="flex items-center gap-2 px-4" style={{ minHeight: 64, borderBottom: '1px solid var(--border)' }}>
        <input
          autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { item.onRename!(draft.trim()); onEndRename() } if (e.key === 'Escape') onEndRename() }}
          style={{ flex: 1, padding: '9px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}
        />
        <button onClick={() => { item.onRename!(draft.trim()); onEndRename() }} aria-label="Save" style={iconBtn('var(--success)')}><Check size={20} /></button>
        <button onClick={onEndRename} aria-label="Cancel" style={iconBtn('var(--text-secondary)')}><X size={20} /></button>
      </div>
    )
  }

  return (
    <div className="relative" style={{ borderBottom: '1px solid var(--border)', background: item.isActive ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent' }}>
      <button
        onClick={item.onOpen}
        className="flex items-center gap-3 w-full text-left"
        style={{ minHeight: 64, padding: '10px 8px 10px 14px', border: 'none', background: 'transparent', cursor: 'pointer' }}
      >
        {/* Avatar */}
        <span style={{ position: 'relative', flexShrink: 0, width: 40, height: 40, borderRadius: 20, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
          {item.emoji}
          {item.running && (
            <span className="animate-pulse-dot" style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, background: 'var(--success)', border: '2px solid var(--bg-primary)' }} />
          )}
        </span>
        {/* Text */}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{item.name}</span>
            {item.time && <span style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{item.time}</span>}
          </span>
          {item.subtitle && (
            <span className="block truncate" style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{item.subtitle}</span>
          )}
        </span>
        {/* Overflow */}
        {(item.onRename || item.onDelete) && (
          <span
            role="button" tabIndex={0} aria-label="Chat actions"
            onClick={e => { e.stopPropagation(); onMenu() }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onMenu() } }}
            style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}
          >
            <MoreVertical size={18} />
          </span>
        )}
      </button>

      {/* Action menu */}
      {menuOpen && (
        <>
          <div onClick={onCloseMenu} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', right: 10, top: 52, zIndex: 41, minWidth: 150, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
            {item.onRename && (
              <button onClick={onStartRename} style={menuItem()}>
                <Pencil size={15} /> Rename
              </button>
            )}
            {item.onDelete && (
              <button onClick={() => { item.onDelete!(); onCloseMenu() }} style={menuItem('var(--danger)')}>
                <Trash2 size={15} /> Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const iconBtn = (color: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40,
  borderRadius: 'var(--radius)', border: 'none', background: 'transparent', color, cursor: 'pointer', flexShrink: 0,
})
const menuItem = (color = 'var(--text-primary)'): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 14px',
  border: 'none', background: 'transparent', color, cursor: 'pointer', fontSize: 14, textAlign: 'left',
})
