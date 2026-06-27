import { describe, expect, it } from 'vitest'
import { buildFxRateProvider } from '../../src/composition/fx'

describe('buildFxRateProvider', () => {
  it('defaults to the static JPY snapshot through the cache (the production path)', async () => {
    // No overrides and no FX_RATE_CACHE binding: StaticFxRateProvider behind an
    // InMemoryFxRateCache. Proves the real default wiring, which the route test
    // (always injecting a fake provider) never exercises.
    const rates = await buildFxRateProvider().getRates()

    expect(rates?.base).toBe('JPY')
    expect(rates?.rates.USD).toBeGreaterThan(0)
  })
})
