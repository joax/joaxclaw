#!/usr/bin/env node
/**
 * Fully-offline voice — feasibility probe.
 *
 * Answers the three questions from TALK.md § "Research: fully-offline voice" against a
 * LIVE gateway, so we can pick an architecture (A: local engines in the Talk pipeline,
 * B: a custom/local talk endpoint, C: bespoke client pipeline):
 *
 *   1. Does `talk.catalog` list any LOCAL engine (whisper / sherpa-onnx / piper / kokoro …)
 *      in its speech (TTS) or transcription (STT) buckets?  → enables architecture A.
 *   2. Do the catalog provider objects (or `config.get` → talk.providers.*) carry any
 *      `baseUrl` / `endpoint` / `url` field the client doesn't currently write?  → arch B.
 *   3. Which transport does `stt-tts` need — `gateway-relay` (client has it) or
 *      `managed-room` (unbuilt)?  → sizes the client work.
 *
 * Connection replays the desktop app's EXACT signed "v3" handshake (same as
 * probe-signed-scopes.mjs), reusing the already-approved device identity + operator
 * device token under ~/.joaxclaw. It is READ-ONLY: only talk.catalog / talk.config /
 * config.get are called; nothing is patched.
 *
 * Secrets: the Ed25519 private key + tokens are read ONLY to sign/authenticate in-memory
 * and are never printed. All RPC output is recursively REDACTED for key/token/secret
 * fields before printing, so it is safe to paste the output back here.
 *
 * Note (see memory: remote-gateway-localhost-pitfall): local engines detected here reflect
 * whatever gateway you point at — a REMOTE gateway won't see your local machine's engines.
 *
 * Usage:
 *   JOAXCLAW_TOKEN=… node scripts/probe-talk-offline.mjs wss://host[:port]
 *   node scripts/probe-talk-offline.mjs wss://host[:port] <token>
 */
import WebSocket from 'ws'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const url = process.argv[2]
let token = process.env.JOAXCLAW_TOKEN || ''
let rest = process.argv.slice(3)
if (!token && rest[0] && !/^https?:\/\//.test(rest[0])) { token = rest[0]; rest = rest.slice(1) }

if (!url || !token) {
  console.error('usage: JOAXCLAW_TOKEN=… node scripts/probe-talk-offline.mjs wss://host[:port]')
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

// ── redaction — never print anything that looks like a credential ────────────────
const SECRET_KEY = /(api[_-]?key|apikey|token|secret|password|passphrase|credential|private[_-]?key|authorization)/i
function redact(v) {
  if (Array.isArray(v)) return v.map(redact)
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, val] of Object.entries(v)) {
      o[k] = SECRET_KEY.test(k) ? (val == null ? val : '***REDACTED***') : redact(val)
    }
    return o
  }
  return v
}
const j = v => JSON.stringify(redact(v), null, 2)

// ── connect (signed handshake), then run read-only RPCs over the same socket ─────
const LOCAL_ENGINE = /whisper|sherpa|onnx|piper|kokoro|vosk|coqui|xtts|moonshine|parakeet|kyutai|moshi|\blocal\b|offline/i
const ENDPOINT_KEY = /^(base[_-]?url|endpoint|url|host|api[_-]?base)$/i

function collectEndpointKeys(obj, out = new Set(), pathStr = '') {
  if (Array.isArray(obj)) obj.forEach((v, i) => collectEndpointKeys(v, out, `${pathStr}[${i}]`))
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (ENDPOINT_KEY.test(k)) out.add(`${pathStr ? pathStr + '.' : ''}${k}`)
      collectEndpointKeys(v, out, `${pathStr ? pathStr + '.' : ''}${k}`)
    }
  }
  return out
}

