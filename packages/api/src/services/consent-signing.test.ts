import { describe, expect, it } from 'vitest'
import { type SignableAcceptance, signAcceptanceRecord } from './consent-signing'

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
