import { geocodeCacheKey } from './geocode-cache'
import type { GeocodeCache, GeocodeResult } from './types'

// 30 days. Geocode results are stable (an address doesn't move), so the TTL is
// generous; it just bounds staleness if an address is corrected upstream and caps
// unbounded key growth.
const TTL_SECONDS = 60 * 60 * 24 * 30

/**
 * Minimal structural view of a Workers KV namespace — only the two methods this
 * adapter uses. Keeps the service layer free of the `@cloudflare/workers-types`
 * KVNamespace type (the same rule the RateLimiter port follows); `index.ts` casts
 * the native `GEOCODE_CACHE` binding to it. The real KVNamespace is structurally
 * compatible, so the cast needs no adapter code.
 */
export interface KvStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

/**
 * Durable, TTL'd {@link GeocodeCache} over Workers KV (#601, #574 piece 1/2).
 * Persists `{lat,lng}` JSON keyed by the normalized address, shared across every
 * isolate and request so the whole app spends the 1-req/10s geocode budget at most
 * once per distinct address. Activation is gated on #304 (KV provisioning) —
 * `index.ts` falls back to InMemoryGeocodeCache until the `GEOCODE_CACHE` binding
 * exists. A corrupt or wrong-shaped entry reads as a miss; operational KV errors
 * propagate to the CachingGeocoder decorator, which degrades them to a miss.
 */
export class KvGeocodeCache implements GeocodeCache {
  constructor(private readonly kv: KvStore) {}

  async get(address: string): Promise<GeocodeResult | null> {
    const raw = await this.kv.get(geocodeCacheKey(address))
    return raw ? parseResult(raw) : null
  }

  async set(address: string, result: GeocodeResult): Promise<void> {
    await this.kv.put(
      geocodeCacheKey(address),
      JSON.stringify({ lat: result.lat, lng: result.lng }),
      {
        expirationTtl: TTL_SECONDS,
      },
    )
  }
}

// A manually-edited, partially-written, or schema-drifted entry must not poison
// reads — an unparseable or wrong-shaped value reads as a miss (re-geocoded).
function parseResult(raw: string): GeocodeResult | null {
  try {
    const value = JSON.parse(raw) as { lat?: unknown; lng?: unknown }
    return typeof value.lat === 'number' && typeof value.lng === 'number'
      ? { lat: value.lat, lng: value.lng }
      : null
  } catch {
    return null
  }
}
