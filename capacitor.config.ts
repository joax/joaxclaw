// Capacitor configuration — consumed by @capacitor/cli once the mobile tooling is
// installed (see MOBILE.md). No @capacitor types are imported here so this file is
// inert to the Electron/Vite build until Capacitor is added to the project.
//
// `webDir` points at the electron-vite renderer output; a dedicated web build target
// may replace it later (see MOBILE.md → "Build the web bundle").
const config = {
  appId: 'com.joax.joaxclaw',
  appName: 'JoaxClaw',
  webDir: 'out/renderer',
  server: {
    androidScheme: 'https',
  },
}

export default config
