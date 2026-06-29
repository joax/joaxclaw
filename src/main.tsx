import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
