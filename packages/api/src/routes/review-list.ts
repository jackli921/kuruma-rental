import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import { decodeReviewCursor } from '../services/review-cursor'
import type { ReviewListService } from '../services/review-list'
import { fail, ok } from './helpers'
import { rateLimitByIp } from './rate-limit'

/**
 * Public review-list read surface (review-display slice, #1067). The newest published
 * reviews for a storefront's operator (and, later, a vehicle). Anonymous, like the
 * aggregate reads — mounted in a SEPARATE Hono router from createReviewRoutes so the
 * `requireAuth('/reviews/:id')` there does not gate these GETs.
 */
export function createReviewListRoutes(
  service: ReviewListService,
  publicCatalogLimiter?: RateLimitBinding,
) {
  const app = new Hono()

  // Same per-IP budget as the rest of the public catalog — review text is as
  // scrape-prone as the aggregates and storefront cards that consume them. Fails
  // closed on an unresolvable IP (#580).
  if (publicCatalogLimiter) {
    app.use('/reviews/for/*', rateLimitByIp(publicCatalogLimiter))
  }

  return app
    .get('/reviews/for/operators/:id', async (c) => {
      // A present-but-malformed cursor is a 400 (parsing untrusted query input is an HTTP
      // concern); `after` stays typed via inference, so no repository type is imported here.
      const raw = c.req.query('after')
      const after = raw ? decodeReviewCursor(raw) : undefined
      if (raw && !after) return fail(c, 'INVALID_CURSOR', 400)
      const page = await service.forOperator(c.req.param('id'), after)
      return ok(c, page)
    })
    .get('/reviews/for/vehicles/:id', async (c) => {
      const raw = c.req.query('after')
      const after = raw ? decodeReviewCursor(raw) : undefined
      if (raw && !after) return fail(c, 'INVALID_CURSOR', 400)
      const page = await service.forVehicle(c.req.param('id'), after)
      return ok(c, page)
    })
}
