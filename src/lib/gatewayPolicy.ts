// What the gateway tells us about itself at connect, and what to do with it.
//
// The handshake answer (`hello-ok`) carries a feature list, size limits and the granted
// scopes — a description of this exact gateway that the app previously threw away. The
// cost of ignoring it shows up in three places:
//
//  - Method support was learned by CALLING a method and pattern-matching "unknown
//    method" in the rejection. Every unsupported method therefore cost one failed
//    request and one INVALID_REQUEST in the host's log, on every fresh connection.
//  - Attachment limits were unknown, so an oversized file was discovered by the gateway
//    rejecting the send rather than by the composer saying so first.
//  - A scope refusal was read by matching the legacy "missing scope: …" message, when
//    the gateway now sends structured details saying exactly which scope is missing.

export interface GatewayFeatures {
  methods?: string[]
  events?: string[]
  capabilities?: string[]
}

export interface AttachmentPolicy {
  /** Largest decoded size for a single non-image attachment. */
  maxBytes?: number
  /** Largest decoded size for a single image — min(maxBytes, the 6MB hydration cap). */
  maxImageBytes?: number
}

export interface GatewayPolicy {
  maxPayload?: number
  maxBufferedBytes?: number
  tickIntervalMs?: number
  attachments?: AttachmentPolicy
}

/**
 * Whether this gateway advertises a method.
 *
 * Deliberately conservative: the list is documented as "a conservative discovery list…
 * not a generated dump of every method", and some real methods (`push.test`,
 * `web.login.start`, `web.login.wait`, `sessions.usage`) are excluded from it on
 * purpose. So absence is NOT proof a method is missing — an unknown answer means
 * "try it", and only the gateway's own rejection is authoritative.
 */
export function advertisesMethod(features: GatewayFeatures | undefined, method: string): boolean | undefined {
  const list = features?.methods
  if (!Array.isArray(list) || list.length === 0) return undefined
  return list.includes(method)
}

/**
 * The handshake itself. It is never in `features.methods` — that list describes the RPCs
 * callable on an OPEN connection — so it must never be gated on it.
 */
export function isHandshakeMethod(method: string): boolean {
  return method === 'connect'
}

/**
 * Whether to reject a request without sending it, and why: `'cached'` when this
 * connection already got "unknown method" for it, `'not-advertised'` when hello-ok's list
 * explicitly leaves it out, `null` to send it.
 *
 * The handshake is exempt from both. 0.24.0 gated `connect` on the PREVIOUS connection's
 * advertised list — which never contains it — so every reconnect failed client-side
 * with "unknown method: connect" and the app could not get back online until restarted.
 */
export function clientSideGate(
  method: string,
  features: GatewayFeatures | undefined,
  unsupported: ReadonlySet<string>,
): 'cached' | 'not-advertised' | null {
  if (isHandshakeMethod(method)) return null
  if (unsupported.has(method)) return 'cached'
  if (advertisesMethod(features, method) === false) return 'not-advertised'
  return null
}

/** Additive wire contracts this gateway supports, e.g. `session-scoped-chat-metadata`. */
export function hasCapability(features: GatewayFeatures | undefined, capability: string): boolean {
  return Array.isArray(features?.capabilities) && features.capabilities.includes(capability)
}

const IMAGE_RE = /^image\//i

/**
 * Why an attachment can't be sent, or null when it can.
 *
 * The gateway advertises a per-attachment ceiling; it is never a promise the whole frame
 * fits, because attachments travel as base64 — a 20MB file is ~26.7MB on the wire and
 * exceeds the default 25MiB frame limit on its own. `overallPayloadExceeded` covers that
 * separately.
 */
