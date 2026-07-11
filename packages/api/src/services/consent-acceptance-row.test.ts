import { describe, expect, it } from 'vitest'
import {
  type AcceptanceDoc,
  type AcceptanceSubject,
  buildAcceptanceRow,
} from './consent-acceptance-row'

const doc: AcceptanceDoc = {
  id: 'd1',
  type: 'OPERATOR_RENTAL_TERMS',
  version: 'v3',
  locale: 'ja',
  title: 'T',
  body: 'B',
  acceptanceLabel: 'A',
  contentHash: 'h',
}

const subject: AcceptanceSubject = {
  userId: 'u1',
  operatorId: null,
  operatorMembershipId: null,
  actorRole: 'RENTER',
  bookingId: 'b1',
  method: 'CLICKWRAP',
  acceptedAt: new Date('2026-07-09T00:00:00Z'),
  ipAddress: null,
  userAgent: null,
}

describe('buildAcceptanceRow', () => {
  it('builds a signed row carrying the document snapshot and bookingId', () => {
    const row = buildAcceptanceRow(doc, subject, { key: 'secret', keyId: 'v1' })
    expect(row.documentSnapshot).toEqual({
      version: 'v3',
      locale: 'ja',
      title: 'T',
      body: 'B',
      acceptanceLabel: 'A',
      contentHash: 'h',
    })
    expect(row.bookingId).toBe('b1')
    expect(row.consentType).toBe('OPERATOR_RENTAL_TERMS')
    expect(row.operatorId).toBeNull()
    expect(row.method).toBe('CLICKWRAP')
    expect(row.recordSignature).toMatch(/^[0-9a-f]{64}$/)
    expect(row.signingKeyId).toBe('v1')
    expect(row.signatureCanonicalVersion).toBe('v1')
  })

  it('is deterministic — same inputs + key produce the same signature', () => {
    const a = buildAcceptanceRow(doc, subject, { key: 'secret', keyId: 'v1' })
    const b = buildAcceptanceRow(doc, subject, { key: 'secret', keyId: 'v1' })
    expect(a.recordSignature).toBe(b.recordSignature)
  })

  it('omits the signature when no key is supplied', () => {
    const row = buildAcceptanceRow(doc, subject, undefined)
    expect(row.recordSignature).toBeNull()
    expect(row.signingKeyId).toBeNull()
    expect(row.signatureCanonicalVersion).toBeNull()
  })
})
