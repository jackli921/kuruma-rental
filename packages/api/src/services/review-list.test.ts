import { describe, expect, it, vi } from 'vitest'
import type { ReviewRepository } from '../repositories/types'
import type { Review } from '../stores'
import { decodeReviewCursor } from './review-cursor'
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
    const { reviews, nextCursor } = await svc.forOperator('op1')
    expect(reviews).toEqual([
      {
        id: 'r1',
        overall: 5,
        subRatings: { cleanliness: 5 },
        comment: 'great',
        publishedAt: '2026-06-02T03:00:00.000Z',
      },
    ])
    expect(reviews[0]).not.toHaveProperty('bookingId')
    expect(reviews[0]).not.toHaveProperty('authorUserId')
    // A partial page (< MAX + 1 rows) means no further page.
    expect(nextCursor).toBeNull()
  })

  it('asks the repo for OPERATOR subject and probes ONE past the page size for hasMore', async () => {
    const repo = repoWith([])
    await new ReviewListService(repo).forOperator('op9')
    expect(repo.listPublishedForSubject).toHaveBeenCalledWith(
      'OPERATOR',
      'op9',
      MAX_REVIEW_LIST + 1,
      undefined,
    )
  })

  it('forVehicle asks for VEHICLE subject', async () => {
    const repo = repoWith([])
    await new ReviewListService(repo).forVehicle('v9')
    expect(repo.listPublishedForSubject).toHaveBeenCalledWith(
      'VEHICLE',
      'v9',
      MAX_REVIEW_LIST + 1,
      undefined,
    )
  })

  it('forwards the `after` cursor to the repo verbatim', async () => {
    const repo = repoWith([])
    const after = { publishedAt: new Date('2026-06-01T00:00:00.000Z'), id: 'cur1' }
    await new ReviewListService(repo).forOperator('op1', after)
    expect(repo.listPublishedForSubject).toHaveBeenCalledWith(
      'OPERATOR',
      'op1',
      MAX_REVIEW_LIST + 1,
      after,
    )
  })

  it('trims the probe row and emits a nextCursor pointing at the last KEPT row', async () => {
    // MAX + 1 rows: the extra one only signals "there is another page". Distinct
    // publishedAt so the boundary row is unambiguous.
    const rows = Array.from({ length: MAX_REVIEW_LIST + 1 }, (_, i) =>
      review({
        id: `r${i}`,
        bookingId: `b${i}`,
        publishedAt: new Date(2026, 0, 1, 0, 0, MAX_REVIEW_LIST + 1 - i),
      }),
    )
    const { reviews, nextCursor } = await new ReviewListService(repoWith(rows)).forOperator('op1')
    expect(reviews).toHaveLength(MAX_REVIEW_LIST)
    expect(reviews.at(-1)?.id).toBe(`r${MAX_REVIEW_LIST - 1}`)
    // The probe row (`r20`) must NOT leak into the page.
    expect(reviews.map((r) => r.id)).not.toContain(`r${MAX_REVIEW_LIST}`)
    // nextCursor addresses the last kept row so the next page starts strictly after it.
    const lastKept = rows[MAX_REVIEW_LIST - 1]
    expect(nextCursor).not.toBeNull()
    expect(decodeReviewCursor(nextCursor ?? '')).toEqual({
      publishedAt: lastKept?.publishedAt,
      id: lastKept?.id,
    })
  })

  it('passes through comment: null without modification', async () => {
    const { reviews } = await new ReviewListService(
      repoWith([review({ comment: null })]),
    ).forOperator('op1')
    expect(reviews[0]?.comment).toBeNull()
    expect(reviews[0]?.id).toBe('r1')
  })

  it('throws when a published row has null publishedAt (invariant guard)', async () => {
    const svc = new ReviewListService(repoWith([review({ publishedAt: null })]))
    await expect(svc.forOperator('op1')).rejects.toThrow('null publishedAt')
  })
})