export function attachmentRejection(
  file: { size: number; type?: string; name?: string },
  policy: AttachmentPolicy | undefined,
): string | null {
  if (!policy) return null          // an older gateway advertises no limits; let it decide
  const isImage = IMAGE_RE.test(file.type ?? '')
  const cap = isImage ? policy.maxImageBytes ?? policy.maxBytes : policy.maxBytes
  if (typeof cap !== 'number' || cap <= 0) return null
  if (file.size <= cap) return null
  const what = file.name ? `“${file.name}”` : isImage ? 'That image' : 'That file'
  return `${what} is ${mb(file.size)} — this gateway accepts up to ${mb(cap)}${isImage ? ' for an image' : ''}.`
}

/**
 * True when the base64-encoded attachments would overflow the frame limit even though
 * each one is individually under its cap. Base64 costs about 4 bytes per 3.
 */
export function overallPayloadExceeded(sizes: readonly number[], maxPayload: number | undefined): boolean {
  if (typeof maxPayload !== 'number' || maxPayload <= 0) return false
  const encoded = sizes.reduce((sum, n) => sum + Math.ceil(n / 3) * 4, 0)
  return encoded > maxPayload
}

function mb(bytes: number): string {
  const v = bytes / (1024 * 1024)
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}MB`
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export interface MissingScope {
  missingScope?: string
  requiredScopes?: string[]
}

/**
 * The scope a refusal is about, from the structured details the gateway now sends.
 *
 * `details.code === "MISSING_SCOPE"` carries `missingScope` and the complete
 * `requiredScopes` set. The legacy `missing scope: <name>` message is still emitted for
 * older clients and is read only as a fallback — the docs are explicit that clients
 * should branch on `details` first and treat `message` as changeable.
 */
export function readMissingScope(error: unknown): MissingScope | null {
  const rec = asRecord(error)
  const details = asRecord(rec?.details)
  if (details && details.code === 'MISSING_SCOPE') {
    return {
      ...(typeof details.missingScope === 'string' ? { missingScope: details.missingScope } : {}),
      ...(Array.isArray(details.requiredScopes) ? { requiredScopes: details.requiredScopes as string[] } : {}),
    }
  }
  const text = typeof rec?.message === 'string' ? rec.message : typeof error === 'string' ? error : ''
  const legacy = /missing scope:\s*([a-z0-9_.]+)/i.exec(text)
  return legacy ? { missingScope: legacy[1] } : null
}

/**
 * A connect refusal that means "not yet", not "no".
 *
 * The gateway answers a retryable UNAVAILABLE with `details.reason: "startup-sidecars"`
 * while it finishes booting. Treating that as a terminal handshake failure turns a
 * two-second wait into a visible connection error.
 */
export function connectRetryDelayMs(error: unknown): number | null {
  const rec = asRecord(error)
  if (!rec) return null
  const details = asRecord(rec.details)
  const retryable = rec.retryable === true || details?.reason === 'startup-sidecars'
  if (!retryable && rec.code !== 'UNAVAILABLE') return null
  const after = typeof rec.retryAfterMs === 'number' ? rec.retryAfterMs : undefined
  // Bounded: a gateway asking for a ten-minute wait should not freeze the UI on it.
  return Math.min(Math.max(after ?? 1000, 250), 10_000)
}

/** The provider-side detail a failed run carries, flattened for display. */
export function describeRunFailure(payload: unknown): string | null {
  const p = asRecord(payload)
  const d = asRecord(p?.errorDetail)
  if (!d) return null
  const bits: string[] = []
  if (typeof d.provider === 'string') bits.push(d.provider)
  if (typeof d.model === 'string') bits.push(d.model)
  const head = bits.join(' · ')
  const status = typeof d.httpStatus === 'number' ? `HTTP ${d.httpStatus}` : ''
  const why = typeof d.providerErrorMessagePreview === 'string' ? d.providerErrorMessagePreview
    : typeof d.providerErrorType === 'string' ? d.providerErrorType
    : ''
  const tail = [status, why].filter(Boolean).join(' — ')
  const all = [head, tail].filter(Boolean).join(': ')
  return all || null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}
