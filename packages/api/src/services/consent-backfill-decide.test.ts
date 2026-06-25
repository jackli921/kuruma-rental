import { computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import { describe, expect, it } from 'vitest'
import { decideBackfill } from '../../../../scripts/consent-backfill-decide'
import { signAcceptanceRecord } from './consent-signing'

const KEY = { key: 'secret', keyId: 'v1' }

const acceptedAt = new Date('2026-06-24T00:00:00Z')

// A self-consistent document: contentHash matches its own text fields.
const doc = (() => {
  const title = 'Terms of Service'
  const body = 'You agree to our terms.'
  const acceptanceLabel = 'I agree'
  const contentHash = computeContentHash({ title, body, acceptanceLabel })
  return {
    id: 'doc_1',
    type: 'RENTER_TOS' as const,
    version: '1.0',
    locale: 'en',
    title,
    body,
    acceptanceLabel,
    contentHash,
    status: 'PUBLISHED' as const,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  }
})()

// An acceptance whose recordSignature is computed over doc's fields.
const acc = (() => {
  const sig = signAcceptanceRecord(
    {
      documentId: 'doc_1',
      contentHash: doc.contentHash,
      consentType: 'RENTER_TOS' as const,
      version: doc.version,
      locale: doc.locale,
      userId: 'u1',
      operatorId: null,
      operatorMembershipId: null,
      bookingId: null,
      method: 'CLICKWRAP' as const,
      acceptedAt,
      ipAddress: null,
      userAgent: null,
    },
    KEY,
  )
  return {
    id: 'acc_1',
    documentId: 'doc_1',
    consentType: 'RENTER_TOS' as const,
    userId: 'u1',
    operatorId: null,
    operatorMembershipId: null,
    actorRole: 'RENTER',
    bookingId: null,
    acceptedAt,
    context: null,
    ipAddress: null,
    userAgent: null,
    method: 'CLICKWRAP' as const,
    recordSignature: sig.signature,
    signingKeyId: sig.signingKeyId,
    signatureCanonicalVersion: 'v1',
    documentSnapshot: null,
    signatureRef: null,
    createdAt: new Date('2026-06-24T00:00:00Z'),
  }
})()

describe('decideBackfill', () => {
  it('backfill when current doc is self-consistent AND HMAC matches', () => {
    expect(decideBackfill(acc, doc, () => KEY).action).toBe('backfill')
  })

  it('skipped-current-doc-hash-mismatch when doc text and its own hash disagree', () => {
    expect(decideBackfill(acc, { ...doc, body: 'EDITED' }, () => KEY).action).toBe(
      'skipped-current-doc-hash-mismatch',
    )
  })

  it('skipped-hash-mismatch when the doc drifted from what was signed', () => {
    // A different, self-consistent doc (its hash matches its own text, but differs from what acc was signed over)
    const differentTitle = 'Different Terms'
    const differentBody = 'Different body text.'
    const differentLabel = 'Accept'
    const driftedSelfConsistentDoc = {
      ...doc,
      title: differentTitle,
      body: differentBody,
      acceptanceLabel: differentLabel,
      contentHash: computeContentHash({
        title: differentTitle,
        body: differentBody,
        acceptanceLabel: differentLabel,
      }),
    }
    expect(decideBackfill(acc, driftedSelfConsistentDoc, () => KEY).action).toBe(
      'skipped-hash-mismatch',
    )
  })

  it('skipped-unsigned for an unsigned row', () => {
    expect(decideBackfill({ ...acc, recordSignature: null }, doc, () => KEY).action).toBe(
      'skipped-unsigned',
    )
  })

  it('backfill with timestampDrift=true when updatedAt>acceptedAt but HMAC matches', () => {
    const r = decideBackfill(
      acc,
      { ...doc, updatedAt: new Date(acceptedAt.getTime() + 1000) },
      () => KEY,
    )
    expect(r.action).toBe('backfill')
    expect(r.timestampDrift).toBe(true)
  })
})
