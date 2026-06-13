/** Coordinates from a successful forward-geocode (#531). */
export interface GeocodeResult {
  lat: number
  lng: number
}

/**
 * Forward-geocoding outcome (#601, architect F6). A bare `null` collapsed two
 * very different failures: a genuinely un-geocodable address (retry won't help →
 * persist NULL coords) and an app-side rate-limit SKIP (#574 — retry WILL help →
 * persist a PENDING pin the bulk re-geocode can enumerate). The discriminated
 * union keeps the two distinguishable all the way to `coordinate_source`.
 */
export type GeocodeOutcome =
  | ({ status: 'ok' } & GeocodeResult)
  | { status: 'notFound' }
  | { status: 'throttled' }

/**
 * Provider-neutral forward-geocoding port (#531). Business logic depends on this
 * interface; the concrete adapter (NominatimGeocoder today, Google/Mapbox later)
 * is wired only in index.ts — a provider swap is a one-line change there.
 *
 * The contract is deliberately minimal: address in, outcome out. `address` stays
 * the canonical source of truth and is never overwritten by the geocoder, so no
 * formattedAddress/precision/place_id is returned. The implementation must NEVER
 * throw — a failure resolves to a {@link GeocodeOutcome} so a location save is
 * never blocked.
 */
export interface Geocoder {
  geocode(address: string): Promise<GeocodeOutcome>
}

/**
 * App-side throttle port (#574). A generic "may I proceed?" check keyed by a
 * caller-chosen string, so the geocoding service stays free of the CF/Hono rate-
 * limit binding type. `index.ts` adapts the native `[[ratelimits]]` binding
 * (whose shape is `limit({ key })`) to this `limit(key)` port — the only place
 * that knows about Cloudflare.
 */
export interface RateLimiter {
  limit(key: string): Promise<{ success: boolean }>
}
