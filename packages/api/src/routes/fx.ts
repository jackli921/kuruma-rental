import { Hono } from 'hono'
import type { FxRateProvider } from '../services/fx/types'
import { cachePublic, fail, ok } from './helpers'

// Indicative rates change at most daily, so cache hard at the edge — the rates
// endpoint is the same for every renter and carries no per-user data.
const CACHE_SECONDS = 3600

/**
 * Public indicative FX rates (#1070). Anonymous — registered with no `requireAuth`
 * so the renter storefront can show converted prices before login (the same
 * pattern as `regions`). JPY base; display-only — the charge is always JPY. The
 * cached provider owns the read; HTTP in/out only.
 *
 * If the provider can't supply rates (a future upstream outage), respond 503 so
 * the edge doesn't cache the gap and the web falls back to JPY-only display —
 * never a 500.
 */
export function createFxRoutes(fxProvider: FxRateProvider) {
  return new Hono().get('/fx/rates', async (c) => {
    const rates = await fxProvider.getRates()
    if (!rates) return fail(c, 'FX_RATES_UNAVAILABLE', 503)
    cachePublic(c, CACHE_SECONDS)
    return ok(c, rates)
  })
}
