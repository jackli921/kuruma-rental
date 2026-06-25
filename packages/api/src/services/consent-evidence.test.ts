import { computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import { describe, expect, it } from 'vitest'
import { InMemoryConsentRepository } from '../repositories/in-memory/consent'
import { ConsentEvidenceService } from './consent-evidence'
import { signAcceptanceRecord } from './consent-signing'

const KEY = { key: 'secret', keyId: 'v1' }
const getKey = (keyId: string) => (keyId === 'v1' ? KEY : undefined)

function makeSignedNewAcceptance() {
  const snap = {
    version: 'v1',
    locale: 'en',
    title: 'Terms',
    body: 'Body text',
    acceptanceLabel: 'I agree',
    contentHash: computeContentHash({
      title: 'Terms',
      body: 'Body text',
      acceptanceLabel: 'I agree',
    }),
  }
  const base = {
    documentId: 'doc_1',
    consentType: 'RENTER_TOS' as const,
    userId: 'u1',
    operatorId: 'op_1',
    operatorMembershipId: 'mem_1',
    actorRole: 'RENTER',
    bookingId: null,
    acceptedAt: new Date('2026-06-24T00:00:00Z'),
    context: null,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    method: 'CLICKWRAP' as const,
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
  return { ...base, recordSignature: sig.signature, signingKeyId: sig.signingKeyId }
}

describe('ConsentEvidenceService', () => {
  it('assembles an evidence bundle with verification for an acceptance id', async () => {
    const repo = new InMemoryConsentRepository()
    const acc = await repo.createAcceptance(makeSignedNewAcceptance())
    const svc = new ConsentEvidenceService(repo, getKey)
    const ev = await svc.getConsentEvidence(acc.id)
    expect(ev?.acceptance.id).toBe(acc.id)
    expect(ev?.acceptance.documentId).toBe(acc.documentId)
    expect(ev?.acceptance.operatorMembershipId).toBe(acc.operatorMembershipId)
    expect(ev?.document).toEqual(acc.documentSnapshot)
    expect(ev?.signature.signatureCanonicalVersion).toBe('v1')
    expect(ev?.verification.status).toBe('VERIFIED')
  })

  it('returns undefined for an unknown acceptance id', async () => {
    const svc = new ConsentEvidenceService(new InMemoryConsentRepository(), () => undefined)
    expect(await svc.getConsentEvidence('nope')).toBeUndefined()
  })

  it('returns all evidence for a user', async () => {
    const repo = new InMemoryConsentRepository()
    const acc = await repo.createAcceptance(makeSignedNewAcceptance())
    const svc = new ConsentEvidenceService(repo, getKey)
    const evs = await svc.getConsentEvidenceForUser(acc.userId)
    expect(evs).toHaveLength(1)
    expect(evs[0]?.acceptance.id).toBe(acc.id)
    expect(evs[0]?.verification.status).toBe('VERIFIED')
  })
})
