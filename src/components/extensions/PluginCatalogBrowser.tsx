import { useEffect, useState, type KeyboardEvent } from 'react'
import { Search, X, Puzzle, AlertTriangle } from 'lucide-react'
import { usePluginCatalogStore } from '../../store/pluginCatalog'
import { useConnectionStore } from '../../store/connection'
import {
  cardAction, formatCount, installTargetForEntry, summariseRemoteError,
  type CatalogIntent, type DiscoveryEntry,
} from '../../lib/pluginCatalog'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { toneTint } from '../../lib/stateTone'
import { Btn } from '../ui/Btn'
import { Pill } from '../ui/Pill'
import { FilterTab } from '../ui/FilterTab'
import { EmptyState } from '../ui/EmptyState'
import { PluginDetailPane, catalogOrigin } from './PluginDetailPane'
import { ConsentDialog } from './PluginBrowser'

// The plugin catalog (OpenClaw 2026.9): views, category chips, cards whose button
// reflects the plugin's real state on this gateway, and a detail pane to read before
// installing. A modal over the Extensions page rather than a new section: browsing is
// something done rarely, over the page that manages what's installed.
//
// Every list call goes through the store, which drops answers for a view the user has
// already left, and reloads on a new connection (FR-11).

const VIEWS: { id: CatalogIntent; label: string }[] = [
  { id: 'featured', label: 'Featured' },
  { id: 'trending', label: 'Trending' },
  { id: 'official', label: 'Official' },
  { id: 'bundled', label: 'Bundled' },
  { id: 'all', label: 'All' },
]

