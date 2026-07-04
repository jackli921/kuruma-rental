import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import type { ReviewListService } from '../services/review-list'
import { ok } from './helpers'
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
      const reviews = await service.forOperator(c.req.param('id'))
      return ok(c, { reviews })
    })
    .get('/reviews/for/vehicles/:id', async (c) => {
      const reviews = await service.forVehicle(c.req.param('id'))
      return ok(c, { reviews })
    })
}
