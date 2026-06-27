import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { FxRateProvider, FxRates } from '../../src/services/fx/types'

const RATES: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067, EUR: 0.006 } }

function makeApp(fxRateProvider: FxRateProvider) {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
  )
  return createApp({ vehicleRepo, bookingRepo, availabilityRepo, fxRateProvider })
}

describe('GET /fx/rates', () => {
  it('returns the indicative rate table to an anonymous caller', async () => {
    const app = makeApp({ getRates: async () => RATES })
    const res = await app.request('/fx/rates')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: RATES })
  })

  it('marks the response publicly cacheable at the edge', async () => {
    const app = makeApp({ getRates: async () => RATES })
    const res = await app.request('/fx/rates')

    expect(res.headers.get('Cache-Control')).toMatch(/public/)
  })

  it('degrades to 503 (not 500) when rates are unavailable', async () => {
    const app = makeApp({ getRates: async () => null })
    const res = await app.request('/fx/rates')

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ success: false, error: 'FX_RATES_UNAVAILABLE' })
  })
})
