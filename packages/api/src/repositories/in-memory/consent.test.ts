import { beforeEach, describe, expect, it } from 'vitest'
import type { ConsentDocument } from '../../stores'
import { InMemoryConsentRepository } from './consent'

const DOC: ConsentDocument = {
  id: 'doc_tos_v1_en',
  type: 'RENTER_TOS',
  version: '1.0',
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

const baseAcceptance = {
  documentId: DOC.id,
  consentType: 'RENTER_TOS' as const,
  userId: 'user_1',
  operatorId: null,
  operatorMembershipId: null,
  actorRole: null,
  bookingId: null,
  acceptedAt: new Date('2026-06-15T00:00:00Z'),
  context: null,
  ipAddress: null,
  userAgent: null,
  method: 'CLICKWRAP' as const,
  recordSignature: 'sig',
  signingKeyId: 'v1',
}

describe('InMemoryConsentRepository', () => {
  let repo: InMemoryConsentRepository
  beforeEach(() => {
    repo = new InMemoryConsentRepository([DOC])
  })

  it('finds the latest published version and resolves a locale doc', async () => {
    expect(await repo.findLatestPublishedVersion('RENTER_TOS', new Date('2026-06-15Z'))).toBe('1.0')
    expect((await repo.findPublishedDocument('RENTER_TOS', '1.0', 'en'))?.id).toBe(DOC.id)
  })

  it('records an acceptance and reports the version accepted', async () => {
    await repo.createAcceptance(baseAcceptance)
    expect(await repo.hasAcceptedVersion('user_1', 'RENTER_TOS', '1.0')).toBe(true)
    expect(await repo.hasAcceptedVersion('user_2', 'RENTER_TOS', '1.0')).toBe(false)
  })

  it('seals once-per-user idempotency with a PG-shaped 23505', async () => {
    await repo.createAcceptance(baseAcceptance)
    await expect(repo.createAcceptance(baseAcceptance)).rejects.toMatchObject({ code: '23505' })
    expect((await repo.findUserDocumentAcceptance('user_1', DOC.id))?.userId).toBe('user_1')
  })
})
