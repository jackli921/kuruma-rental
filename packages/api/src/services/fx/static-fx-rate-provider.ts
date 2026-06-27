import type { FxRateProvider, FxRates } from './types'

/**
 * Pinned indicative-rate snapshot (#1070). The AFK demo has no upstream rate API
 * and no secret to wire, so these are hand-captured JPY→currency rates with a
 * fixed `asOf`. The figures are indicative only (the charge is always JPY), so a
 * slightly stale snapshot is acceptable — refresh it when convenient.
 *
 * A real HTTP provider drops in behind the same {@link FxRateProvider} port (an
 * env-var/secret swap in index.ts, exactly like the Nominatim geocoder); the
 * daily {@link CachingFxRateProvider} in front then earns its keep.
 *
 * JPY is deliberately absent — `formatIndicativePrice` treats a JPY display
 * currency as "no conversion", so a self-rate would never be read.
 */
const SNAPSHOT: FxRates = {
  base: 'JPY',
  asOf: '2026-06-01',
  rates: {
    USD: 0.0067,
    EUR: 0.006,
    GBP: 0.0052,
    AUD: 0.0101,
    CAD: 0.0091,
    CNY: 0.048,
    KRW: 9.07,
    TWD: 0.21,
    HKD: 0.052,
    SGD: 0.009,
    THB: 0.24,
  },
}

/** Returns the pinned {@link SNAPSHOT}. Always succeeds (in-memory constant), so
 *  it never returns null — but the port allows it for the future HTTP adapter. */
export class StaticFxRateProvider implements FxRateProvider {
  async getRates(): Promise<FxRates> {
    // Defensive copy: a caller mutating the result must not corrupt the snapshot.
    return { base: SNAPSHOT.base, asOf: SNAPSHOT.asOf, rates: { ...SNAPSHOT.rates } }
  }
}
