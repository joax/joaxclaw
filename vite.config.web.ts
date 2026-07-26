import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone WEB target for the mobile companion / PWA. Serves the SAME renderer as the
// Electron app, but in a plain browser (no Electron main, no preload). There, `window.api`
// is absent so main.tsx installs the browser shim (real WebSocket + WebCrypto device
// identity — see src/lib/mobile/). Use this to develop and test the responsive layout and
// the PWA path, which the Electron window can't show (it enforces a desktop minWidth).
//
//   npm run dev:web    → dev server at http://localhost:5173 (open in a browser; use
//                        device-emulation / narrow the window to exercise the mobile UI)
//   npm run build:web  → static bundle in out/web (the future PWA)
//
// `base: './'` keeps asset paths relative so the bundle can be served same-origin from
// the gateway (no gateway.controlUi.allowedOrigins change needed) or any mount point.
export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: { '@renderer': resolve('src'), '@': resolve('src') },
  },
  plugins: [react()],
  css: { postcss: resolve('postcss.config.js') },
  server: { port: 5173, strictPort: false },
  build: { outDir: 'out/web', emptyOutDir: true },
})
