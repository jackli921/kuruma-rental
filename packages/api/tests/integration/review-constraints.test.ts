import { SECOND_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { reviewReports, reviews } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  PG_ERROR,
  REVIEWS_SUBJECT_CONSTRAINT,
  REVIEW_REPORT_UNIQUE_CONSTRAINT,
  pgConstraintName,
  pgErrorCode,
} from '../../src/pg-errors'
import { type SeededBooking, createSeededBooking, seedRenter } from './booking-factory'
import { db } from './setup'

// #1067 slice 1: the reviews row-shape invariants live in Postgres, not service
// promises. Inserts DIRECTLY via db.insert (NOT a repo) so the Postgres-emitted
// constraint name is what we assert — a migration that renames or drops a seal
// turns this green test red. Mirrors payment-refund-constraints.test.ts.

let seeded: SeededBooking
let bookingId: string
let operatorId: string
let renterId: string
let vehicleId: string
let classId: string

beforeAll(async () => {
  seeded = await createSeededBooking({ prefix: 'review-chk' })
  bookingId = seeded.booking.id
  operatorId = seeded.operatorId
  renterId = seeded.renterId
  vehicleId = seeded.ids.vehicleId
  classId = seeded.ids.classId
})

afterEach(async () => {
  // The (bookingId, subject) unique allows one row per pair; clear them between cases
  // so each starts clean and the asserted seal is what trips.
  await db.delete(reviews).where(eq(reviews.bookingId, bookingId))
})

afterAll(async () => {
  // reviews.bookingId is ON DELETE restrict — drop our rows before the factory
  // tears the booking down, or its cleanup 23503s.
  await db.delete(reviews).where(eq(reviews.bookingId, bookingId))
  await seeded.cleanup()
})

function reviewRow(
  overrides: Partial<typeof reviews.$inferInsert> = {},
): typeof reviews.$inferInsert {
  return {
    id: crypto.randomUUID(),
    bookingId,
    operatorId,
    authorUserId: renterId,
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    overall: 5,
    revealDeadlineAt: new Date('2027-01-21T09:00:00Z'),
    ...overrides,
  }
}

async function insertReview(
  overrides: Partial<typeof reviews.$inferInsert> = {},
): Promise<unknown> {
  return db
    .insert(reviews)
    .values(reviewRow(overrides))
    .then(
      () => null,
      (e) => e,
    )
}

/** Insert a review and return its id — the report cases need a live FK referent. */
async function seedReview(overrides: Partial<typeof reviews.$inferInsert> = {}): Promise<string> {
  const row = reviewRow(overrides)
  await db.insert(reviews).values(row)
  return row.id as string
}

async function insertReport(reviewId: string, reporterUserId: string): Promise<unknown> {
  return db
    .insert(reviewReports)
    .values({ id: crypto.randomUUID(), reviewId, reporterUserId, reason: 'inappropriate' })
    .then(
      () => null,
      (e) => e,
    )
}

