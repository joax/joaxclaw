import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, RefreshCw, X, Loader2, AlertCircle, Folder } from 'lucide-react'
import { FilePreview, FileGlyph } from './FilePreview'
import { RemotePluginNotice } from '../common/RemotePluginNotice'
import { useFilesStore, newSince, breadcrumbFor, type FileEntry } from '../../store/files'
import { useConnectionStore } from '../../store/connection'
import { fmtBytes } from '../../lib/artifacts'
import { useIsNarrow } from '../../lib/useIsNarrow'

// The Files panel: what the gateway's agents wrote, listed independently of the
// conversation that produced it, with the same viewer the artifact cards open.
//
// Listing needs joaxclaw-fs `host.files.*` on the gateway host — the plugin is what
// knows which directories count as roots. Without it the panel offers the install flow,
// while artifact cards keep working (they read a known path). See docs/files-drawer.md.

const WIDTH = 380

export function FileDrawer({ onOpenChat }: { onOpenChat?: () => void }) {
  const {
    open, expanded, selected, roots, rootId, subdir, entries, loading, error, supported, seenAtMs,
    closeDrawer, clearSelection, toggleExpand, loadRoots, selectRoot, refresh,
  } = useFilesStore()
  const status = useConnectionStore(s => s.status)
  const narrow = useIsNarrow()

  // Probe for the listing RPC once the drawer is open and the socket is up. A selection
  // opened straight from a chat card doesn't need it — the preview reads its own path.
  useEffect(() => {
    if (open && status === 'connected' && supported === null) void loadRoots()
  }, [open, status, supported])

  if (!open) return null

  const fresh = newSince(entries, seenAtMs)
  const freshPaths = new Set(fresh.map(f => f.path))

  const shell = (children: React.ReactNode) => (
    <aside
      className="flex flex-col min-h-0"
      style={{
        width: narrow || expanded ? '100%' : WIDTH,
        flexShrink: 0,
        borderLeft: narrow || expanded ? 'none' : '1px solid var(--border)',
        background: 'var(--bg-primary)',
        // Lift the panel off the chat column — left edge only. The negative spread is
        // what keeps it there: it shrinks the shadow shape by 12px on every side, and
        // the 24px blur reaches ~12px back out, so the top and bottom cancel to zero
        // while the -20px offset still leaves ~20px of shadow to the left. Pointless as
        // a full-screen overlay, where there's nothing beside it to separate from.
        ...(narrow ? {} : { boxShadow: '-20px 0 24px -12px rgba(0,0,0,0.45)' }),
        // <main>'s inner wrapper carries z-[1], so a static sibling paints *under* it —
        // anything overflowing the chat column would bleed over this panel. Give the
        // drawer its own stacking context above it.
        ...(narrow
          ? { position: 'fixed' as const, inset: 0, zIndex: 40 }
          : { position: 'relative' as const, zIndex: 2 }),
      }}
    >
      {children}
    </aside>
  )

  // A file is selected → the viewer owns the panel (it draws its own header).
  if (selected) {
    return shell(
      <>
        <div
          className="flex items-center gap-1 px-2 shrink-0"
          style={{ minHeight: 36, borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
        >
          <button
            onClick={clearSelection}
            className="flex items-center gap-1 text-xs px-1.5 py-1"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            <ChevronLeft size={13} /> All files
          </button>
        </div>
        <FilePreview
          path={selected.path}
          name={selected.name}
          expanded={expanded}
          onToggleExpand={narrow ? undefined : toggleExpand}
          onClose={closeDrawer}
        />
      </>
    )
  }

  return shell(
    <>
      <div
        className="flex items-center gap-2 px-3 shrink-0"
        style={{ minHeight: 44, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
      >
        <FolderOpen size={14} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)', flex: 1 }}>Files</span>
        <button
          title="Refresh"
          onClick={() => void refresh()}
          className="flex items-center justify-center"
          style={{ width: 24, height: 24, borderRadius: 5, border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          title="Close"
          onClick={closeDrawer}
          className="flex items-center justify-center"
          style={{ width: 24, height: 24, borderRadius: 5, border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <X size={13} />
        </button>
      </div>

      {supported === false ? (
        <RemotePluginNotice feature="Files" onRetry={() => void loadRoots()} onOpenChat={onOpenChat} />
      ) : (
        <>
          {roots.length > 1 && (
            <div className="flex gap-1 px-2 py-2 shrink-0" style={{ overflowX: 'auto', borderBottom: '1px solid var(--border)' }}>
              {roots.map(r => (
                <button
                  key={r.id}
                  onClick={() => void selectRoot(r.id)}
                  className="text-xs px-2 py-1 shrink-0"
                  style={{
                    borderRadius: 5,
                    border: '1px solid ' + (r.id === rootId ? 'color-mix(in srgb, var(--accent) 50%, var(--border))' : 'var(--border)'),
                    background: r.id === rootId ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                    color: r.id === rootId ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  title={r.path}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          {subdir && (
            <div
              className="flex items-center gap-0.5 px-2 py-1.5 shrink-0"
              style={{ overflowX: 'auto', borderBottom: '1px solid var(--border)' }}
            >
              {breadcrumbFor(roots.find(r => r.id === rootId)?.label ?? 'Files', subdir).map((crumb, i, all) => {
                const isLast = i === all.length - 1
                return (
                  <span key={crumb.subdir} className="flex items-center gap-0.5 shrink-0">
                    {i > 0 && <ChevronRight size={11} style={{ color: 'var(--text-secondary)', opacity: 0.5 }} />}
                    <button
                      onClick={() => { if (!isLast && rootId) void selectRoot(rootId, crumb.subdir) }}
                      disabled={isLast}
                      className="text-xs px-1 py-0.5"
                      style={{
                        border: 'none', background: 'none', borderRadius: 4,
                        color: isLast ? 'var(--text-primary)' : 'var(--accent)',
                        cursor: isLast ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {crumb.label}
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
            {loading && !entries.length ? (
              <div className="flex items-center gap-2 text-xs px-1" style={{ color: 'var(--text-secondary)' }}>
                <Loader2 size={13} className="animate-spin" /> Listing files on the host…
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 px-1" style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.6 }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{error}</span>
              </div>
            ) : !entries.length ? (
              <div className="text-xs px-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Nothing here yet. Files your agents write show up in this list.
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {entries.map(e => <Row key={e.path} entry={e} isNew={freshPaths.has(e.path)} />)}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

function Row({ entry, isNew }: { entry: FileEntry; isNew: boolean }) {
  const openFile = useFilesStore(s => s.openFile)
  const selectRoot = useFilesStore(s => s.selectRoot)
  const rootId = useFilesStore(s => s.rootId)
  const subdir = useFilesStore(s => s.subdir)

  const onClick = () => {
    if (entry.isDir) {
      if (rootId) void selectRoot(rootId, subdir ? `${subdir}/${entry.name}` : entry.name)
      return
    }
    openFile({ path: entry.path, name: entry.name })
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-1.5 text-left"
      style={{ border: 'none', background: 'none', borderRadius: 5, cursor: 'pointer', width: '100%' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
      title={entry.path}
    >
      {entry.isDir
        ? <Folder size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        : <FileGlyph path={entry.path} size={12} />}
      <span className="text-xs truncate" style={{ color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{entry.name}</span>
      {isNew && (
        <span
          className="shrink-0"
          style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }}
          title="New since you last looked"
        />
      )}
      {!entry.isDir && (
        <span className="shrink-0" style={{ color: 'var(--text-secondary)', fontSize: 10 }}>{fmtBytes(entry.size)}</span>
      )}
    </button>
  )
}
