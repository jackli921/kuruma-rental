import { describe, expect, it, vi } from 'vitest'
import type { ReviewRepository } from '../repositories/types'
import type { Review } from '../stores'
import { MAX_REVIEW_LIST, ReviewListService } from './review-list'

function review(over: Partial<Review>): Review {
  return {
    id: 'r1',
    bookingId: 'b1',
    operatorId: 'op1',
    authorUserId: 'u1',
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    subjectVehicleId: null,
    subjectClassId: null,
    overall: 5,
    subRatings: { cleanliness: 5 },
    comment: 'great',
    moderationStatus: 'VISIBLE',
    moderatedBy: null,
    moderatedAt: null,
    revealDeadlineAt: new Date('2026-01-01'),
    submittedAt: new Date('2026-01-01'),
    publishedAt: new Date('2026-06-02T03:00:00.000Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }
}

function repoWith(list: Review[]): ReviewRepository {
  return { listPublishedForSubject: vi.fn().mockResolvedValue(list) } as unknown as ReviewRepository
}

describe('ReviewListService.forOperator', () => {
  it('maps rows to the privacy-curated PublicReview shape (no bookingId/authorUserId)', async () => {
    const svc = new ReviewListService(repoWith([review({})]))
    const result = await svc.forOperator('op1')
    expect(result).toEqual([
      {
        id: 'r1',
        overall: 5,
        subRatings: { cleanliness: 5 },
        comment: 'great',
        publishedAt: '2026-06-02T03:00:00.000Z',
      },
    ])
    expect(result[0]).not.toHaveProperty('bookingId')
    expect(result[0]).not.toHaveProperty('authorUserId')
  })

  it('asks the repo for OPERATOR subject, capped at MAX_REVIEW_LIST', async () => {
    const repo = repoWith([])
    const svc = new ReviewListService(repo)
    await svc.forOperator('op9')
    expect(repo.listPublishedForSubject).toHaveBeenCalledWith('OPERATOR', 'op9', MAX_REVIEW_LIST)
  })

  it('forVehicle asks for VEHICLE subject', async () => {
    const repo = repoWith([])
    await new ReviewListService(repo).forVehicle('v9')
    expect(repo.listPublishedForSubject).toHaveBeenCalledWith('VEHICLE', 'v9', MAX_REVIEW_LIST)
  })

  it('passes through comment: null without modification', async () => {
    const svc = new ReviewListService(repoWith([review({ comment: null })]))
    const result = await svc.forOperator('op1')
    expect(result[0]?.comment).toBeNull()
    expect(result[0]?.id).toBe('r1')
    expect(result[0]?.overall).toBe(5)
  })

  it('throws when a published row has null publishedAt (invariant guard)', async () => {
    const svc = new ReviewListService(repoWith([review({ publishedAt: null })]))
    await expect(svc.forOperator('op1')).rejects.toThrow('null publishedAt')
  })
})