function run() {
  return new Promise((resolve, reject) => {
    let sock, nextId = 1, connected = false
    const pending = new Map()
    const timer = setTimeout(() => { try { sock?.terminate() } catch {}; reject(new Error('timeout after 15s')) }, 15000)

    const request = (method, params = {}) => new Promise(res => {
      const id = `req_${nextId++}`
      pending.set(id, res)
      sock.send(JSON.stringify({ type: 'req', id, method, params }))
    })

    try { sock = new WebSocket(url) } catch (e) { clearTimeout(timer); return reject(e) }

    sock.on('message', async raw => {
      let f; try { f = JSON.parse(raw.toString()) } catch { return }

      if (f.type === 'event' && f.event === 'connect.challenge') {
        sock.send(JSON.stringify({
          type: 'req', id: 'connect', method: 'connect',
          params: {
            minProtocol: 4, maxProtocol: 4,
            client: { id: CLIENT_ID, displayName: 'talk-offline-probe', version: '0.1.0', platform: PLATFORM, mode: CLIENT_MODE },
            caps: ['tool-events'],
            auth: { token, ...(deviceToken ? { deviceToken } : {}) },
            role: 'operator', scopes: REQUESTED,
            device: buildDeviceBlock(f.payload?.nonce, REQUESTED),
          },
        }))
        return
      }

      if (f.type === 'res' && f.id === 'connect') {
        if (!f.ok) { clearTimeout(timer); try { sock.terminate() } catch {}; return reject(new Error(`connect failed: ${typeof f.error === 'string' ? f.error : JSON.stringify(f.error)}`)) }
        connected = true
        // fire the three read-only introspection calls
        const [catalog, config, cfgget] = await Promise.all([
          request('talk.catalog', {}).catch(e => ({ __error: String(e) })),
          request('talk.config', {}).catch(e => ({ __error: String(e) })),
          request('config.get', {}).catch(e => ({ __error: String(e) })),
        ])
        clearTimeout(timer); try { sock.terminate() } catch {}
        resolve({ catalog, config, cfgget })
        return
      }

      if (f.type === 'res' && pending.has(f.id)) {
        const res = pending.get(f.id); pending.delete(f.id)
        res(f.ok ? (f.payload ?? {}) : { __error: typeof f.error === 'string' ? f.error : JSON.stringify(f.error) })
      }
    })
    sock.on('error', e => { if (!connected) { clearTimeout(timer); reject(e) } })
    sock.on('close', (code, reason) => { if (!connected) { clearTimeout(timer); reject(new Error(`closed ${code}${reason ? ' ' + reason : ''}`)) } })
  })
}

// ── analysis ─────────────────────────────────────────────────────────────────────
function providerList(bucket) {
  const arr = bucket?.providers ?? bucket ?? []
  return Array.isArray(arr) ? arr : []
}
function summarizeProvider(p) {
  const known = new Set(['id', 'label', 'configured', 'modes', 'brains', 'models', 'voices'])
  const extra = Object.keys(p || {}).filter(k => !known.has(k))
  const local = LOCAL_ENGINE.test(`${p?.id ?? ''} ${p?.label ?? ''}`)
  return { id: p?.id, label: p?.label, configured: p?.configured, local, extraFields: extra }
}

console.log('\n=== Talk fully-offline voice — feasibility probe (read-only) ===')
console.log(`gateway: ${url}   device: ${identity.deviceId.slice(0, 12)}…   device-token: ${deviceToken ? 'present' : 'none'}`)
console.log('(remote gateway ⇒ local engines reflect the REMOTE host, not this machine)')

let out
try { out = await run() } catch (e) { console.error(`\n✗ probe failed: ${e.message}`); process.exit(1) }
const { catalog, config, cfgget } = out

