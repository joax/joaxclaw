import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ChatPopout } from './components/chat/ChatPopout'
import { AboutWindow } from './components/layout/AboutWindow'
import './index.css'
import { DEFAULT_THEME } from './lib/presetThemes'
import { applyTheme } from './lib/theme'
import { useSettingsStore } from './store/settings'
import { installBrowserApi } from './lib/mobile/browserApi'
import { isElectron } from './lib/platform'

// In a plain browser (PWA / mobile companion) there's no Electron preload, so provide
// a `window.api` shim: a real WebSocket for the gateway + a WebCrypto device identity,
// with desktop-only surfaces degraded to no-ops. No-op under Electron. Must run before
// anything touches window.api.
installBrowserApi()

// Register the PWA service worker in the browser build only (never under Electron) —
// enables install-to-home-screen and an offline-capable launch. See public/sw.js. The
// './' base keeps it working whether the app is served at the root or a sub-path.
if (!isElectron() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* SW optional; app still runs */ })
  })
  // A tapped notification posts here from the SW; re-dispatch as a window event the
  // app listens for to route to the right chat/view.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'joax-navigate' && e.data.navigate) {
      window.dispatchEvent(new CustomEvent('joax:navigate', { detail: e.data.navigate }))
    }
  })
}

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
