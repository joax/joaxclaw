import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ChatPopout } from './components/chat/ChatPopout'
import { AboutWindow } from './components/layout/AboutWindow'
import './index.css'
import { DEFAULT_THEME } from './lib/presetThemes'
import { applyTheme } from './lib/theme'
import { useSettingsStore } from './store/settings'
import { installMobileBridge } from './lib/mobileBridge'

// On a non-Electron runtime (Capacitor webview / browser dev) install a no-op
// `window.api` so the renderer boots without the preload bridge. Inert on desktop.
installMobileBridge()

// Apply the active theme before first render. The settings store has already
// rehydrated from localStorage by the time this runs (it's imported transitively via
// App above), so read the saved selection rather than forcing DEFAULT_THEME — which
// would clobber the user's theme back to dark on every reload.
const { themes, activeThemeId } = useSettingsStore.getState()
applyTheme(themes.find(t => t.id === activeThemeId) ?? DEFAULT_THEME)

// Flatten the window's rounded corners while it's maximized / full-screen (a
// maximized window should be square against the screen edges).
window.api?.window?.onMaximized?.(max => {
  document.documentElement.classList.toggle('win-maximized', max)
})

// Secondary windows reuse this renderer via a ?popout=… query: a chat deep-linked to
// one session, or the About window. Otherwise render the full app.
const params = new URLSearchParams(window.location.search)
const popout = params.get('popout')
const popoutSession = popout === 'chat' ? (params.get('session') ?? '') : ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {popout === 'about' ? <AboutWindow />
      : popoutSession ? <ChatPopout sessionKey={popoutSession} />
      : <App />}
  </React.StrictMode>
)
