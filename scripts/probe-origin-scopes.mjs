#!/usr/bin/env node
/**
 * Phase 0 probe — can a BROWSER-ORIGIN connection get operator scopes?
 *
 * Why: JoaxClaw proxies its gateway WebSocket through the Electron MAIN process
 * specifically so no `Origin` header is sent — the comment in electron/main/index.ts
 * says "the gateway clears scopes for browser-origin connections". A PWA/browser
 * cannot suppress `Origin`, so that behaviour decides whether a pure PWA companion
 * can ever hold operator scopes.
 *
 * OpenClaw's docs conflict on this (the protocol page says browser-origin can't get
 * full scopes; the Control UI page says browser sessions do, and the Control UI is
 * itself a browser SPA on the same socket). This probe settles it empirically.
 *
 * Method: two IDENTICAL device-less handshakes; the ONLY difference is the Origin
 * header. Whatever differs in the granted scope set is caused by Origin alone.
 *
 * Usage:
 *   node scripts/probe-origin-scopes.mjs <wsUrl> <token> [origin]
 *   node scripts/probe-origin-scopes.mjs wss://gateway.example:18789 "$TOKEN"
 *
 * Read-only: it performs a connect handshake and prints the granted scopes. It makes
 * no changes to the gateway.
 */
import WebSocket from 'ws'

const [, , url, token, origin = 'http://localhost:5173'] = process.argv
if (!url || !token) {
  console.error('usage: node scripts/probe-origin-scopes.mjs <wsUrl> <token> [origin]')
  process.exit(1)
}

const REQUESTED = [
  'operator.admin', 'operator.read', 'operator.write',
  'operator.approvals', 'operator.pairing', 'operator.talk.secrets',
]

function probe(label, wsOptions) {
  return new Promise(resolve => {
    const out = { label, granted: null, error: null, closed: null }
    let done = false
    let sock
    const finish = patch => {
      if (done) return
      done = true
      Object.assign(out, patch)
      try { sock?.terminate() } catch { /* already gone */ }
      resolve(out)
    }
    const timer = setTimeout(() => finish({ error: 'timeout after 12s' }), 12000)

    try { sock = new WebSocket(url, wsOptions) }
    catch (e) { clearTimeout(timer); return resolve({ ...out, error: String(e?.message ?? e) }) }

    sock.on('message', raw => {
      let f
      try { f = JSON.parse(raw.toString()) } catch { return }

      // Gateway challenges first; answer it with a device-LESS connect.
      if (f.type === 'event' && f.event === 'connect.challenge') {
        sock.send(JSON.stringify({
          type: 'req', id: 'req_1', method: 'connect',
          params: {
            minProtocol: 4, maxProtocol: 4,
            client: { id: 'gateway-client', displayName: 'phase0-probe', version: '0.0.0', platform: 'linux', mode: 'backend' },
            caps: ['tool-events'],
            auth: { token },
            role: 'operator',
            scopes: REQUESTED,
          },
        }))
        return
      }

      if (f.type === 'res' && f.id === 'req_1') {
        clearTimeout(timer)
        if (f.ok) finish({ granted: f.payload?.auth?.scopes ?? [] })
        else finish({ error: typeof f.error === 'string' ? f.error : JSON.stringify(f.error) })
      }
    })

    sock.on('error', e => { clearTimeout(timer); finish({ error: String(e?.message ?? e) }) })
    sock.on('close', (code, reason) => {
      clearTimeout(timer)
      finish({ closed: `${code}${reason ? ' ' + reason : ''}` })
    })
  })
}

const describe = r =>
  r.error ? `error: ${r.error}`
  : Array.isArray(r.granted) ? (r.granted.length ? r.granted.join(', ') : '(EMPTY — scopes cleared)')
  : `closed before hello-ok: ${r.closed}`

const noOrigin = await probe('A. NO Origin header  (what Electron main does today)', {})
const withOrigin = await probe(`B. WITH Origin: ${origin}  (what a PWA/browser sends)`, { headers: { Origin: origin } })

console.log('\n=== Phase 0 — browser-origin scope probe ===')
console.log(`gateway: ${url}`)
for (const r of [noOrigin, withOrigin]) console.log(`\n• ${r.label}\n    granted: ${describe(r)}`)

// ── Verdict ────────────────────────────────────────────────────────────────────
// This probe is device-LESS (it does not sign the challenge). The real app signs a
// device identity, which is what actually grants scopes — so an EMPTY result here is
// expected and means "device-less is the gate", NOT "Origin killed the scopes".
const a = Array.isArray(noOrigin.granted) ? noOrigin.granted : null
const b = Array.isArray(withOrigin.granted) ? withOrigin.granted : null
const originBlocked = !!withOrigin.error && /origin not allowed|CONTROL_UI_ORIGIN_NOT_ALLOWED/i.test(withOrigin.error)
console.log('\n--- verdict ---')
if (originBlocked && a && !a.length) {
  console.log('Two INDEPENDENT gates, both surmountable in a browser:')
  console.log('  1) Origin allowlist: the browser origin was rejected up front —')
  console.log('     add it to gateway.controlUi.allowedOrigins (or serve the PWA same-origin;')
  console.log('     loopback / RFC1918 / .local / .ts.net auto-accept).')
  console.log('  2) Scopes: the no-Origin connection ALSO got empty scopes — because it is')
  console.log('     DEVICE-LESS. So Origin is not the scope gate; device identity is.')
  console.log('→ A PWA that is origin-allowed AND signs the device challenge (WebCrypto) should get')
  console.log('  scopes — exactly what OpenClaw\'s own browser Control UI does. PWA looks viable;')
  console.log('  the definitive test is a signed handshake from an allowed origin.')
} else if (!a && !b) {
  console.log('Inconclusive: neither handshake completed. Check the URL/token and reachability.')
} else if (a && b && a.length && b.length) {
  console.log('Origin does NOT block scopes — a browser/PWA can hold operator scopes. PWA viable.')
} else if (a && !a.length && b && !b.length) {
  console.log('BOTH empty → device-LESS is the gate, not Origin. Implement the device-identity')
  console.log('handshake (WebCrypto) and add the origin to allowedOrigins. PWA looks viable.')
} else if (a?.length && b && !b.length) {
  console.log('Origin cleared scopes even WITH a device — test a signed browser handshake; if still')
  console.log('empty, prefer Capacitor (native socket).')
} else {
  console.log('Mixed/partial result — compare the two rows above against docs/mobile-companion.md.')
}
console.log()
