#!/usr/bin/env node
/**
 * host.readMedia — host-side media read diagnostic.
 *
 * Calls the joaxclaw-fs `host.readMedia` RPC against a live gateway exactly as the app
 * does, so we can see WHY a remote workspace image fails to render. Replays the signed
 * "v3" handshake (like probe-signed-scopes.mjs) using the paired identity under
 * ~/.joaxclaw. READ-ONLY; prints the RPC's ok/error/path/mediaType/size but NEVER the
 * base64 bytes (only their length), so the output is safe to paste back.
 *
 * Pass either a bare filename (exercises the host-side find) or an absolute path:
 *   JOAXCLAW_TOKEN=… node scripts/probe-media.mjs wss://host[:port] DAW_Antique-Velour_485.jpg
 *   JOAXCLAW_TOKEN=… node scripts/probe-media.mjs wss://host[:port] /abs/path/on/host.jpg
 */
import WebSocket from 'ws'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const url = process.argv[2]
const token = process.env.JOAXCLAW_TOKEN || ''
const target = process.argv[3]

if (!url || !token || !target) {
  console.error('usage: JOAXCLAW_TOKEN=… node scripts/probe-media.mjs wss://host[:port] <filename-or-abs-path>')
  process.exit(1)
}

const host = new URL(url).host
const REQUESTED = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing', 'operator.talk.secrets']

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

// bare filename → { filename } (host-side find); absolute/~ path → { path }
const isRelative = !target.startsWith('/') && !target.startsWith('~/') && !target.startsWith('file://')
const params = isRelative ? { filename: target } : { path: target }

function run() {
  return new Promise((resolve, reject) => {
    let sock, connected = false
    const timer = setTimeout(() => { try { sock?.terminate() } catch {}; reject(new Error('timeout after 15s')) }, 15000)
    try { sock = new WebSocket(url) } catch (e) { clearTimeout(timer); return reject(e) }
    sock.on('message', raw => {
      let f; try { f = JSON.parse(raw.toString()) } catch { return }
      if (f.type === 'event' && f.event === 'connect.challenge') {
        sock.send(JSON.stringify({
          type: 'req', id: 'connect', method: 'connect',
          params: {
            minProtocol: 4, maxProtocol: 4,
            client: { id: CLIENT_ID, displayName: 'media-probe', version: '0.1.0', platform: PLATFORM, mode: CLIENT_MODE },
            caps: ['tool-events'], auth: { token, ...(deviceToken ? { deviceToken } : {}) },
            role: 'operator', scopes: REQUESTED, device: buildDeviceBlock(f.payload?.nonce, REQUESTED),
          },
        }))
        return
      }
      if (f.type === 'res' && f.id === 'connect') {
        if (!f.ok) { clearTimeout(timer); try { sock.terminate() } catch {}; return reject(new Error(`connect failed: ${JSON.stringify(f.error)}`)) }
        connected = true
        sock.send(JSON.stringify({ type: 'req', id: 'media', method: 'host.readMedia', params }))
        return
      }
      if (f.type === 'res' && f.id === 'media') {
        clearTimeout(timer); try { sock.terminate() } catch {}
        resolve(f)
      }
    })
    sock.on('error', e => { if (!connected) { clearTimeout(timer); reject(e) } })
    sock.on('close', (code, reason) => { if (!connected) { clearTimeout(timer); reject(new Error(`closed ${code}${reason ? ' ' + reason : ''}`)) } })
  })
}

console.log(`\n=== host.readMedia probe ===`)
console.log(`gateway: ${url}   request: ${JSON.stringify(params)}   device-token: ${deviceToken ? 'present' : 'none'}`)
let res
try { res = await run() } catch (e) { console.error(`\n✗ ${e.message}`); process.exit(1) }

if (res.ok) {
  const p = res.payload ?? {}
  const bytes = typeof p.dataUrl === 'string' ? p.dataUrl.length : 0
  console.log(`\n✅ resolved on host`)
  console.log(`   path:      ${p.path}`)
  console.log(`   mediaType: ${p.mediaType}`)
  console.log(`   size:      ${p.size} bytes`)
  console.log(`   dataUrl:   ${bytes} chars (base64, not shown)`)
  console.log(`\n→ The host RPC works. The app calls the same method, so images should render.`)
} else {
  const err = typeof res.error === 'string' ? res.error : JSON.stringify(res.error)
  console.log(`\n✗ host.readMedia error: ${err}`)
  if (/unknown method/i.test(err)) {
    console.log(`→ The gateway host does NOT have joaxclaw-fs ≥0.11.4 loaded (RPC missing). Reinstall + restart.`)
  } else if (/requires path or filename/i.test(err)) {
    console.log(`→ Host-side find returned nothing for a bare filename — the file isn't under ~/.openclaw or ~`)
    console.log(`  within the search depth. Retry with the ABSOLUTE host path.`)
  } else if (/not found|not a file/i.test(err)) {
    console.log(`→ The path doesn't exist on the gateway host. Check where the display-media skill writes files.`)
  } else if (/too large/i.test(err)) {
    console.log(`→ File exceeds the 32MB cap.`)
  }
}
console.log()
