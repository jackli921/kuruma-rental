import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryBookingEventRepository } from '../../src/repositories/in-memory/booking-event'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory/operator-membership'
import { InMemoryReviewRepository } from '../../src/repositories/in-memory/review'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { createAdminReviewRoutes } from '../../src/routes/admin-reviews'
import { ReviewService } from '../../src/services/review'
import type { Review } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

// parseId validates a uuid path param, so ids are uuid-shaped.
const REVIEW_ID = '22222222-2222-4222-8222-222222222222'
const BOOKING_ID = '11111111-1111-4111-8111-111111111111'

let reviewRepo: InMemoryReviewRepository

function makeReview(overrides: Partial<Review> = {}): Review {
  const now = new Date()
  return {
    id: REVIEW_ID,
    bookingId: BOOKING_ID,
    operatorId: 'op-1',
    authorUserId: 'renter-1',
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    subjectVehicleId: null,
    subjectClassId: null,
    overall: 5,
    subRatings: {},
    comment: 'ok',
    moderationStatus: 'VISIBLE',
    revealDeadlineAt: now,
    submittedAt: now,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// listReported/hideReview touch only the review repo; the other repos exist to
// satisfy the constructor and stay empty.
function service(): ReviewService {
  return new ReviewService(
    reviewRepo,
    new InMemoryBookingRepository(),
    new InMemoryVehicleRepository(),
    new InMemoryBookingEventRepository([]),
    new InMemoryOperatorMembershipRepository(),
  )
}

function mount(role: UserRole, operatorId?: string): Hono {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  return app.route('/', createAdminReviewRoutes(service()))
}

beforeEach(() => {
  reviewRepo = new InMemoryReviewRepository()
})

describe('GET /admin/reviews/reported', () => {
  it('lists reported reviews with counts + reasons for a platform admin', async () => {
    reviewRepo = new InMemoryReviewRepository(new Map([[REVIEW_ID, makeReview()]]))
    await reviewRepo.insertReport({ reviewId: REVIEW_ID, reporterUserId: 'u1', reason: 'abusive' })

    const res = await mount('PLATFORM_ADMIN').request('/admin/reviews/reported')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.reported).toHaveLength(1)
    expect(body.data.reported[0]).toMatchObject({
      review: { id: REVIEW_ID },
      reportCount: 1,
      reasons: ['abusive'],
    })
  })

  it('403s an operator owner (platform-admin-only surface)', async () => {
    const res = await mount('OPERATOR_OWNER', 'op-1').request('/admin/reviews/reported')
    expect(res.status).toBe(403)
  })

  it('403s a renter', async () => {
    const res = await mount('RENTER').request('/admin/reviews/reported')
    expect(res.status).toBe(403)
  })
})

describe('POST /admin/reviews/:id/hide', () => {
  function hide(app: Hono, id: string) {
    return app.request(`/admin/reviews/${id}/hide`, { method: 'POST' })
  }

  it('hides a review and returns the HIDDEN row for a platform admin', async () => {
    reviewRepo = new InMemoryReviewRepository(new Map([[REVIEW_ID, makeReview()]]))
    const res = await hide(mount('PLATFORM_ADMIN'), REVIEW_ID)
    expect(res.status).toBe(200)
    expect((await res.json()).data.review.moderationStatus).toBe('HIDDEN')
    expect((await reviewRepo.findById(REVIEW_ID))?.moderationStatus).toBe('HIDDEN')
  })

  it('404s hiding a nonexistent review', async () => {
    const res = await hide(mount('PLATFORM_ADMIN'), REVIEW_ID)
    expect(res.status).toBe(404)
  })

  it('400s a non-uuid id', async () => {
    const res = await hide(mount('PLATFORM_ADMIN'), 'not-a-uuid')
    expect(res.status).toBe(400)
  })

  it('403s an operator owner attempting to hide (no oracle on the id)', async () => {
    reviewRepo = new InMemoryReviewRepository(new Map([[REVIEW_ID, makeReview()]]))
    const res = await hide(mount('OPERATOR_OWNER', 'op-1'), REVIEW_ID)
    expect(res.status).toBe(403)
  })
})
