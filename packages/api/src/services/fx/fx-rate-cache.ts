import type { FxRateCache, FxRates } from './types'

/** Defensive deep-ish copy: the only mutable part of FxRates is the `rates` map. */
function clone(rates: FxRates): FxRates {
  return { base: rates.base, asOf: rates.asOf, rates: { ...rates.rates } }
}

/**
 * Process-local {@link FxRateCache} for dev / tests / seed, and the default when
 * no Workers KV binding is present (#1070). A single nullable slot — the rate
 * table is one logical resource, unlike the per-address geocode cache. Not shared
 * across isolates and not TTL'd; {@link KvFxRateCache} owns durable, daily-TTL'd
 * caching in production. Stores and returns defensive copies so a caller mutating
 * an input or a returned object cannot corrupt the cached entry.
 */
export class InMemoryFxRateCache implements FxRateCache {
  private entry: FxRates | null = null

  async get(): Promise<FxRates | null> {
    return this.entry ? clone(this.entry) : null
  }

  async set(rates: FxRates): Promise<void> {
    this.entry = clone(rates)
  }
}
