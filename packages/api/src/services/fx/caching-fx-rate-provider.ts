import type { FxRateCache, FxRateProvider, FxRates } from './types'

/**
 * Wraps a {@link FxRateProvider} with a daily cache (#1070), mirroring
 * {@link CachingGeocoder}. A cache HIT returns the stored table WITHOUT
 * delegating, so the upstream rate API is hit at most once per TTL window rather
 * than once per page render. With the StaticFxRateProvider this is a no-op in
 * front of an in-memory constant; it earns its keep once a real HTTP provider is
 * wired behind the same port.
 *
 * Only a successful (non-null) fetch is cached — caching a null would pin an
 * upstream outage for the whole TTL. Honors the never-throw contract: a cache
 * read/write failure degrades to a miss / silent skip so a flaky cache can never
 * break the rates endpoint.
 */
export class CachingFxRateProvider implements FxRateProvider {
  constructor(
    private readonly inner: FxRateProvider,
    private readonly cache: FxRateCache,
  ) {}

  async getRates(): Promise<FxRates | null> {
    const cached = await this.read()
    if (cached) return cached

    const rates = await this.inner.getRates()
    if (rates) await this.write(rates)
    return rates
  }

  private async read(): Promise<FxRates | null> {
    try {
      return await this.cache.get()
    } catch (err) {
      console.warn('[fx] cache read failed; treating as a miss', {
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  private async write(rates: FxRates): Promise<void> {
    try {
      await this.cache.set(rates)
    } catch (err) {
      console.warn('[fx] cache write failed; rates not cached', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
