// Route-level tests for GET /vehicles/fleet-overview — the owner-facing
// aggregated read for issue #52. Uses InMemory repos; the aggregation
// logic itself is covered in tests/repositories/fleet-overview.test.ts.
// This file lives next to vehicles.test.ts but in its own file so slice
// #51 (status toggle) can extend vehicles.test.ts without merge conflicts.

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryFleetOverviewRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createFleetOverviewRoutes } from '../../src/routes/fleet-overview'
import { FleetOverviewService } from '../../src/services/fleet-overview'
import type { Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'

const FIXED_NOW = new Date('2026-04-11T12:00:00Z')

let app: Hono
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let maintenanceLogRepo: InMemoryMaintenanceLogRepository

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
  const fleetRepo = new InMemoryFleetOverviewRepository(
    vehicleRepo,
    bookingRepo,
    new Map(),
    maintenanceLogRepo,
  )
  app = new Hono()
  app.use('*', testAuthMiddleware('staff-user', 'PLATFORM_ADMIN'))
  app.route('/', createFleetOverviewRoutes(new FleetOverviewService(fleetRepo)))
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
    await vehicleRepo.create(SYSTEM_CONTEXT, {
      name: 'Toyota Corolla',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: 'Gasoline',
      licensePlate: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
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
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      name: 'On Rental',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        renterId: 'user_1',
        assignedVehicleId: vehicle.id,
        startAt: new Date('2026-04-11T09:00:00Z'),
        endAt: new Date('2026-04-11T18:00:00Z'),
        effectiveEndAt: new Date('2026-04-11T19:00:00Z'),
        status: 'ACTIVE',
      }),
    )

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

  it('includes activeMaintenanceReason when vehicle is in MAINTENANCE', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      name: 'Under Repair',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      status: 'MAINTENANCE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
    })
    await maintenanceLogRepo.create({
      vehicleId: vehicle.id,
      reason: 'Engine overhaul',
      notes: null,
      costJpy: null,
      startedAt: new Date(),
      resolvedAt: null,
    })

    const res = await app.request('/vehicles/fleet-overview')
    const body = await res.json()

    expect(body.data[0].activeMaintenanceReason).toBe('Engine overhaul')
  })

  it('returns null activeMaintenanceReason for AVAILABLE vehicles', async () => {
    await vehicleRepo.create(SYSTEM_CONTEXT, {
      name: 'Ready Car',
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

    const res = await app.request('/vehicles/fleet-overview')
    const body = await res.json()

    expect(body.data[0].activeMaintenanceReason).toBeNull()
  })
})

// Operator tenant-scoping (#594). The Fleet page in the operator portal calls
// this endpoint, so a tenant-scoped OPERATOR_* caller must (a) be admitted, not
// 403'd, and (b) see ONLY their own vehicles — never another operator's. Renters
// and 3rd-party PARTNER callers must still be rejected.
describe('GET /vehicles/fleet-overview — operator scoping', () => {
  type VehicleInput = Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>
  function vehicleInput(overrides: Partial<VehicleInput> = {}): VehicleInput {
    return {
      name: 'Car',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
      ...overrides,
    }
  }

  function appAs(role: UserRole, operatorId?: string): Hono {
    const a = new Hono()
    a.use('*', testAuthMiddleware('caller', role, operatorId))
    a.route(
      '/',
      createFleetOverviewRoutes(
        new FleetOverviewService(
          new InMemoryFleetOverviewRepository(
            vehicleRepo,
            bookingRepo,
            new Map(),
            maintenanceLogRepo,
          ),
        ),
      ),
    )
    return a
  }

  it('admits an OPERATOR_OWNER and returns only their own vehicles', async () => {
    await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ name: 'A-Car', operatorId: 'op-a' }))
    await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ name: 'B-Car', operatorId: 'op-b' }))

    const res = await appAs('OPERATOR_OWNER', 'op-a').request('/vehicles/fleet-overview')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ name: string }> }
    expect(body.data.map((v) => v.name)).toEqual(['A-Car'])
  })

  it('admits an OPERATOR_STAFF and isolates them from another tenant', async () => {
    await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ name: 'A-Car', operatorId: 'op-a' }))
    await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ name: 'B-Car', operatorId: 'op-b' }))

    const res = await appAs('OPERATOR_STAFF', 'op-b').request('/vehicles/fleet-overview')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ name: string }> }
    expect(body.data.map((v) => v.name)).toEqual(['B-Car'])
  })

  it('lets a PLATFORM_ADMIN see every operator’s vehicles (bypass)', async () => {
    await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ name: 'A-Car', operatorId: 'op-a' }))
    await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ name: 'B-Car', operatorId: 'op-b' }))

    const res = await appAs('PLATFORM_ADMIN').request('/vehicles/fleet-overview')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ name: string }> }
    expect(body.data.map((v) => v.name).sort()).toEqual(['A-Car', 'B-Car'])
  })

  it('rejects a RENTER with 403 (never leaks the operator catalog)', async () => {
    const res = await appAs('RENTER').request('/vehicles/fleet-overview')
    expect(res.status).toBe(403)
  })

  it('rejects a PARTNER (3rd-party API caller) with 403', async () => {
    const res = await appAs('PARTNER').request('/vehicles/fleet-overview')
    expect(res.status).toBe(403)
  })
})
