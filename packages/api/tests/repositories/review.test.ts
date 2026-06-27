import { describe, expect, it } from 'vitest'
import { PG_ERROR, REVIEWS_AUTHOR_SUBJECT_CONSTRAINT } from '../../src/pg-errors'
import { InMemoryReviewRepository } from '../../src/repositories/in-memory/review'
import type { NewReview } from '../../src/repositories/types'

// Slice 1 (#1067): the InMemory ReviewRepository must mirror the two DB seals the
// later submission service distinguishes on — assign id/timestamps on insert and
// throw a PG-shaped UNIQUE_VIOLATION (with constraint_name) when the same
// (bookingId, authorUserId, subject) is submitted twice — so route suites behave
// identically to Drizzle without a live Postgres.

const REVEAL_DEADLINE = new Date('2026-07-09T00:00:00Z')
const SUBMITTED = new Date('2026-06-25T00:00:00Z')

function renterReview(overrides: Partial<NewReview> = {}): NewReview {
  return {
    bookingId: 'bk_1',
    operatorId: 'op_1',
    authorUserId: 'user_renter',
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    subjectVehicleId: null,
    subjectClassId: null,
    overall: 5,
    subRatings: { communication: 4 },
    comment: 'Great car',
    moderationStatus: 'VISIBLE',
    revealDeadlineAt: REVEAL_DEADLINE,
    submittedAt: SUBMITTED,
    publishedAt: null,
    ...overrides,
  }
}

describe('InMemoryReviewRepository', () => {
  it('insert assigns id + timestamps and returns the stored review verbatim', async () => {
    const repo = new InMemoryReviewRepository()
    const review = await repo.insert(renterReview())
    expect(review.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(review.bookingId).toBe('bk_1')
    expect(review.authorRole).toBe('RENTER')
    expect(review.subject).toBe('OPERATOR')
    expect(review.overall).toBe(5)
    expect(review.subRatings).toEqual({ communication: 4 })
    expect(review.publishedAt).toBeNull()
    expect(review.submittedAt).toEqual(SUBMITTED)
    expect(review.createdAt).toBeInstanceOf(Date)
    expect(review.updatedAt).toBeInstanceOf(Date)
  })

  it("findByBookingId returns only that booking's reviews", async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(renterReview({ subject: 'OPERATOR' }))
    await repo.insert(renterReview({ subject: 'VEHICLE', subjectVehicleId: 'veh_1' }))
    await repo.insert(renterReview({ bookingId: 'bk_2' }))
    const forBk1 = await repo.findByBookingId('bk_1')
    expect(forBk1.map((r) => r.subject).sort()).toEqual(['OPERATOR', 'VEHICLE'])
    expect(await repo.findByBookingId('bk_missing')).toEqual([])
  })

  it('rejects a duplicate (bookingId, authorUserId, subject) with the unique constraint name', async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(renterReview())
    const err = await repo.insert(renterReview()).then(
      () => null,
      (e) => e as { code: string; constraint_name: string },
    )
    expect(err, 'a second review for the same author+booking+subject must throw').not.toBeNull()
    expect(err?.code).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(err?.constraint_name).toBe(REVIEWS_AUTHOR_SUBJECT_CONSTRAINT)
  })

  it('allows the same author to review a DIFFERENT subject of the same booking', async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(renterReview({ subject: 'OPERATOR' }))
    const second = await repo.insert(
      renterReview({ subject: 'VEHICLE', subjectVehicleId: 'veh_1' }),
    )
    expect(second.subject).toBe('VEHICLE')
    expect(await repo.findByBookingId('bk_1')).toHaveLength(2)
  })
})

// #1085 slice 5 aggregates. The InMemory predicate is the source of truth tests can
// mutation-prove against (the Drizzle SQL mirrors the same predicate, locked by the
// real-pg suite). Both impls return ABSENT entries — not {sum:0,count:0} — for ids
// with no published+visible rows, so the service distinguishes "no reviews yet"
// from "rated zero" at the call site.

const PUBLISHED = new Date('2026-06-26T00:00:00Z')

// A renter->OPERATOR review, published+visible, with a custom overall + per-row
// override hooks for the aggregate predicate matrix.
function publishedOperatorReview(overrides: Partial<NewReview> = {}): NewReview {
  return renterReview({
    publishedAt: PUBLISHED,
    moderationStatus: 'VISIBLE',
    ...overrides,
  })
}

function vehicleReview(overrides: Partial<NewReview> = {}): NewReview {
  return renterReview({
    subject: 'VEHICLE',
    subjectVehicleId: 'veh_1',
    subjectClassId: 'cls_1',
    publishedAt: PUBLISHED,
    moderationStatus: 'VISIBLE',
    ...overrides,
  })
}

