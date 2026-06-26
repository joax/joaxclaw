import { Download, X, ExternalLink, Sparkles, RotateCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useUpdaterStore } from '../../store/updater'
import { useSettingsStore } from '../../store/settings'
import { Btn } from '../ui/Btn'

function fmtBytes(n: number): string {
  if (!n) return ''
  const mb = n / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

// A slim, dismissible app-wide banner shown when an update is available or a
// download/install is in flight. Lives just under the title bar. Steady-state
// (no update, up-to-date, manual checks) is handled in Settings → Updates.
export function UpdateBanner() {
  const { status, info, progress, installAction, error, dismissed,
          download, install, restart, openReleasePage, skipVersion, dismiss, reset } = useUpdaterStore()
  const skipped = useSettingsStore(s => s.skippedUpdateVersion)

  const inFlight = status === 'downloading' || status === 'downloaded' || status === 'installing'
  const offerUpdate = !!info?.available && !dismissed && skipped !== info.latestVersion
  if (!offerUpdate && !inFlight && status !== 'error') return null
  // An 'error' with no pending update (e.g. a failed manual check) belongs in
  // Settings, not the banner.
  if (status === 'error' && !info?.available) return null

  const platform = info?.platform
  const isWin = platform === 'win32'
  const isMac = platform === 'darwin'

  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{
        background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        className="flex items-center justify-center rounded-full shrink-0"
        style={{ width: 26, height: 26, background: 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
      >
        {status === 'error'
          ? <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />
          : status === 'downloaded'
            ? <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />
            : <Sparkles size={14} style={{ color: 'var(--accent)' }} />}
      </div>

      <div className="flex-1 min-w-0">
        <Body
          status={status} info={info} progress={progress} installAction={installAction}
          error={error} isWin={isWin} isMac={isMac}
        />
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Actions
          status={status} info={info} installAction={installAction} isWin={isWin}
          onDownload={download} onInstall={install} onRestart={restart}
          onViewNotes={openReleasePage} onRetry={() => (status === 'error' ? download() : reset())}
        />
        {!inFlight && status !== 'installing' && (
          <>
            {info?.available && (
              <button
                onClick={skipVersion}
                className="text-xs px-2 py-1 rounded"
                style={{ color: 'var(--text-secondary)', background: 'transparent' }}
                title={`Skip v${info.latestVersion} — don't remind me until the next release`}
              >
                Skip
              </button>
            )}
            <button
              onClick={dismiss}
              className="flex items-center justify-center rounded"
              style={{ width: 24, height: 24, color: 'var(--text-secondary)' }}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Body({ status, info, progress, installAction, error, isWin, isMac }: {
  status: string
  info: ReturnType<typeof useUpdaterStore.getState>['info']
  progress: { received: number; total: number; percent: number } | null
  installAction: string | null
  error: string | null
  isWin: boolean
  isMac: boolean
}) {
  const v = info?.latestVersion
  if (status === 'downloading') {
    const pct = Math.round((progress?.percent ?? 0) * 100)
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Downloading v{v}…
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {pct}%{progress?.total ? ` · ${fmtBytes(progress.received)} / ${fmtBytes(progress.total)}` : ''}
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
        </div>
      </div>
    )
  }
  if (status === 'installing') {
    return <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Installing v{v}…</span>
  }
  if (status === 'downloaded') {
    // Post-handoff guidance differs per OS / install method.
    if (installAction === 'opened-dmg') {
      return (
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          <b>v{v} mounted.</b> Drag JoaxClaw into Applications, then reopen the app.
        </span>
      )
    }
    if (installAction === 'installed-deb') {
      return (
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          <b>v{v} installed.</b> Restart to finish updating.
        </span>
      )
    }
    if (installAction === 'revealed') {
      return (
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          <b>v{v} downloaded.</b> Opened your file manager — run the package to install.
        </span>
      )
    }
    return (
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
        <b>v{v} ready to install.</b>{' '}
        {isWin ? 'The installer will run and the app will restart.'
          : isMac ? "We'll open the disk image so you can drop it into Applications."
            : "We'll install it with your system package manager."}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
        Update failed{error ? `: ${error}` : '.'}
      </span>
    )
  }
  // available
  if (info?.noAssetForPlatform) {
    return (
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
        <b>JoaxClaw v{v}</b> is available — no installer was published for your platform yet.
      </span>
    )
  }
  return (
    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
      <b>JoaxClaw v{v}</b> is available{info?.asset?.size ? ` (${fmtBytes(info.asset.size)})` : ''}.
      <span style={{ color: 'var(--text-secondary)' }}> You're on v{info?.currentVersion}.</span>
    </span>
  )
}

function Actions({ status, info, installAction, isWin, onDownload, onInstall, onRestart, onViewNotes, onRetry }: {
  status: string
  info: ReturnType<typeof useUpdaterStore.getState>['info']
  installAction: string | null
  isWin: boolean
  onDownload: () => void
  onInstall: () => void
  onRestart: () => void
  onViewNotes: () => void
  onRetry: () => void
}) {
  if (status === 'downloading' || status === 'installing') return null

  if (status === 'downloaded') {
    if (installAction === 'installed-deb') {
      return <Btn size="sm" icon={<RotateCw size={12} />} onClick={onRestart}>Restart now</Btn>
    }
    if (installAction) {
      // mac dmg / revealed deb — handoff done, just a link to the notes.
      return (
        <Btn size="sm" variant="outline" icon={<ExternalLink size={12} />} onClick={onViewNotes}>
          Release notes
        </Btn>
      )
    }
    return (
      <Btn size="sm" icon={isWin ? <RotateCw size={12} /> : <Download size={12} />} onClick={onInstall}>
        {isWin ? 'Install & restart' : 'Install'}
      </Btn>
    )
  }

  if (status === 'error') {
    return (
      <>
        <Btn size="sm" variant="outline" icon={<RotateCw size={12} />} onClick={onRetry}>Retry</Btn>
        <Btn size="sm" variant="ghost" icon={<ExternalLink size={12} />} onClick={onViewNotes}>Open release</Btn>
      </>
    )
  }

  // available
  return (
    <>
      {info?.asset
        ? <Btn size="sm" icon={<Download size={12} />} onClick={onDownload}>Download</Btn>
        : <Btn size="sm" icon={<ExternalLink size={12} />} onClick={onViewNotes}>Open release page</Btn>}
      {info?.asset && (
        <Btn size="sm" variant="ghost" icon={<ExternalLink size={12} />} onClick={onViewNotes}>Notes</Btn>
      )}
    </>
  )
}
