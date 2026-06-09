import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { type Context, Hono } from 'hono'
import { PUBLIC_CONTEXT } from '../middleware/auth'
import type { StorefrontDetailService } from '../services/storefront-detail'
import type { StorefrontSearchService } from '../services/storefront-search'
import { cachePublic, fail, ok, parseDateRange, parseLimit } from './helpers'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
// Availability is time-sensitive (bookings land, vehicles go to maintenance).
// 10s at the edge absorbs a renter's browse-to-click round trip without
// pinning a stale view; the DB exclusion constraint is the real overlap
// guardrail, this is purely perf (mirrors vehicle-classes availability).
const CACHE_SECONDS = 10

/**
 * Public renter-facing storefront catalog (#391). Both routes are anonymous —
 * registered with no `requireAuth` so renters browse the cross-operator
 * marketplace. Auth-agnostic services receive PUBLIC_CONTEXT; the renter-safe
 * column projection lives in the services, not here.
 */
export function createStorefrontRoutes(
  searchService: StorefrontSearchService,
  detailService: StorefrontDetailService,
  publicCatalogLimiter?: RateLimitBinding,
) {
  const app = new Hono()

  // Stricter per-IP budget on the unauthenticated catalog paths — the public
  // endpoints are the most attractive scraping target (mirrors vehicle-classes).
  if (publicCatalogLimiter) {
    const ipKey = (c: Context) => c.req.header('cf-connecting-ip') ?? ''
    app.use('/storefronts/*', rateLimit(publicCatalogLimiter, ipKey))
  }

  return app
    .get('/storefronts/search', async (c) => {
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response
      const limit = parseLimit(c, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT })
      if (!limit.ok) return limit.response

      const pickupLocationId = c.req.query('pickupLocationId')
      const classes = c.req.queries('class')
      const cursor = c.req.query('cursor')

      const result = await searchService.search(PUBLIC_CONTEXT, {
        from: range.from,
        to: range.to,
        limit: limit.limit,
        ...(pickupLocationId ? { pickupLocationId } : {}),
        ...(classes && classes.length > 0 ? { classes } : {}),
        ...(cursor ? { cursor } : {}),
      })
      if (!result.ok) return fail(c, result.error, result.status)
      cachePublic(c, CACHE_SECONDS)
      return ok(c, result.data)
    })
    .get('/storefronts/:locationId/vehicles', async (c) => {
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response
      const limit = parseLimit(c, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT })
      if (!limit.ok) return limit.response

      const classes = c.req.queries('class')
      const cursor = c.req.query('cursor')

      const result = await detailService.getDetail(PUBLIC_CONTEXT, {
        locationId: c.req.param('locationId'),
        from: range.from,
        to: range.to,
        limit: limit.limit,
        ...(classes && classes.length > 0 ? { classes } : {}),
        ...(cursor ? { cursor } : {}),
      })
      // Unknown/archived location -> 404, never edge-cached: a cached 404 would
      // pin the miss until TTL, hiding a store that just went ACTIVE.
      if (!result.ok) return fail(c, result.error, result.status)
      cachePublic(c, CACHE_SECONDS)
      return ok(c, result.data)
    })
    .get('/storefronts/:locationId/insurance-options', async (c) => {
      // The ACTIVE coverage a renter can add when booking at this storefront
      // (#392). Public + active-only + single-operator — see the service for the
      // [P0] seal rationale. 404 mirrors the vehicles route (unknown/archived).
      const result = await detailService.getInsuranceOptions(
        PUBLIC_CONTEXT,
        c.req.param('locationId'),
      )
      if (!result.ok) return fail(c, result.error, result.status)
      cachePublic(c, CACHE_SECONDS)
      return ok(c, result.data)
    })
    .get('/storefronts/:locationId/add-ons', async (c) => {
      // The ACTIVE paid add-ons a renter can pick when booking at this storefront
      // (#460). Public + active-only + single-operator — see the service for the
      // [P0] seal rationale. 404 mirrors the vehicles route (unknown/archived).
      const result = await detailService.getAddOns(PUBLIC_CONTEXT, c.req.param('locationId'))
      if (!result.ok) return fail(c, result.error, result.status)
      cachePublic(c, CACHE_SECONDS)
      return ok(c, result.data)
    })
}