describe('InMemoryReviewRepository — aggregates (#1085)', () => {
  it('empty ids returns an empty Map without scanning', async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(publishedOperatorReview({ operatorId: 'op_1', overall: 5 }))
    expect(await repo.aggregateByOperator([])).toEqual(new Map())
    expect(await repo.aggregateByVehicle([])).toEqual(new Map())
    expect(await repo.aggregateByClass([])).toEqual(new Map())
  })

  it('aggregateByOperator sums + counts published+visible rows per id', async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(
      publishedOperatorReview({ bookingId: 'bk_a', operatorId: 'op_1', overall: 5 }),
    )
    await repo.insert(
      publishedOperatorReview({
        bookingId: 'bk_b',
        operatorId: 'op_1',
        overall: 3,
        authorUserId: 'user_renter_2',
      }),
    )
    await repo.insert(
      publishedOperatorReview({ bookingId: 'bk_c', operatorId: 'op_2', overall: 4 }),
    )
    const out = await repo.aggregateByOperator(['op_1', 'op_2'])
    expect(out.get('op_1')).toEqual({ sum: 8, count: 2 })
    expect(out.get('op_2')).toEqual({ sum: 4, count: 1 })
  })

  it('aggregateByOperator excludes unpublished and HIDDEN rows', async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(
      publishedOperatorReview({ bookingId: 'bk_a', operatorId: 'op_1', overall: 5 }),
    )
    // still-double-blind (slice 2 hidden)
    await repo.insert(
      publishedOperatorReview({
        bookingId: 'bk_b',
        operatorId: 'op_1',
        overall: 1,
        publishedAt: null,
        authorUserId: 'user_renter_2',
      }),
    )
    // moderator-hidden (slice 6 forward-compat)
    await repo.insert(
      publishedOperatorReview({
        bookingId: 'bk_c',
        operatorId: 'op_1',
        overall: 1,
        moderationStatus: 'HIDDEN',
        authorUserId: 'user_renter_3',
      }),
    )
    const out = await repo.aggregateByOperator(['op_1'])
    expect(out.get('op_1')).toEqual({ sum: 5, count: 1 })
  })

  it('aggregateByOperator omits ids that have no published+visible rows', async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(
      publishedOperatorReview({ bookingId: 'bk_a', operatorId: 'op_1', overall: 5 }),
    )
    const out = await repo.aggregateByOperator(['op_1', 'op_unrated'])
    expect(out.get('op_1')).toEqual({ sum: 5, count: 1 })
    // The contract: absent, NOT {sum:0,count:0}. The service maps absent -> null
    // so the UI can distinguish "no reviews yet" from "rated zero".
    expect(out.has('op_unrated')).toBe(false)
  })

  it('aggregateByOperator drops VEHICLE-subject rows even on the same operatorId (no pollution)', async () => {
    const repo = new InMemoryReviewRepository()
    // operatorId is denormalized on EVERY row (it's the booking's operator), so
    // a VEHICLE-subject review for `op_1`'s booking shares its operatorId. Without
    // the subject filter this row would inflate the operator's public rating.
    await repo.insert(
      publishedOperatorReview({ bookingId: 'bk_a', operatorId: 'op_1', overall: 5 }),
    )
    await repo.insert(
      vehicleReview({
        bookingId: 'bk_a',
        operatorId: 'op_1',
        subjectVehicleId: 'veh_1',
        subjectClassId: 'cls_1',
        overall: 1,
        authorUserId: 'user_renter_2',
      }),
    )
    const out = await repo.aggregateByOperator(['op_1'])
    // Mutation-resistant: a regression that drops the subject filter lands at
    // {sum:6,count:2}. The OPERATOR-only row (overall=5) is the sole contributor.
    expect(out.get('op_1')).toEqual({ sum: 5, count: 1 })
  })

  it('aggregateByVehicle keys on subjectVehicleId, skips non-vehicle reviews', async () => {
    const repo = new InMemoryReviewRepository()
    // An OPERATOR review whose operatorId happens to equal a vehicle id must NOT count.
    await repo.insert(publishedOperatorReview({ operatorId: 'veh_1', overall: 1 }))
    await repo.insert(vehicleReview({ bookingId: 'bk_v', subjectVehicleId: 'veh_1', overall: 4 }))
    await repo.insert(
      vehicleReview({
        bookingId: 'bk_v2',
        subjectVehicleId: 'veh_1',
        overall: 2,
        authorUserId: 'user_renter_2',
      }),
    )
    const out = await repo.aggregateByVehicle(['veh_1'])
    expect(out.get('veh_1')).toEqual({ sum: 6, count: 2 })
  })

  it('aggregateByClass keys on subjectClassId, skips reviews with null class', async () => {
    const repo = new InMemoryReviewRepository()
    // An unclassed vehicle review (class is null) must not pollute the aggregate.
    await repo.insert(
      vehicleReview({ bookingId: 'bk_unclassed', subjectClassId: null, overall: 1 }),
    )
    await repo.insert(vehicleReview({ bookingId: 'bk_c', subjectClassId: 'cls_1', overall: 5 }))
    await repo.insert(
      vehicleReview({
        bookingId: 'bk_c2',
        subjectClassId: 'cls_1',
        overall: 4,
        authorUserId: 'user_renter_2',
      }),
    )
    const out = await repo.aggregateByClass(['cls_1'])
    expect(out.get('cls_1')).toEqual({ sum: 9, count: 2 })
  })
})
