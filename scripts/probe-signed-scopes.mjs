#!/usr/bin/env node
/**
 * Phase 1 go/no-go — does a SIGNED (device-identity) handshake keep operator scopes
 * when an `Origin` header is present (the browser/PWA case)?
 *
 * The device-less probe (probe-origin-scopes.mjs) showed scopes come from device
 * identity, not from omitting Origin. This proves the browser case end-to-end by
 * replaying the desktop app's EXACT signed handshake (electron/main/deviceIdentity.ts:
 * Ed25519 over the "v3" pipe-joined payload), reusing the already-approved device
 * identity + stored operator device token under ~/.joaxclaw, and connecting:
 *   A) with NO Origin   — what the Electron app does today (control/sanity)
 *   B) with an Origin    — what a browser/PWA sends (the actual question)
 *
 * If B returns operator scopes, a browser-origin connection CAN hold scopes given a
 * device identity + an allowed origin → a PWA is viable. OpenClaw's own browser
 * Control UI does the same thing; this confirms it against your gateway.
 *
 * Secrets: reads the local Ed25519 private key + device token ONLY to sign/authenticate
 * in-memory; it never prints or writes them. The operator token comes from
 * $JOAXCLAW_TOKEN (preferred, keeps it out of shell history) or argv.
 *
 * Usage:
 *   JOAXCLAW_TOKEN=… node scripts/probe-signed-scopes.mjs wss://host[:port] [extraOrigin]
 *   node scripts/probe-signed-scopes.mjs wss://host[:port] <token> [extraOrigin]
 */
import WebSocket from 'ws'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const url = process.argv[2]
// token: env first (no shell-history leak), else positional (skip if it looks like an origin)
let token = process.env.JOAXCLAW_TOKEN || ''
let rest = process.argv.slice(3)
if (!token && rest[0] && !/^https?:\/\//.test(rest[0])) { token = rest[0]; rest = rest.slice(1) }
const extraOrigin = rest.find(a => /^https?:\/\//.test(a))

if (!url || !token) {
  console.error('usage: JOAXCLAW_TOKEN=… node scripts/probe-signed-scopes.mjs wss://host[:port] [extraOrigin]')
  process.exit(1)
}

const host = new URL(url).host
const REQUESTED = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing', 'operator.talk.secrets']

// ── replicate electron/main/deviceIdentity.ts exactly ────────────────────────────
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const b64url = buf => buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
function derivePubRaw(pem) {
  const spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })
  return (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX))
    ? spki.subarray(ED25519_SPKI_PREFIX.length) : spki
}
const normalizeMeta = v => (typeof v === 'string' ? v.trim().replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32)) : '')

const idPath = path.join(homedir(), '.joaxclaw', 'identity', 'device.json')
const tokPath = path.join(homedir(), '.joaxclaw', 'identity', 'device-tokens.json')
let identity, deviceToken
try { identity = JSON.parse(fs.readFileSync(idPath, 'utf8')) }
catch { console.error(`No device identity at ${idPath} — pair the desktop app with this gateway first.`); process.exit(1) }
try { deviceToken = JSON.parse(fs.readFileSync(tokPath, 'utf8'))?.[host]?.operator?.token } catch { /* optional */ }

const CLIENT_ID = 'gateway-client', CLIENT_MODE = 'backend', PLATFORM = 'linux'

function buildDeviceBlock(nonce, scopes) {
  const signedAt = Date.now()
  const payload = ['v3', identity.deviceId, CLIENT_ID, CLIENT_MODE, 'operator', scopes.join(','),
    String(signedAt), token ?? '', nonce, normalizeMeta(PLATFORM), normalizeMeta(undefined)].join('|')
  const signature = b64url(crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(identity.privateKeyPem)))
  return { id: identity.deviceId, publicKey: b64url(derivePubRaw(identity.publicKeyPem)), signature, signedAt, nonce }
}

function probe(label, wsOptions) {
  return new Promise(resolve => {
    const out = { label, granted: null, error: null, closed: null }
    let done = false, sock
    const finish = patch => { if (done) return; done = true; Object.assign(out, patch); try { sock?.terminate() } catch {} ; resolve(out) }
    const timer = setTimeout(() => finish({ error: 'timeout after 12s' }), 12000)
    try { sock = new WebSocket(url, wsOptions) } catch (e) { clearTimeout(timer); return resolve({ ...out, error: String(e?.message ?? e) }) }

    sock.on('message', raw => {
      let f; try { f = JSON.parse(raw.toString()) } catch { return }
      if (f.type === 'event' && f.event === 'connect.challenge') {
        const scopes = REQUESTED
        sock.send(JSON.stringify({
          type: 'req', id: 'req_1', method: 'connect',
          params: {
            minProtocol: 4, maxProtocol: 4,
            client: { id: CLIENT_ID, displayName: 'phase1-probe', version: '0.1.0', platform: PLATFORM, mode: CLIENT_MODE },
            caps: ['tool-events'],
            auth: { token, ...(deviceToken ? { deviceToken } : {}) },
            role: 'operator', scopes,
            device: buildDeviceBlock(f.payload?.nonce, scopes),
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
    sock.on('close', (code, reason) => { clearTimeout(timer); finish({ closed: `${code}${reason ? ' ' + reason : ''}` }) })
  })
}

const describe = r => r.error ? `error: ${r.error}`
  : Array.isArray(r.granted) ? (r.granted.length ? r.granted.join(', ') : '(EMPTY)')
  : `closed before hello-ok: ${r.closed}`

const sameOrigin = `https://${host}`   // the gateway's own origin (same-origin auto-accepts)
const runs = [
  ['A. signed, NO Origin        (what the Electron app does)', {}],
  [`B. signed, Origin ${sameOrigin}  (browser/PWA, same-origin)`, { headers: { Origin: sameOrigin } }],
]
if (extraOrigin) runs.push([`C. signed, Origin ${extraOrigin}  (must be in allowedOrigins)`, { headers: { Origin: extraOrigin } }])

console.log('\n=== Phase 1 — signed (device-identity) scope probe ===')
console.log(`gateway: ${url}   device: ${identity.deviceId.slice(0, 12)}…   device-token: ${deviceToken ? 'present' : 'none'}`)
const results = []
for (const [label, opts] of runs) { const r = await probe(label, opts); results.push(r); console.log(`\n• ${label}\n    granted: ${describe(r)}`) }

console.log('\n--- verdict ---')
const scoped = r => Array.isArray(r.granted) && r.granted.length > 0
const a = results[0], b = results[1]
if (scoped(a) && scoped(b)) {
  console.log('✅ A SIGNED browser-origin connection RECEIVES operator scopes.')
  console.log('→ PWA confirmed viable: device identity (WebCrypto) + an allowed origin = full scopes.')
  console.log('  Next: port this handshake to WebCrypto in the browser shim; ship it (PWA or Capacitor).')
} else if (scoped(a) && !scoped(b)) {
  console.log('⚠ Signed works WITHOUT Origin but not WITH it — the gateway restricts browser origins even')
  console.log('  when device-signed. Re-check the origin is allowed; if it truly blocks, prefer Capacitor')
  console.log('  (native socket avoids the browser Origin header).')
} else if (!scoped(a)) {
  console.log('Signed handshake did not return scopes even without Origin — likely the operator token or')
  console.log('device token/identity is stale, or the device needs re-approval. Fix that first, then re-run.')
}
console.log()
