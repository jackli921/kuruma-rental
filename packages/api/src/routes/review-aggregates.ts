import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { type Context, Hono } from 'hono'
import {
  type AggregateMap,
  InvalidAggregateIdsError,
  type ReviewAggregateService,
} from '../services/review-aggregate'
import { fail, ok } from './helpers'
import { rateLimitByIp } from './rate-limit'

/**
 * Public aggregate read surface (#1085 slice 5). Operator / vehicle / class
 * rating summaries for the anonymous storefront pages. Mounted in a SEPARATE
 * Hono router from `createReviewRoutes` so the wildcard `requireAuth('/reviews/*')`
 * over there does not bleed onto these GETs — the index composition root must
 * keep the two router files distinct.
 */
export function createReviewAggregateRoutes(
  service: ReviewAggregateService,
  publicCatalogLimiter?: RateLimitBinding,
) {
  const app = new Hono()

  // Same per-IP budget as the rest of the public catalog (`/storefronts/*`,
  // `/vehicle-classes`): aggregates are cheap-per-byte and just as scrape-prone
  // as the storefront cards that consume them. Fails closed on an unresolvable
  // IP (#580). No carve-out vs the surrounding catalog.
  if (publicCatalogLimiter) {
    app.use('/reviews/aggregates/*', rateLimitByIp(publicCatalogLimiter))
  }

  return app
    .get('/reviews/aggregates/operators', (c) =>
      handleAggregate(c, (ids) => service.forOperators(ids)),
    )
    .get('/reviews/aggregates/vehicles', (c) =>
      handleAggregate(c, (ids) => service.forVehicles(ids)),
    )
    .get('/reviews/aggregates/classes', (c) => handleAggregate(c, (ids) => service.forClasses(ids)))
}

async function handleAggregate(
  c: Context,
  scan: (ids: readonly string[]) => Promise<AggregateMap>,
) {
  // `?ids=a,b,c` — comma-separated, same wire as `vite/reviews/api.ts`'s
  // `subjects` query. We split + trim and drop empty fragments so a stray
  // trailing comma doesn't smuggle a falsey id into the service.
  const raw = c.req.query('ids')
  const ids = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : []
  if (ids.length === 0) return fail(c, 'IDS_REQUIRED', 400)
  try {
    const aggregates = await scan(ids)
    return ok(c, { aggregates })
  } catch (err) {
    if (err instanceof InvalidAggregateIdsError) return fail(c, err.reason, 400)
    throw err
  }
}
