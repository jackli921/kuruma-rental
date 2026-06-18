import { boundFetch } from '@kuruma/shared/lib/bound-fetch'

import type { GeocodeOutcome, Geocoder } from './types'

// A provider miss/error is un-geocodable as far as this adapter knows — retrying
// won't help. The app-side throttle (ThrottledGeocoder) owns the 'throttled'
// outcome; a bare adapter never emits it.
const NOT_FOUND: GeocodeOutcome = { status: 'notFound' }

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
    // boundFetch keeps this === globalThis when called detached as this.fetchFn;
    // a bare global fetch throws "Illegal invocation" on CF Workers (#887/#893).
    private readonly fetchFn: typeof fetch = boundFetch,
    // Optional auth token. LocationIQ is Nominatim-compatible but key-gated via
    // `?key=` (#574), so providing one makes it a pure env-var swap from public OSM.
    private readonly apiKey?: string,
  ) {}

  async geocode(address: string): Promise<GeocodeOutcome> {
    const url = new URL('/search', this.baseUrl)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '1')
    url.searchParams.set('q', address)
    if (this.apiKey) url.searchParams.set('key', this.apiKey)

    try {
      const response = await this.fetchFn(url.toString(), {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      })
      if (!response.ok) {
        // 429/403 here is the rate-limit/ban signal under the OSMF policy (#574);
        // surface it so provider degradation is visible. The save still proceeds.
        console.warn('[geocode] provider returned non-OK; persisting without coords', {
          status: response.status,
        })
        return NOT_FOUND
      }

      const hits = (await response.json()) as NominatimHit[]
      const first = hits[0]
      if (!first) return NOT_FOUND // a genuine no-match is normal, not a failure

      const lat = Number(first.lat)
      const lng = Number(first.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NOT_FOUND
      return { status: 'ok', lat, lng }
    } catch (err) {
      // Network error, timeout (TimeoutError/AbortError), or a malformed body.
      // Best-effort: log and report "no coordinates" so the save proceeds.
      console.warn('[geocode] lookup failed; persisting without coords', {
        error: err instanceof Error ? err.message : String(err),
      })
      return NOT_FOUND
    }
  }
}
