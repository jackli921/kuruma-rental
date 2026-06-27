import type { FxRateCache, FxRates } from './types'

// 1 day: indicative rates are refreshed at most daily (#1070), so the TTL bounds
// staleness and lets the next request re-fetch from the upstream provider.
const TTL_SECONDS = 60 * 60 * 24

// Single fixed key — the rate table is one logical resource (JPY base). Bump `v1`
// to invalidate every entry at once if the stored shape ever changes.
const KEY = 'fx:v1:JPY'

/**
 * Minimal structural view of a Workers KV namespace — only the two methods this
 * adapter uses (the same rule {@link KvGeocodeCache} follows). Keeps the service
 * layer free of the `@cloudflare/workers-types` KVNamespace type; index.ts casts
 * the native binding to it. The real KVNamespace is structurally compatible.
 */
export interface KvStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

/**
 * Durable, daily-TTL'd {@link FxRateCache} over Workers KV (#1070). Persists the
 * whole {@link FxRates} table as JSON under one key, shared across every isolate
 * and request so the upstream rate provider is hit at most once per day for the
 * entire app. Activation is gated on an `FX_RATE_CACHE` KV binding — index.ts
 * falls back to InMemoryFxRateCache until it exists. A corrupt or wrong-shaped
 * entry reads as a miss; operational KV errors propagate to the
 * CachingFxRateProvider decorator, which degrades them to a miss.
 */
export class KvFxRateCache implements FxRateCache {
  constructor(private readonly kv: KvStore) {}

  async get(): Promise<FxRates | null> {
    const raw = await this.kv.get(KEY)
    return raw ? parseRates(raw) : null
  }

  async set(rates: FxRates): Promise<void> {
    await this.kv.put(KEY, JSON.stringify(rates), { expirationTtl: TTL_SECONDS })
  }
}

// A manually-edited, partially-written, or schema-drifted entry must not poison
// reads — anything but a well-formed JPY-based table reads as a miss (re-fetched).
function parseRates(raw: string): FxRates | null {
  try {
    const value = JSON.parse(raw) as { base?: unknown; asOf?: unknown; rates?: unknown }
    if (value.base !== 'JPY' || typeof value.asOf !== 'string' || !isRateMap(value.rates)) {
      return null
    }
    return { base: 'JPY', asOf: value.asOf, rates: { ...value.rates } }
  } catch {
    return null
  }
}

function isRateMap(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}
