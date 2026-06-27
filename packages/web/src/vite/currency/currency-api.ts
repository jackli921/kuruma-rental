import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { FxRates } from '@kuruma/shared/types/fx'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #1070: indicative JPY→currency rates the public GET /fx/rates returns. Display
// only — the charge is always JPY — so a failed fetch degrades to JPY-only display
// rather than blocking. The API edge-caches these for an hour; we match that.
const ONE_HOUR_MS = 60 * 60 * 1000

export const FX_RATES_QUERY_KEY = ['fx', 'rates'] as const

// Network-seam validator (#711-style). Pinned to FxRates with `satisfies` so a
// contract drift fails to compile; the JPY-base literal is enforced at the seam so
// a mis-based snapshot can never reach `formatIndicativePrice`.
const fxRatesSchema = z.object({
  base: z.literal('JPY'),
  asOf: z.string(),
  // A JPY→currency multiplier is always positive; rejecting 0/negative here fails the
  // whole snapshot loudly (UI degrades to JPY-only) as defense-in-depth —
  // formatIndicativePrice also guards per-currency (`rate <= 0 → null`), so this only
  // hardens the seam, it isn't the sole guard. (z.number() already rejects NaN/Infinity.)
  rates: z.record(z.string(), z.number().positive()),
}) satisfies z.ZodType<FxRates>

export async function fetchFxRates(): Promise<FxRates> {
  // Public, unauthenticated read (mirrors GET /regions); credentials are harmless.
  const res = await fetch(`${getApiBaseUrl()}/fx/rates`, { credentials: 'include' })
  return unwrap(res, fxRatesSchema)
}

export function fxRatesQueryOptions() {
  return queryOptions({
    queryKey: FX_RATES_QUERY_KEY,
    queryFn: fetchFxRates,
    staleTime: ONE_HOUR_MS,
  })
}
