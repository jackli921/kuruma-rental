import type { GeocodeOutcome, Geocoder, RateLimiter } from './types'

// One shared bucket across every isolate/request: a constant key makes the
// native CF rate-limit binding enforce a single GLOBAL rate, not a per-key one.
const GLOBAL_KEY = 'geocode:global'

/**
 * Wraps a `Geocoder` with an app-side global throttle (#574). OSM/Nominatim's
 * policy caps the WHOLE app at 1 req/s; this caps our outbound geocoding before
 * a burst of operator saves can breach it (best-effort defense-in-depth — the
 * native binding is a fixed window, not a token bucket, so it can admit 2 across
 * a window boundary; the production provider's own server-side limit is the real
 * guarantee).
 *
 * Over the limit ⇒ SKIP the lookup and return `{ status: 'throttled' }` (#601,
 * architect F6). Unlike a provider miss (`notFound`), a throttle-skip is retry-
 * able, so `LocationService` persists it as a PENDING pin the bulk re-geocode can
 * enumerate — rather than collapsing it into an indistinguishable null. Honors
 * the `Geocoder` never-throw contract: a degraded limiter fails OPEN (proceed) so
 * a rate-limit-service blip can't silently kill all geocoding.
 */
export class ThrottledGeocoder implements Geocoder {
  constructor(
    private readonly inner: Geocoder,
    private readonly limiter: RateLimiter,
    private readonly key: string = GLOBAL_KEY,
  ) {}

  async geocode(address: string): Promise<GeocodeOutcome> {
    let allowed = true
    try {
      ;({ success: allowed } = await this.limiter.limit(this.key))
    } catch (err) {
      // Limiter itself failed: fail OPEN so geocoding survives a limiter outage.
      // Safe ONLY while public OSM stays opt-in (index.ts gates on UA + URL); if
      // OSM is ever defaulted on, fail-open could breach its 1 req/s — revisit then.
      console.warn('[geocode] rate limiter unavailable; proceeding without throttle', {
        error: err instanceof Error ? err.message : String(err),
      })
      allowed = true
    }

    if (!allowed) {
      console.warn('[geocode] global rate limit reached; skipping lookup (pin pending)', {
        address,
      })
      return { status: 'throttled' }
    }

    try {
      return await this.inner.geocode(address)
    } catch {
      // Inner Geocoders must never throw, but honor the contract defensively so
      // a misbehaving adapter can't break a save through this decorator either. A
      // thrown adapter is a failure, not a throttle — treat it as un-geocodable.
      return { status: 'notFound' }
    }
  }
}
