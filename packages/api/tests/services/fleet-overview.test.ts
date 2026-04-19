// Covers the now-injection contract on FleetOverviewService without
// touching the global clock. If the service started pulling `new Date()`
// internally again, these tests would silently pass with real time and
// fail intermittently — so every assertion depends on the injected Date.

import { describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryFleetOverviewRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { FleetOverviewService } from '../../src/services/fleet-overview'
import type { Booking, Vehicle } from '../../src/stores'

async function seedVehicle(
  repo: InMemoryVehicleRepository,
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Promise<Vehicle> {
  return repo.create(SYSTEM_CONTEXT, {
    name: 'Test',
    description: null,
    photos: [],
    seats: 4,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 10000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...overrides,
  })
}

async function seedBooking(
  repo: InMemoryBookingRepository,
  vehicleId: string,
  startAt: Date,
  endAt: Date,
  status: Booking['status'] = 'CONFIRMED',
): Promise<void> {
  await repo.create(SYSTEM_CONTEXT, {
    vehicleId,
    renterId: 'renter-1',
    startAt,
    endAt,
    effectiveEndAt: new Date(endAt.getTime() + 60 * 60 * 1000),
    status,
    source: 'DIRECT',
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
  })
}

describe('FleetOverviewService — clock injection', () => {
  it('uses the injected now, not the system clock, for the 30-day window', async () => {
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const fleetRepo = new InMemoryFleetOverviewRepository(
      vehicleRepo,
      bookingRepo,
      new Map(),
      new InMemoryMaintenanceLogRepository(),
    )
    const service = new FleetOverviewService(fleetRepo)

    const vehicle = await seedVehicle(vehicleRepo)
    // Booking runs 2026-04-01 00:00 → 2026-04-02 00:00 (24h)
    await seedBooking(
      bookingRepo,
      vehicle.id,
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-04-02T00:00:00Z'),
    )

    // "now" = 2026-04-11 — booking is inside the 30-day window
    const insideWindow = await service.findFleetOverview(new Date('2026-04-11T00:00:00Z'))
    expect(insideWindow[0]?.bookingCountLast30Days).toBe(1)

    // "now" = 2026-06-01 — booking is outside the 30-day window (ended ~60d ago)
    const outsideWindow = await service.findFleetOverview(new Date('2026-06-01T00:00:00Z'))
    expect(outsideWindow[0]?.bookingCountLast30Days).toBe(0)
  })

  it('classifies the same booking as current or past based on injected now', async () => {
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const fleetRepo = new InMemoryFleetOverviewRepository(vehicleRepo, bookingRepo)
    const service = new FleetOverviewService(fleetRepo)

    const vehicle = await seedVehicle(vehicleRepo)
    const start = new Date('2026-05-01T00:00:00Z')
    const end = new Date('2026-05-01T12:00:00Z')
    await seedBooking(bookingRepo, vehicle.id, start, end)

    const duringBooking = await service.findFleetOverview(new Date('2026-05-01T06:00:00Z'))
    expect(duringBooking[0]?.currentBooking).not.toBeNull()

    const afterBooking = await service.findFleetOverview(new Date('2026-05-02T00:00:00Z'))
    expect(afterBooking[0]?.currentBooking).toBeNull()
  })
})
