// Covers the now-injection contract on FleetOverviewService without
// touching the global clock. If the service started pulling `new Date()`
// internally again, these tests would silently pass with real time and
// fail intermittently — so every assertion depends on the injected Date.

import { describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryFleetOverviewRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { FleetOverviewService } from '../../src/services/fleet-overview'
import type { Booking, Vehicle } from '../../src/stores'
import { bookingInput } from '../helpers/booking'
import { operatorCtx } from '../helpers/context'

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
  await repo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      assignedVehicleId: vehicleId,
      startAt,
      endAt,
      effectiveEndAt: new Date(endAt.getTime() + 60 * 60 * 1000),
      status,
    }),
  )
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
    const insideWindow = await service.findFleetOverview(
      SYSTEM_CONTEXT,
      new Date('2026-04-11T00:00:00Z'),
    )
    expect(insideWindow[0]?.bookingCountLast30Days).toBe(1)

    // "now" = 2026-06-01 — booking is outside the 30-day window (ended ~60d ago)
    const outsideWindow = await service.findFleetOverview(
      SYSTEM_CONTEXT,
      new Date('2026-06-01T00:00:00Z'),
    )
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

    const duringBooking = await service.findFleetOverview(
      SYSTEM_CONTEXT,
      new Date('2026-05-01T06:00:00Z'),
    )
    expect(duringBooking[0]?.currentBooking).not.toBeNull()

    const afterBooking = await service.findFleetOverview(
      SYSTEM_CONTEXT,
      new Date('2026-05-02T00:00:00Z'),
    )
    expect(afterBooking[0]?.currentBooking).toBeNull()
  })
})

// #1273: the two operator-dashboard cards must resolve read scope from the SAME
// vocabulary. Overview scopes via bookingReadScope (legacy STAFF/ADMIN -> renter
// -> zero); fleet-overview used to scope via operatorReadScope (legacy -> all ->
// the whole fleet), so the cards disagreed for a legacy session. Reconciled onto
// bookingReadScope: legacy STAFF/ADMIN now read nothing here too, matching both
// the overview card and the vehicleBlockReadScope precedent (#487 phase-out).
describe('FleetOverviewService — scope parity with the overview card (#1273)', () => {
  const now = new Date('2026-05-01T00:00:00Z')

  async function fleetWithOneVehiclePerOperator(): Promise<FleetOverviewService> {
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    await seedVehicle(vehicleRepo, { operatorId: 'op-a', name: 'A-car' })
    await seedVehicle(vehicleRepo, { operatorId: 'op-b', name: 'B-car' })
    return new FleetOverviewService(new InMemoryFleetOverviewRepository(vehicleRepo, bookingRepo))
  }

  it('returns [] for a legacy STAFF/ADMIN, matching overview (never the whole fleet)', async () => {
    const service = await fleetWithOneVehiclePerOperator()
    const staff: CallerContext = { userId: 'legacy', role: 'STAFF', bypassScope: false }
    const admin: CallerContext = { userId: 'legacy', role: 'ADMIN', bypassScope: false }
    expect(await service.findFleetOverview(staff, now)).toEqual([])
    expect(await service.findFleetOverview(admin, now)).toEqual([])
  })

  it('rejects RENTER / PARTNER at the repo seal (defence-in-depth)', async () => {
    const service = await fleetWithOneVehiclePerOperator()
    const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
    const partner: CallerContext = { userId: 'trip', role: 'PARTNER', bypassScope: true }
    await expect(service.findFleetOverview(renter, now)).rejects.toThrow(ForbiddenError)
    await expect(service.findFleetOverview(partner, now)).rejects.toThrow(ForbiddenError)
  })

  it('scopes an OPERATOR_* caller to its own tenant fleet', async () => {
    const service = await fleetWithOneVehiclePerOperator()
    const rows = await service.findFleetOverview(operatorCtx('op-a'), now)
    expect(rows.map((r) => r.operatorId)).toEqual(['op-a'])
  })

  it('aggregates all operators for a bypass admin, and narrows to a picked operator', async () => {
    const service = await fleetWithOneVehiclePerOperator()
    const admin: CallerContext = { userId: 'pa', role: 'PLATFORM_ADMIN', bypassScope: true }
    const all = await service.findFleetOverview(admin, now)
    expect(all.map((r) => r.operatorId).sort()).toEqual(['op-a', 'op-b'])
    const narrowed = await service.findFleetOverview(admin, now, 'op-a')
    expect(narrowed.map((r) => r.operatorId)).toEqual(['op-a'])
  })
})
