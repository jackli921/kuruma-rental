import { describe, expect, it } from 'vitest'
import { PG_ERROR, REVIEWS_SUBJECT_CONSTRAINT } from '../../src/pg-errors'
import { InMemoryReviewRepository } from '../../src/repositories/in-memory/review'
import type { NewReview } from '../../src/repositories/types'

// Slice 1 (#1067, reseal #1158): the InMemory ReviewRepository must mirror the DB
// seals the later submission service distinguishes on — assign id/timestamps on
// insert and throw a PG-shaped UNIQUE_VIOLATION (with constraint_name) when the same
// (bookingId, subject) is submitted twice — so route suites behave
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

  it('rejects a duplicate (bookingId, subject) with the unique constraint name', async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(renterReview())
    const err = await repo.insert(renterReview()).then(
      () => null,
      (e) => e as { code: string; constraint_name: string },
    )
    expect(err, 'a second review for the same booking+subject must throw').not.toBeNull()
    expect(err?.code).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(err?.constraint_name).toBe(REVIEWS_SUBJECT_CONSTRAINT)
  })

  it('rejects a duplicate operator-side subject from a DIFFERENT staff member of the same operator (#1158)', async () => {
    const repo = new InMemoryReviewRepository()
    await repo.insert(
      renterReview({ authorRole: 'OPERATOR', subject: 'RENTER', authorUserId: 'staff_a' }),
    )
    const err = await repo
      .insert(renterReview({ authorRole: 'OPERATOR', subject: 'RENTER', authorUserId: 'staff_b' }))
      .then(
        () => null,
        (e) => e as { code: string; constraint_name: string },
      )
    expect(
      err,
      'a second operator-side review of one booking must throw whoever submits it',
    ).not.toBeNull()
    expect(err?.code).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(err?.constraint_name).toBe(REVIEWS_SUBJECT_CONSTRAINT)
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
