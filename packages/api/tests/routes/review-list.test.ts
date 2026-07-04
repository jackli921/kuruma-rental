import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryReviewRepository } from '../../src/repositories/in-memory/review'
import type { NewReview } from '../../src/repositories/types'
import { createReviewListRoutes } from '../../src/routes/review-list'
import type { PublicReview, ReviewListService } from '../../src/services/review-list'
import { setupAuthEnv } from '../helpers/auth'

function appWith(reviews: PublicReview[]) {
  const service = {
    forOperator: async () => reviews,
    forVehicle: async () => reviews,
  } as unknown as ReviewListService
  return createReviewListRoutes(service)
}

const sample: PublicReview = {
  id: 'r1',
  overall: 5,
  subRatings: { cleanliness: 5 },
  comment: 'great',
  publishedAt: '2026-06-02T03:00:00.000Z',
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
  it('returns the published reviews for the operator', async () => {
    const res = await appWith([sample]).request('/reviews/for/operators/op1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { reviews: [sample] } })
  })

  it('returns an empty list (200) when the operator has none', async () => {
    const res = await appWith([]).request('/reviews/for/operators/op1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { reviews: [] } })
  })
})

describe('GET /reviews/for/vehicles/:id', () => {
  it('returns the published reviews for the vehicle', async () => {
    const res = await appWith([sample]).request('/reviews/for/vehicles/v1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { reviews: [sample] } })
  })

  it('returns an empty list (200) when the vehicle has none', async () => {
    const res = await appWith([]).request('/reviews/for/vehicles/v1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { reviews: [] } })
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
