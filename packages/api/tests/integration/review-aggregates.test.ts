import { reviews } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleReviewRepository } from '../../src/repositories/drizzle/review'
import { type SeededBooking, createSeededBooking } from './booking-factory'
import { db } from './setup'

// #1085 slice 5: lock the SQL aggregate semantics on real Postgres. The InMemory
// suite proves the predicate matrix (published+visible, key column, mixed batch);
// here we pin that the Drizzle GROUP BY + WHERE + sum()/count() lowering renders the
// SAME predicate against a live schema (`moderationStatus` ENUM, the partial index,
// the FK columns). One scenario per method covers a happy path + a published-vs-hidden
// row drop — enough for the SQL contract; predicate-completeness lives in InMemory.
//
// The reviews reseal (#1201) makes `(bookingId, subject)` UNIQUE: at most one review
// per booking per subject. So any scenario that needs two same-subject rows (two
// VEHICLE reviews to sum, or a counted OPERATOR row plus a dropped one) must spread
// them across TWO bookings. Both bookings default to the same operator; the second
// exists purely to give same-subject rows a distinct bookingId.

let seeded: SeededBooking
let secondSeeded: SeededBooking
let bookingId: string
let secondBookingId: string
let operatorId: string
let renterId: string
let secondRenterId: string
let vehicleId: string
let classId: string

beforeAll(async () => {
  seeded = await createSeededBooking({ prefix: 'review-agg' })
  bookingId = seeded.booking.id
  operatorId = seeded.operatorId
  renterId = seeded.renterId
  vehicleId = seeded.ids.vehicleId
  classId = seeded.ids.classId
  // A SECOND booking on the same operator. The `(bookingId, subject)` seal admits
  // only one review per subject per booking, so a scenario's second same-subject
  // row lands here. Its own renter authors it — realistic, and no cross-check ties
  // a review's author or subjectVehicleId to the booking it cites.
  secondSeeded = await createSeededBooking({ prefix: 'review-agg-2' })
  secondBookingId = secondSeeded.booking.id
  secondRenterId = secondSeeded.renterId
})

const bookingIds = (): string[] => [bookingId, secondBookingId]

afterEach(async () => {
  await db.delete(reviews).where(inArray(reviews.bookingId, bookingIds()))
})

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.bookingId, bookingIds()))
  await seeded.cleanup()
  await secondSeeded.cleanup()
})

const REVEAL_DEADLINE = new Date('2027-01-21T09:00:00Z')
const PUBLISHED = new Date('2026-06-26T00:00:00Z')

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
    moderationStatus: 'VISIBLE',
    revealDeadlineAt: REVEAL_DEADLINE,
    publishedAt: PUBLISHED,
    ...overrides,
  }
}

describe('DrizzleReviewRepository aggregates (#1085, real pg)', () => {
  it('aggregateByOperator: only OPERATOR-subject rows count; drops VEHICLE + unpublished + HIDDEN', async () => {
    // One published+visible OPERATOR row (counts) + one published+visible VEHICLE
    // row on the SAME operator (must NOT count — `operatorId` is denormalized on
    // every review, so without the subject filter the operator rating would
    // ingest renters' vehicle scores). Plus a still-hidden OPERATOR row and a
    // HIDDEN VEHICLE row, both also denied. The second OPERATOR/VEHICLE pair lives
    // on the second booking so the `(bookingId, subject)` seal admits them.
    await db.insert(reviews).values([
      reviewRow({ overall: 5 }),
      reviewRow({
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 3,
      }),
      // still in the double-blind window (publishedAt: null)
      reviewRow({
        bookingId: secondBookingId,
        authorUserId: secondRenterId,
        overall: 1,
        publishedAt: null,
      }),
      // moderator-hidden published row — slice 6 forward-compat
      reviewRow({
        bookingId: secondBookingId,
        authorUserId: secondRenterId,
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 1,
        moderationStatus: 'HIDDEN',
      }),
    ])
    const repo = new DrizzleReviewRepository(db)
    const out = await repo.aggregateByOperator([operatorId])
    // Only the OPERATOR-subject row (overall=5) counts. A regression that drops
    // the subject filter would land at {sum:8,count:2} (5+3 from VEHICLE).
    expect(out.get(operatorId)).toEqual({ sum: 5, count: 1 })
  })

  it('aggregateByVehicle: keys on subjectVehicleId; only VEHICLE rows count', async () => {
    // Two VEHICLE reviews of the SAME vehicle across two bookings (the seal allows
    // one VEHICLE review per booking). Both denormalize subjectVehicleId onto
    // vehicleId — the aggregate keys off reviews.subjectVehicleId, NOT the cited
    // booking's own vehicle, so the second booking's car never enters the sum.
    await db.insert(reviews).values([
      reviewRow({
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 4,
      }),
      reviewRow({
        bookingId: secondBookingId,
        authorUserId: secondRenterId,
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 2,
      }),
      // OPERATOR-subject review on the same booking — subjectVehicleId is null,
      // so the WHERE inArray(subjectVehicleId, …) drops it as expected.
      reviewRow({ subject: 'OPERATOR', overall: 1 }),
    ])
    const repo = new DrizzleReviewRepository(db)
    const out = await repo.aggregateByVehicle([vehicleId])
    expect(out.get(vehicleId)).toEqual({ sum: 6, count: 2 })
  })

  it('aggregateByClass: keys on subjectClassId; null-class vehicle rows are absent', async () => {
    // Same shape as the vehicle case: two VEHICLE reviews across two bookings,
    // both tagged with classId, summing under the one class key.
    await db.insert(reviews).values([
      reviewRow({
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 4,
      }),
      reviewRow({
        bookingId: secondBookingId,
        authorUserId: secondRenterId,
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 5,
      }),
    ])
    const repo = new DrizzleReviewRepository(db)
    const out = await repo.aggregateByClass([classId])
    expect(out.get(classId)).toEqual({ sum: 9, count: 2 })
    // An id with no published+visible rows is ABSENT, not {sum:0,count:0}.
    expect(out.has('cls_missing')).toBe(false)
  })
})
