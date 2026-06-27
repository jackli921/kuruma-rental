import { describe, expect, it, vi } from 'vitest'
import { KvFxRateCache, type KvStore } from '../../../src/services/fx/kv-fx-rate-cache'
import type { FxRates } from '../../../src/services/fx/types'

const RATES: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067, EUR: 0.006 } }
const ONE_DAY_SECONDS = 60 * 60 * 24

function fakeKv(initial?: string | null): KvStore & {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
} {
  let value: string | null = initial ?? null
  return {
    get: vi.fn(async () => value),
    put: vi.fn(async (_k: string, v: string) => {
      value = v
    }),
  }
}

describe('KvFxRateCache', () => {
  it('returns null on a cache miss (no entry)', async () => {
    expect(await new KvFxRateCache(fakeKv(null)).get()).toBeNull()
  })

  it('round-trips through KV under a single fixed key with a one-day TTL', async () => {
    const kv = fakeKv()
    const cache = new KvFxRateCache(kv)
    await cache.set(RATES)

    expect(kv.put).toHaveBeenCalledTimes(1)
    const [key, value, opts] = kv.put.mock.calls[0]
    expect(key).toBe('fx:v1:JPY')
    expect(JSON.parse(value)).toEqual(RATES)
    expect(opts).toEqual({ expirationTtl: ONE_DAY_SECONDS })
    expect(await cache.get()).toEqual(RATES)
  })

  it('reads a corrupt (unparseable) entry as a miss', async () => {
    expect(await new KvFxRateCache(fakeKv('{not json')).get()).toBeNull()
  })

  it('reads a wrong-shaped entry as a miss (wrong base / non-number rate)', async () => {
    const wrongBase = JSON.stringify({ base: 'USD', asOf: '2026-06-01', rates: { USD: 0.0067 } })
    const badRate = JSON.stringify({ base: 'JPY', asOf: '2026-06-01', rates: { USD: 'nope' } })
    expect(await new KvFxRateCache(fakeKv(wrongBase)).get()).toBeNull()
    expect(await new KvFxRateCache(fakeKv(badRate)).get()).toBeNull()
  })
})
