import { useEffect, useState } from 'react'
import { Github, Heart, RefreshCw, CheckCircle2, Sparkles, ExternalLink } from 'lucide-react'
import { TitleBar } from './TitleBar'
import { useUpdaterStore } from '../../store/updater'
import logoUrl from '../../assets/logo-dark.png'

const REPO_URL    = 'https://github.com/joax/joaxclaw'
const SPONSOR_URL = 'https://github.com/sponsors/joax'
const AUTHOR      = 'Joaquin Ayuso'

function openExternal(url: string) {
  window.api?.app?.openExternal?.(url)
}

// The "About JoaxClaw" window, opened from the tray menu: app version, an update
// check, repository link, sponsorship/donation link, and copyright.
export function AboutWindow() {
  const { status, info, error, check } = useUpdaterStore()
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api?.app?.version?.().then(setVersion).catch(() => { /* not in Electron */ })
  }, [])

  const checking = status === 'checking'
  const hasUpdate = !!info?.available

  return (
    <div className="flex flex-col h-screen select-none" style={{ background: 'var(--bg-primary)' }}>
      <TitleBar />
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-7 py-6 text-center">
        <img src={logoUrl} alt="JoaxClaw" style={{ height: 72, width: 'auto' }} />
        <h1 className="text-xl font-semibold mt-3" style={{ color: 'var(--text-primary)' }}>JoaxClaw</h1>
        <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
          v{version || '…'}
        </p>
        <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          A desktop control UI for <button onClick={() => openExternal('https://openclaw.dev')}
            className="underline" style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}>
            OpenClaw</button> — a self-hosted AI agent gateway.
        </p>

        {/* Update check */}
        <div className="mt-5 w-full flex flex-col items-center gap-2">
          <button
            onClick={() => check()}
            disabled={checking}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded transition-colors"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: checking ? 'default' : 'pointer' }}
          >
            <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {status === 'up-to-date' && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <CheckCircle2 size={13} style={{ color: 'var(--accent)' }} /> You're on the latest version.
            </span>
          )}
          {hasUpdate && (
            <button
              onClick={() => useUpdaterStore.getState().openReleasePage()}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded"
              style={{ border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--border))', background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))', color: 'var(--accent)', cursor: 'pointer' }}
            >
              <Sparkles size={12} /> v{info?.latestVersion} available — view release <ExternalLink size={11} />
            </button>
          )}
          {status === 'error' && (
            <span className="text-xs" style={{ color: 'var(--danger)' }}>{error ?? 'Update check failed.'}</span>
          )}
        </div>

        <div style={{ height: 1, background: 'var(--border)', width: '100%', margin: '20px 0' }} />

        {/* Links */}
        <div className="w-full flex flex-col gap-2">
          <AboutLink icon={<Github size={15} />} label="GitHub repository" onClick={() => openExternal(REPO_URL)} />
          <AboutLink
            icon={<Heart size={15} style={{ color: '#ec4899' }} />}
            label="Sponsor this project"
            sub="Support development via GitHub Sponsors"
            onClick={() => openExternal(SPONSOR_URL)}
          />
        </div>

        <div className="flex-1" />
        <p className="text-xs mt-6" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
          © {new Date().getFullYear()} {AUTHOR} · MIT License
        </p>
      </div>
    </div>
  )
}

function AboutLink({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-3 py-2.5 rounded text-left transition-colors"
      style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)' }}
    >
      <span style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {sub && <span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{sub}</span>}
      </span>
      <ExternalLink size={13} style={{ color: 'var(--text-secondary)', opacity: 0.6, flexShrink: 0 }} />
    </button>
  )
}
