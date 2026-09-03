import { useEffect, useRef, useState } from 'react'
import { NavRail } from './components/layout/NavRail'
import { StatusBar } from './components/layout/StatusBar'
import { TitleBar } from './components/layout/TitleBar'
import { ChatView } from './components/chat/ChatView'
import { TalkView } from './components/talk/TalkView'
import { AgentsView } from './components/agents/AgentsView'
import { GatewayView, focusGatewayTab } from './components/gateway/GatewayView'
import { SettingsView } from './components/settings/SettingsView'
import { ThemesView } from './components/theme/ThemesView'
import { ThemeBackground } from './components/theme/ThemeBackground'
import { CronsView } from './components/crons/CronsView'
import { ProcessesView } from './components/processes/ProcessesView'
import { TeamsView } from './components/teams/TeamsView'
import { MemoryView } from './components/memory/MemoryView'
import { DashboardView } from './components/dashboard/DashboardView'
import { BillingView } from './components/billing/BillingView'
import { SystemMonitorHUD } from './components/monitor/SystemMonitorHUD'
import { ConnectScreen } from './components/layout/ConnectScreen'
import { ReconnectOverlay } from './components/layout/ReconnectOverlay'
import { UpdateBanner } from './components/layout/UpdateBanner'
import { PluginUpdateBanner } from './components/layout/PluginUpdateBanner'
import { GatewayUpdateBanner } from './components/layout/GatewayUpdateBanner'
import { ScopeWarningBanner } from './components/layout/ScopeWarningBanner'
import { WelcomeModal } from './components/layout/WelcomeModal'
import { BottomNav } from './components/layout/BottomNav'
import { FileDrawer } from './components/files/FileDrawer'
import { PanelErrorBoundary } from './components/common/PanelErrorBoundary'
import { useIsNarrow } from './lib/useIsNarrow'
import { useNotificationsWatcher } from './lib/useNotificationsWatcher'
import { useChatStore } from './store/chat'
import { isElectron } from './lib/platform'
import { useUpdaterStore } from './store/updater'
import { useConnectionStore, restoreConnectionsFromBackup } from './store/connection'
import { useMetricsStore } from './store/metrics'
import { useSettingsStore, ZOOM_STEP, restoreProfileFromBackup } from './store/settings'
import { useExtensionsStore } from './store/extensions'
import { useProcessesStore } from './store/processes'
import { useSessionsStore } from './store/sessions'
import { useTeamsStore } from './store/teams'
import { useSkillsStore } from './store/skills'
import { useFilesStore, resetFilesForConnection } from './store/files'

export type NavSection = 'dashboard' | 'chat' | 'talk' | 'agents' | 'processes' | 'teams' | 'crons' | 'obsidian' | 'billing' | 'gateway' | 'themes' | 'settings'

