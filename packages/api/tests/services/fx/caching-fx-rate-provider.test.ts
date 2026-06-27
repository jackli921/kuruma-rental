import { describe, expect, it, vi } from 'vitest'
import { CachingFxRateProvider } from '../../../src/services/fx/caching-fx-rate-provider'
import type { FxRateCache, FxRateProvider, FxRates } from '../../../src/services/fx/types'

const RATES: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067 } }
const STALE: FxRates = { base: 'JPY', asOf: '2026-05-01', rates: { USD: 0.0064 } }

function fakeProvider(
  result: FxRates | null,
): FxRateProvider & { getRates: ReturnType<typeof vi.fn> } {
  return { getRates: vi.fn(async () => result) }
}

function fakeCache(seed: FxRates | null): FxRateCache & {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
} {
  return { get: vi.fn(async () => seed), set: vi.fn(async () => undefined) }
}

describe('CachingFxRateProvider', () => {
  it('cache HIT: returns the cached rates WITHOUT calling the inner provider', async () => {
    const inner = fakeProvider(RATES)
    const cache = fakeCache(STALE)
    const result = await new CachingFxRateProvider(inner, cache).getRates()

    expect(result).toEqual(STALE)
    expect(inner.getRates).not.toHaveBeenCalled()
  })

  it('cache MISS: delegates to the inner provider and stores the fetched rates', async () => {
    const inner = fakeProvider(RATES)
    const cache = fakeCache(null)
    const result = await new CachingFxRateProvider(inner, cache).getRates()

    expect(result).toEqual(RATES)
    expect(inner.getRates).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith(RATES)
  })

  it('does NOT cache a null fetch (an upstream failure must not pin a non-result)', async () => {
    const inner = fakeProvider(null)
    const cache = fakeCache(null)
    const result = await new CachingFxRateProvider(inner, cache).getRates()

    expect(result).toBeNull()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('never throws: a failing cache READ falls through to the inner provider', async () => {
    const inner = fakeProvider(RATES)
    const cache: FxRateCache = {
      get: vi.fn(async () => {
        throw new Error('kv get boom')
      }),
      set: vi.fn(async () => undefined),
    }
    const result = await new CachingFxRateProvider(inner, cache).getRates()

    expect(result).toEqual(RATES)
    expect(inner.getRates).toHaveBeenCalledTimes(1)
  })

  it('never throws: a failing cache WRITE still returns the fetched rates', async () => {
    const inner = fakeProvider(RATES)
    const cache: FxRateCache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw new Error('kv put boom')
      }),
    }
    const result = await new CachingFxRateProvider(inner, cache).getRates()

    expect(result).toEqual(RATES)
  })
})
