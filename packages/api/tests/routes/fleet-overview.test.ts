// Route-level tests for GET /vehicles/fleet-overview — the owner-facing
// aggregated read for issue #52. Uses InMemory repos; the aggregation
// logic itself is covered in tests/repositories/fleet-overview.test.ts.
// This file lives next to vehicles.test.ts but in its own file so slice
// #51 (status toggle) can extend vehicles.test.ts without merge conflicts.

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryBookingRepository,
  InMemoryFleetOverviewRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createFleetOverviewRoutes } from '../../src/routes/fleet-overview'

const FIXED_NOW = new Date('2026-04-11T12:00:00Z')

let app: Hono
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  const fleetRepo = new InMemoryFleetOverviewRepository(vehicleRepo, bookingRepo)
  app = new Hono()
  app.route('/', createFleetOverviewRoutes(fleetRepo))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /vehicles/fleet-overview', () => {
  it('returns an empty list when there are no vehicles', async () => {
    const res = await app.request('/vehicles/fleet-overview')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: [] })
  })

  it('returns an enriched row per vehicle with default zeroed metrics', async () => {
    await vehicleRepo.create({
      name: 'Toyota Corolla',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: 'Gasoline',
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
    })

    const res = await app.request('/vehicles/fleet-overview')
    const body = (await res.json()) as {
      success: boolean
      data: Array<{
        id: string
        name: string
        dailyRateJpy: number | null
        utilization: number
        bookingCountLast30Days: number
        currentBooking: unknown
        nextBooking: unknown
      }>
    }

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]!.name).toBe('Toyota Corolla')
    expect(body.data[0]!.dailyRateJpy).toBe(8000)
    expect(body.data[0]!.utilization).toBe(0)
    expect(body.data[0]!.bookingCountLast30Days).toBe(0)
    expect(body.data[0]!.currentBooking).toBeNull()
    expect(body.data[0]!.nextBooking).toBeNull()
  })

  it('serializes current/next booking Date fields as ISO strings', async () => {
    const vehicle = await vehicleRepo.create({
      name: 'On Rental',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
    })
    await bookingRepo.create({
      renterId: 'user_1',
      vehicleId: vehicle.id,
      startAt: new Date('2026-04-11T09:00:00Z'),
      endAt: new Date('2026-04-11T18:00:00Z'),
      effectiveEndAt: new Date('2026-04-11T19:00:00Z'),
      status: 'ACTIVE',
      source: 'DIRECT',
      externalId: null,
      notes: null,
      totalPrice: null,
      cancellationFee: null,
      cancelledAt: null,
    })

    const res = await app.request('/vehicles/fleet-overview')
    const body = (await res.json()) as {
      data: Array<{
        currentBooking: { startAt: string; endAt: string; renterName: string | null } | null
      }>
    }

    expect(body.data[0]!.currentBooking).not.toBeNull()
    expect(body.data[0]!.currentBooking!.startAt).toBe('2026-04-11T09:00:00.000Z')
    expect(body.data[0]!.currentBooking!.endAt).toBe('2026-04-11T18:00:00.000Z')
    expect(body.data[0]!.currentBooking!.renterName).toBeNull()
  })
})
