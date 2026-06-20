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
import { ProcessesView } from './components/processes/ProcessesView'
import { TeamsView } from './components/teams/TeamsView'
import { ObsidianView } from './components/obsidian/ObsidianView'
import { DashboardView } from './components/dashboard/DashboardView'
import { ModelsView } from './components/models/ModelsView'
import { SystemMonitorHUD } from './components/monitor/SystemMonitorHUD'
import { ConnectScreen } from './components/layout/ConnectScreen'
import { ReconnectOverlay } from './components/layout/ReconnectOverlay'
import { useConnectionStore, restoreConnectionsFromBackup } from './store/connection'
import { useMetricsStore } from './store/metrics'
import { useSettingsStore } from './store/settings'
import { useExtensionsStore } from './store/extensions'
import { useSkillsStore } from './store/skills'

export type NavSection = 'dashboard' | 'chat' | 'agents' | 'processes' | 'teams' | 'extensions' | 'sessions' | 'crons' | 'obsidian' | 'models' | 'gateway' | 'settings'

export default function App() {
  const [section, setSection] = useState<NavSection>('dashboard')
  const { status, connection, reconnecting } = useConnectionStore()
  const { start: startMetrics, stop: stopMetrics } = useMetricsStore()
  const { monitorVisible } = useSettingsStore()
  const { plugins, skills, load: loadExtensions } = useExtensionsStore()
  const obsidianEnabled =
    plugins.some(p => /obsidian/i.test(p.id) && p.enabled) ||
    skills.some(s => /obsidian/i.test(s.id) && s.enabled)

  useEffect(() => {
    startMetrics()
    // Restore saved connections from the file backup (resilient to localStorage
    // resets) and keep the backup in sync going forward.
    restoreConnectionsFromBackup()
    return () => stopMetrics()
  }, [])

  // Load extensions whenever the gateway becomes connected.
  // The initial call at mount usually fails (connection not ready yet),
  // so we re-load on every successful connect / reconnect.
  useEffect(() => {
    if (status === 'connected') loadExtensions()
  }, [status])

  // Install the app-native agent skills (process-builder, teams-blueprint) on
  // connect. Local gateways get a direct file write; remote gateways get an
  // upload over the gateway WebSocket (skills.upload.* + skills.install).
  const runSkillInstall = useSkillsStore(s => s.run)
  useEffect(() => {
    if (status === 'connected') runSkillInstall(connection?.url)
  }, [status, connection?.url])

  const notConnected = status !== 'connected'
  const ALL_GATEWAY_SECTIONS: NavSection[] = ['dashboard', 'chat', 'agents', 'processes', 'teams', 'extensions', 'sessions', 'crons', 'obsidian', 'models', 'gateway']
  const disabledSections: NavSection[] = notConnected
    ? ALL_GATEWAY_SECTIONS
    : obsidianEnabled ? [] : ['obsidian']

  // While auto-reconnecting (e.g. the gateway reloaded after a channel change),
  // show the explanatory overlay instead of bouncing to the manual connect screen.
  const showConnect = notConnected && !reconnecting && section !== 'settings'

  return (
    <div className="flex flex-col h-screen select-none">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <NavRail section={section} onNavigate={setSection} disabledSections={disabledSections} />
        <main className="flex-1 min-w-0 flex flex-col relative" style={{ background: 'var(--bg-primary)' }}>
          {reconnecting ? (
            <ReconnectOverlay />
          ) : showConnect ? (
            <ConnectScreen onConnect={() => setSection('dashboard')} />
          ) : (
            <>
              {section === 'dashboard' && <DashboardView onNavigate={setSection} />}
              {section === 'chat' && <ChatView />}
              {section === 'agents' && <AgentsView onOpenChat={() => setSection('chat')} />}
              {section === 'extensions' && <ExtensionsView />}
              {section === 'sessions' && <SessionsView onOpenChat={() => setSection('chat')} />}
              {section === 'processes' && <ProcessesView onOpenChat={() => setSection('chat')} />}
              {section === 'teams' && <TeamsView onOpenChat={() => setSection('chat')} />}
              {section === 'crons' && <CronsView onOpenChat={() => setSection('chat')} />}
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
