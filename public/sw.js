/* JoaxClaw PWA service worker — dependency-free.
 *
 * Strategy:
 *  - Navigations (the app shell): network-first, falling back to the cached shell when
 *    offline. Keeps the app loading fresh on each launch but survives a dropped network.
 *  - Same-origin static assets (hashed, immutable Vite output): cache-first, so repeat
 *    launches are instant; a new build ships new hashes, so there's no staleness.
 *  - Everything else (gateway WebSocket, cross-origin, non-GET): passthrough, untouched.
 *
 * Bump CACHE to invalidate old entries on a breaking change.
 */
const CACHE = 'joaxclaw-pwa-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  // Warm the shell so the very first offline launch works.
  event.waitUntil(caches.open(CACHE).then((c) => c.add('./').catch(() => {})))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Tapping a notification: focus an existing app window (or open one) and tell it
// where to route. The client re-dispatches this as a `joax:navigate` window event.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  // `navigate` comes from a Tier 1 notification this app raised itself; `url` comes from
  // a gateway push and is a Control UI path we translate app-side (lib/webPush.ts), so
  // the mapping stays in one tested place rather than being duplicated here.
  const msg = { type: 'joax-navigate', navigate: data.navigate, url: data.url }
  const routable = data.navigate || data.url
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.focus()
          if (routable) c.postMessage(msg)
          return
        }
      }
      return self.clients.openWindow('./').then((c) => {
        if (c && routable) c.postMessage(msg)
      })
    })
  )
})

// Tier 2: true background push from the gateway, which wakes this worker even with the
// app fully closed. OpenClaw sends `{ title, body, tag, url?, renotify }` — `url` is its
// own Control UI path and is absent for categories with nothing to select (a finished
// agent run, a failed background task). `navigate` is accepted too so a payload this app
// generates itself keeps working.
//
// `userVisibleOnly: true` was promised at subscribe time, so every push MUST show a
// notification; bailing out silently is what gets a subscription revoked by the browser.
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { /* ignore */ }
  const title = (payload && payload.title) || 'JoaxClaw'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body,
      tag: payload.tag,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { navigate: payload.navigate, url: payload.url },
      // The gateway sets renotify:false on a replacement (e.g. an approval going
      // terminal) so a re-tagged alert doesn't buzz the phone a second time.
      ...(payload.tag ? { renotify: payload.renotify !== false } : {}),
    })
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return   // gateway WS, CDNs, etc. — untouched

  // App shell / navigations → network-first, cached fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./', copy))
          return res
        })
        .catch(() => caches.match('./').then((r) => r || caches.match(req)))
    )
    return
  }

  // Static assets → cache-first, populate on miss.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
    )
  )
})
