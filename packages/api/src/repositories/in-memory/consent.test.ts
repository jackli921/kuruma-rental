import { beforeEach, describe, expect, it } from 'vitest'
import type { ConsentDocument } from '../../stores'
import type { NewConsentAcceptance, NewConsentDocument } from '../types'
import { CONSENT_ACCEPTANCE_LIST_LIMIT } from '../types-consent'
import { InMemoryConsentRepository } from './consent'

const DOC: ConsentDocument = {
  id: 'doc_tos_v1_en',
  type: 'RENTER_TOS',
  version: '1.0',
  locale: 'en',
  operatorId: null,
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

const baseAcceptance: NewConsentAcceptance = {
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
  signatureCanonicalVersion: 'v1',
  documentSnapshot: null,
}

const OP = 'op_kuruma'
const TERMS = 'OPERATOR_RENTAL_TERMS' as const

function opDoc(
  over: Partial<ConsentDocument> & Pick<ConsentDocument, 'id' | 'version' | 'locale' | 'status'>,
): ConsentDocument {
  return {
    type: TERMS,
    operatorId: OP,
    title: 'Terms',
    body: 'body',
    acceptanceLabel: 'I agree',
    contentHash: 'b'.repeat(64),
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}

function newOpRow(over: Partial<NewConsentDocument> = {}): NewConsentDocument {
  return {
    operatorId: OP,
    type: TERMS,
    version: 'v1',
    locale: 'en',
    title: 'Terms',
    body: 'body',
    acceptanceLabel: 'I agree',
    contentHash: 'c'.repeat(64),
    status: 'DRAFT',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: null,
    ...over,
  }
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

  it('findAcceptances joins the document version and drops rows whose doc is absent', async () => {
    await repo.createAcceptance(baseAcceptance)
    // An acceptance pointing at a document not in the repo (mirrors an inner join
    // miss) must NOT surface with an empty version — it is dropped entirely.
    await repo.createAcceptance({ ...baseAcceptance, userId: 'user_2', documentId: 'doc_missing' })

    const rows = await repo.findAcceptances({})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'user_1', consentType: 'RENTER_TOS', version: '1.0' })
  })

  it('caps the ledger browse at CONSENT_ACCEPTANCE_LIST_LIMIT, keeping the newest', async () => {
    // Seed more than the cap, each a distinct user (the composite-unique key) with a
    // strictly increasing acceptedAt, so newest-first ordering is unambiguous.
    const overflow = CONSENT_ACCEPTANCE_LIST_LIMIT + 5
    for (let i = 0; i < overflow; i++) {
      await repo.createAcceptance({
        ...baseAcceptance,
        userId: `user_${String(i).padStart(4, '0')}`,
        acceptedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      })
    }

    const rows = await repo.findAcceptances({})

    expect(rows).toHaveLength(CONSENT_ACCEPTANCE_LIST_LIMIT)
    // Newest row survives; the 5 oldest (user_0000..user_0004) are dropped by the cap.
    expect(rows[0]?.userId).toBe(`user_${String(overflow - 1).padStart(4, '0')}`)
    expect(rows.map((r) => r.userId)).not.toContain('user_0000')
  })

  it('seals once-per-user idempotency with constraint_name consent_unique_user_document', async () => {
    await repo.createAcceptance(baseAcceptance)
    await expect(repo.createAcceptance(baseAcceptance)).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'consent_unique_user_document',
    })
    expect((await repo.findUserDocumentAcceptance('user_1', DOC.id))?.userId).toBe('user_1')
  })

  it('seals booking-liability idempotency with constraint_name consent_unique_booking_liability', async () => {
    // bookingId set → hits the booking-liability branch first (priority early-return).
    const bookingAcceptance: NewConsentAcceptance = {
      ...baseAcceptance,
      consentType: 'RENTER_LIABILITY' as const,
      bookingId: 'booking_abc',
    }
    const created = await repo.createAcceptance(bookingAcceptance)
    await expect(repo.createAcceptance(bookingAcceptance)).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'consent_unique_booking_liability',
    })
    expect((await repo.findBookingAcceptance('booking_abc'))?.id).toBe(created.id)
  })

  it('seals operator-document idempotency with constraint_name consent_unique_operator_document', async () => {
    // bookingId must be null to skip the booking branch and hit the operator branch.
    const operatorAcceptance: NewConsentAcceptance = {
      ...baseAcceptance,
      consentType: 'OPERATOR_AGREEMENT' as const,
      userId: 'user_op',
      operatorId: 'op_1',
      bookingId: null,
    }
    const created = await repo.createAcceptance(operatorAcceptance)
    await expect(repo.createAcceptance(operatorAcceptance)).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'consent_unique_operator_document',
    })
    // A different documentId for the same operatorId is a distinct seal — must not throw.
    await expect(
      repo.createAcceptance({ ...operatorAcceptance, documentId: 'doc_other' }),
    ).resolves.toBeDefined()
    expect((await repo.findOperatorDocumentAcceptance('op_1', DOC.id))?.id).toBe(created.id)
  })

  it('replaceOperatorDraftRows is atomic: a unique clash on insert leaves the prior draft intact (rollback parity with the drizzle runTx, #1498)', async () => {
    // A PUBLISHED en row of v1 blocks the new en insert; a DRAFT ja row of the SAME
    // version is the prior draft a rollback must preserve. The drizzle path runs
    // delete+insert in ONE runTx, so the 23505 on insert rolls the delete back and the
    // ja draft survives. The in-memory twin must match, or Slice B's test double lies.
    const seeded = new InMemoryConsentRepository([
      opDoc({ id: 'pub_v1_en', version: 'v1', locale: 'en', status: 'PUBLISHED' }),
      opDoc({ id: 'draft_v1_ja', version: 'v1', locale: 'ja', status: 'DRAFT' }),
    ])

    await expect(
      seeded.replaceOperatorDraftRows(OP, TERMS, 'v1', [newOpRow({ locale: 'en' })]),
    ).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'consent_documents_operator_tvl_unique',
    })

    // The prior ja draft must NOT have been destroyed by the aborted rewrite.
    const surviving = await seeded.findOperatorDocuments(OP, TERMS)
    expect(surviving.map((d) => d.id).sort()).toEqual(['draft_v1_ja', 'pub_v1_en'])
  })

  it('replaceOperatorDraftRows rejects an intra-batch duplicate locale before mutating, so the prior draft survives (#1498)', async () => {
    // Two en rows in one batch violate the same (operatorId,type,version,locale) seal
    // the real partial unique index enforces; validate-before-mutate must reject the
    // batch without first deleting the existing ja draft.
    const seeded = new InMemoryConsentRepository([
      opDoc({ id: 'draft_v1_ja', version: 'v1', locale: 'ja', status: 'DRAFT' }),
    ])

    await expect(
      seeded.replaceOperatorDraftRows(OP, TERMS, 'v1', [
        newOpRow({ locale: 'en' }),
        newOpRow({ locale: 'en' }),
      ]),
    ).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'consent_documents_operator_tvl_unique',
    })

    const surviving = await seeded.findOperatorDocuments(OP, TERMS)
    expect(surviving.map((d) => d.id)).toEqual(['draft_v1_ja'])
  })

  it('findAcceptanceById returns the acceptance, findAcceptancesByUser scopes by user, findAcceptancesByBooking returns empty for unknown booking', async () => {
    const created = await repo.createAcceptance(baseAcceptance)
    const byId = await repo.findAcceptanceById(created.id)
    expect(byId?.id).toBe(created.id)
    expect(byId?.userId).toBe('user_1')
    const byUser = await repo.findAcceptancesByUser('user_1')
    expect(byUser).toHaveLength(1)
    expect(byUser[0]?.id).toBe(created.id)
    const byBooking = await repo.findAcceptancesByBooking('none')
    expect(byBooking).toEqual([])
  })
})
