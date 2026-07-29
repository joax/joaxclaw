// @vitest-environment node
import { describe, it, expect } from 'vitest'
import nodeCrypto from 'node:crypto'
import {
  buildConnectBlockFromKeys, buildV3Payload, deviceIdFromPublicKey, normalizeMeta,
  type DeviceConnectInput,
} from '../mobile/deviceIdentityWeb'

// Proves the browser (WebCrypto) device handshake is byte-compatible with the gateway:
// WebCrypto signs the "v3" payload, and node:crypto — the same Ed25519 verifier the
// gateway runs — must accept the signature. Mirrors electron/main/deviceIdentity.ts.

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const b64urlToBuf = (s: string) => Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/'), 'base64')

describe('deviceIdentityWeb', () => {
  it('normalizeMeta lowercases + trims (matches deviceIdentity.ts)', () => {
    expect(normalizeMeta('  Linux ')).toBe('linux')
    expect(normalizeMeta('macOS')).toBe('macos')
    expect(normalizeMeta(undefined)).toBe('')
  })

  it('WebCrypto v3 signature verifies under node:crypto, and deviceId matches', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair
    const deviceId = await deviceIdFromPublicKey(keys.publicKey)

    const input: DeviceConnectInput = {
      nonce: 'nonce-123', role: 'operator',
      scopes: ['operator.admin', 'operator.read', 'operator.write'],
      token: 'op-token', clientId: 'gateway-client', clientMode: 'backend', platform: 'Linux',
    }
    const block = await buildConnectBlockFromKeys(keys, deviceId, input)

    // Rebuild the exact payload the gateway reconstructs from the connect params.
    const payload = buildV3Payload(deviceId, input, block.signedAt)

    // Reconstruct a node public key from the raw 32-byte key we sent, then verify.
    const rawPub = b64urlToBuf(block.publicKey)
    expect(rawPub.length).toBe(32)
    const pub = nodeCrypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPub]), format: 'der', type: 'spki',
    })
    const ok = nodeCrypto.verify(null, Buffer.from(payload, 'utf8'), pub, b64urlToBuf(block.signature))
    expect(ok).toBe(true)

    // deviceId = sha256(raw pubkey) hex — same derivation as the Electron side.
    expect(deviceId).toBe(nodeCrypto.createHash('sha256').update(rawPub).digest('hex'))
    expect(block.nonce).toBe(input.nonce)
  })

  it('a different key produces a signature that does NOT verify (sanity)', async () => {
    const k1 = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair
    const k2 = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair
    const id1 = await deviceIdFromPublicKey(k1.publicKey)
    const input: DeviceConnectInput = { nonce: 'n', role: 'operator', scopes: ['operator.read'], clientId: 'c', clientMode: 'backend', platform: 'linux' }
    const block = await buildConnectBlockFromKeys(k1, id1, input)
    const payload = buildV3Payload(id1, input, block.signedAt)
    const wrongRaw = Buffer.from(await crypto.subtle.exportKey('raw', k2.publicKey))
    const wrongPub = nodeCrypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, wrongRaw]), format: 'der', type: 'spki' })
    expect(nodeCrypto.verify(null, Buffer.from(payload, 'utf8'), wrongPub, b64urlToBuf(block.signature))).toBe(false)
  })
})
