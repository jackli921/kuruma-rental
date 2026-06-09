import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { type Context, Hono } from 'hono'
import { PUBLIC_CONTEXT } from '../middleware/auth'
import type { FlatSearchService } from '../services/flat-search'
import { cachePublic, fail, ok, parseDateRange, parseLimit } from './helpers'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
// Availability is time-sensitive; 10s at the edge mirrors the storefront catalog
// (the DB exclusion constraint is the real overlap guardrail, this is perf only).
const CACHE_SECONDS = 10

/**
 * Public cross-operator flat vehicle search (#458). Anonymous — registered with
 * no `requireAuth` so renters browse the whole marketplace. The auth-agnostic
 * FlatSearchService receives PUBLIC_CONTEXT and owns the renter-safe column
 * projection (no licence plate, no operator internals — D3); this route is HTTP
 * in/out only.
 */
export function createFlatSearchRoutes(
  flatSearchService: FlatSearchService,
  publicCatalogLimiter?: RateLimitBinding,
) {
  const app = new Hono()

  // Stricter per-IP budget on the unauthenticated search path — the public
  // endpoints are the most attractive scraping target (mirrors storefronts).
  if (publicCatalogLimiter) {
    const ipKey = (c: Context) => c.req.header('cf-connecting-ip') ?? ''
    app.use('/search/*', rateLimit(publicCatalogLimiter, ipKey))
  }

  return app.get('/search/vehicles', async (c) => {
    const range = parseDateRange(c, true)
    if (!range.ok) return range.response
    const limit = parseLimit(c, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT })
    if (!limit.ok) return limit.response

    const pickupLocationId = c.req.query('pickupLocationId')
    const operatorId = c.req.query('operatorId')
    const classes = c.req.queries('class')
    const cursor = c.req.query('cursor')

    const result = await flatSearchService.search(PUBLIC_CONTEXT, {
      from: range.from,
      to: range.to,
      limit: limit.limit,
      ...(pickupLocationId ? { pickupLocationId } : {}),
      ...(operatorId ? { operatorId } : {}),
      ...(classes && classes.length > 0 ? { classes } : {}),
      ...(cursor ? { cursor } : {}),
    })
    if (!result.ok) return fail(c, result.error, result.status)
    cachePublic(c, CACHE_SECONDS)
    return ok(c, result.data)
  })
}
