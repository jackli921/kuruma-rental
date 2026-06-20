import { describe, expect, it } from 'vitest'
import {
  InMemoryGeocodeCache,
  geocodeCacheKey,
  normalizeGeocodeAddress,
} from '../../../src/services/geocoding/geocode-cache'
import type { GeocodeResult } from '../../../src/services/geocoding/types'

const OSAKA: GeocodeResult = { lat: 34.6937, lng: 135.5023 }

describe('normalizeGeocodeAddress', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeGeocodeAddress('  1-1  Dotonbori,   OSAKA ')).toBe('1-1 dotonbori, osaka')
  })
})

describe('geocodeCacheKey', () => {
  it('prefixes a version so the whole cache can be invalidated by bumping it', () => {
    expect(geocodeCacheKey('Osaka')).toBe('geocode:v1:osaka')
  })

  it('maps case/whitespace variants of one address to the same key', () => {
    expect(geocodeCacheKey('Osaka  Station')).toBe(geocodeCacheKey('osaka station'))
  })
})

describe('InMemoryGeocodeCache', () => {
  it('returns null for an address it has never seen', async () => {
    expect(await new InMemoryGeocodeCache().get('unknown')).toBeNull()
  })

  it('round-trips a stored result', async () => {
    const cache = new InMemoryGeocodeCache()
    await cache.set('Dotonbori, Osaka', OSAKA)
    expect(await cache.get('Dotonbori, Osaka')).toEqual(OSAKA)
  })

  it('normalizes keys: a case/whitespace variant of the stored address hits the same entry', async () => {
    const cache = new InMemoryGeocodeCache()
    await cache.set('Dotonbori, Osaka', OSAKA)
    expect(await cache.get('  dotonbori,   OSAKA ')).toEqual(OSAKA)
  })

  it('stores a defensive copy so later mutation of the input cannot corrupt the cache', async () => {
    const cache = new InMemoryGeocodeCache()
    const coords = { ...OSAKA }
    await cache.set('x', coords)
    coords.lat = 0
    expect(await cache.get('x')).toEqual(OSAKA)
  })
})
