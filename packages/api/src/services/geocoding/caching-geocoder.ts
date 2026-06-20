import type { GeocodeCache, GeocodeOutcome, GeocodeResult, Geocoder } from './types'

/**
 * Wraps a {@link Geocoder} with a forward-geocode result cache (#601, #574 piece
 * 1/2). A cache HIT returns the stored coordinates WITHOUT delegating, so repeated
 * or identical address lookups never spend the 1-req/10s global geocode budget
 * (the OSMF policy asks consumers to cache). Composed OUTSIDE the
 * {@link ThrottledGeocoder} in index.ts, so a hit also skips the rate-limit check.
 *
 * Only `status: 'ok'` outcomes are cached: a `throttled` is retryable and a
 * `notFound` can be a transient provider error (NominatimGeocoder maps timeouts/
 * network failures to notFound), so caching either would pin a non-result.
 *
 * Honors the Geocoder never-throw contract: a cache read/write failure degrades to
 * a miss / silent skip so a flaky cache can never block a location save.
 */
export class CachingGeocoder implements Geocoder {
  constructor(
    private readonly inner: Geocoder,
    private readonly cache: GeocodeCache,
  ) {}

  async geocode(address: string): Promise<GeocodeOutcome> {
    const cached = await this.read(address)
    if (cached) return { status: 'ok', lat: cached.lat, lng: cached.lng }

    const outcome = await this.inner.geocode(address)
    if (outcome.status === 'ok') await this.write(address, outcome)
    return outcome
  }

  private async read(address: string): Promise<GeocodeResult | null> {
    try {
      return await this.cache.get(address)
    } catch (err) {
      console.warn('[geocode] cache read failed; treating as a miss', {
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  private async write(address: string, result: GeocodeResult): Promise<void> {
    try {
      await this.cache.set(address, { lat: result.lat, lng: result.lng })
    } catch (err) {
      console.warn('[geocode] cache write failed; result not cached', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
