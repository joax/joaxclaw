import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, Bot } from 'lucide-react'
import { usePluginCatalogStore } from '../../store/pluginCatalog'
import {
  cardAction, clawhubUrl, formatCount, hostInstallCommand, installTargetForEntry, needsNewerGateway, needsSummary,
  readmeForDisplay, securityLabel, unavailableReason, updatedAgo, type DiscoveryEntry,
} from '../../lib/pluginCatalog'
import { gatewayClient } from '../../lib/gateway'
import { sendViaAgent } from '../../lib/agentPrompt'
import { toneColor } from '../../lib/stateTone'
import { MarkdownContent } from '../chat/MarkdownContent'
import { Btn } from '../ui/Btn'
import { Pill } from '../ui/Pill'
import { CommandHint } from '../ui/CommandHint'
import { InstallStatus } from './InstallStatus'

// What a plugin is before you install it: who publishes it, what it needs (API keys,
// settings), what it adds, ClawHub's security verdict, which version, and its README.
// A pre-install read is the point of the catalog, so the pane is where the install
// button lives in full, with the restart warning above it.

/** The install origin for a catalog entry, so its pane (and only its pane) shows the run. */
export const catalogOrigin = (entryId: string) => `browser:${entryId}`

export function PluginDetailPane({ entry, admin, connected, onBack, onManage, onOpenChat }: {
  entry: DiscoveryEntry
  admin: boolean
  connected: boolean
  /** Phone only: back to the list. */
  onBack?: () => void
  onManage: (pluginId: string) => void
  onOpenChat?: () => void
}) {
  const slot = usePluginCatalogStore(s => s.details[entry.id])
  const busy = usePluginCatalogStore(s => s.busy)
  const mutationAllowed = usePluginCatalogStore(s => s.mutationAllowed)
  const loadDetail = usePluginCatalogStore(s => s.loadDetail)
  const installAndRestart = usePluginCatalogStore(s => s.installAndRestart)
  const [version, setVersion] = useState<string>('')
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Focus the heading when a plugin opens, so a screen reader starts at its name.
  useEffect(() => { headingRef.current?.focus(); setVersion('') }, [entry.id])

  // The detail's own copy of the entry is fresher once loaded (it's what `get` returned).
  const live = slot?.plugin ?? entry
  const detail = slot?.detail
  const action = cardAction(live, { admin })
  const origin = catalogOrigin(entry.id)
  const hasRun = usePluginCatalogStore(s => s.run?.target.origin === origin)
  const author = detail?.author?.displayName ?? detail?.author?.handle ?? live.catalog.author
  const verified = !!(detail?.verification?.tier ?? live.catalog.verificationTier)
  const latest = live.catalog.latestVersion
  const security = securityLabel(detail?.security)
  const readme = readmeForDisplay(detail?.readme)
  const hubUrl = clawhubUrl(detail?.packageName ?? live.catalog.packageName, detail?.author?.handle)
  const tooNew = needsNewerGateway(detail?.compatibility?.minGatewayVersion, gatewayClient.serverVersion)
  const versions = detail?.origin === 'clawhub' ? detail.versions : []
  const command = hostInstallCommand(live)
  const needs = detail ? needsSummary(detail, live.local.installed ? live.local.state : undefined) : []

  const install = () => {
    const target = installTargetForEntry(live, { version: version || undefined, origin })
    if (target) void installAndRestart(target)
  }
  const installViaAgent = () => {
    sendViaAgent([
      'Run these commands on the gateway host (the machine you are running on), one after the other, and report their output:',
      '',
      '```bash',
      command,
      'openclaw gateway restart',
      '```',
      '',
      `This installs the ${live.catalog.name} plugin and restarts the gateway so it loads.`,
    ].join('\n'), onOpenChat)
  }

  const meta = [
    author ? `by ${author}` : null,
    latest ? `v${latest}` : null,
    verified ? 'verified' : null,
  ].filter(Boolean).join(' · ')
  const counts = [
    typeof live.catalog.installs === 'number' ? `${formatCount(live.catalog.installs)} installs`
      : typeof live.catalog.downloads === 'number' ? `${formatCount(live.catalog.downloads)} downloads` : null,
    detail?.updatedAt ? `updated ${updatedAgo(detail.updatedAt)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-start gap-2 px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        {onBack && (
          <button onClick={onBack} aria-label="Back to the list" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
            <ArrowLeft size={16} />
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <h4 ref={headingRef} tabIndex={-1} className="text-sm font-semibold" style={{ color: 'var(--text-primary)', outline: 'none' }}>
              {live.catalog.name}
            </h4>
            {live.catalog.official && <Pill tone="working">Official</Pill>}
            {action.pill && <Pill tone={action.pill.tone}>{action.pill.text}</Pill>}
          </div>
          {meta && <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{meta}</div>}
          {counts && <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{counts}</div>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3 text-xs" style={{ color: 'var(--text-primary)' }}>
        {slot?.loading && !detail && <PaneSkeleton />}
        {slot?.error && !detail && (
          <div className="px-2.5 py-2 rounded flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
            <span style={{ flex: 1 }}>Couldn&apos;t load details for {live.catalog.name}. {slot.error}</span>
            <Btn size="sm" variant="outline" onClick={() => void loadDetail(entry.id, true)}>Try again</Btn>
          </div>
        )}

        {detail && (
          <>
            {needs.length > 0 && (
              <Row label="Needs">
                <ul style={{ margin: 0, paddingLeft: 14 }}>
                  {needs.map(line => <li key={line}>{line}</li>)}
                </ul>
              </Row>
            )}
            {security && (
              <Row label="Security">
                <span style={{ color: toneColor(security.tone) }}>{security.text}</span>
                {detail.security?.summary && <span style={{ color: 'var(--text-secondary)' }}> · {detail.security.summary}</span>}
                {detail.security?.auditUrl && /^https:\/\//.test(detail.security.auditUrl) && (
                  <a href={detail.security.auditUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 ml-1" style={{ color: 'var(--accent)' }}>
                    Security audit <ExternalLink size={10} />
                  </a>
                )}
              </Row>
            )}
            {tooNew && detail.compatibility?.minGatewayVersion && (
              <p style={{ color: toneColor('needsYou') }}>
                Needs OpenClaw {detail.compatibility.minGatewayVersion.replace(/^[^\d]+/, '')} or later
              </p>
            )}
            {versions.length > 0 && (
              <Row label="Version">
                <select
                  value={version}
                  onChange={e => setVersion(e.target.value)}
                  aria-label="Version to install"
                  style={{ fontSize: 12, padding: '2px 6px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                >
                  <option value="">{latest ? `${latest} (latest)` : '(latest)'}</option>
                  {versions.filter(v => v.version !== latest).map(v => <option key={v.version} value={v.version}>{v.version}</option>)}
                </select>
              </Row>
            )}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              {readme ? (
                <div className="text-sm" style={{ userSelect: 'text' }}>
                  {/* Markdown only: raw HTML in a README is shown as text, never rendered. */}
                  <MarkdownContent text={readme.text} />
                  {readme.truncated && hubUrl && (
                    <a href={hubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                      Read the full README on ClawHub <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>This plugin doesn&apos;t include a README.</p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="px-4 py-3 flex flex-col gap-2" style={{ borderTop: '1px solid var(--border)' }}>
        <InstallStatus origin={origin} action={action.kind === 'manage' || action.kind === 'configure'
          ? <Btn size="sm" variant="outline" onClick={() => live.local.pluginId && onManage(live.local.pluginId)}>{action.label}</Btn>
          : undefined} />
        {action.kind === 'install' && (
          <>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Installing restarts the gateway. JoaxClaw reconnects on its own.</p>
            <div className="flex justify-end">
              <Btn size="sm" disabled={!connected || busy !== null} loading={busy === live.catalog.name}
                title={busy !== null && busy !== live.catalog.name ? 'Another plugin is installing' : undefined}
                onClick={install}>
                {busy === live.catalog.name ? 'Installing…' : 'Install'}
              </Btn>
            </div>
          </>
        )}
        {action.kind === 'askAdmin' && (
          <>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Installing needs admin access. Run this on the gateway host:</p>
            <CommandHint command={command} lead="" />
            <div className="flex justify-end">
              <Btn size="sm" variant="outline" icon={<Bot size={12} />} disabled={!connected} onClick={installViaAgent}>Install via agent</Btn>
            </div>
          </>
        )}
        {(action.kind === 'manage' || action.kind === 'configure') && !hasRun && (
          <div className="flex justify-end">
            <Btn size="sm" variant="outline" disabled={!live.local.pluginId} onClick={() => live.local.pluginId && onManage(live.local.pluginId)}>{action.label}</Btn>
          </div>
        )}
        {action.kind === 'none' && (
          <>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{unavailableReason(live, { mutationAllowed })}</p>
            {mutationAllowed === false && <CommandHint command={command} lead="" />}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 font-semibold" style={{ width: 64, color: 'var(--text-secondary)' }}>{label}</span>
      <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
    </div>
  )
}

function PaneSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[80, 60, 90, 70].map((w, i) => (
        <div key={i} className="animate-pulse" style={{ height: 10, width: `${w}%`, borderRadius: 4, background: 'var(--bg-elevated)' }} />
      ))}
    </div>
  )
}
