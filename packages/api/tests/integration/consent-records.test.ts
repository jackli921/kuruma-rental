import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import {
  consentAcceptances,
  consentDocuments,
  operatorMemberships,
  users,
} from '@kuruma/shared/db/schema'
import type { ConsentType } from '@kuruma/shared/enums'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PG_ERROR, pgConstraintName, pgErrorCode } from '../../src/pg-errors'
import { createSeededBooking } from './booking-factory'
import { cleanupUsers, db } from './setup'

// #1049: the consent-ledger (issue #877) row-shape invariants live entirely in
// Postgres — composite-FK sync seal, three CHECKs, three partial-unique seals.
// The service-layer doubles can't prove the DB enforces them; ONLY a real-pg
// insert can. Each test inserts DIRECTLY via db.insert (NOT through any repo) so
// the Postgres-emitted constraint name is what we assert — a future migration
// that weakens or renames any seal turns a green test red. Every row this file
// writes is scoped to ids it created and torn down in afterAll, so a warm-DB
// re-run and parallel files never see its rows.

// --- ids seeded once in beforeAll ---
let renterUserId: string // FK target for RENTER_TOS / RENTER_LIABILITY acceptances
let operatorUserId: string // FK target for OPERATOR_AGREEMENT + the membership row
let membershipId: string // real operator_memberships row (FK passes; the CHECK is what trips)
let bookingId: string // one confirmed booking (RENTER_LIABILITY needs a real bookingId)
let cleanupBooking: () => Promise<void>

// One PUBLISHED document per consent type under test. documentId pins (type),
// so the composite FK (documentId, consentType) only passes when the snapshot
// consentType equals the document's real type.
const docIds: Partial<Record<ConsentType, string>> = {}

const createdAcceptanceIds: string[] = []
const createdUserIds: string[] = []
const createdDocumentIds: string[] = []

async function seedDocument(type: ConsentType): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(consentDocuments).values({
    id,
    type,
    version: `v-${id.slice(0, 8)}`,
    locale: 'en',
    title: `${type} document`,
    body: 'You agree to the terms.',
    acceptanceLabel: 'I agree',
    contentHash: crypto.randomUUID(),
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  })
  createdDocumentIds.push(id)
  docIds[type] = id
  return id
}

async function seedUser(prefix: string, role: 'RENTER' | 'OPERATOR_OWNER'): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: `${prefix}-${id.slice(0, 8)}@kuruma-1049.test`,
    role,
    operatorId: role === 'OPERATOR_OWNER' ? BEST_CAR_RENTAL_OPERATOR_ID : null,
    language: 'en',
  })
  createdUserIds.push(id)
  return id
}

/** Base acceptance row; tests spread overrides onto it. Tracks the id for teardown. */
function acceptance(values: {
  consentType: ConsentType
  documentId: string
  userId?: string
  operatorId?: string | null
  operatorMembershipId?: string | null
  bookingId?: string | null
}): typeof consentAcceptances.$inferInsert {
  const id = crypto.randomUUID()
  createdAcceptanceIds.push(id)
  return {
    id,
    documentId: values.documentId,
    consentType: values.consentType,
    userId: values.userId ?? renterUserId,
    operatorId: values.operatorId ?? null,
    operatorMembershipId: values.operatorMembershipId ?? null,
    bookingId: values.bookingId ?? null,
    acceptedAt: new Date('2026-06-01T12:00:00Z'),
    method: 'CLICKWRAP',
  }
}

async function insertAcceptance(values: typeof consentAcceptances.$inferInsert): Promise<unknown> {
  return db
    .insert(consentAcceptances)
    .values(values)
    .then(
      () => null,
      (e) => e,
    )
}

async function expectViolation(
  values: typeof consentAcceptances.$inferInsert,
  code: string,
  constraintName: string,
): Promise<void> {
  const err = await insertAcceptance(values)
  expect(err, 'expected the insert to be rejected by a constraint').not.toBeNull()
  expect(pgErrorCode(err)).toBe(code)
  expect(pgConstraintName(err)).toBe(constraintName)
}