describe('reviews table constraints (#1067, real pg)', () => {
  it('accepts a valid renter -> operator review', async () => {
    expect(await insertReview()).toBeNull()
  })

  it('accepts a valid operator -> renter review', async () => {
    expect(await insertReview({ authorRole: 'OPERATOR', subject: 'RENTER' })).toBeNull()
  })

  it('accepts a valid renter -> vehicle review carrying its vehicle id', async () => {
    expect(await insertReview({ subject: 'VEHICLE', subjectVehicleId: vehicleId })).toBeNull()
  })

  it('accepts a renter -> vehicle review carrying its denormalized class id', async () => {
    expect(
      await insertReview({
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
      }),
    ).toBeNull()
  })

  it('rejects a duplicate (bookingId, subject) — the single reseal (#1201)', async () => {
    expect(await insertReview()).toBeNull()
    const err = await insertReview()
    expect(err, 'a second review for the same booking+subject must be rejected').not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(err)).toBe(REVIEWS_SUBJECT_CONSTRAINT)
  })

  it('rejects a 2nd operator->renter review by a different staff member of the same operator (#1158)', async () => {
    // Two distinct staff users of the SAME operator. The (bookingId, subject) unique
    // seals one operator->renter review per booking regardless of which staff member submits.
    const staffA = await seedRenter('review-op-a')
    const staffB = await seedRenter('review-op-b')
    expect(
      await insertReview({ authorRole: 'OPERATOR', subject: 'RENTER', authorUserId: staffA }),
    ).toBeNull()
    const err = await insertReview({
      authorRole: 'OPERATOR',
      subject: 'RENTER',
      authorUserId: staffB,
    })
    expect(err, 'one operator-side review per booking, keyed on the operator').not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(err)).toBe(REVIEWS_SUBJECT_CONSTRAINT)
  })

  it('seals operator->renter on (bookingId, subject) regardless of operatorId (#1201)', async () => {
    // The denormalized operatorId is NOT part of the seal anymore. A 2nd operator->renter
    // review carrying a DIFFERENT (still FK-valid) operatorId must still be rejected — proving
    // a writer setting a wrong operatorId can no longer slip a duplicate past the seal.
    // SECOND_OPERATOR_ID is FK-seeded in global-setup.ts so the row is genuinely FK-valid and
    // reaches the unique check (the 23505 fires before the FK is even evaluated).
    const staffA = await seedRenter('review-indep-a')
    const staffB = await seedRenter('review-indep-b')
    expect(
      await insertReview({ authorRole: 'OPERATOR', subject: 'RENTER', authorUserId: staffA }),
    ).toBeNull()
    const err = await insertReview({
      authorRole: 'OPERATOR',
      subject: 'RENTER',
      authorUserId: staffB,
      operatorId: SECOND_OPERATOR_ID,
    })
    expect(err, 'a wrong operatorId must not unlock a 2nd operator review').not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(err)).toBe(REVIEWS_SUBJECT_CONSTRAINT)
  })

  it('rejects an operator reviewing a non-renter subject (reviews_subject_pairing_chk)', async () => {
    const err = await insertReview({ authorRole: 'OPERATOR', subject: 'OPERATOR' })
    expect(err, 'operators may only review RENTER').not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    expect(pgConstraintName(err)).toBe('reviews_subject_pairing_chk')
  })

  it('rejects a vehicle review with no vehicle id (reviews_vehicle_subject_chk)', async () => {
    const err = await insertReview({ subject: 'VEHICLE', subjectVehicleId: null })
    expect(err, 'a VEHICLE review must carry its vehicle id').not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    expect(pgConstraintName(err)).toBe('reviews_vehicle_subject_chk')
  })

  it('rejects a non-vehicle review carrying a stray class id (reviews_class_subject_chk)', async () => {
    const err = await insertReview({ subject: 'OPERATOR', subjectClassId: classId })
    expect(err, 'a class id may only ride a VEHICLE review').not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    expect(pgConstraintName(err)).toBe('reviews_class_subject_chk')
  })

  it('rejects an out-of-range overall rating (reviews_overall_range_chk)', async () => {
    const err = await insertReview({ overall: 6 })
    expect(err, 'overall must be 1-5').not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    expect(pgConstraintName(err)).toBe('reviews_overall_range_chk')
  })
})

// #1086 slice 6: the "one report per (review, reporter)" seal lives in Postgres as
// a unique index. The service reads its constraint NAME off the 23505 to map to 409
// ALREADY_REPORTED — so a driver whose error omits that name (the #1362 Neon-vs-postgres-js
// divergence) would silently 500 instead. This asserts the real-pg name, belt to the
// statically-verified suspenders. Inserts DIRECTLY via db (not the repo) so the seal is
// what trips, and reports cascade-delete with their review in the shared afterEach.
describe('review_reports table constraints (#1086, real pg)', () => {
  it('accepts a first report of a review by a reporter', async () => {
    const reviewId = await seedReview()
    const reporter = await seedRenter('review-report-ok')
    expect(await insertReport(reviewId, reporter)).toBeNull()
  })

  it('rejects a duplicate report by the same reporter (review_reports_one_per_reporter)', async () => {
    const reviewId = await seedReview()
    const reporter = await seedRenter('review-report-dup')
    expect(await insertReport(reviewId, reporter)).toBeNull()
    const err = await insertReport(reviewId, reporter)
    expect(err, 'a user may report a given review at most once').not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(err)).toBe(REVIEW_REPORT_UNIQUE_CONSTRAINT)
  })

  it('allows two different reporters to report the same review (seal is per reporter, not per review)', async () => {
    const reviewId = await seedReview()
    const reporterA = await seedRenter('review-report-a')
    const reporterB = await seedRenter('review-report-b')
    expect(await insertReport(reviewId, reporterA)).toBeNull()
    expect(await insertReport(reviewId, reporterB)).toBeNull()
  })
})
