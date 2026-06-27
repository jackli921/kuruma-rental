import { reviews } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleReviewRepository } from '../../src/repositories/drizzle/review'
import { type SeededBooking, createSeededBooking, seedRenter } from './booking-factory'
import { db } from './setup'

// #1085 slice 5: lock the SQL aggregate semantics on real Postgres. The InMemory
// suite proves the predicate matrix (published+visible, key column, mixed batch);
// here we pin that the Drizzle GROUP BY + WHERE + sum()/count() lowering renders the
// SAME predicate against a live schema (`moderationStatus` ENUM, the partial index,
// the FK columns). One scenario per method covers a happy path + a published-vs-hidden
// row drop — enough for the SQL contract; predicate-completeness lives in InMemory.

let seeded: SeededBooking
let bookingId: string
let operatorId: string
let renterId: string
let vehicleId: string
let classId: string
let secondRenterId: string
let thirdRenterId: string

beforeAll(async () => {
  seeded = await createSeededBooking({ prefix: 'review-agg' })
  bookingId = seeded.booking.id
  operatorId = seeded.operatorId
  renterId = seeded.renterId
  vehicleId = seeded.ids.vehicleId
  classId = seeded.ids.classId
  // A SECOND renter so we can attach a published+visible row authored by someone
  // else (the per-author seal would reject a same-author second row in the same
  // subject), which makes the sum/count assertion non-trivial.
  secondRenterId = await seedRenter('review-agg-2')
  // A THIRD renter: the aggregateByOperator scenario exercises BOTH a still-hidden
  // (publishedAt:null) row AND a moderator-hidden (HIDDEN) row for the same VEHICLE
  // subject. With only two renters they'd collide on the
  // `(bookingId,authorUserId,subject)` UNIQUE seal at insert time — the test code
  // would never reach the aggregate scan. Distinct authors keep every fixture row
  // schema-legal while still proving the predicate drops both rows.
  thirdRenterId = await seedRenter('review-agg-3')
})

afterEach(async () => {
  await db.delete(reviews).where(eq(reviews.bookingId, bookingId))
})

afterAll(async () => {
  await db.delete(reviews).where(eq(reviews.bookingId, bookingId))
  await seeded.cleanup()
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
    // ingest renters' vehicle scores). Plus a still-hidden row and a HIDDEN row,
    // both also denied.
    await db.insert(reviews).values([
      reviewRow({ overall: 5 }),
      reviewRow({
        authorUserId: secondRenterId,
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 3,
      }),
      // hidden: still in the double-blind window
      reviewRow({ authorUserId: secondRenterId, overall: 1, publishedAt: null }),
      // moderator-hidden published row — slice 6 forward-compat. Uses a third
      // author so the seal `(bookingId,authorUserId,subject)` stays unique vs
      // row 2's VEHICLE row (same subject + booking, different author).
      reviewRow({
        authorUserId: thirdRenterId,
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
    await db.insert(reviews).values([
      reviewRow({
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 4,
      }),
      reviewRow({
        authorUserId: secondRenterId,
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 2,
      }),
      // OPERATOR-subject review on the same booking — subjectVehicleId is null,
      // so the WHERE inArray(subjectVehicleId, …) drops it as expected.
      reviewRow({ authorUserId: secondRenterId, subject: 'OPERATOR', overall: 1 }),
    ])
    const repo = new DrizzleReviewRepository(db)
    const out = await repo.aggregateByVehicle([vehicleId])
    expect(out.get(vehicleId)).toEqual({ sum: 6, count: 2 })
  })

  it('aggregateByClass: keys on subjectClassId; null-class vehicle rows are absent', async () => {
    await db.insert(reviews).values([
      reviewRow({
        subject: 'VEHICLE',
        subjectVehicleId: vehicleId,
        subjectClassId: classId,
        overall: 4,
      }),
      reviewRow({
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
