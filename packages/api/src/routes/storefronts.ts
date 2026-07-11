import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import { PUBLIC_CONTEXT } from '../middleware/auth'
import type { StorefrontDetailService } from '../services/storefront-detail'
import type { StorefrontSearchService } from '../services/storefront-search'
import {
  cachePublic,
  failResult,
  ok,
  parseDateRange,
  parseId,
  parseLimit,
  parseLocale,
} from './helpers'
import { rateLimitByIp } from './rate-limit'

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
  // Fails closed on an unresolvable IP (#580).
  if (publicCatalogLimiter) {
    app.use('/storefronts/*', rateLimitByIp(publicCatalogLimiter))
  }

  return app
    .get('/storefronts/search', async (c) => {
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response
      const limit = parseLimit(c, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT })
      if (!limit.ok) return limit.response

      const pickupLocationId = c.req.query('pickupLocationId')
      const regionId = c.req.query('regionId')
      const classes = c.req.queries('class')
      const cursor = c.req.query('cursor')

      const result = await searchService.search(PUBLIC_CONTEXT, {
        from: range.from,
        to: range.to,
        limit: limit.limit,
        ...(pickupLocationId ? { pickupLocationId } : {}),
        ...(regionId ? { regionId } : {}),
        ...(classes && classes.length > 0 ? { classes } : {}),
        ...(cursor ? { cursor } : {}),
      })
      if (!result.ok) return failResult(c, result)
      cachePublic(c, CACHE_SECONDS)
      return ok(c, result.data)
    })
    .get('/storefronts/:locationId/vehicles', async (c) => {
      const idResult = parseId(c, 'locationId')
      if (!idResult.ok) return idResult.response
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response
      const limit = parseLimit(c, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT })
      if (!limit.ok) return limit.response

      const classes = c.req.queries('class')
      const cursor = c.req.query('cursor')

      const result = await detailService.getDetail(PUBLIC_CONTEXT, {
        locationId: idResult.id,
        from: range.from,
        to: range.to,
        limit: limit.limit,
        ...(classes && classes.length > 0 ? { classes } : {}),
        ...(cursor ? { cursor } : {}),
      })
      // Unknown/archived location -> 404, never edge-cached: a cached 404 would
      // pin the miss until TTL, hiding a store that just went ACTIVE.
      if (!result.ok) return failResult(c, result)
      cachePublic(c, CACHE_SECONDS)
      return ok(c, result.data)
    })
    .get('/storefronts/:locationId/insurance-options', async (c) => {
      const idResult = parseId(c, 'locationId')
      if (!idResult.ok) return idResult.response

      // Catalog i18n (slice 3b): resolve names to the renter's locale. Parse
      // BEFORE cachePublic — a bad ?locale= is a 400 that must never be cached
      // (a cached error would pin the miss edge-wide until TTL).
      const locale = parseLocale(c)
      if (!locale.ok) return locale.response

      // The ACTIVE coverage a renter can add when booking at this storefront
      // (#392). Public + active-only + single-operator — see the service for the
      // [P0] seal rationale. 404 mirrors the vehicles route (unknown/archived).
      const result = await detailService.getInsuranceOptions(
        PUBLIC_CONTEXT,
        idResult.id,
        locale.locale,
      )
      if (!result.ok) return failResult(c, result)
      cachePublic(c, CACHE_SECONDS)
      return ok(c, result.data)
    })
    .get('/storefronts/:locationId/add-ons', async (c) => {
      const idResult = parseId(c, 'locationId')
      if (!idResult.ok) return idResult.response

      // Catalog i18n (slice 2): resolve names to the renter's locale. Parse
      // BEFORE cachePublic — a bad ?locale= is a 400 that must never be cached
      // (a cached error would pin the miss edge-wide until TTL).
      const locale = parseLocale(c)
      if (!locale.ok) return locale.response

      // The ACTIVE paid add-ons a renter can pick when booking at this storefront
      // (#460). Public + active-only + single-operator — see the service for the
      // [P0] seal rationale. 404 mirrors the vehicles route (unknown/archived).
      const result = await detailService.getAddOns(PUBLIC_CONTEXT, idResult.id, locale.locale)
      if (!result.ok) return failResult(c, result)
      cachePublic(c, CACHE_SECONDS)
      return ok(c, result.data)
    })
}
