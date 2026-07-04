import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryReviewRepository } from '../../src/repositories/in-memory/review'
import type { NewReview, ReviewListCursor } from '../../src/repositories/types'
import { createReviewListRoutes } from '../../src/routes/review-list'
import { encodeReviewCursor } from '../../src/services/review-cursor'
import type { PublicReview, ReviewListService, ReviewPage } from '../../src/services/review-list'
import { setupAuthEnv } from '../helpers/auth'

type Captured = { id: string; after?: ReviewListCursor }

function appWith(
  page: Partial<ReviewPage> & { reviews: PublicReview[] },
  onCall?: (c: Captured) => void,
) {
  const respond = async (id: string, after?: ReviewListCursor): Promise<ReviewPage> => {
    onCall?.({ id, after })
    return { reviews: page.reviews, nextCursor: page.nextCursor ?? null }
  }
  const service = {
    forOperator: (id: string, after?: ReviewListCursor) => respond(id, after),
    forVehicle: (id: string, after?: ReviewListCursor) => respond(id, after),
  } as unknown as ReviewListService
  return createReviewListRoutes(service)
}

const sample: PublicReview = {
  id: 'r1',
  overall: 5,
  subRatings: { cleanliness: 5 },
  comment: 'great',
  publishedAt: '2026-06-02T03:00:00.000Z',
  reviewerFirstName: 'Jack',
}

const PUBLISHED = new Date('2026-06-26T00:00:00Z')
const REVEAL = new Date('2026-07-09T00:00:00Z')

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
    revealDeadlineAt: REVEAL,
    submittedAt: PUBLISHED,
    publishedAt: PUBLISHED,
    ...overrides,
  }
}

describe('GET /reviews/for/operators/:id', () => {
  it('returns the published reviews plus a nextCursor', async () => {
    const res = await appWith({ reviews: [sample] }).request('/reviews/for/operators/op1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      data: { reviews: [sample], nextCursor: null },
    })
  })

  it('returns an empty list (200) when the operator has none', async () => {
    const res = await appWith({ reviews: [] }).request('/reviews/for/operators/op1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { reviews: [], nextCursor: null } })
  })

  it('surfaces a non-null nextCursor from the service verbatim', async () => {
    const res = await appWith({ reviews: [sample], nextCursor: 'NEXT_TOKEN' }).request(
      '/reviews/for/operators/op1',
    )
    expect((await res.json()).data.nextCursor).toBe('NEXT_TOKEN')
  })

  it('decodes a valid ?after cursor and forwards it to the service', async () => {
    const onCall = vi.fn()
    const cursor = { publishedAt: new Date('2026-06-01T00:00:00.000Z'), id: 'cur1' }
    const token = encodeReviewCursor(cursor)
    const res = await appWith({ reviews: [] }, onCall).request(
      `/reviews/for/operators/op1?after=${encodeURIComponent(token)}`,
    )
    expect(res.status).toBe(200)
    expect(onCall).toHaveBeenCalledWith({ id: 'op1', after: cursor })
  })

  it('rejects a malformed ?after cursor with 400 and never calls the service', async () => {
    const onCall = vi.fn()
    const res = await appWith({ reviews: [sample] }, onCall).request(
      '/reviews/for/operators/op1?after=%40%40not-base64',
    )
    expect(res.status).toBe(400)
    expect(onCall).not.toHaveBeenCalled()
  })
})

describe('GET /reviews/for/vehicles/:id', () => {
  it('returns the published reviews plus a nextCursor', async () => {
    const res = await appWith({ reviews: [sample] }).request('/reviews/for/vehicles/v1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      data: { reviews: [sample], nextCursor: null },
    })
  })

  it('forwards a valid ?after cursor to forVehicle', async () => {
    const onCall = vi.fn()
    const cursor = { publishedAt: new Date('2026-05-05T00:00:00.000Z'), id: 'v-cur' }
    const res = await appWith({ reviews: [] }, onCall).request(
      `/reviews/for/vehicles/v1?after=${encodeURIComponent(encodeReviewCursor(cursor))}`,
    )
    expect(res.status).toBe(200)
    expect(onCall).toHaveBeenCalledWith({ id: 'v1', after: cursor })
  })

  it('rejects a malformed ?after cursor with 400', async () => {
    const res = await appWith({ reviews: [] }).request('/reviews/for/vehicles/v1?after=%40bad')
    expect(res.status).toBe(400)
  })
})

describe('mount isolation from createReviewRoutes (P1)', () => {
  let reviewRepo: InMemoryReviewRepository
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    setupAuthEnv()
    reviewRepo = new InMemoryReviewRepository()
    app = createApp({ reviewRepo })
  })

  it('an anonymous GET /reviews/for/operators/:id is NOT challenged by /reviews/* auth', async () => {
    // Proves /reviews/for/* is public and does not inherit the wildcard requireAuth
    // that guards /reviews/:id write routes. An anonymous request must return 200.
    await reviewRepo.insert(published({ operatorId: 'op_1', overall: 5 }))
    const res = await app.request('/reviews/for/operators/op_1')
    expect(res.status).toBe(200)
    // For contrast: a write route under the wildcard does require auth.
    const writeRes = await app.request('/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(writeRes.status).toBe(401)
  })
})
