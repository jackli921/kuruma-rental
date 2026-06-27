import { computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import { describe, expect, it } from 'vitest'
import { verifyAcceptance } from './consent-evidence-verify'
import { signAcceptanceRecord } from './consent-signing'

const KEY = { key: 'secret', keyId: 'v1' }

function signedAcceptance(over: Record<string, unknown> = {}) {
  const snap = {
    version: 'v1',
    locale: 'en',
    title: 'T',
    body: 'B',
    acceptanceLabel: 'L',
    contentHash: computeContentHash({ title: 'T', body: 'B', acceptanceLabel: 'L' }),
  }
  const base = {
    id: 'acc_1',
    documentId: 'doc_1',
    consentType: 'RENTER_TOS' as const,
    userId: 'u1',
    operatorId: null,
    operatorMembershipId: null,
    actorRole: 'RENTER',
    bookingId: null,
    acceptedAt: new Date('2026-06-24T00:00:00Z'),
    context: null,
    ipAddress: null,
    userAgent: null,
    method: 'CLICKWRAP' as const,
    signatureRef: null,
    createdAt: new Date('2026-06-24T00:00:00Z'),
    signatureCanonicalVersion: 'v1',
    documentSnapshot: snap,
  }
  const sig = signAcceptanceRecord(
    {
      documentId: base.documentId,
      contentHash: snap.contentHash,
      consentType: base.consentType,
      version: snap.version,
      locale: snap.locale,
      userId: base.userId,
      operatorId: base.operatorId,
      operatorMembershipId: base.operatorMembershipId,
      bookingId: base.bookingId,
      method: base.method,
      acceptedAt: base.acceptedAt,
      ipAddress: base.ipAddress,
      userAgent: base.userAgent,
    },
    KEY,
  )
  // `over` allows targeted overrides for tamper tests; cast needed because tests
  // deliberately supply invalid values (null signature, unknown keyId, etc.).
  // biome-ignore lint/suspicious/noExplicitAny: test helper for negative-path overrides
  return { ...base, recordSignature: sig.signature, signingKeyId: sig.signingKeyId, ...over } as any
}

describe('verifyAcceptance', () => {
  it('VERIFIED when snapshot hashes correctly and signature matches', () => {
    expect(verifyAcceptance(signedAcceptance(), () => KEY).status).toBe('VERIFIED')
  })

  it('SNAPSHOT_MISSING when no snapshot', () => {
    expect(verifyAcceptance(signedAcceptance({ documentSnapshot: null }), () => KEY).status).toBe(
      'SNAPSHOT_MISSING',
    )
  })

  it('SNAPSHOT_HASH_MISMATCH when body altered but hash left intact (the attack)', () => {
    const a = signedAcceptance()
    const tampered = { ...a, documentSnapshot: { ...a.documentSnapshot, body: 'EVIL' } }
    expect(verifyAcceptance(tampered, () => KEY).status).toBe('SNAPSHOT_HASH_MISMATCH')
  })

  it('UNSIGNED when recordSignature null', () => {
    expect(verifyAcceptance(signedAcceptance({ recordSignature: null }), () => KEY).status).toBe(
      'UNSIGNED',
    )
  })

  it('KEY_UNAVAILABLE when signingKeyId is not resolvable', () => {
    const onlyV1 = (keyId: string) => (keyId === 'v1' ? KEY : undefined)
    expect(verifyAcceptance(signedAcceptance({ signingKeyId: 'v9' }), onlyV1).status).toBe(
      'KEY_UNAVAILABLE',
    )
  })

  it('SIGNATURE_MISMATCH when the signature was altered', () => {
    expect(
      verifyAcceptance(signedAcceptance({ recordSignature: 'deadbeef' }), () => KEY).status,
    ).toBe('SIGNATURE_MISMATCH')
  })
})
