import { describe, expect, it } from 'vitest'
import { InMemoryFxRateCache } from '../../../src/services/fx/fx-rate-cache'
import type { FxRates } from '../../../src/services/fx/types'

const RATES: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067, EUR: 0.006 } }

describe('InMemoryFxRateCache', () => {
  it('returns null before anything is stored', async () => {
    expect(await new InMemoryFxRateCache().get()).toBeNull()
  })

  it('round-trips the stored rate table', async () => {
    const cache = new InMemoryFxRateCache()
    await cache.set(RATES)
    expect(await cache.get()).toEqual(RATES)
  })

  it('stores a defensive copy — mutating the input after set cannot corrupt the entry', async () => {
    const cache = new InMemoryFxRateCache()
    const input: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067 } }
    await cache.set(input)
    ;(input.rates as Record<string, number>).USD = 999

    const hit = await cache.get()
    expect(hit?.rates.USD).toBe(0.0067)
  })

  it('returns a defensive copy — mutating a read result cannot corrupt the entry', async () => {
    const cache = new InMemoryFxRateCache()
    await cache.set(RATES)
    const first = await cache.get()
    ;(first?.rates as Record<string, number>).USD = 999

    const second = await cache.get()
    expect(second?.rates.USD).toBe(0.0067)
  })
})
