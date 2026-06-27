import { describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError } from '../middleware/auth'
import { InMemoryConsentRepository } from '../repositories/in-memory/consent'
import type { ConsentDocument } from '../stores'
import { ConsentGovernanceService } from './consent-governance'

const ADMIN: CallerContext = { userId: 'admin-user', role: 'PLATFORM_ADMIN' }

function doc(id: string, version: string, type: ConsentDocument['type']): ConsentDocument {
  return {
    id,
    type,
    version,
    locale: 'en',
    title: 'Terms',
    body: 'body',
    acceptanceLabel: 'I accept',
    contentHash: 'a'.repeat(64),
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

const TOS_V1 = doc('doc_tos_v1_en', '1.0', 'RENTER_TOS')
const TOS_V2 = doc('doc_tos_v2_en', '2.0', 'RENTER_TOS')
const PRIVACY_V1 = doc('doc_privacy_v1_en', '1.0', 'PRIVACY_POLICY')

async function seededService(): Promise<ConsentGovernanceService> {
  const repo = new InMemoryConsentRepository([TOS_V1, TOS_V2, PRIVACY_V1])
  // user_a accepted TOS v1 (oldest), then privacy v1; user_b accepted TOS v2 (newest).
  await repo.createAcceptance({
    documentId: TOS_V1.id,
    consentType: 'RENTER_TOS',
    userId: 'user_a',
    operatorId: null,
    operatorMembershipId: null,
    actorRole: 'RENTER',
    bookingId: null,
    acceptedAt: new Date('2026-03-01T00:00:00Z'),
    context: null,
    ipAddress: null,
    userAgent: null,
    method: 'CLICKWRAP',
    recordSignature: null,
    signingKeyId: null,
    signatureCanonicalVersion: null,
    documentSnapshot: null,
  })
  await repo.createAcceptance({
    documentId: PRIVACY_V1.id,
    consentType: 'PRIVACY_POLICY',
    userId: 'user_a',
    operatorId: null,
    operatorMembershipId: null,
    actorRole: 'RENTER',
    bookingId: null,
    acceptedAt: new Date('2026-04-01T00:00:00Z'),
    context: null,
    ipAddress: null,
    userAgent: null,
    method: 'CLICKWRAP',
    recordSignature: null,
    signingKeyId: null,
    signatureCanonicalVersion: null,
    documentSnapshot: null,
  })
  await repo.createAcceptance({
    documentId: TOS_V2.id,
    consentType: 'RENTER_TOS',
    userId: 'user_b',
    operatorId: null,
    operatorMembershipId: null,
    actorRole: 'RENTER',
    bookingId: null,
    acceptedAt: new Date('2026-05-01T00:00:00Z'),
    context: null,
    ipAddress: null,
    userAgent: null,
    method: 'CLICKWRAP',
    recordSignature: null,
    signingKeyId: null,
    signatureCanonicalVersion: null,
    documentSnapshot: null,
  })
  return new ConsentGovernanceService(repo)
}

describe('ConsentGovernanceService — defence-in-depth authz', () => {
  it.each(['OPERATOR_OWNER', 'OPERATOR_STAFF', 'RENTER', 'PARTNER'] as const)(
    'rejects %s with ForbiddenError even if the route gate were bypassed',
    async (role) => {
      const service = await seededService()
      await expect(service.list({ userId: `${role}-user`, role }, {})).rejects.toThrow(
        ForbiddenError,
      )
    },
  )
})

describe('ConsentGovernanceService — ledger browse', () => {
  it('returns all acceptances across users, newest accepted first', async () => {
    const service = await seededService()
    const { acceptances } = await service.list(ADMIN, {})

    expect(acceptances.map((a) => a.userId)).toEqual(['user_b', 'user_a', 'user_a'])
    expect(acceptances[0]).toMatchObject({
      userId: 'user_b',
      consentType: 'RENTER_TOS',
      version: '2.0',
      acceptedAt: '2026-05-01T00:00:00.000Z',
      operatorId: null,
      bookingId: null,
    })
    // The acceptanceId is the evidence-export link target — must be the real PK.
    expect(acceptances[0]?.acceptanceId).toMatch(/[0-9a-f-]{36}/)
    // No computed status leaks onto the wire (deferred to a later slice).
    expect(acceptances[0]).not.toHaveProperty('status')
  })

  it('filters by userId', async () => {
    const service = await seededService()
    const { acceptances } = await service.list(ADMIN, { userId: 'user_a' })
    expect(acceptances.map((a) => a.consentType)).toEqual(['PRIVACY_POLICY', 'RENTER_TOS'])
    expect(acceptances.every((a) => a.userId === 'user_a')).toBe(true)
  })

  it('filters by consentType', async () => {
    const service = await seededService()
    const { acceptances } = await service.list(ADMIN, { consentType: 'RENTER_TOS' })
    expect(acceptances.map((a) => a.version)).toEqual(['2.0', '1.0'])
  })

  it('filters by version (resolved via the joined document)', async () => {
    const service = await seededService()
    const { acceptances } = await service.list(ADMIN, { version: '2.0' })
    expect(acceptances).toHaveLength(1)
    expect(acceptances[0]).toMatchObject({ userId: 'user_b', version: '2.0' })
  })

  it('inclusively bounds acceptedAt by acceptedFrom/acceptedTo', async () => {
    const service = await seededService()
    const { acceptances } = await service.list(ADMIN, {
      acceptedFrom: '2026-04-01T00:00:00.000Z',
      acceptedTo: '2026-04-30T00:00:00.000Z',
    })
    expect(acceptances).toHaveLength(1)
    expect(acceptances[0]).toMatchObject({ consentType: 'PRIVACY_POLICY', version: '1.0' })
  })
})