export function PluginCatalogBrowser({ onClose, onManage, onOpenChat }: {
  onClose: () => void
  onManage: (pluginId: string) => void
  onOpenChat?: () => void
}) {
  const narrow = useIsNarrow()
  const seq = useConnectionStore(s => s.connectionSeq)
  const connected = useConnectionStore(s => s.status === 'connected')
  const admin = useConnectionStore(s => s.grantedScopes.includes('operator.admin'))
  const {
    intent, category, catalogQuery, items, nextCursor, remoteError, listState, listError, loadingMore,
    categories, selectedId, busy, consent, policy,
    setView, loadView, loadMore, loadCategories, loadMutationAllowed, select, resetCatalog, installAndRestart,
  } = usePluginCatalogStore()
  const [draft, setDraft] = useState(catalogQuery)

  // Load (and reload on every new connection): the list, the chips, and whether the
  // gateway's config accepts plugin changes at all.
  useEffect(() => {
    if (!connected) return
    resetCatalog()
    void loadView()
    void loadCategories()
    void loadMutationAllowed()
    const sel = usePluginCatalogStore.getState().selectedId
    if (sel) select(sel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, connected])

  // Search: debounced 250 ms, or at once on Enter. Clearing it returns to the tab.
  useEffect(() => {
    if (draft.trim() === catalogQuery.trim()) return
    const t = setTimeout(() => setView({ catalogQuery: draft }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // Escape closes the detail on a phone first, otherwise the modal.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || consent || policy) return
      if (narrow && usePluginCatalogStore.getState().selectedId) select(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [narrow, consent, policy, onClose, select])

  // A selected plugin that isn't in the current list (a deep link, a changed view) still
  // opens, from its detail record.
  const selectedFromDetail = usePluginCatalogStore(s => (selectedId ? s.details[selectedId]?.plugin : undefined))
  const selected = items.find(e => e.id === selectedId) ?? selectedFromDetail ?? null
  const searching = !!catalogQuery.trim()
  const remoteLine = summariseRemoteError(remoteError ?? undefined)
  const showList = !narrow || !selected

  const onCardAction = (entry: DiscoveryEntry) => {
    const a = cardAction(entry, { admin })
    if (a.kind === 'install') {
      const target = installTargetForEntry(entry, { origin: catalogOrigin(entry.id) })
      select(entry.id)
      if (target) void installAndRestart(target)
    } else if ((a.kind === 'manage' || a.kind === 'configure') && entry.local.pluginId) {
      onManage(entry.local.pluginId)
    } else {
      select(entry.id)
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center"
      style={{ top: narrow ? 0 : 36, background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Browse plugins" className="flex flex-col" style={{
        background: 'var(--bg-surface)', border: narrow ? 'none' : '1px solid var(--border)',
        borderRadius: narrow ? 0 : 'var(--radius)',
        width: narrow ? '100%' : 880, maxWidth: narrow ? '100%' : '94vw',
        height: narrow ? '100%' : '86vh', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
        paddingTop: narrow ? 'env(safe-area-inset-top)' : undefined,
      }} onClick={e => e.stopPropagation()}>

        {showList && (
          <div className="flex flex-col gap-2 px-4 pt-4 pb-2 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Browse plugins</h3>
              <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input
                value={draft}
                autoFocus={!narrow}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setView({ catalogQuery: draft }) }}
                placeholder="Search ClawHub plugins…"
                aria-label="Search ClawHub plugins"
                style={{ width: '100%', padding: '6px 10px 6px 28px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>
            <div role="tablist" aria-label="Views" className="flex items-center gap-1 overflow-x-auto" onKeyDown={arrowNav('ArrowLeft', 'ArrowRight')}
              style={{ opacity: searching ? 0.5 : 1 }}>
              {VIEWS.map(v => (
                <FilterTab key={v.id} label={v.label} active={!searching && intent === v.id}
                  onClick={() => { setDraft(''); setView({ intent: v.id, catalogQuery: '' }) }} />
              ))}
            </div>
            {categories && categories.length > 0 && (
              <div role="toolbar" aria-label="Categories" className="flex items-center gap-1 overflow-x-auto" onKeyDown={arrowNav('ArrowLeft', 'ArrowRight')}>
                <FilterTab label="All categories" active={!category} onClick={() => setView({ category: null })} />
                {categories.map(c => (
                  <FilterTab key={c.slug} label={c.label} active={category === c.slug} onClick={() => setView({ category: c.slug })} />
                ))}
              </div>
            )}
            {remoteLine && (
              <div className="flex items-start gap-1.5 text-xs px-2 py-1 rounded" style={{ background: toneTint('needsYou', 10), color: 'var(--text-primary)' }}>
                <AlertTriangle size={12} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
                <span>{remoteLine}</span>
              </div>
            )}
            {!connected && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Reconnecting to the gateway…</p>
            )}
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {showList && (
            <div className="flex flex-col min-h-0 overflow-y-auto p-3 gap-2" style={{ width: narrow ? '100%' : 400, flexShrink: 0, borderRight: narrow ? 'none' : '1px solid var(--border)' }}>
              {listState === 'loading' && (
                <>
                  <span className="sr-only" role="status">Loading plugins…</span>
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} aria-hidden className="animate-pulse" style={{ height: 76, borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', flexShrink: 0 }} />
                  ))}
                </>
              )}
              {listState === 'error' && (
                <div className="text-xs px-2.5 py-2 rounded flex items-start gap-2" style={{ background: toneTint('failed', 10), color: 'var(--danger)' }}>
                  <span style={{ flex: 1 }}>Couldn&apos;t load the plugin catalog: {listError}</span>
                  <Btn size="sm" variant="outline" onClick={() => void loadView()}>Try again</Btn>
                </div>
              )}
              {listState === 'ready' && items.length === 0 && (
                <EmptyState icon={Puzzle} label={searching ? `Nothing matches “${catalogQuery.trim()}”.` : remoteLine && (intent === 'featured' || intent === 'trending') ? remoteLine : 'No plugins match this view.'} />
              )}
              {listState === 'ready' && items.length > 0 && (
                <div role="list" className="flex flex-col gap-2" onKeyDown={arrowNav('ArrowUp', 'ArrowDown')}>
                  {items.map(entry => (
                    <PluginCard key={entry.id} entry={entry} admin={admin} selected={entry.id === selectedId} busy={busy} connected={connected}
                      onOpen={() => select(entry.id)} onAction={() => onCardAction(entry)} />
                  ))}
                </div>
              )}
              {listState === 'ready' && nextCursor && !searching && (
                <div className="flex justify-center py-1">
                  <Btn size="sm" variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Load more</Btn>
                </div>
              )}
            </div>
          )}
          {selected && (
            <div className="flex-1 min-w-0 min-h-0">
              <PluginDetailPane entry={selected} admin={admin} connected={connected}
                onBack={narrow ? () => select(null) : undefined} onManage={onManage} onOpenChat={onOpenChat} />
            </div>
          )}
          {!narrow && !selected && (
            <div className="flex-1 min-w-0 flex">
              <EmptyState icon={Puzzle} label="Pick a plugin to read about it." />
            </div>
          )}
        </div>
      </div>

      {(consent || policy) && <ConsentDialog />}
    </div>
  )
}

function PluginCard({ entry, admin, selected, busy, connected, onOpen, onAction }: {
  entry: DiscoveryEntry
  admin: boolean
  selected: boolean
  busy: string | null
  connected: boolean
  onOpen: () => void
  onAction: () => void
}) {
  const a = cardAction(entry, { admin })
  const installing = busy === entry.catalog.name
  const count = typeof entry.catalog.installs === 'number' ? `${formatCount(entry.catalog.installs)} installs`
    : typeof entry.catalog.downloads === 'number' ? `${formatCount(entry.catalog.downloads)} downloads` : null
  return (
    <div role="listitem">
      <div
        role="button"
        tabIndex={0}
        data-nav-item
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen() }}
        className="flex items-start gap-3 px-3 py-2"
        style={{
          cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-elevated)',
          boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : undefined,
        }}
      >
        <PluginIcon entry={entry} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{entry.catalog.name}</span>
            {entry.catalog.official && <Pill tone="working">Official</Pill>}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {entry.catalog.summary?.trim() || 'No description.'}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {count && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{count}</span>}
            {a.pill && <Pill tone={a.pill.tone}>{a.pill.text}</Pill>}
          </div>
        </div>
        {a.kind !== 'none' && (
          <span onClick={e => e.stopPropagation()} className="shrink-0 self-center">
            <Btn size="sm" variant={a.kind === 'install' ? 'primary' : 'outline'}
              disabled={!connected || (a.kind === 'install' && busy !== null)}
              loading={installing}
              title={a.kind === 'install' && busy !== null && !installing ? 'Another plugin is installing' : undefined}
              onClick={onAction}>
              {installing ? 'Installing…' : a.label}
            </Btn>
          </span>
        )}
      </div>
    </div>
  )
}

// ClawHub's image when it's a plain https URL, otherwise the generic plugin icon. Loaded
// lazily and without a referrer, so browsing doesn't tell ClawHub where it's viewed from.
function PluginIcon({ entry }: { entry: DiscoveryEntry }) {
  const [failed, setFailed] = useState(false)
  const url = entry.catalog.imageUrl
  const box: React.CSSProperties = { width: 28, height: 28, borderRadius: 6, flexShrink: 0, marginTop: 2 }
  if (url && /^https:\/\//.test(url) && !failed) {
    return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ ...box, objectFit: 'cover' }} />
  }
  return (
    <span className="flex items-center justify-center" style={{ ...box, background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
      <Puzzle size={14} />
    </span>
  )
}

/**
 * Arrow-key movement between the focusable items of a row or list: tabs and chips move
 * with Left/Right, cards with Up/Down. Items are the container's buttons, or its
 * `[data-nav-item]` elements when it has any.
 */
function arrowNav(prev: string, next: string) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== prev && e.key !== next) return
    const root = e.currentTarget
    const marked = Array.from(root.querySelectorAll<HTMLElement>('[data-nav-item]'))
    const items = marked.length ? marked : Array.from(root.querySelectorAll<HTMLElement>(':scope > button'))
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    e.preventDefault()
    const to = e.key === next ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1)
    items[to]?.focus()
  }
}