beforeAll(async () => {
  renterUserId = await seedUser('renter', 'RENTER')
  operatorUserId = await seedUser('operator', 'OPERATOR_OWNER')

  await seedDocument('RENTER_TOS')
  await seedDocument('RENTER_LIABILITY')
  await seedDocument('OPERATOR_AGREEMENT')
  // Slice B (#877): a bare OPERATOR_RENTAL_TERMS document to serve as the composite-FK
  // target for the acceptance-row constraint tests below. Kept operatorId NULL on purpose:
  // this file exercises the ACCEPTANCE row shape (whose operatorId is always NULL, §3), and
  // consent-operator-repo.test.ts owns every operator-scoped doc for BEST_CAR_RENTAL and runs
  // in parallel against this DB — seeding one here under that operator would pollute it.
  await seedDocument('OPERATOR_RENTAL_TERMS')

  const seeded = await createSeededBooking({ prefix: 'consent-1049', renterId: renterUserId })
  bookingId = seeded.booking.id
  cleanupBooking = seeded.cleanup

  const [membership] = await db
    .insert(operatorMemberships)
    .values({
      id: crypto.randomUUID(),
      userId: operatorUserId,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    .returning({ id: operatorMemberships.id })
  if (!membership) throw new Error('Failed to seed operator membership')
  membershipId = membership.id
})

afterAll(async () => {
  // Acceptances first (they FK booking/membership/users/documents), then the
  // membership, the booking (FK-ordered by the factory), the documents, and last
  // the users. cleanupBooking owns renterUserId's renter only if it seeded it;
  // we passed our own renterId so it won't, so we delete both users ourselves.
  if (createdAcceptanceIds.length > 0) {
    await db.delete(consentAcceptances).where(inArray(consentAcceptances.id, createdAcceptanceIds))
  }
  if (membershipId) {
    await db.delete(operatorMemberships).where(eq(operatorMemberships.id, membershipId))
  }
  if (cleanupBooking) await cleanupBooking()
  if (createdDocumentIds.length > 0) {
    await db.delete(consentDocuments).where(inArray(consentDocuments.id, createdDocumentIds))
  }
  await cleanupUsers(createdUserIds)
})

describe('consent_acceptances DB constraints (#1049, real pg)', () => {
  it('round-trips a valid RENTER_TOS acceptance', async () => {
    const row = acceptance({ consentType: 'RENTER_TOS', documentId: docIds.RENTER_TOS! })
    const err = await insertAcceptance(row)
    expect(err, 'a valid acceptance must insert without error').toBeNull()

    const [persisted] = await db
      .select({
        id: consentAcceptances.id,
        documentId: consentAcceptances.documentId,
        consentType: consentAcceptances.consentType,
      })
      .from(consentAcceptances)
      .where(eq(consentAcceptances.id, row.id))
    expect(persisted).toEqual({
      id: row.id,
      documentId: docIds.RENTER_TOS,
      consentType: 'RENTER_TOS',
    })
  })

  it('rejects a consentType that diverges from the document type (composite-FK sync seal)', async () => {
    // documentId points at a real PUBLISHED RENTER_TOS doc, but the snapshot
    // claims PRIVACY_POLICY — (documentId, consentType) has no matching
    // (id, type) pair in consent_documents. A fresh doc + a fresh user keep the
    // (user, document) partial-unique from firing first, so the composite FK is
    // provably what rejects the row.
    const freshDoc = await seedDocument('RENTER_TOS')
    const freshUser = await seedUser('fk-probe', 'RENTER')
    await expectViolation(
      acceptance({ consentType: 'PRIVACY_POLICY', documentId: freshDoc, userId: freshUser }),
      PG_ERROR.FOREIGN_KEY_VIOLATION,
      'consent_acceptances_document_type_fk',
    )
  })

  it('rejects RENTER_LIABILITY with a NULL bookingId (liability-booking CHECK)', async () => {
    await expectViolation(
      acceptance({
        consentType: 'RENTER_LIABILITY',
        documentId: docIds.RENTER_LIABILITY!,
        bookingId: null,
      }),
      PG_ERROR.CHECK_VIOLATION,
      'consent_liability_booking_chk',
    )
  })

  it('rejects a non-liability consent that carries a bookingId (liability-booking CHECK)', async () => {
    await expectViolation(
      acceptance({
        consentType: 'RENTER_TOS',
        documentId: docIds.RENTER_TOS!,
        bookingId,
      }),
      PG_ERROR.CHECK_VIOLATION,
      'consent_liability_booking_chk',
    )
  })

  it('rejects OPERATOR_AGREEMENT with a NULL operatorId (operator-agreement CHECK)', async () => {
    await expectViolation(
      acceptance({
        consentType: 'OPERATOR_AGREEMENT',
        documentId: docIds.OPERATOR_AGREEMENT!,
        userId: operatorUserId,
        operatorId: null,
      }),
      PG_ERROR.CHECK_VIOLATION,
      'consent_operator_agreement_chk',
    )
  })

  it('rejects a non-operator consent that carries an operatorId (operator-agreement CHECK)', async () => {
    await expectViolation(
      acceptance({
        consentType: 'RENTER_TOS',
        documentId: docIds.RENTER_TOS!,
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      }),
      PG_ERROR.CHECK_VIOLATION,
      'consent_operator_agreement_chk',
    )
  })

  it('rejects a membership reference without an operatorId (membership-implies-operator CHECK)', async () => {
    // RENTER_TOS so the operator-agreement CHECK (which also fires on a stray
    // operatorId) is not what trips — the membership FK passes (real row), and
    // membership-without-operator is the only invariant left to violate.
    await expectViolation(
      acceptance({
        consentType: 'RENTER_TOS',
        documentId: docIds.RENTER_TOS!,
        userId: operatorUserId,
        operatorMembershipId: membershipId,
        operatorId: null,
      }),
      PG_ERROR.CHECK_VIOLATION,
      'consent_membership_implies_operator_chk',
    )
  })

  it('rejects a second RENTER_LIABILITY acceptance for the same booking (booking-liability unique)', async () => {
    const first = acceptance({
      consentType: 'RENTER_LIABILITY',
      documentId: docIds.RENTER_LIABILITY!,
      bookingId,
    })
    expect(await insertAcceptance(first), 'first liability acceptance must insert').toBeNull()

    await expectViolation(
      acceptance({
        consentType: 'RENTER_LIABILITY',
        documentId: docIds.RENTER_LIABILITY!,
        bookingId,
      }),
      PG_ERROR.UNIQUE_VIOLATION,
      'consent_unique_booking_liability',
    )
  })

  // --- Slice B (#877): OPERATOR_RENTAL_TERMS is the second per-booking (PER_EVENT) consent. ---

  it('accepts an OPERATOR_RENTAL_TERMS row bound to a booking (widened liability CHECK)', async () => {
    // Before Slice B this row was rejected by consent_liability_booking_chk (only
    // RENTER_LIABILITY could carry a bookingId). operatorId stays NULL (§3).
    const row = acceptance({
      consentType: 'OPERATOR_RENTAL_TERMS',
      documentId: docIds.OPERATOR_RENTAL_TERMS!,
      bookingId,
    })
    const err = await insertAcceptance(row)
    expect(err, 'an operator-terms acceptance with a bookingId must now insert').toBeNull()

    const [persisted] = await db
      .select({
        consentType: consentAcceptances.consentType,
        bookingId: consentAcceptances.bookingId,
        operatorId: consentAcceptances.operatorId,
      })
      .from(consentAcceptances)
      .where(eq(consentAcceptances.id, row.id))
    expect(persisted).toEqual({
      consentType: 'OPERATOR_RENTAL_TERMS',
      bookingId,
      operatorId: null,
    })
  })

  it('rejects OPERATOR_RENTAL_TERMS with a NULL bookingId (widened liability CHECK)', async () => {
    // The widened CHECK is bidirectional: operator-terms still REQUIRES a booking.
    await expectViolation(
      acceptance({
        consentType: 'OPERATOR_RENTAL_TERMS',
        documentId: docIds.OPERATOR_RENTAL_TERMS!,
        bookingId: null,
      }),
      PG_ERROR.CHECK_VIOLATION,
      'consent_liability_booking_chk',
    )
  })

  it('lets liability AND operator-terms coexist on one booking, but blocks a duplicate of either type (generalized (booking, type) seal)', async () => {
    // A fresh booking so this test owns both per-booking types on it outright.
    const seeded = await createSeededBooking({ prefix: 'consent-sliceb', renterId: renterUserId })
    const bId = seeded.booking.id

    const liability = acceptance({
      consentType: 'RENTER_LIABILITY',
      documentId: docIds.RENTER_LIABILITY!,
      bookingId: bId,
    })
    const terms = acceptance({
      consentType: 'OPERATOR_RENTAL_TERMS',
      documentId: docIds.OPERATOR_RENTAL_TERMS!,
      bookingId: bId,
    })
    expect(
      await insertAcceptance(liability),
      'liability on the fresh booking must insert',
    ).toBeNull()
    expect(
      await insertAcceptance(terms),
      'operator-terms on the SAME booking must coexist with liability',
    ).toBeNull()

    // The seal is now (bookingId, consentType): a duplicate of the SAME type still collides.
    await expectViolation(
      acceptance({
        consentType: 'OPERATOR_RENTAL_TERMS',
        documentId: docIds.OPERATOR_RENTAL_TERMS!,
        bookingId: bId,
      }),
      PG_ERROR.UNIQUE_VIOLATION,
      'consent_unique_booking_liability',
    )

    // Teardown: acceptances are dropped in afterAll (their ids are tracked); drop this
    // test's extra booking here (afterAll only knows the beforeAll booking).
    await db.delete(consentAcceptances).where(eq(consentAcceptances.bookingId, bId))
    await seeded.cleanup()
  })

  it('rejects a second acceptance of the same (user, document) (user-document unique)', async () => {
    // Both null booking + operator, so they fall in the partial index's WHERE.
    const fresh = await seedDocument('RENTER_TOS')
    const first = acceptance({ consentType: 'RENTER_TOS', documentId: fresh })
    expect(await insertAcceptance(first), 'first user-document acceptance must insert').toBeNull()

    await expectViolation(
      acceptance({ consentType: 'RENTER_TOS', documentId: fresh }),
      PG_ERROR.UNIQUE_VIOLATION,
      'consent_unique_user_document',
    )
  })

  it('rejects a second OPERATOR_AGREEMENT for the same (operator, document) (operator-document unique)', async () => {
    const first = acceptance({
      consentType: 'OPERATOR_AGREEMENT',
      documentId: docIds.OPERATOR_AGREEMENT!,
      userId: operatorUserId,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    })
    expect(
      await insertAcceptance(first),
      'first operator-document acceptance must insert',
    ).toBeNull()

    // A different operator user accepting the SAME operator+document still
    // collides — the seal is keyed on (operatorId, documentId), not the user.
    const otherOperatorUser = await seedUser('operator2', 'OPERATOR_OWNER')
    await expectViolation(
      acceptance({
        consentType: 'OPERATOR_AGREEMENT',
        documentId: docIds.OPERATOR_AGREEMENT!,
        userId: otherOperatorUser,
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      }),
      PG_ERROR.UNIQUE_VIOLATION,
      'consent_unique_operator_document',
    )
  })
})
