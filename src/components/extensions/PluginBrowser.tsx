import { useState, type ReactNode } from 'react'
import { Search, Download, Loader2, ShieldAlert, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import { usePluginCatalogStore } from '../../store/pluginCatalog'
import { describeSurface, surfaceHasDanger, trustLabel } from '../../lib/pluginCatalog'
import { findingLocation, hasCriticalFinding } from '../../lib/pluginInstall'
import { Btn } from '../ui/Btn'
import { Pill } from '../ui/Pill'
import { InstallStatus } from './InstallStatus'
import { CommandHint } from '../ui/CommandHint'
import { PluginCatalogBrowser } from './PluginCatalogBrowser'
import { useGatewaySupport } from '../../lib/useGatewaySupport'

// Find and install plugins from ClawHub.
//
// "Add plugin" beside this registers a config entry for a plugin already on disk — it
// installs nothing. Until now that was the only route, so getting a plugin onto the
// gateway meant leaving the app for a shell.
//
// A 2026.9 gateway has a real catalog (plugins.catalog.*), browsed in
// PluginCatalogBrowser. Older gateways keep the search box below, unchanged apart from
// the automatic restart after an install.
export function PluginBrowser({ onClose, installedIds, onManage, onOpenChat }: {
  onClose: () => void
  installedIds: Set<string>
  onManage: (pluginId: string) => void
  onOpenChat?: () => void
}) {
  const catalog = useGatewaySupport({ methods: ['plugins.catalog.browse'] }).supported
  const search = useGatewaySupport({ methods: ['plugins.search'] }).supported
  if (catalog) return <PluginCatalogBrowser onClose={onClose} onManage={onManage} onOpenChat={onOpenChat} />
  if (search) return <PluginSearchBrowser onClose={onClose} installedIds={installedIds} />
  return <PluginsFromHostOnly onClose={onClose} />
}

// Gateways before 2026.7 (2026.6.x) have no plugin search or install RPCs at all: plugins
// go on from the host's CLI.
function PluginsFromHostOnly({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center"
      style={{ top: 36, background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Browse plugins" className="flex flex-col p-5 gap-3" style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        width: 520, maxWidth: '94vw', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Browse plugins</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={16} />
          </button>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          This gateway can&apos;t search for or install plugins from apps. Update OpenClaw, or install them on the gateway host:
        </p>
        <CommandHint command="openclaw plugins search <name>" lead="" />
        <CommandHint command="openclaw plugins install <name>" lead="" />
      </div>
    </div>
  )
}

export function PluginSearchBrowser({ onClose, installedIds }: { onClose: () => void; installedIds: Set<string> }) {
  const {
    query, results, searching, searched, busy, error, consent, policy, justInstalled,
    search, install, clearError,
  } = usePluginCatalogStore()
  const [draft, setDraft] = useState(query)

  const isInstalled = (runtimeId: string | undefined, name: string) =>
    (runtimeId && installedIds.has(runtimeId)) || justInstalled.includes(runtimeId ?? name)

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center"
      style={{ top: 36, background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="flex flex-col p-5 gap-3" style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        width: 620, maxWidth: '94vw', maxHeight: '86vh', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Browse plugins</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void search(draft) }}
              placeholder="Search ClawHub — slack, notion, memory…"
              style={{ width: '100%', padding: '6px 10px 6px 28px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
          <Btn size="sm" loading={searching} disabled={!draft.trim()} onClick={() => void search(draft)}>Search</Btn>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Installing restarts the gateway. JoaxClaw reconnects on its own.
        </p>

        <InstallStatus origin="browser" />

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
          {results.map(hit => {
            const p = hit.package
            const installed = isInstalled(p.runtimeId, p.name)
            return (
              <div key={p.name} className="flex items-start gap-3 px-3 py-2" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-elevated)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.displayName}</span>
                    <span className="text-xs px-1.5 rounded" style={{
                      border: '1px solid var(--border)',
                      color: p.isOfficial ? 'var(--accent)' : 'var(--text-secondary)',
                    }}>{trustLabel(p)}</span>
                    {p.latestVersion && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.latestVersion}</span>}
                  </div>
                  {p.summary && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{p.summary}</div>
                  )}
                  <div className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                    {p.name}{typeof p.downloads === 'number' ? ` · ${p.downloads.toLocaleString()} downloads` : ''}
                  </div>
                </div>
                {installed ? (
                  <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 size={12} /> Installed
                  </span>
                ) : (
                  <Btn size="sm" variant="outline" icon={busy === p.displayName ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    disabled={busy !== null} title={busy !== null && busy !== p.displayName ? 'Another plugin is installing' : undefined}
                    onClick={() => void install(p)}>
                    Install
                  </Btn>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {(consent || policy) && <ConsentDialog />}
    </div>
  )
}

// What the plugin is asking to be allowed to do, or what the install policy flagged.
//
// The gateway refuses an install until this surface is acknowledged, and hands back a
// token to acknowledge it with. Echoing that token automatically would defeat the point:
// it is the record that a person saw this and agreed. `widened` is why it re-asks — a
// plugin cannot quietly grow its reach across an update on consent given for less.
//
// The same dialog asks the second question (review mode): the gateway's install policy
// found something in the package worth a look, and says what and where. Continuing
// retries with `acknowledgeInstallPolicyWarning`.
/** The plugin consent / install-review prompt. Also shown by the channel form and Meetings. */
export function ConsentDialog() {
  const consent = usePluginCatalogStore(s => s.consent)
  const policy = usePluginCatalogStore(s => s.policy)
  if (consent) return <CapabilityConsent />
  if (policy) return <PolicyReview />
  return null
}

function DialogShell({ danger, title, onClose, children }: { danger: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex flex-col p-5 gap-3" style={{
        background: 'var(--bg-surface)', border: `1px solid ${danger ? 'var(--danger)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)', width: 480, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function CapabilityConsent() {
  const { consent, busy, acceptConsent, dismissConsent } = usePluginCatalogStore()
  if (!consent) return null
  const { challenge, name, declared } = consent

  const widened = describeSurface(challenge.widened)
  const full = describeSurface(declared)
  const lines = widened.length > 0 ? widened : full
  const danger = surfaceHasDanger(challenge.widened) || surfaceHasDanger(declared)
  const title = widened.length > 0 ? `${name} wants more access` : `Allow ${name} to do this?`

  return (
    <DialogShell danger={danger} title={title} onClose={dismissConsent}>
      <div className="flex items-center gap-2">
        <ShieldAlert size={16} style={{ color: danger ? 'var(--danger)' : 'var(--accent)' }} />
        <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {widened.length > 0
          ? `You approved this plugin before${challenge.acceptedAt ? ` on ${new Date(challenge.acceptedAt).toLocaleDateString()}` : ''}. Since then it has declared the following in addition:`
          : 'Installing it lets it register the following on your gateway:'}
      </p>

      {lines.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          This plugin declares no channels, tools or config flags.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {lines.map(line => (
            <div key={line.label}>
              <div className="text-xs font-semibold" style={{ color: line.dangerous ? 'var(--danger)' : 'var(--text-secondary)' }}>
                {line.label}
              </div>
              <div className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                {line.items.join(', ')}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 justify-end mt-1">
        <Btn size="sm" variant="outline" onClick={dismissConsent}>Cancel</Btn>
        <Btn size="sm" variant={danger ? 'danger' : 'primary'} loading={busy !== null} onClick={() => void acceptConsent()}>
          Install {name}
        </Btn>
      </div>
    </DialogShell>
  )
}

// Severity → state tone. `info` is informational, not a state, so it stays neutral.
const SEVERITY_TONE = { info: 'neutral', warn: 'needsYou', critical: 'failed' } as const

function PolicyReview() {
  const { policy, busy, acceptPolicy, dismissPolicy } = usePluginCatalogStore()
  if (!policy) return null
  const { warning, name } = policy
  const critical = hasCriticalFinding(warning)
  return (
    <DialogShell danger={critical} title="Review required" onClose={dismissPolicy}>
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} style={{ color: critical ? 'var(--danger)' : 'var(--warning)' }} />
        <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Review required</h3>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>The gateway&apos;s install policy flagged {name}:</p>
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>&ldquo;{warning.reason}&rdquo;</p>
      {warning.findings.length > 0 && (
        <ul className="flex flex-col gap-1.5" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {warning.findings.map((f, i) => (
            <li key={`${f.ruleId}-${i}`} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
              <Pill tone={SEVERITY_TONE[f.severity]}>{f.severity}</Pill>
              {findingLocation(f) && <span className="font-mono shrink-0" style={{ color: 'var(--text-secondary)' }}>{findingLocation(f)}</span>}
              <span style={{ minWidth: 0 }}>{f.message}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 justify-end mt-1">
        <Btn size="sm" variant="outline" onClick={dismissPolicy}>Cancel</Btn>
        <Btn size="sm" variant={critical ? 'danger' : 'primary'} loading={busy !== null} onClick={() => void acceptPolicy()}>
          Continue installation
        </Btn>
      </div>
    </DialogShell>
  )
}
