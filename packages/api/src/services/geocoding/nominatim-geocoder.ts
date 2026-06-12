import type { GeocodeResult, Geocoder } from './types'

// OSMF Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
// ≤1 req/s, a descriptive User-Agent, no autocomplete, results cached. Geocode-
// on-save satisfies this — one request per save, the coords are persisted.
const GEOCODE_TIMEOUT_MS = 4000 // a hung upstream must never block a location save

interface NominatimHit {
  lat?: string
  lon?: string
}

/**
 * Forward-geocoding adapter over OSM/Nominatim's `/search` (jsonv2, limit 1).
 * Total by contract: a miss, a non-OK response, a parse failure, a network
 * error, or the AbortSignal timeout all resolve to `null` — never a throw. The
 * #531 write path treats `null` as "no coordinates" so the location persists
 * regardless. Single request, no retries (OSMF rate policy + autocomplete ban).
 */
export class NominatimGeocoder implements Geocoder {
  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async geocode(address: string): Promise<GeocodeResult | null> {
    const url = new URL('/search', this.baseUrl)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '1')
    url.searchParams.set('q', address)

    try {
      const response = await this.fetchFn(url.toString(), {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      })
      if (!response.ok) return null

      const hits = (await response.json()) as NominatimHit[]
      const first = hits[0]
      if (!first) return null

      const lat = Number(first.lat)
      const lng = Number(first.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return { lat, lng }
    } catch {
      // Network error, timeout (TimeoutError/AbortError), or a malformed body.
      // Best-effort: swallow and report "no coordinates" so the save proceeds.
      return null
    }
  }
}
