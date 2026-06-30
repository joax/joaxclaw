import { useEffect, useRef, useState } from 'react'
import { NavRail } from './components/layout/NavRail'
import { StatusBar } from './components/layout/StatusBar'
import { TitleBar } from './components/layout/TitleBar'
import { ChatView } from './components/chat/ChatView'
import { TalkView } from './components/talk/TalkView'
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
import { UpdateBanner } from './components/layout/UpdateBanner'
import { useUpdaterStore } from './store/updater'
import { useConnectionStore, restoreConnectionsFromBackup } from './store/connection'
import { useMetricsStore } from './store/metrics'
import { useSettingsStore, ZOOM_STEP } from './store/settings'
import { useExtensionsStore } from './store/extensions'
import { useProcessesStore } from './store/processes'
import { useSessionsStore } from './store/sessions'
import { useTeamsStore } from './store/teams'
import { useSkillsStore } from './store/skills'

export type NavSection = 'dashboard' | 'chat' | 'talk' | 'agents' | 'processes' | 'teams' | 'extensions' | 'sessions' | 'crons' | 'obsidian' | 'models' | 'gateway' | 'settings'

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

  // Whole-app zoom: Ctrl/Cmd and +/- to scale text & UI, Ctrl/Cmd+0 to reset.
  // Persisted in settings; re-applied here once the preload bridge is available.
  useEffect(() => {
    useSettingsStore.getState().setUiZoom(useSettingsStore.getState().uiZoom)
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const s = useSettingsStore.getState()
      if (e.key === '=' || e.key === '+') { e.preventDefault(); s.setUiZoom(s.uiZoom + ZOOM_STEP) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); s.setUiZoom(s.uiZoom - ZOOM_STEP) }
      else if (e.key === '0') { e.preventDefault(); s.setUiZoom(0) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-update check: independent of the gateway. Checks GitHub Releases shortly
  // after launch, then every 6 hours, when the preference is on. A found update
  // surfaces via the app-wide UpdateBanner; manual checks live in Settings.
  useEffect(() => {
    const PERIOD_MS = 6 * 60 * 60 * 1000
    let interval: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      if (useSettingsStore.getState().autoUpdateCheck) {
        void useUpdaterStore.getState().check({ silent: true })
      }
    }
    const initial = setTimeout(tick, 4000)
    interval = setInterval(tick, PERIOD_MS)
    return () => { clearTimeout(initial); if (interval) clearInterval(interval) }
  }, [])

  // Load extensions whenever the gateway becomes connected.
  // The initial call at mount usually fails (connection not ready yet),
  // so we re-load on every successful connect / reconnect.
  useEffect(() => {
    if (status === 'connected') {
      loadExtensions()
      // Re-attach to any team/process run that was still executing on the gateway when
      // the app last closed, so a restart keeps tracking it (idempotent per run).
      useProcessesStore.getState().load()
      // Seed sessions + teams (and start their live event tracking) so the tray's
      // running counts are accurate regardless of which tab is open.
      useSessionsStore.getState().fetch()
      useTeamsStore.getState().load()
    }
  }, [status])

  // Keep the system tray's run counts (agents running / teams running) up to date.
  // The stores update on every gateway frame, so only push when a count changes.
  const trayRuns     = useProcessesStore(s => s.runs)
  const trayTeams    = useTeamsStore(s => s.blueprints)
  const traySessions = useSessionsStore(s => s.sessions)
  const lastTray     = useRef('')
  useEffect(() => {
    const teamIds = new Set(trayTeams.map(b => b.id))
    const teams   = Object.values(trayRuns).filter(r => r.status === 'running' && teamIds.has(r.processId)).length
    const agents  = traySessions.filter(s => s.hasActiveRun).length
    const key = `${agents}:${teams}`
    if (key === lastTray.current) return
    lastTray.current = key
    window.api?.tray?.update?.({ agents, teams })
  }, [trayRuns, trayTeams, traySessions])

  // Tray menu can jump the app to a section (e.g. clicking "Teams running").
  useEffect(() => {
    const off = window.api?.app?.onNavigate?.(s => setSection(s as NavSection))
    return () => off?.()
  }, [])

  // Install the app-native agent skills (process-builder, teams-blueprint) on
  // connect. Local gateways get a direct file write; remote gateways get an
  // upload over the gateway WebSocket (skills.upload.* + skills.install).
  const runSkillInstall = useSkillsStore(s => s.run)
  useEffect(() => {
    if (status === 'connected') runSkillInstall(connection?.url)
  }, [status, connection?.url])

  const notConnected = status !== 'connected'
  const ALL_GATEWAY_SECTIONS: NavSection[] = ['dashboard', 'chat', 'talk', 'agents', 'processes', 'teams', 'extensions', 'sessions', 'crons', 'obsidian', 'models', 'gateway']
  const disabledSections: NavSection[] = notConnected
    // Keep Dashboard clickable while disconnected so it routes back to the connect
    // screen — otherwise, opening the Theme editor (the one non-gateway view) would
    // trap the user there with every other nav item disabled.
    ? ALL_GATEWAY_SECTIONS.filter(s => s !== 'dashboard')
    : obsidianEnabled ? [] : ['obsidian']

  // While auto-reconnecting (e.g. the gateway reloaded after a channel change),
  // show the explanatory overlay instead of bouncing to the manual connect screen.
  const showConnect = notConnected && !reconnecting && section !== 'settings'

  return (
    <div className="flex flex-col h-screen select-none">
      <TitleBar />
      <UpdateBanner />
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
              {section === 'talk' && <TalkView />}
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
