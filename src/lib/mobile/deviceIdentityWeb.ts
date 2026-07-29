// Browser (WebCrypto) device identity for the gateway handshake — the port of
// electron/main/deviceIdentity.ts for a PWA / mobile companion. Phase 1 proved a
// signed, Origin-bearing connection receives full operator scopes, so the browser
// must reproduce the SAME Ed25519 "v3" signature the gateway verifies.
//
// Keeping it byte-compatible:
//   - Ed25519 keypair, private key NON-EXTRACTABLE, persisted as a CryptoKey in
//     IndexedDB (structured-clone) — it can't be exported/exfiltrated, even via XSS.
//   - deviceId = sha256(raw 32-byte public key) hex.
//   - signature = Ed25519 over the pipe-joined "v3" payload (identical field order).
// The pure functions below are unit-tested against node:crypto to prove the gateway
// (Node-based) accepts our signatures.

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
export interface DeviceConnectBlock { id: string; publicKey: string; signature: string; signedAt: number; nonce: string }

const enc = new TextEncoder()

export function base64UrlFromBytes(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

// OpenClaw lowercases + trims platform/deviceFamily before signing them.
export function normalizeMeta(value?: string): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32))
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}

// The exact payload the gateway rebuilds and verifies. Every field must equal the
// corresponding value sent in the connect params (see gateway.ts _respondToChallenge).
export function buildV3Payload(deviceId: string, input: DeviceConnectInput, signedAtMs: number): string {
  return [
    'v3',
    deviceId,
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
}

export async function deviceIdFromPublicKey(publicKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
  return sha256Hex(raw)
}

// Sign a connect block given an existing keypair — the pure, testable core.
export async function buildConnectBlockFromKeys(
  keys: CryptoKeyPair,
  deviceId: string,
  input: DeviceConnectInput,
): Promise<DeviceConnectBlock> {
  const signedAt = Date.now()
  const payload = buildV3Payload(deviceId, input, signedAt)
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, enc.encode(payload)))
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
  return {
    id: deviceId,
    publicKey: base64UrlFromBytes(rawPub),
    signature: base64UrlFromBytes(signature),
    signedAt,
    nonce: input.nonce,
  }
}

// ── IndexedDB persistence (browser only) ─────────────────────────────────────
const DB_NAME = 'joaxclaw'
const STORE = 'identity'
const KEY = 'device-ed25519'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => reject(r.error)
  })
}
async function idbPut(key: string, val: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(val, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

let cached: { deviceId: string; keys: CryptoKeyPair } | null = null

// Load the persisted device keypair, or mint one on first run. The private key is
// generated non-extractable and stored as a CryptoKey (IndexedDB structured-clone),
// so it survives reloads yet can never be read out of the browser.
export async function loadOrCreateWebDeviceIdentity(): Promise<{ deviceId: string; keys: CryptoKeyPair }> {
  if (cached) return cached
  let keys = await idbGet<CryptoKeyPair>(KEY)
  if (!keys?.privateKey || !keys?.publicKey) {
    keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair
    await idbPut(KEY, keys)
  }
  const deviceId = await deviceIdFromPublicKey(keys.publicKey)
  cached = { deviceId, keys }
  return cached
}

export async function buildConnectBlockWeb(input: DeviceConnectInput): Promise<DeviceConnectBlock> {
  const { deviceId, keys } = await loadOrCreateWebDeviceIdentity()
  return buildConnectBlockFromKeys(keys, deviceId, input)
}

export async function webDeviceId(): Promise<string> {
  return (await loadOrCreateWebDeviceIdentity()).deviceId
}
