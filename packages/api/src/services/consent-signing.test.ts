import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SignableAcceptance, resolveSigningKey, signAcceptanceRecord } from './consent-signing'

const PAYLOAD: SignableAcceptance = {
  documentId: 'doc_1',
  contentHash: 'a'.repeat(64),
  consentType: 'RENTER_TOS',
  version: '1.0',
  locale: 'en',
  userId: 'user_1',
  operatorId: null,
  operatorMembershipId: null,
  bookingId: null,
  method: 'CLICKWRAP',
  acceptedAt: new Date('2026-06-15T03:00:00.000Z'),
  ipAddress: '203.0.113.7',
  userAgent: 'jest',
}

describe('signAcceptanceRecord', () => {
  it('produces a stable hex HMAC + keyId for a given key', () => {
    const a = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' })
    const b = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' })
    expect(a.signature).toBe(b.signature)
    expect(a.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(a.signingKeyId).toBe('v1')
  })

  it('changes the signature when any signed field changes', () => {
    const base = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' }).signature
    expect(
      signAcceptanceRecord({ ...PAYLOAD, userId: 'user_2' }, { key: 'secret', keyId: 'v1' })
        .signature,
    ).not.toBe(base)
  })

  it('changes the signature when the key changes (rotation)', () => {
    const base = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' }).signature
    expect(signAcceptanceRecord(PAYLOAD, { key: 'secret2', keyId: 'v2' }).signature).not.toBe(base)
  })

  it('binds the keyId — the same key under a different keyId signs differently', () => {
    const base = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' }).signature
    expect(signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v2' }).signature).not.toBe(base)
  })
})

// #1048: The legacy contract returned `undefined` when the secret was unset so
// IMPORTED-row flows kept working. That contract silently masks a real renter
// accept against an unconfigured deploy as `recordSignature: null`. Production
// must fail-closed; non-prod (dev, vitest unit) must keep returning undefined
// so the existing IMPORTED-row and route tests don't all need a secret stub.
describe('resolveSigningKey — fail-closed in production (#1048)', () => {
  // vi.stubEnv tracks every override and unstubAllEnvs restores cleanly. Plain
  // `delete process.env.X` would trip biome's `noDelete`; assigning `undefined`
  // would store the literal string "undefined" (truthy) and break the unset case.
  beforeEach(() => {
    vi.stubEnv('CONSENT_SIGNING_KEY', '')
    vi.stubEnv('CONSENT_SIGNING_KEY_ID', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns undefined in non-production when unset (legacy IMPORTED-row contract)', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(resolveSigningKey()).toBeUndefined()
  })

  it('throws in production when unset (fail-closed against silent unsigned writes)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => resolveSigningKey()).toThrow(/CONSENT_SIGNING_KEY/)
    expect(() => resolveSigningKey()).toThrow(/#1048/)
  })

  it('returns the configured key when set, regardless of NODE_ENV', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CONSENT_SIGNING_KEY', 'prodsecret')
    vi.stubEnv('CONSENT_SIGNING_KEY_ID', 'v3')
    expect(resolveSigningKey()).toEqual({ key: 'prodsecret', keyId: 'v3' })
  })

  it('defaults keyId to v1 when only the key is set', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CONSENT_SIGNING_KEY', 'prodsecret')
    expect(resolveSigningKey()).toEqual({ key: 'prodsecret', keyId: 'v1' })
  })
})
