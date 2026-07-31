// Which paths under /app/ stay public even though the app itself is gated.
//
// A PWA can only be installed if the browser can read its manifest, register its service
// worker, and fetch its icons. Those requests are not ordinary page loads:
//
//   • the manifest is fetched with credentials OMITTED unless the <link> opts in with
//     crossorigin="use-credentials", so a cookie-gated manifest fails even for a
//     signed-in user, and
//   • a service worker script that answers with a redirect fails registration outright.
//
// Gating them therefore doesn't protect anything — the files are public in the repo and
// carry no user data — it just makes the app uninstallable. The app's own HTML and its
// JS/CSS bundle stay behind the gate.

const PUBLIC_APP_ASSETS = /^\/app\/(manifest\.webmanifest|sw\.js|apple-touch-icon\.png|favicon\.ico|icons\/[^/]+)$/

export function isPublicAppAsset(pathname) {
  return PUBLIC_APP_ASSETS.test(String(pathname ?? ''))
}
