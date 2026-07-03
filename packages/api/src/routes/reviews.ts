import { editReviewSchema, submitReviewSchema } from '@kuruma/shared/validators/review'
import { Hono } from 'hono'
import { requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { ReviewService } from '../services/review'
import { failResult, ok, parseBody, parseId } from './helpers'

/**
 * Mutual-review surface (#1067 slice 2): submit, edit-until-published, and the
 * participant-scoped, double-blind read. Any authenticated user may POST — the
 * eligibility guard (COMPLETED-only, participant-only, subject pairing) lives in the
 * service, so there is no role allow-list here (renters review too). The GET hides a
 * counterparty's review until reveal; that decision is the service's, not the route's.
 */
export function createReviewRoutes(service: ReviewService) {
  const app = new Hono()

  app.use('/reviews', requireAuth())
  // Scoped to the single-segment :id path (PATCH /reviews/:id) — a broad
  // `/reviews/*` would also gate sibling routers mounted on the same root,
  // which the #1085 public aggregate reads at `/reviews/aggregates/*` rely on.
  app.use('/reviews/:id', requireAuth())
  app.use('/bookings/:bookingId/reviews', requireAuth())

  return app
    .post('/reviews', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const body = await parseBody(c, submitReviewSchema)
      if (!body.ok) return body.response

      const result = await service.submit(ctx, body.data, new Date())
      if (!result.ok) return failResult(c, result)
      return ok(c, { review: result.review }, 201)
    })
    .patch('/reviews/:id', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const body = await parseBody(c, editReviewSchema)
      if (!body.ok) return body.response

      const result = await service.edit(ctx, idResult.id, body.data, new Date())
      if (!result.ok) return failResult(c, result)
      return ok(c, { review: result.review })
    })
    .get('/bookings/:bookingId/reviews', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const idResult = parseId(c, 'bookingId')
      if (!idResult.ok) return idResult.response

      const result = await service.getForBooking(ctx, idResult.id, new Date())
      if (!result.ok) return failResult(c, result)
      return ok(c, { reviews: result.reviews })
    })
}
