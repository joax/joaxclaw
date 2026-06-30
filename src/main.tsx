import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ChatPopout } from './components/chat/ChatPopout'
import './index.css'
import { DEFAULT_THEME } from './lib/types'
import { applyTheme } from './lib/theme'
import { useSettingsStore } from './store/settings'

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

// A pop-out chat window is the same renderer deep-linked to one session
// (?popout=chat&session=<key>) — render just that chat instead of the full app.
const params = new URLSearchParams(window.location.search)
const popoutSession = params.get('popout') === 'chat' ? (params.get('session') ?? '') : ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {popoutSession ? <ChatPopout sessionKey={popoutSession} /> : <App />}
  </React.StrictMode>
)
