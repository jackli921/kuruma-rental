import { describe, expect, it } from 'vitest'
import { StaticFxRateProvider } from '../../../src/services/fx/static-fx-rate-provider'

describe('StaticFxRateProvider', () => {
  it('returns a JPY-based snapshot with a YYYY-MM-DD asOf date', async () => {
    const rates = await new StaticFxRateProvider().getRates()

    expect(rates.base).toBe('JPY')
    expect(rates.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('covers the core tourist currencies with positive finite JPY→code rates', async () => {
    const { rates } = await new StaticFxRateProvider().getRates()

    for (const code of ['USD', 'EUR', 'GBP', 'AUD', 'CNY', 'KRW']) {
      expect(rates[code]).toBeGreaterThan(0)
      expect(Number.isFinite(rates[code])).toBe(true)
    }
    // sanity: 1 JPY is a small fraction of a USD, not the inverse
    expect(rates.USD).toBeLessThan(1)
  })

  it('never includes JPY itself (no self-conversion entry)', async () => {
    const { rates } = await new StaticFxRateProvider().getRates()
    expect(rates.JPY).toBeUndefined()
  })

  it('returns a defensive copy — mutating the result cannot corrupt the snapshot', async () => {
    const provider = new StaticFxRateProvider()
    const first = await provider.getRates()
    ;(first.rates as Record<string, number>).USD = 999

    const second = await provider.getRates()
    expect(second.rates.USD).not.toBe(999)
  })
})
