import { useEffect, useState } from 'react'
import { RefreshCw, Download, ExternalLink, RotateCw, Sparkles, CheckCircle2 } from 'lucide-react'
import { useSettingsStore, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '../../store/settings'
import { useUpdaterStore } from '../../store/updater'
import { Btn } from '../ui/Btn'

// Theme editing lives in its own screen now (components/theme/ThemesView). This keeps the
// non-appearance app settings: status-bar meters, zoom, stall timeout, and updates.
export function SettingsView() {
  const { showGpu, showRam, showHeartbeat, showModelName, streamStallTimeout, setAppPref, uiZoom, setUiZoom } = useSettingsStore()

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="p-6 flex flex-col gap-4" style={{ maxWidth: 520 }}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Settings</h2>

        <ProfileSection />

        <Section title="Status Bar">
          <div className="space-y-2">
            {[
              { label: 'Show GPU meter', key: 'showGpu', value: showGpu },
              { label: 'Show RAM meter', key: 'showRam', value: showRam },
              { label: 'Show heartbeat', key: 'showHeartbeat', value: showHeartbeat },
              { label: 'Show model name', key: 'showModelName', value: showModelName },
            ].map(({ label, key, value }) => (
              <Toggle
                key={key}
                label={label}
                value={value}
                onChange={v => useSettingsStore.setState({ [key]: v } as Partial<typeof useSettingsStore>)}
              />
            ))}
          </div>
        </Section>

        <Section title="App">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Zoom</label>
                <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{Math.round(Math.pow(1.2, uiZoom) * 100)}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Btn size="sm" variant="outline" onClick={() => setUiZoom(uiZoom - ZOOM_STEP)} disabled={uiZoom <= ZOOM_MIN}>−</Btn>
                <Btn size="sm" variant="outline" onClick={() => setUiZoom(0)} disabled={uiZoom === 0}>Reset</Btn>
                <Btn size="sm" variant="outline" onClick={() => setUiZoom(uiZoom + ZOOM_STEP)} disabled={uiZoom >= ZOOM_MAX}>+</Btn>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                Scales the whole app. Shortcut: <b style={{ color: 'var(--text-primary)' }}>Ctrl/⌘ +</b> / <b style={{ color: 'var(--text-primary)' }}>−</b> (and <b style={{ color: 'var(--text-primary)' }}>Ctrl/⌘ 0</b> to reset).
              </p>
            </div>
            <SliderField
              label="Stream stall timeout"
              value={streamStallTimeout}
              min={15} max={300} unit="s"
              description="How long to wait for new tokens before showing the 'Model stopped responding' banner."
              onChange={v => setAppPref('streamStallTimeout', v)}
            />
          </div>
        </Section>

        <UpdatesSection />
      </div>
    </div>
  )
}

function ProfileSection() {
  const { userProfile, setUserProfile, shareProfile, setShareProfile, useNameAsIdentity, setUseNameAsIdentity } = useSettingsStore()

  return (
    <Section title="You">
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.8, lineHeight: 1.5 }}>
          Tell your agents who they're talking to. Your name and a short description are shared as context at the start of new chats, so replies are addressed and tailored to you.
        </p>
        <TextField
          label="Name"
          value={userProfile.name}
          placeholder="How agents should address you"
          onChange={v => setUserProfile({ name: v })}
        />
        <TextAreaField
          label="About you"
          value={userProfile.about}
          placeholder="Role, expertise, how you like answers (concise vs. detailed), timezone, anything worth knowing…"
          onChange={v => setUserProfile({ about: v })}
        />
        <div className="pt-1 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
          <Toggle label="Share my profile with agents" value={shareProfile} onChange={setShareProfile} />
          <Toggle label="Use my name as my chat identity" value={useNameAsIdentity} onChange={setUseNameAsIdentity} />
          {useNameAsIdentity && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.65 }}>
              Replaces the “JoaxClaw” sender label the model sees. Takes effect on the next reconnect.
            </p>
          )}
        </div>
      </div>
    </Section>
  )
}

function UpdatesSection() {
  const { autoUpdateCheck, setAutoUpdateCheck } = useSettingsStore()
  const { status, info, lastChecked, error, check, download, install } = useUpdaterStore()
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    const api = (window as unknown as { api?: { app?: { version: () => Promise<string> } } }).api
    api?.app?.version().then(v => setVersion(v)).catch(() => { /* not in Electron */ })
  }, [])

  const checking = status === 'checking'
  const hasUpdate = !!info?.available
  const downloadable = hasUpdate && !!info?.asset

  return (
    <Section title="Updates">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Current version</p>
            <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              v{version || '…'}
            </p>
          </div>
          <Btn size="sm" variant="outline" icon={<RefreshCw size={12} className={checking ? 'animate-spin' : ''} />}
               loading={checking} onClick={() => check()}>
            Check now
          </Btn>
        </div>

        {status === 'up-to-date' && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <CheckCircle2 size={13} style={{ color: 'var(--accent)' }} />
            You're on the latest version.
          </div>
        )}
        {hasUpdate && (
          <div
            className="px-3 py-2.5 rounded space-y-2"
            style={{ background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))', border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))' }}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={13} style={{ color: 'var(--accent)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                v{info?.latestVersion} available
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {downloadable && status !== 'downloaded' && status !== 'downloading' && (
                <Btn size="sm" icon={<Download size={12} />} loading={status === 'downloading'} onClick={() => download()}>
                  Download
                </Btn>
              )}
              {status === 'downloading' && (
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Downloading…</span>
              )}
              {status === 'downloaded' && (
                <Btn size="sm" icon={<RotateCw size={12} />} onClick={() => install()}>Install</Btn>
              )}
              <Btn size="sm" variant="ghost" icon={<ExternalLink size={12} />}
                   onClick={() => useUpdaterStore.getState().openReleasePage()}>
                Release notes
              </Btn>
            </div>
          </div>
        )}
        {status === 'error' && (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>{error ?? 'Update check failed.'}</p>
        )}
        {lastChecked && !checking && (
          <p className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.65 }}>
            Last checked {new Date(lastChecked).toLocaleString()}
          </p>
        )}

        <Toggle label="Check for updates automatically" value={autoUpdateCheck} onChange={setAutoUpdateCheck} />
      </div>
    </Section>
  )
}

const fieldInputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)', outline: 'none',
}

export function TextField({ label, value, placeholder, onChange }: {
  label: string; value: string; placeholder?: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={fieldInputStyle} />
    </div>
  )
}

export function TextAreaField({ label, value, placeholder, onChange, rows = 4 }: {
  label: string; value: string; placeholder?: string; onChange: (v: string) => void; rows?: number
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <textarea value={value} placeholder={placeholder} rows={rows} onChange={e => onChange(e.target.value)}
        style={{ ...fieldInputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div className="px-4 py-2.5 text-xs font-semibold" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function SliderField({ label, value, min, max, unit, description, onChange }: {
  label: string; value: number; min: number; max: number; unit: string; description?: string; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
        <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{value}{unit}</span>
      </div>
      {description && (
        <p className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)', opacity: 0.65 }}>{description}</p>
      )}
      <input
        type="range"
        min={min} max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 36, height: 20, borderRadius: 10, cursor: 'pointer', border: 'none', position: 'relative',
          background: value ? 'var(--accent)' : 'var(--border)', transition: 'background 0.2s'
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3, left: value ? 19 : 3, transition: 'left 0.2s'
        }} />
      </button>
    </div>
  )
}
