import { Minus, Square, X } from 'lucide-react'
import { useLogoUrl } from '../../lib/logo'

declare global {
  interface Window {
    api: {
      window: {
        minimize(): void; maximize(): void; close(): void
        setTitleBarOverlay?(color: string, symbolColor: string): void
        popOutChat?(sessionKey: string): void
        returnChat?(sessionKey: string): void
        popoutInfo?(): Promise<{ connection: { url: string; token: string } | null }>
        listPoppedOut?(): Promise<string[]>
        onPoppedOut?(cb: (keys: string[]) => void): () => void
        onFocusSession?(cb: (sessionKey: string) => void): () => void
        onMaximized?(cb: (maximized: boolean) => void): () => void
      }
      app?: { version?(): Promise<string>; onNavigate?(cb: (section: string) => void): () => void; openExternal?(url: string): void }
      tray?: { update?(counts: { agents: number; teams: number }): void }
      config: { read(): Promise<{ ok: boolean; text?: string; path?: string; error?: string }>; write(t: string): Promise<{ ok: boolean }> }
      gateway: { restart(): Promise<{ok:boolean;stdout:string;stderr:string}>; restartSafe(): Promise<{ok:boolean;stdout:string;stderr:string}>; stop(): Promise<{ok:boolean;stdout:string;stderr:string}>; status(): Promise<{ok:boolean;stdout:string;stderr:string}> }
      metrics: { get(): Promise<{ ok: boolean; cpu: number; ramUsed: number; ramTotal: number; gpu: { model: string; utilizationGpu: number; memUsed: number; memTotal: number; temperatureGpu: number }[] }> }
    }
  }
}

export function TitleBar() {
  const isElectron = !!window.api?.window
  const logoUrl = useLogoUrl()

  return (
    <div
      className="flex items-center justify-between px-4 shrink-0"
      style={{
        height: 36,
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)',
        WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion']
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <img src={logoUrl} alt="JoaxClaw" style={{ height: 20, width: 'auto' }} />
        <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          JoaxClaw
        </span>
      </div>

      {isElectron && (
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <WinBtn onClick={() => window.api.window.minimize()} label="Minimize">
            <Minus size={11} />
          </WinBtn>
          <WinBtn onClick={() => window.api.window.maximize()} label="Maximize">
            <Square size={10} />
          </WinBtn>
          <WinBtn onClick={() => window.api.window.close()} label="Close" danger>
            <X size={11} />
          </WinBtn>
        </div>
      )}
    </div>
  )
}

function WinBtn({ children, onClick, label, danger }: { children: React.ReactNode; onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center justify-center transition-colors"
      style={{
        width: 24, height: 24, borderRadius: 4,
        color: 'var(--text-secondary)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer'
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = danger ? 'var(--danger)' : 'var(--bg-elevated)'
        if (danger) (e.currentTarget as HTMLButtonElement).style.color = '#fff'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        if (danger) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
      }}
    >
      {children}
    </button>
  )
}
