import { describe, expect, it, vi } from 'vitest'
import { KvGeocodeCache, type KvStore } from '../../../src/services/geocoding/kv-geocode-cache'
import type { GeocodeResult } from '../../../src/services/geocoding/types'

const OSAKA: GeocodeResult = { lat: 34.6937, lng: 135.5023 }
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30

function fakeKv(initial?: Record<string, string>): KvStore & {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  store: Map<string, string>
} {
  const store = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  }
}

describe('KvGeocodeCache', () => {
  it('set: writes the {lat,lng} JSON under the versioned, normalized key with a 30-day TTL', async () => {
    const kv = fakeKv()
    await new KvGeocodeCache(kv).set('  Osaka ', OSAKA)

    expect(kv.put).toHaveBeenCalledWith('geocode:v1:osaka', JSON.stringify(OSAKA), {
      expirationTtl: THIRTY_DAYS_SECONDS,
    })
  })

  it('get: returns the parsed coordinates for a stored entry', async () => {
    const kv = fakeKv({ 'geocode:v1:osaka': JSON.stringify(OSAKA) })
    expect(await new KvGeocodeCache(kv).get('OSAKA')).toEqual(OSAKA)
  })

  it('get: returns null for an address with no entry', async () => {
    expect(await new KvGeocodeCache(fakeKv()).get('nowhere')).toBeNull()
  })

  it('set then get round-trips — set and get agree on the normalized key', async () => {
    const cache = new KvGeocodeCache(fakeKv())
    await cache.set('Dotonbori, Osaka', OSAKA)
    expect(await cache.get('  dotonbori,   OSAKA ')).toEqual(OSAKA)
  })

  it('get: a corrupt (unparseable) entry reads as a miss, not a throw', async () => {
    const kv = fakeKv({ 'geocode:v1:osaka': '{not valid json' })
    expect(await new KvGeocodeCache(kv).get('Osaka')).toBeNull()
  })

  it('get: a parseable but wrong-shaped entry reads as a miss', async () => {
    const kv = fakeKv({ 'geocode:v1:osaka': JSON.stringify({ foo: 1 }) })
    expect(await new KvGeocodeCache(kv).get('Osaka')).toBeNull()
  })
})