// ---- talk.catalog ----
console.log('\n── talk.catalog ──')
if (catalog?.__error) {
  console.log(`  error: ${catalog.__error}`)
} else {
  console.log(`  modes:      ${(catalog.modes ?? []).join(', ') || '(none)'}`)
  console.log(`  transports: ${(catalog.transports ?? []).join(', ') || '(none)'}`)
  console.log(`  brains:     ${(catalog.brains ?? []).join(', ') || '(none)'}`)
  for (const bucket of ['realtime', 'speech', 'transcription']) {
    const ps = providerList(catalog[bucket]).map(summarizeProvider)
    console.log(`  ${bucket}:`)
    if (!ps.length) { console.log('     (none)'); continue }
    for (const p of ps) {
      console.log(`     - ${p.id}${p.label ? ` (${p.label})` : ''}  configured=${p.configured}${p.local ? '  ★LOCAL' : ''}${p.extraFields.length ? `  +fields: ${p.extraFields.join(',')}` : ''}`)
    }
  }
}

// ---- talk.config ----
console.log('\n── talk.config (current) ──')
console.log(config?.__error ? `  error: ${config.__error}` : '  ' + j(config).replace(/\n/g, '\n  '))

// ---- config.get → talk.* + messages.tts.* (redacted) ----
const parsed = cfgget?.__error ? null : (cfgget?.parsed ?? cfgget?.config ?? cfgget ?? {})
console.log('\n── config.get → talk.* (redacted) ──')
if (cfgget?.__error) console.log(`  error: ${cfgget.__error}`)
else console.log('  ' + j(parsed?.talk ?? {}).replace(/\n/g, '\n  '))
console.log('\n── config.get → messages.tts.* (redacted; where local sherpa/whisper live) ──')
if (!cfgget?.__error) console.log('  ' + j(parsed?.messages?.tts ?? {}).replace(/\n/g, '\n  '))

// ---- endpoint-key scan across everything ----
const endpointKeys = new Set()
if (!catalog?.__error) collectEndpointKeys(catalog, endpointKeys, 'catalog')
if (parsed) collectEndpointKeys(parsed?.talk ?? {}, endpointKeys, 'config.talk')

// ---- verdict ----
console.log('\n--- verdict ---')
const localInSpeech = !catalog?.__error && providerList(catalog.speech).some(p => LOCAL_ENGINE.test(`${p?.id ?? ''} ${p?.label ?? ''}`))
const localInStt    = !catalog?.__error && providerList(catalog.transcription).some(p => LOCAL_ENGINE.test(`${p?.id ?? ''} ${p?.label ?? ''}`))
const sttTtsMode    = !catalog?.__error && (catalog.modes ?? []).includes('stt-tts')

if (localInSpeech || localInStt) {
  console.log('✅ ARCH A viable — talk.catalog already lists local engine(s):')
  console.log(`     local TTS in speech bucket: ${localInSpeech ? 'YES' : 'no'} · local STT in transcription bucket: ${localInStt ? 'YES' : 'no'}`)
  console.log('   → Wire Talk `stt-tts` mode to these engines; work is mostly client-side (mode/provider picker + transport).')
} else {
  console.log('✗ ARCH A blocked — no local engine found in talk.catalog speech/transcription buckets.')
  console.log('   (The offline sherpa-onnx/whisper engines are in messages.tts.* but not exposed to realtime Talk.)')
}
if (endpointKeys.size) {
  console.log(`\n✅ ARCH B possible — endpoint/baseUrl-style key(s) exist in talk config/catalog:`)
  for (const k of endpointKeys) console.log(`     ${k}`)
  console.log('   → A local OpenAI-compatible server (Speaches/LocalAI) could be pointed at via this key.')
} else {
  console.log('\n✗ ARCH B blocked — no baseUrl/endpoint/url field anywhere under talk config or catalog providers.')
}
if (!localInSpeech && !localInStt && !endpointKeys.size) {
  console.log('\n→ Fall back to ARCH C (bespoke client pipeline): mic → local VAD → local STT → LLM → local TTS,')
  console.log('  bypassing the gateway Talk subsystem. Heaviest, but independent of gateway voice capabilities.')
}
console.log(`\nnote: stt-tts mode advertised by gateway: ${sttTtsMode ? 'yes' : 'no'}. If yes, confirm whether it runs`)
console.log('over gateway-relay (client has it) or managed-room (unbuilt) before committing to Arch A.')
console.log()
