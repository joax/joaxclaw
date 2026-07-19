// Device identity for the OpenClaw gateway handshake.
//
// OpenClaw 2026.7.x requires remote WS clients to present a signed *device
// identity* in the connect handshake — a bare token from a non-loopback origin is
// rejected with DEVICE_IDENTITY_REQUIRED. This module mirrors OpenClaw's own client
// (`packages/gateway-client`) exactly so our handshake is byte-compatible:
//   - Ed25519 keypair, persisted as { version:1, deviceId, publicKeyPem, privateKeyPem }
//   - deviceId = sha256(raw 32-byte public key) hex
//   - the connect params gain a `device` block { id, publicKey, signature, signedAt, nonce }
//   - signature = Ed25519 over the "v3" pipe-joined payload (see buildDeviceConnectBlock)
// The gateway rebuilds that same payload from the connect params and verifies the
// signature, so every signed field MUST match what we send in the params.
//
// The keypair lives under the app's own state dir (~/.joaxclaw), NOT ~/.openclaw —
// this is JoaxClaw's device, paired independently of the gateway host's CLI.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

// DER prefix for an Ed25519 SubjectPublicKeyInfo — strip it to get the raw 32-byte key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length)
  }
  return spki
}

function fingerprintPublicKey(publicKeyPem: string): string {
  return crypto.createHash('sha256').update(derivePublicKeyRaw(publicKeyPem)).digest('hex')
}

interface DeviceIdentity { version: 1; deviceId: string; publicKeyPem: string; privateKeyPem: string }

function identityPath(): string {
  return path.join(homedir(), '.joaxclaw', 'identity', 'device.json')
}

let cached: DeviceIdentity | null = null

export function loadOrCreateDeviceIdentity(): DeviceIdentity {
  if (cached) return cached
  const p = identityPath()
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (parsed?.version === 1 && typeof parsed.deviceId === 'string'
      && typeof parsed.publicKeyPem === 'string' && typeof parsed.privateKeyPem === 'string'
      && fingerprintPublicKey(parsed.publicKeyPem) === parsed.deviceId) {
      cached = parsed as DeviceIdentity
      return cached
    }
  } catch { /* missing or corrupt — mint a fresh one below */ }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const identity: DeviceIdentity = { version: 1, deviceId: fingerprintPublicKey(publicKeyPem), publicKeyPem, privateKeyPem }
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(identity, null, 2), { mode: 0o600 })
  try { fs.chmodSync(p, 0o600) } catch { /* best-effort perms */ }
  cached = identity
  return identity
}

// ── Device tokens ────────────────────────────────────────────────────────────
// After a device is approved, the gateway returns a per-role device token in
// `hello-ok.auth.deviceToken`. Resending it as `auth.deviceToken` makes the gateway
// authenticate the connection with method "device-token" — the ONLY method that
// preserves operator scopes from a REMOTE locality (a relayed Tailscale connection
// from another network). Without it, operator scopes survive only on the trusted
// local path (same LAN / direct), which is why pairing works at home but drops
// operator role from a foreign network. Tokens are scoped per gateway host + role.
interface StoredDeviceToken { token: string; scopes: string[]; issuedAtMs?: number }
type DeviceTokenStore = Record<string, Record<string, StoredDeviceToken>>  // host -> role -> token

function tokensPath(): string {
  return path.join(homedir(), '.joaxclaw', 'identity', 'device-tokens.json')
}

function readTokenStore(): DeviceTokenStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokensPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed as DeviceTokenStore : {}
  } catch { return {} }
}

function writeTokenStore(store: DeviceTokenStore): void {
  const p = tokensPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 })
  try { fs.chmodSync(p, 0o600) } catch { /* best-effort perms */ }
}

export function getDeviceToken(host: string, role: string): StoredDeviceToken | null {
  return readTokenStore()[host]?.[role] ?? null
}

export function storeDeviceToken(host: string, role: string, token: string, scopes: string[], issuedAtMs?: number): void {
  const store = readTokenStore()
  store[host] = { ...(store[host] ?? {}), [role]: { token, scopes, issuedAtMs } }
  writeTokenStore(store)
}

export function clearDeviceToken(host: string, role: string): void {
  const store = readTokenStore()
  if (store[host]?.[role]) { delete store[host][role]; writeTokenStore(store) }
}

// OpenClaw lowercases + trims platform/deviceFamily before signing them.
function normalizeMeta(value?: string): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32))
}

export interface DeviceConnectBlock { id: string; publicKey: string; signature: string; signedAt: number; nonce: string }

export interface DeviceConnectInput {
  nonce: string
  role: string
  scopes: string[]
  token?: string | null
  clientId: string
  clientMode: string
  platform: string
  deviceFamily?: string
}

// Build the `device` block for the connect params, signing OpenClaw's exact "v3"
// payload. Every field here must equal the corresponding value we put in the connect
// params (client.id, client.mode, role, scopes, auth.token, client.platform, …) or
// the gateway's signature check fails.
export function buildDeviceConnectBlock(input: DeviceConnectInput): DeviceConnectBlock {
  const id = loadOrCreateDeviceIdentity()
  const signedAtMs = Date.now()
  const payload = [
    'v3',
    id.deviceId,
    input.clientId,
    input.clientMode,
    input.role,
    input.scopes.join(','),
    String(signedAtMs),
    input.token ?? '',
    input.nonce,
    normalizeMeta(input.platform),
    normalizeMeta(input.deviceFamily),
  ].join('|')
  const signature = base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(id.privateKeyPem)))
  return {
    id: id.deviceId,
    publicKey: base64UrlEncode(derivePublicKeyRaw(id.publicKeyPem)),
    signature,
    signedAt: signedAtMs,
    nonce: input.nonce,
  }
}
