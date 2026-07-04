import { describe, expect, it, vi } from 'vitest'
import type { ReviewRepository, UserRepository } from '../repositories/types'
import type { Review, User } from '../stores'
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

// The service resolves reviewer display names through UserRepository.findByIds. The stub
// returns FAITHFUL user rows carrying the PII the real repo would (email/phone) — so the
// privacy test proves the projection STRIPS them, not merely that they were never supplied.
function userRepoWith(names: Record<string, string | null>): Pick<UserRepository, 'findByIds'> {
  return {
    findByIds: vi.fn(async (ids: string[]) =>
      ids
        .filter((id) => id in names)
        .map(
          (id) =>
            ({
              id,
              name: names[id] ?? null,
              email: `${id}@example.com`,
              phone: '+81-90-1234-5678',
            }) as User,
        ),
    ),
  }
}

// Default author (u1) has a two-part name so the first-token projection is observable.
function makeService(
  reviews: Review[],
  names: Record<string, string | null> = { u1: 'Jack Li' },
): ReviewListService {
  return new ReviewListService(repoWith(reviews), userRepoWith(names))
}

describe('ReviewListService.forOperator', () => {
  it('maps rows to the privacy-curated PublicReview shape (no bookingId/authorUserId), with first name only', async () => {
    const { reviews, nextCursor } = await makeService([review({})]).forOperator('op1')
    expect(reviews).toEqual([
      {
        id: 'r1',
        overall: 5,
        subRatings: { cleanliness: 5 },
        comment: 'great',
        publishedAt: '2026-06-02T03:00:00.000Z',
        reviewerFirstName: 'Jack',
      },
    ])
    expect(reviews[0]).not.toHaveProperty('bookingId')
    expect(reviews[0]).not.toHaveProperty('authorUserId')
    // A partial page (< MAX + 1 rows) means no further page.
    expect(nextCursor).toBeNull()
  })

  it('exposes only the first name — the full name and other PII never reach the wire', async () => {
    // The stubbed author (u1) carries a surname, an email, and a phone (see userRepoWith).
    const { reviews } = await makeService([review({})], { u1: 'Jack Li' }).forOperator('op1')
    const wire = JSON.stringify(reviews)
    expect(reviews[0]?.reviewerFirstName).toBe('Jack')
    // None of the source PII may appear anywhere in the serialized payload.
    expect(wire).not.toContain('Li') // surname
    expect(wire).not.toContain('@example.com') // email
    expect(wire).not.toContain('1234-5678') // phone
    expect(reviews[0]).not.toHaveProperty('name')
    expect(reviews[0]).not.toHaveProperty('email')
    expect(reviews[0]).not.toHaveProperty('authorUserId')
  })

  it('falls back to null reviewerFirstName when the author has no name or is unresolved', async () => {
    const noName = await makeService([review({ id: 'r1', authorUserId: 'u1' })], {
      u1: null,
    }).forOperator('op1')
    expect(noName.reviews[0]?.reviewerFirstName).toBeNull()
    // Author row missing entirely (e.g. deleted user) -> still renders, anonymously.
    const missing = await makeService(
      [review({ id: 'r1', authorUserId: 'ghost' })],
      {},
    ).forOperator('op1')
    expect(missing.reviews[0]?.reviewerFirstName).toBeNull()
  })

  it('batch-resolves the page authors in ONE findByIds call (no N+1)', async () => {
    const userRepo = userRepoWith({ u1: 'Ann Smith', u2: 'Bob Lee' })
    const svc = new ReviewListService(
      repoWith([
        review({ id: 'r1', authorUserId: 'u1' }),
        review({ id: 'r2', authorUserId: 'u2', publishedAt: new Date('2026-06-01T03:00:00.000Z') }),
      ]),
      userRepo,
    )
    const { reviews } = await svc.forOperator('op1')
    expect(userRepo.findByIds).toHaveBeenCalledTimes(1)
    expect((userRepo.findByIds as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.sort()).toEqual([
      'u1',
      'u2',
    ])
    expect(reviews.map((r) => r.reviewerFirstName)).toEqual(['Ann', 'Bob'])
  })

  it('asks the repo for OPERATOR subject and probes ONE past the page size for hasMore', async () => {
    const repo = repoWith([])
    await new ReviewListService(repo, userRepoWith({})).forOperator('op9')
    expect(repo.listPublishedForSubject).toHaveBeenCalledWith(
      'OPERATOR',
      'op9',
      MAX_REVIEW_LIST + 1,
      undefined,
    )
  })

  it('forVehicle asks for VEHICLE subject', async () => {
    const repo = repoWith([])
    await new ReviewListService(repo, userRepoWith({})).forVehicle('v9')
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
    await new ReviewListService(repo, userRepoWith({})).forOperator('op1', after)
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
    const { reviews, nextCursor } = await makeService(rows).forOperator('op1')
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
    const { reviews } = await makeService([review({ comment: null })]).forOperator('op1')
    expect(reviews[0]?.comment).toBeNull()
    expect(reviews[0]?.id).toBe('r1')
  })

  it('throws when a published row has null publishedAt (invariant guard)', async () => {
    await expect(makeService([review({ publishedAt: null })]).forOperator('op1')).rejects.toThrow(
      'null publishedAt',
    )
  })
})
