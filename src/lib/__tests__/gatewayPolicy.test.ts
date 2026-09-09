import { describe, it, expect } from 'vitest'
import {
  advertisesMethod, attachmentRejection, connectRetryDelayMs, describeRunFailure,
  hasCapability, overallPayloadExceeded, readMissingScope,
} from '../gatewayPolicy'

const MB = 1024 * 1024

describe('advertisesMethod', () => {
  it('answers from the advertised list', () => {
    const f = { methods: ['health', 'sessions.list'] }
    expect(advertisesMethod(f, 'sessions.list')).toBe(true)
    expect(advertisesMethod(f, 'sessions.search')).toBe(false)
  })

  it('is undefined — not false — when nothing was advertised', () => {
    // An older gateway sends no list; "unknown" must mean "try it", never "skip it".
    expect(advertisesMethod(undefined, 'health')).toBeUndefined()
    expect(advertisesMethod({ methods: [] }, 'health')).toBeUndefined()
  })
})

describe('hasCapability', () => {
  it('reads additive wire contracts', () => {
    expect(hasCapability({ capabilities: ['session-scoped-chat-metadata'] }, 'session-scoped-chat-metadata')).toBe(true)
    expect(hasCapability({ capabilities: [] }, 'session-scoped-chat-metadata')).toBe(false)
    expect(hasCapability(undefined, 'anything')).toBe(false)
  })
})

describe('attachmentRejection', () => {
  const policy = { maxBytes: 20 * MB, maxImageBytes: 6 * MB }

  it('accepts what fits', () => {
    expect(attachmentRejection({ size: 5 * MB, type: 'application/pdf' }, policy)).toBeNull()
    expect(attachmentRejection({ size: 5 * MB, type: 'image/png' }, policy)).toBeNull()
  })

  it('holds images to their own smaller cap', () => {
    // 10MB is fine as a file and too big as an image: maxImageBytes is
    // min(maxBytes, the 6MB agent-hydration cap).
    expect(attachmentRejection({ size: 10 * MB, type: 'application/pdf' }, policy)).toBeNull()
    expect(attachmentRejection({ size: 10 * MB, type: 'image/png' }, policy)).toMatch(/image/)
  })

  it('names the file and both sizes', () => {
    const msg = attachmentRejection({ size: 30 * MB, type: 'application/zip', name: 'dump.zip' }, policy)
    expect(msg).toContain('dump.zip')
    expect(msg).toContain('30MB')
    expect(msg).toContain('20MB')
  })

  it('defers to the gateway when it advertises no limits', () => {
    // An older gateway sends no policy.attachments; refusing locally would invent a rule.
    expect(attachmentRejection({ size: 999 * MB, type: 'image/png' }, undefined)).toBeNull()
    expect(attachmentRejection({ size: 999 * MB, type: 'image/png' }, {})).toBeNull()
  })
})

describe('overallPayloadExceeded', () => {
  it('accounts for base64 growth, not the raw size', () => {
    // 20MB of attachments is ~26.7MB encoded and overflows a 25MiB frame on its own,
    // even though each file is individually under its cap.
    expect(overallPayloadExceeded([20 * MB], 25 * MB)).toBe(true)
    expect(overallPayloadExceeded([18 * MB], 25 * MB)).toBe(false)
  })

  it('sums across attachments', () => {
    expect(overallPayloadExceeded([10 * MB, 10 * MB], 25 * MB)).toBe(true)
  })

  it('is false when no limit was advertised', () => {
    expect(overallPayloadExceeded([999 * MB], undefined)).toBe(false)
  })
})

describe('readMissingScope', () => {
  it('prefers the structured details', () => {
    expect(readMissingScope({
      code: 'FORBIDDEN',
      message: 'missing scope: operator.write',
      details: { code: 'MISSING_SCOPE', missingScope: 'operator.questions', requiredScopes: ['operator.questions'] },
    })).toEqual({ missingScope: 'operator.questions', requiredScopes: ['operator.questions'] })
  })

  it('falls back to the legacy message for an older gateway', () => {
    expect(readMissingScope({ message: 'missing scope: operator.approvals' }))
      .toEqual({ missingScope: 'operator.approvals' })
  })

  it('is null for anything else', () => {
    expect(readMissingScope({ code: 'INVALID_REQUEST', message: 'nope' })).toBeNull()
    expect(readMissingScope(undefined)).toBeNull()
  })
})

describe('connectRetryDelayMs', () => {
  it('treats a still-booting gateway as retryable', () => {
    expect(connectRetryDelayMs({ code: 'UNAVAILABLE', retryable: true, details: { reason: 'startup-sidecars' }, retryAfterMs: 1500 }))
      .toBe(1500)
  })

  it('bounds an unreasonable retryAfterMs rather than freezing on it', () => {
    expect(connectRetryDelayMs({ code: 'UNAVAILABLE', retryable: true, retryAfterMs: 600_000 })).toBe(10_000)
    expect(connectRetryDelayMs({ code: 'UNAVAILABLE', retryable: true, retryAfterMs: 1 })).toBe(250)
  })

  it('defaults when no delay is given', () => {
    expect(connectRetryDelayMs({ code: 'UNAVAILABLE', retryable: true })).toBe(1000)
  })

  it('is null for a terminal failure, which must not be retried', () => {
    expect(connectRetryDelayMs({ code: 'UNAUTHORIZED', message: 'bad token' })).toBeNull()
    expect(connectRetryDelayMs(undefined)).toBeNull()
  })
})

describe('describeRunFailure', () => {
  it('flattens the provider detail a failed run carries', () => {
    expect(describeRunFailure({
      state: 'error',
      errorDetail: { provider: 'openai', model: 'gpt-6', httpStatus: 429, providerErrorMessagePreview: 'rate limited' },
    })).toBe('openai · gpt-6: HTTP 429 — rate limited')
  })

  it('works from a partial detail', () => {
    expect(describeRunFailure({ errorDetail: { providerErrorType: 'overloaded' } })).toBe('overloaded')
  })

  it('is null when the run carried none', () => {
    // Successful and cancelled events omit errorDetail entirely.
    expect(describeRunFailure({ state: 'final' })).toBeNull()
    expect(describeRunFailure({ errorDetail: {} })).toBeNull()
  })
})
