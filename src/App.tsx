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
import { ObsidianView } from './components/obsidian/ObsidianView'
import { ModelsView } from './components/models/ModelsView'
import { SystemMonitorHUD } from './components/monitor/SystemMonitorHUD'
import { ConnectScreen } from './components/layout/ConnectScreen'
import { useConnectionStore } from './store/connection'
import { useMetricsStore } from './store/metrics'
import { useSettingsStore } from './store/settings'
import { useExtensionsStore } from './store/extensions'

export type NavSection = 'chat' | 'agents' | 'extensions' | 'sessions' | 'crons' | 'obsidian' | 'models' | 'gateway' | 'settings'

export default function App() {
  const [section, setSection] = useState<NavSection>('chat')
  const { status } = useConnectionStore()
  const { start: startMetrics, stop: stopMetrics } = useMetricsStore()
  const { monitorVisible } = useSettingsStore()
  const { plugins, skills, load: loadExtensions } = useExtensionsStore()
  const obsidianEnabled =
    plugins.some(p => /obsidian/i.test(p.id) && p.enabled) ||
    skills.some(s => /obsidian/i.test(s.id) && s.enabled)

  useEffect(() => {
    startMetrics()
    return () => stopMetrics()
  }, [])

  // Load extensions whenever the gateway becomes connected.
  // The initial call at mount usually fails (connection not ready yet),
  // so we re-load on every successful connect / reconnect.
  useEffect(() => {
    if (status === 'connected') loadExtensions()
  }, [status])

  const notConnected = status !== 'connected'
  const ALL_GATEWAY_SECTIONS: NavSection[] = ['chat', 'agents', 'extensions', 'sessions', 'crons', 'obsidian', 'models', 'gateway']
  const disabledSections: NavSection[] = notConnected
    ? ALL_GATEWAY_SECTIONS
    : obsidianEnabled ? [] : ['obsidian']

  const showConnect = notConnected && section !== 'settings'

  return (
    <div className="flex flex-col h-screen select-none">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <NavRail section={section} onNavigate={setSection} disabledSections={disabledSections} />
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
              {section === 'obsidian' && <ObsidianView onNavigateExtensions={() => setSection('extensions')} />}
              {section === 'models' && <ModelsView />}
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
