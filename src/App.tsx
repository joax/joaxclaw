import { useEffect, useState } from 'react'
import { NavRail } from './components/layout/NavRail'
import { StatusBar } from './components/layout/StatusBar'
import { TitleBar } from './components/layout/TitleBar'
import { ChatView } from './components/chat/ChatView'
import { AgentsView } from './components/agents/AgentsView'
import { SessionsView } from './components/sessions/SessionsView'
import { GatewayView } from './components/gateway/GatewayView'
import { SettingsView } from './components/settings/SettingsView'
import { ExtensionsView } from './components/extensions/ExtensionsView'
import { CronsView } from './components/crons/CronsView'
import { SystemMonitorHUD } from './components/monitor/SystemMonitorHUD'
import { ConnectScreen } from './components/layout/ConnectScreen'
import { useConnectionStore } from './store/connection'
import { useMetricsStore } from './store/metrics'
import { useSettingsStore } from './store/settings'

export type NavSection = 'chat' | 'agents' | 'extensions' | 'sessions' | 'crons' | 'gateway' | 'settings'

export default function App() {
  const [section, setSection] = useState<NavSection>('chat')
  const { status } = useConnectionStore()
  const { start: startMetrics, stop: stopMetrics } = useMetricsStore()
  const { monitorVisible } = useSettingsStore()

  useEffect(() => {
    startMetrics()
    return () => stopMetrics()
  }, [])

  // Show connect screen while disconnected, connecting, or in error state
  // (but let user reach Settings and Gateway even without a connection)
  const showConnect = (status === 'disconnected' || status === 'connecting' || status === 'error')
    && section !== 'settings'
    && section !== 'gateway'

  return (
    <div className="flex flex-col h-screen select-none">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <NavRail section={section} onNavigate={setSection} />
        <main className="flex-1 min-w-0 flex flex-col relative" style={{ background: 'var(--bg-primary)' }}>
          {showConnect ? (
            <ConnectScreen onConnect={() => setSection('chat')} />
          ) : (
            <>
              {section === 'chat' && <ChatView />}
              {section === 'agents' && <AgentsView onOpenChat={() => setSection('chat')} />}
              {section === 'extensions' && <ExtensionsView />}
              {section === 'sessions' && <SessionsView onOpenChat={() => setSection('chat')} />}
              {section === 'crons' && <CronsView />}
              {section === 'gateway' && <GatewayView />}
              {section === 'settings' && <SettingsView />}
            </>
          )}
          {monitorVisible && (
            <div className="absolute bottom-4 right-4 z-50">
              <SystemMonitorHUD />
            </div>
          )}
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
