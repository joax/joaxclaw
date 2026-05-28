import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { DEFAULT_THEME } from './lib/types'
import { applyTheme } from './lib/theme'

// Apply default theme before first render
applyTheme(DEFAULT_THEME)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
