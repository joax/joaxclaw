import { useEffect, useState } from 'react'
import { TitleBar } from '../layout/TitleBar'
import { StatusBar } from '../layout/StatusBar'
import { ChatView } from './ChatView'
import { ReconnectOverlay } from '../layout/ReconnectOverlay'
import { useConnectionStore } from '../../store/connection'
import { useMetricsStore } from '../../store/metrics'
import { useSettingsStore } from '../../store/settings'

// The root of a popped-out chat window: a minimal shell that connects to the same
// gateway as the main window (credentials are handed over by the main process) and
// renders ChatView locked to one session. It runs its own gateway socket, so it
// streams the conversation live and independently of the main window.
export function ChatPopout({ sessionKey }: { sessionKey: string }) {
  const { status, reconnecting, connect } = useConnectionStore()
  const { start: startMetrics, stop: stopMetrics } = useMetricsStore()
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    // Re-apply the persisted UI zoom in this window's frame, and drive the status bar.
    useSettingsStore.getState().setUiZoom(useSettingsStore.getState().uiZoom)
    startMetrics()
    let cancelled = false
    void (async () => {
      const info = await window.api?.window?.popoutInfo?.()
      if (cancelled) return
      const conn = info?.connection
      if (conn?.url) connect({ url: conn.url, token: conn.token })
      setBootstrapped(true)
    })()
    return () => { cancelled = true; stopMetrics() }
  }, [])

  return (
    <div className="flex flex-col h-screen select-none">
      <TitleBar />
      <div className="flex flex-1 min-h-0" style={{ background: 'var(--bg-primary)' }}>
        {reconnecting ? (
          <ReconnectOverlay />
        ) : status === 'connected' ? (
          <ChatView solo={sessionKey} />
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
