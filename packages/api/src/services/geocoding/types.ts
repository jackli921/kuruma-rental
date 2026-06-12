/**
 * Provider-neutral forward-geocoding port (#531). Business logic depends on this
 * interface; the concrete adapter (NominatimGeocoder today, Google/Mapbox later)
 * is wired only in index.ts — a provider swap is a one-line change there.
 *
 * The contract is deliberately minimal: address in, coords or null out. `address`
 * stays the canonical source of truth and is never overwritten by the geocoder,
 * so no formattedAddress/precision/place_id is returned. The implementation must
 * NEVER throw — a failure (no match, network, timeout) returns null so a location
 * save is never blocked.
 */
export interface GeocodeResult {
  lat: number
  lng: number
}

export interface Geocoder {
  geocode(address: string): Promise<GeocodeResult | null>
}
