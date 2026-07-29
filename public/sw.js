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
  const nav = event.notification.data && event.notification.data.navigate
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.focus()
          if (nav) c.postMessage({ type: 'joax-navigate', navigate: nav })
          return
        }
      }
      return self.clients.openWindow('./').then((c) => {
        if (c && nav) c.postMessage({ type: 'joax-navigate', navigate: nav })
      })
    })
  )
})

// Tier 2 (true background push) placeholder — inert until the gateway sends Web Push.
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { /* ignore */ }
  if (!payload || !payload.title) return
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { navigate: payload.navigate },
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
