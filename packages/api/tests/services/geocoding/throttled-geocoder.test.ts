import { describe, expect, it, vi } from 'vitest'
import { ThrottledGeocoder } from '../../../src/services/geocoding/throttled-geocoder'
import type { GeocodeOutcome, Geocoder, RateLimiter } from '../../../src/services/geocoding/types'

const OSAKA: GeocodeOutcome = { status: 'ok', lat: 34.6937, lng: 135.5023 }

function fakeGeocoder(outcome: GeocodeOutcome): Geocoder & { geocode: ReturnType<typeof vi.fn> } {
  return { geocode: vi.fn(async () => outcome) }
}

function limiterReturning(success: boolean): RateLimiter & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) }
}

describe('ThrottledGeocoder', () => {
  it('delegates to the inner geocoder and returns its outcome when the limiter allows', async () => {
    const inner = fakeGeocoder(OSAKA)
    const limiter = limiterReturning(true)
    const result = await new ThrottledGeocoder(inner, limiter).geocode('1-1 Osaka, Japan')

    expect(result).toEqual(OSAKA)
    expect(inner.geocode).toHaveBeenCalledWith('1-1 Osaka, Japan')
  })

  it('checks one shared global bucket — the limiter is keyed by a single constant', async () => {
    const limiter = limiterReturning(true)
    const throttled = new ThrottledGeocoder(fakeGeocoder(OSAKA), limiter)
    await throttled.geocode('A')
    await throttled.geocode('B')

    expect(limiter.limit).toHaveBeenCalledTimes(2)
    expect(limiter.limit).toHaveBeenNthCalledWith(1, 'geocode:global')
    expect(limiter.limit).toHaveBeenNthCalledWith(2, 'geocode:global')
  })

  it('over the limit: returns a distinguishable throttled outcome WITHOUT calling the inner geocoder (#601)', async () => {
    const inner = fakeGeocoder(OSAKA)
    const result = await new ThrottledGeocoder(inner, limiterReturning(false)).geocode('Osaka')

    expect(result).toEqual({ status: 'throttled' })
    expect(inner.geocode).not.toHaveBeenCalled()
  })

  it('passes through a notFound when allowed but the inner geocoder finds no match', async () => {
    const inner = fakeGeocoder({ status: 'notFound' })
    const result = await new ThrottledGeocoder(inner, limiterReturning(true)).geocode('nowhere')

    expect(result).toEqual({ status: 'notFound' })
    expect(inner.geocode).toHaveBeenCalledTimes(1)
  })

  it('fails OPEN: a limiter error falls through to the inner geocoder rather than killing geocoding', async () => {
    const inner = fakeGeocoder(OSAKA)
    const limiter: RateLimiter = {
      limit: vi.fn(async () => {
        throw new Error('rate-limit service unavailable')
      }),
    }
    const result = await new ThrottledGeocoder(inner, limiter).geocode('Osaka')

    expect(result).toEqual(OSAKA)
    expect(inner.geocode).toHaveBeenCalledWith('Osaka')
  })

  it('a rejecting inner geocoder is treated as notFound, not throttled (never throws)', async () => {
    const inner: Geocoder = {
      geocode: vi.fn(async () => {
        throw new Error('boom')
      }),
    }
    expect(await new ThrottledGeocoder(inner, limiterReturning(true)).geocode('Osaka')).toEqual({
      status: 'notFound',
    })
  })
})
