import { describe, expect, it, vi } from 'vitest'
import { CachingGeocoder } from '../../../src/services/geocoding/caching-geocoder'
import type {
  GeocodeCache,
  GeocodeOutcome,
  GeocodeResult,
  Geocoder,
} from '../../../src/services/geocoding/types'

const OSAKA: GeocodeResult = { lat: 34.6937, lng: 135.5023 }

function fakeGeocoder(outcome: GeocodeOutcome): Geocoder & { geocode: ReturnType<typeof vi.fn> } {
  return { geocode: vi.fn(async () => outcome) }
}

function fakeCache(seed?: GeocodeResult | null): GeocodeCache & {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
} {
  return { get: vi.fn(async () => seed ?? null), set: vi.fn(async () => undefined) }
}

describe('CachingGeocoder', () => {
  it('cache HIT: returns the cached ok outcome WITHOUT calling the inner geocoder (saves the rate-limit budget)', async () => {
    const inner = fakeGeocoder({ status: 'notFound' })
    const cache = fakeCache(OSAKA)
    const result = await new CachingGeocoder(inner, cache).geocode('1-1 Osaka, Japan')

    expect(result).toEqual({ status: 'ok', ...OSAKA })
    expect(cache.get).toHaveBeenCalledWith('1-1 Osaka, Japan')
    expect(inner.geocode).not.toHaveBeenCalled()
  })

  it('cache MISS: delegates to the inner geocoder and stores a successful result', async () => {
    const inner = fakeGeocoder({ status: 'ok', ...OSAKA })
    const cache = fakeCache(null)
    const result = await new CachingGeocoder(inner, cache).geocode('Dotonbori, Osaka')

    expect(result).toEqual({ status: 'ok', ...OSAKA })
    expect(inner.geocode).toHaveBeenCalledWith('Dotonbori, Osaka')
    expect(cache.set).toHaveBeenCalledWith('Dotonbori, Osaka', OSAKA)
  })

  it.each(['notFound', 'throttled'] as const)(
    'does NOT cache a %s outcome (transient/retryable — caching would pin a non-result)',
    async (status) => {
      const inner = fakeGeocoder({ status })
      const cache = fakeCache(null)
      const result = await new CachingGeocoder(inner, cache).geocode('nowhere')

      expect(result).toEqual({ status })
      expect(cache.set).not.toHaveBeenCalled()
    },
  )

  it('never throws: a failing cache READ falls through to the inner geocoder', async () => {
    const inner = fakeGeocoder({ status: 'ok', ...OSAKA })
    const cache: GeocodeCache = {
      get: vi.fn(async () => {
        throw new Error('kv get boom')
      }),
      set: vi.fn(async () => undefined),
    }
    const result = await new CachingGeocoder(inner, cache).geocode('Osaka')

    expect(result).toEqual({ status: 'ok', ...OSAKA })
    expect(inner.geocode).toHaveBeenCalledWith('Osaka')
  })

  it('never throws: a failing cache WRITE still returns the geocoded result', async () => {
    const inner = fakeGeocoder({ status: 'ok', ...OSAKA })
    const cache: GeocodeCache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw new Error('kv put boom')
      }),
    }
    const result = await new CachingGeocoder(inner, cache).geocode('Osaka')

    expect(result).toEqual({ status: 'ok', ...OSAKA })
  })
})
