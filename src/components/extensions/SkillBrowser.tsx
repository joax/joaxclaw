import { useState } from 'react'
import { Search, Download, Loader2, X, CheckCircle2, RefreshCw, AlertTriangle } from 'lucide-react'
import { useSkillCatalogStore } from '../../store/skillCatalog'
import { isInstallable, skillTrustLabel } from '../../lib/skillCatalog'
import { Btn } from '../ui/Btn'

// Find and install skills from ClawHub, and refresh the ones already installed.
//
// Mirrors the plugin browser. The difference that matters is invisible from here: a
// result's `installRef` is publisher-qualified and its `slug` is not, and install takes
// the former — see lib/skillCatalog.ts.

export function SkillBrowser({ onClose, installedSlugs }: { onClose: () => void; installedSlugs: Set<string> }) {
  const {
    query, results, searching, searched, busy, error, installed, blocked, lastUpdateSummary,
    search, install, updateAll, clearBlocked, clearError,
  } = useSkillCatalogStore()
  const [draft, setDraft] = useState(query)

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center"
      style={{ top: 36, background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="flex flex-col p-5 gap-3" style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        width: 640, maxWidth: '94vw', maxHeight: '86vh', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Browse skills</h3>
          <div className="flex items-center gap-2">
            <Btn size="sm" variant="outline" loading={busy === 'update:all'}
              icon={<RefreshCw size={12} />} onClick={() => void updateAll()}>
              Update installed
            </Btn>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void search(draft) }}
              placeholder="Search ClawHub — pdf, spreadsheet, research…"
              style={{ width: '100%', padding: '6px 10px 6px 28px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
          <Btn size="sm" loading={searching} disabled={!draft.trim()} onClick={() => void search(draft)}>Search</Btn>
        </div>

        {lastUpdateSummary && (
          <div className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            {lastUpdateSummary}
          </div>
        )}

        {/* Files edited in place. Forcing overwrites them, so this asks rather than retrying. */}
        {blocked.length > 0 && (
          <div className="text-xs px-2 py-2 rounded flex flex-col gap-2" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--text-primary)' }}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={13} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
              <span>
                <b>{blocked.join(', ')}</b> {blocked.length === 1 ? 'has' : 'have'} been edited since {blocked.length === 1 ? 'it was' : 'they were'} installed.
                Updating replaces those changes.
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <Btn size="sm" variant="outline" onClick={clearBlocked}>Keep my changes</Btn>
              <Btn size="sm" variant="danger" loading={busy === 'update:all'} onClick={() => void updateAll({ force: true })}>
                Overwrite and update
              </Btn>
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs px-2 py-1.5 rounded flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={clearError} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
          </div>
        )}

        <div className="flex flex-col gap-1.5 overflow-y-auto" style={{ minHeight: 120 }}>
          {searched && results.length === 0 && !searching && (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
              Nothing on ClawHub matches “{query}”.
            </p>
          )}
          {results.map(r => {
            const already = installedSlugs.has(r.slug) || installed.includes(r.installRef)
            const canInstall = isInstallable(r)
            return (
              <div key={r.installRef} className="flex items-start gap-3 px-3 py-2" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-elevated)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {r.displayName || r.slug}
                    </span>
                    <span className="text-xs px-1.5 rounded" style={{
                      border: '1px solid var(--border)',
                      color: r.official ? 'var(--accent)' : 'var(--text-secondary)',
                    }}>{skillTrustLabel(r)}</span>
                    {r.version && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.version}</span>}
                  </div>
                  {r.summary && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {r.summary}
                    </div>
                  )}
                  {/* The publisher-qualified ref, which is what actually gets installed. */}
                  <div className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                    {r.installRef}{typeof r.downloads === 'number' ? ` · ${r.downloads.toLocaleString()} installs` : ''}
                  </div>
                </div>
                {already ? (
                  <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--accent)' }}>
                    <CheckCircle2 size={12} /> Installed
                  </span>
                ) : (
                  <Btn size="sm" variant="outline"
                    icon={busy === r.installRef ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    disabled={busy !== null || !canInstall}
                    title={canInstall ? undefined : 'ClawHub reports this skill as not currently installable'}
                    onClick={() => void install(r)}>
                    Install
                  </Btn>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