export default function App() {
  const [section, setSection] = useState<NavSection>('dashboard')
  const narrow = useIsNarrow()
  // An expanded file takes over the content area (the drawer is a sibling of <main>).
  const filesExpanded = useFilesStore(s => s.open && s.expanded)
  useNotificationsWatcher()
  const { status, connection, reconnecting } = useConnectionStore()
  const { start: startMetrics, stop: stopMetrics } = useMetricsStore()
  const { monitorVisible, welcomeSeen, profileRestored } = useSettingsStore()
  const { plugins, skills, load: loadExtensions } = useExtensionsStore()
  const obsidianEnabled =
    plugins.some(p => /obsidian/i.test(p.id) && p.enabled) ||
    skills.some(s => /obsidian/i.test(s.id) && s.enabled)

  useEffect(() => {
    startMetrics()
    // Restore saved connections from the file backup (resilient to localStorage
    // resets) and keep the backup in sync going forward.
    restoreConnectionsFromBackup()
    // Profile + "welcome seen" survive a localStorage reset, and are shared between the
    // packaged app and the dev build (separate origins) — so the welcome asks once, ever.
    void restoreProfileFromBackup()
    return () => stopMetrics()
  }, [])

  // A different gateway host has different files — and may not have the plugin at all.
  // Drop the per-connection Files state so nothing from the previous host lingers.
  useEffect(() => { resetFilesForConnection() }, [connection?.url])

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

  // A tapped PWA notification routes here (via the service worker → main.tsx window event).
  useEffect(() => {
    const handler = (e: Event) => {
      const nav = (e as CustomEvent).detail as { section?: NavSection; convId?: string } | undefined
      if (!nav) return
      if (nav.convId) useChatStore.getState().selectConversation(nav.convId)
      if (nav.section) setSection(nav.section)
    }
    window.addEventListener('joax:navigate', handler)
    return () => window.removeEventListener('joax:navigate', handler)
  }, [])

  // Install the app-native agent skills (ask-user, script-runner, process-builder,
  // teams-blueprint) on connect. Local gateways get a direct file write; remote get an
  // upload over the gateway WebSocket (skills.upload.* + skills.install).
  const runSkillInstall = useSkillsStore(s => s.run)
  useEffect(() => {
    if (status === 'connected') runSkillInstall(connection?.url)
  }, [status, connection?.url])

  const notConnected = status !== 'connected'
  const ALL_GATEWAY_SECTIONS: NavSection[] = ['dashboard', 'chat', 'talk', 'agents', 'processes', 'teams', 'crons', 'obsidian', 'billing', 'gateway']
  const disabledSections: NavSection[] = notConnected
    // Keep Dashboard clickable while disconnected so it routes back to the connect
    // screen — otherwise, opening the Theme editor (the one non-gateway view) would
    // trap the user there with every other nav item disabled.
    ? ALL_GATEWAY_SECTIONS.filter(s => s !== 'dashboard')
    : obsidianEnabled ? [] : ['obsidian']

  // While auto-reconnecting (e.g. the gateway reloaded after a channel change),
  // show the explanatory overlay instead of bouncing to the manual connect screen.
  const showConnect = notConnected && !reconnecting && section !== 'settings' && section !== 'themes'

  return (
    // h-full, not h-screen: #root is already sized to the visible viewport (100dvh in
    // index.css). h-screen is 100vh, which on a mobile browser is taller than what you can
    // see, and it pushes the bottom tab bar off-screen.
    <div className="flex flex-col h-full select-none">
      {/* Custom title bar is Electron window chrome — omit it in the browser/PWA build. */}
      {isElectron() && <TitleBar />}
      <UpdateBanner />
      <ScopeWarningBanner onFix={() => { focusGatewayTab('connection'); setSection('gateway') }} />
      <GatewayUpdateBanner onOpenChat={() => setSection('chat')} />
      <PluginUpdateBanner onOpenChat={() => setSection('chat')} />
      <div className="flex flex-1 min-h-0">
        {/* Persistent side rail on desktop; a bottom tab bar on narrow (mobile) screens
            (rendered below, as a sibling of the status bar so it sits in the thumb zone). */}
        {!narrow && <NavRail section={section} onNavigate={setSection} disabledSections={disabledSections} />}
        {/* The Files drawer is a real side panel, so an expanded file gets the whole
            content area rather than covering the chat with an overlay. */}
        <main
          className="flex-1 min-w-0 flex flex-col relative"
          style={{ background: 'var(--bg-primary)', ...(filesExpanded ? { display: 'none' } : {}) }}
        >
          <ThemeBackground slot="app" />
          <div className="relative z-[1] flex-1 min-w-0 min-h-0 flex flex-col">
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
              {section === 'processes' && <ProcessesView onOpenChat={() => setSection('chat')} />}
              {section === 'teams' && <TeamsView onOpenChat={() => setSection('chat')} />}
              {section === 'crons' && <CronsView onOpenChat={() => setSection('chat')} />}
              {section === 'obsidian' && <MemoryView onOpenChat={() => setSection('chat')} />}
              {section === 'billing' && <BillingView />}
              {section === 'gateway' && <GatewayView onOpenChat={() => setSection('chat')} />}
              {section === 'themes' && <ThemesView />}
              {section === 'settings' && <SettingsView />}
            </>
          )}
          {monitorVisible && <SystemMonitorHUD />}
          </div>
        </main>
        {!showConnect && !reconnecting && (
          <PanelErrorBoundary label="Files">
            <FileDrawer onOpenChat={() => setSection('chat')} />
          </PanelErrorBoundary>
        )}
      </div>
      <StatusBar />
      {/* Mobile primary navigation lives at the very bottom (thumb zone), just under the
          status bar. Shown in the same states the app itself is usable — not on the
          connect screen or the reconnect overlay. */}
      {narrow && !showConnect && !reconnecting && (
        <BottomNav section={section} onNavigate={setSection} disabledSections={disabledSections} />
      )}
      {/* First-run welcome — once the user is connected and in the app, invite them to
          introduce themselves (Settings → You covers it afterward). */}
      {status === 'connected' && profileRestored && !welcomeSeen && <WelcomeModal />}
    </div>
  )
}
