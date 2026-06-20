import type { GeocodeCache, GeocodeResult } from './types'

const KEY_PREFIX = 'geocode:v1:'

/**
 * Lowercase, trim, and collapse internal whitespace so trivially-different
 * spellings of one address ("  Osaka   Station " vs "osaka station") share a
 * cache entry. The original address stays the DB source of truth — this derived
 * form is only ever a cache key.
 */
export function normalizeGeocodeAddress(address: string): string {
  return address.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Versioned cache key for an address. Bump the `v1` to invalidate every entry at
 * once (e.g. if the cached value shape ever changes) without a KV purge.
 */
export function geocodeCacheKey(address: string): string {
  return `${KEY_PREFIX}${normalizeGeocodeAddress(address)}`
}

/**
 * Process-local {@link GeocodeCache} for dev / tests / seed, and the default when
 * no Workers KV binding is present. Not shared across isolates and not TTL'd — the
 * KV adapter (KvGeocodeCache) owns durable, TTL'd caching in production (#601,
 * activation gated on #304). Stores defensive copies so a caller mutating an input
 * or a returned object cannot corrupt a cached entry.
 */
export class InMemoryGeocodeCache implements GeocodeCache {
  private readonly entries = new Map<string, GeocodeResult>()

  async get(address: string): Promise<GeocodeResult | null> {
    const hit = this.entries.get(geocodeCacheKey(address))
    return hit ? { lat: hit.lat, lng: hit.lng } : null
  }

  async set(address: string, result: GeocodeResult): Promise<void> {
    this.entries.set(geocodeCacheKey(address), { lat: result.lat, lng: result.lng })
  }
}
