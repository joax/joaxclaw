import { useEffect, useState } from 'react'
import { TitleBar } from '../layout/TitleBar'
import { StatusBar } from '../layout/StatusBar'
import { ReconnectOverlay } from '../layout/ReconnectOverlay'
import { FilePreview } from './FilePreview'
import { useConnectionStore } from '../../store/connection'
import { useSettingsStore } from '../../store/settings'

// The root of a popped-out file window: a minimal shell that connects to the same
// gateway as the main window and renders one file. It runs its own gateway socket, so
// it re-reads the file from the host independently — the path in the URL is the whole
// state, which is what lets the window survive a reload. See docs/files-drawer.md.
export function FilePopout({ path, name }: { path: string; name?: string }) {
  const { status, reconnecting, connect } = useConnectionStore()
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    useSettingsStore.getState().setUiZoom(useSettingsStore.getState().uiZoom)
    let cancelled = false
    void (async () => {
      // Electron hands a pop-out the live connection. In a browser tab there's no such
      // channel, so fall back to the most recently saved gateway — the same one the
      // main tab is talking to in every realistic case.
      const info = await window.api?.window?.popoutInfo?.()
      if (cancelled) return
      const conn = info?.connection ?? useConnectionStore.getState().savedConnections[0] ?? null
      if (conn?.url) connect({ url: conn.url, token: conn.token })
      setBootstrapped(true)
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="flex flex-col h-screen select-none">
      <TitleBar />
      <div className="flex flex-1 min-h-0" style={{ background: 'var(--bg-primary)' }}>
        {reconnecting ? (
          <ReconnectOverlay />
        ) : status === 'connected' ? (
          <FilePreview path={path} name={name} canPopOut={false} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            {!bootstrapped ? 'Loading…' : status === 'error' ? 'Could not reach the gateway.' : 'Connecting to gateway…'}
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  )
}
