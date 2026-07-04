import { describe, expect, it } from 'vitest'
import { InMemoryReviewRepository } from '../repositories/in-memory/review'
import type { NewReview } from '../repositories/types'
import { InvalidAggregateIdsError, ReviewAggregateService } from './review-aggregate'

// #1085 slice 5: the avg + cap + null-for-unrated semantics live here. The InMemory
// repo (which the service drives directly) is the truth for the published+visible
// predicate the SQL mirror just renders.

const REVEAL = new Date('2026-07-09T00:00:00Z')
const PUBLISHED = new Date('2026-06-26T00:00:00Z')

function published(overrides: Partial<NewReview> = {}): NewReview {
  return {
    bookingId: 'bk_1',
    operatorId: 'op_1',
    authorUserId: 'user_1',
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    subjectVehicleId: null,
    subjectClassId: null,
    overall: 5,
    subRatings: {},
    comment: null,
    moderationStatus: 'VISIBLE',
    moderatedBy: null,
    moderatedAt: null,
    revealDeadlineAt: REVEAL,
    submittedAt: PUBLISHED,
    publishedAt: PUBLISHED,
    ...overrides,
  }
}

function make(): { service: ReviewAggregateService; repo: InMemoryReviewRepository } {
  const repo = new InMemoryReviewRepository()
  return { service: new ReviewAggregateService(repo), repo }
}

describe('ReviewAggregateService (#1085 slice 5)', () => {
  it('forOperators returns avg + count per id, rounded to 1 decimal', async () => {
    const { service, repo } = make()
    await repo.insert(published({ bookingId: 'bk_a', operatorId: 'op_1', overall: 5 }))
    await repo.insert(
      published({ bookingId: 'bk_b', operatorId: 'op_1', overall: 4, authorUserId: 'u2' }),
    )
    await repo.insert(
      published({ bookingId: 'bk_c', operatorId: 'op_1', overall: 4, authorUserId: 'u3' }),
    )
    // (5+4+4)/3 = 4.333... -> 4.3 (round to 1 decimal)
    const out = await service.forOperators(['op_1'])
    expect(out).toEqual({ op_1: { avg: 4.3, count: 3 } })
  })

  it('returns null for an id known to the caller but with no published+visible rows', async () => {
    const { service, repo } = make()
    await repo.insert(published({ bookingId: 'bk_a', operatorId: 'op_1', overall: 5 }))
    const out = await service.forOperators(['op_1', 'op_unrated'])
    expect(out.op_1).toEqual({ avg: 5, count: 1 })
    // The acceptance criteria: null distinguishes "no reviews yet" from "rated zero".
    expect(out.op_unrated).toBeNull()
  })

  it('throws IDS_REQUIRED when ids is empty', async () => {
    const { service } = make()
    await expect(service.forOperators([])).rejects.toMatchObject({
      name: 'InvalidAggregateIdsError',
      reason: 'IDS_REQUIRED',
    })
  })

  it('throws TOO_MANY_IDS when ids exceeds the cap', async () => {
    const { service } = make()
    const tooMany = Array.from({ length: 101 }, (_, i) => `op_${i}`)
    const err = await service.forOperators(tooMany).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InvalidAggregateIdsError)
    expect((err as InvalidAggregateIdsError).reason).toBe('TOO_MANY_IDS')
  })

  it('dedupes ids so a duplicate doesn’t double-charge the cap', async () => {
    const { service, repo } = make()
    await repo.insert(published({ operatorId: 'op_1', overall: 5 }))
    // 100 unique + 1 duplicate of an already-included id = 101 raw input ids, 100 unique
    // -> must NOT throw, because the cap is "unique ids the DB will scan", not raw input.
    const ids = ['op_1', ...Array.from({ length: 99 }, (_, i) => `op_dup_${i}`)]
    const out = await service.forOperators([...ids, 'op_1'])
    expect(out.op_1).toEqual({ avg: 5, count: 1 })
  })

  it('forVehicles + forClasses surface the same shape, keyed on the matching column', async () => {
    const { service, repo } = make()
    await repo.insert(
      published({
        subject: 'VEHICLE',
        subjectVehicleId: 'veh_1',
        subjectClassId: 'cls_1',
        overall: 4,
      }),
    )
    await repo.insert(
      published({
        bookingId: 'bk_b',
        subject: 'VEHICLE',
        subjectVehicleId: 'veh_1',
        subjectClassId: 'cls_1',
        overall: 5,
        authorUserId: 'u2',
      }),
    )
    const vehicles = await service.forVehicles(['veh_1', 'veh_unrated'])
    expect(vehicles).toEqual({ veh_1: { avg: 4.5, count: 2 }, veh_unrated: null })
    const classes = await service.forClasses(['cls_1', 'cls_unrated'])
    expect(classes).toEqual({ cls_1: { avg: 4.5, count: 2 }, cls_unrated: null })
  })
})
