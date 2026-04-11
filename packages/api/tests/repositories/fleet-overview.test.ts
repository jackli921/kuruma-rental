// Unit tests for VehicleRepository.findFleetOverview — the
// aggregated read that powers the /manage/vehicles owner page
// (issue #52). The in-memory repository is the behavior
// specification; the Drizzle implementation is verified against
// it via integration tests in tests/integration/fleet-overview.test.ts.
//
// Utilization formula (per issue #52):
//   sum(booked_hours in last 30 days for non-CANCELLED bookings)
//   / (30 * 24) * 100
// Buffer time is NOT counted — only startAt..endAt.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryBookingRepository,
  InMemoryFleetOverviewRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { Booking, Vehicle } from '../../src/stores'

const FIXED_NOW = new Date('2026-04-11T12:00:00Z')

function baseVehicleInput(
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
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
    ...overrides,
  }
}

function baseBookingInput(
  overrides: Partial<Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>> & {
    vehicleId: string
  },
): Omit<Booking, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    renterId: 'user_1',
    startAt: new Date('2026-04-10T10:00:00Z'),
    endAt: new Date('2026-04-10T14:00:00Z'),
    effectiveEndAt: new Date('2026-04-10T15:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    ...overrides,
  }
}

describe('InMemoryFleetOverviewRepository', () => {
  let vehicleRepo: InMemoryVehicleRepository
  let bookingRepo: InMemoryBookingRepository
  let fleetRepo: InMemoryFleetOverviewRepository

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    fleetRepo = new InMemoryFleetOverviewRepository(vehicleRepo, bookingRepo)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 0% utilization and null bookings for a vehicle with no bookings', async () => {
    const vehicle = await vehicleRepo.create(baseVehicleInput({ name: 'Unbooked' }))

    const overviews = await fleetRepo.findFleetOverview()
    const overview = overviews[0]

    expect(overviews).toHaveLength(1)
    expect(overview).toBeDefined()
    expect(overview!.id).toBe(vehicle.id)
    expect(overview!.name).toBe('Unbooked')
    expect(overview!.utilization).toBe(0)
    expect(overview!.bookingCountLast30Days).toBe(0)
    expect(overview!.currentBooking).toBeNull()
    expect(overview!.nextBooking).toBeNull()
  })

  it('excludes CANCELLED bookings from utilization and count', async () => {
    const vehicle = await vehicleRepo.create(baseVehicleInput({ name: 'Cancelled' }))
    await bookingRepo.create(
      baseBookingInput({
        vehicleId: vehicle.id,
        startAt: new Date('2026-04-05T10:00:00Z'),
        endAt: new Date('2026-04-06T10:00:00Z'),
        effectiveEndAt: new Date('2026-04-06T11:00:00Z'),
        status: 'CANCELLED',
      }),
    )

    const [overview] = await fleetRepo.findFleetOverview()

    expect(overview!.utilization).toBe(0)
    expect(overview!.bookingCountLast30Days).toBe(0)
  })

  it('utilization reflects a single 24-hour booking inside the last 30 days', async () => {
    // 24 booked hours / (30 * 24) = 24/720 ≈ 3.333...%
    // Booking window: 2026-04-05 10:00 → 2026-04-06 10:00 UTC.
    // Now = 2026-04-11 12:00 UTC, so this sits 5-6 days in the past,
    // squarely inside the 30-day window.
    const vehicle = await vehicleRepo.create(baseVehicleInput({ name: 'Booked Once' }))
    await bookingRepo.create(
      baseBookingInput({
        vehicleId: vehicle.id,
        startAt: new Date('2026-04-05T10:00:00Z'),
        endAt: new Date('2026-04-06T10:00:00Z'),
        effectiveEndAt: new Date('2026-04-06T11:00:00Z'),
        status: 'COMPLETED',
      }),
    )

    const [overview] = await fleetRepo.findFleetOverview()

    expect(overview!.bookingCountLast30Days).toBe(1)
    expect(overview!.utilization).toBeCloseTo((24 / (30 * 24)) * 100, 5)
  })

  it('populates currentBooking when now falls inside a non-CANCELLED booking', async () => {
    const vehicle = await vehicleRepo.create(baseVehicleInput({ name: 'On Rental' }))
    await bookingRepo.create(
      baseBookingInput({
        vehicleId: vehicle.id,
        // FIXED_NOW = 2026-04-11T12:00:00Z is inside this window
        startAt: new Date('2026-04-11T09:00:00Z'),
        endAt: new Date('2026-04-11T18:00:00Z'),
        effectiveEndAt: new Date('2026-04-11T19:00:00Z'),
        status: 'ACTIVE',
      }),
    )

    const [overview] = await fleetRepo.findFleetOverview()

    expect(overview!.currentBooking).not.toBeNull()
    expect(overview!.currentBooking!.startAt).toEqual(new Date('2026-04-11T09:00:00Z'))
    expect(overview!.currentBooking!.endAt).toEqual(new Date('2026-04-11T18:00:00Z'))
    expect(overview!.nextBooking).toBeNull()
  })

  it('populates nextBooking with the soonest future non-CANCELLED booking', async () => {
    const vehicle = await vehicleRepo.create(baseVehicleInput({ name: 'Has Future Booking' }))
    // Future booking — closer one first in creation order, but we want
    // findFleetOverview to pick the earliest startAt regardless of insert order.
    await bookingRepo.create(
      baseBookingInput({
        vehicleId: vehicle.id,
        startAt: new Date('2026-04-20T10:00:00Z'),
        endAt: new Date('2026-04-20T14:00:00Z'),
        effectiveEndAt: new Date('2026-04-20T15:00:00Z'),
        status: 'CONFIRMED',
      }),
    )
    await bookingRepo.create(
      baseBookingInput({
        vehicleId: vehicle.id,
        startAt: new Date('2026-04-12T08:00:00Z'),
        endAt: new Date('2026-04-12T10:00:00Z'),
        effectiveEndAt: new Date('2026-04-12T11:00:00Z'),
        status: 'CONFIRMED',
      }),
    )

    const [overview] = await fleetRepo.findFleetOverview()

    expect(overview!.currentBooking).toBeNull()
    expect(overview!.nextBooking).not.toBeNull()
    expect(overview!.nextBooking!.startAt).toEqual(new Date('2026-04-12T08:00:00Z'))
    expect(overview!.nextBooking!.endAt).toEqual(new Date('2026-04-12T10:00:00Z'))
  })

  it('excludes CANCELLED bookings from currentBooking and nextBooking', async () => {
    const vehicle = await vehicleRepo.create(baseVehicleInput({ name: 'All Cancelled' }))
    await bookingRepo.create(
      baseBookingInput({
        vehicleId: vehicle.id,
        startAt: new Date('2026-04-11T09:00:00Z'),
        endAt: new Date('2026-04-11T18:00:00Z'),
        effectiveEndAt: new Date('2026-04-11T19:00:00Z'),
        status: 'CANCELLED',
      }),
    )
    await bookingRepo.create(
      baseBookingInput({
        vehicleId: vehicle.id,
        startAt: new Date('2026-04-15T10:00:00Z'),
        endAt: new Date('2026-04-15T14:00:00Z'),
        effectiveEndAt: new Date('2026-04-15T15:00:00Z'),
        status: 'CANCELLED',
      }),
    )

    const [overview] = await fleetRepo.findFleetOverview()

    expect(overview!.currentBooking).toBeNull()
    expect(overview!.nextBooking).toBeNull()
  })

  it('resolves renterName from the injected renter map for current/next bookings', async () => {
    const renterNameByUserId = new Map<string, string>([['user_alice', 'Alice Smith']])
    fleetRepo = new InMemoryFleetOverviewRepository(
      vehicleRepo,
      bookingRepo,
      renterNameByUserId,
    )

    const vehicle = await vehicleRepo.create(baseVehicleInput({ name: 'Alice Rental' }))
    await bookingRepo.create(
      baseBookingInput({
        vehicleId: vehicle.id,
        renterId: 'user_alice',
        startAt: new Date('2026-04-11T09:00:00Z'),
        endAt: new Date('2026-04-11T18:00:00Z'),
        effectiveEndAt: new Date('2026-04-11T19:00:00Z'),
        status: 'ACTIVE',
      }),
    )

    const [overview] = await fleetRepo.findFleetOverview()

    expect(overview!.currentBooking!.renterName).toBe('Alice Smith')
  })

  it('returns one overview row per vehicle and preserves all Vehicle columns', async () => {
    const v1 = await vehicleRepo.create(
      baseVehicleInput({ name: 'First', dailyRateJpy: 7500, hourlyRateJpy: 900 }),
    )
    const v2 = await vehicleRepo.create(
      baseVehicleInput({ name: 'Second', dailyRateJpy: null, hourlyRateJpy: 1200 }),
    )

    const overviews = await fleetRepo.findFleetOverview()

    expect(overviews).toHaveLength(2)
    const first = overviews.find((o) => o.id === v1.id)
    const second = overviews.find((o) => o.id === v2.id)
    expect(first!.dailyRateJpy).toBe(7500)
    expect(first!.hourlyRateJpy).toBe(900)
    expect(second!.dailyRateJpy).toBeNull()
    expect(second!.hourlyRateJpy).toBe(1200)
  })
})
