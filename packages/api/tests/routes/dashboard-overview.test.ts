import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { ForbiddenError, SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryOverviewRepository } from '../../src/repositories/in-memory/overview'
import { createOverviewRoutes } from '../../src/routes/overview'
import { OverviewService } from '../../src/services/overview'
import type { Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'
const PAST = new Date('2020-01-01T09:00:00Z')
const FUTURE = new Date('2099-01-01T09:00:00Z')

function vehicle(repo: InMemoryVehicleRepository, over: Partial<Vehicle>): Promise<Vehicle> {
  return repo.create(SYSTEM_CONTEXT, {
    operatorId: OP_A,
    classId: 'class_compact',
    pickupLocationId: null,
    name: 'Car',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...over,
  })
}

async function seeded() {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  // OP_A: 2 AVAILABLE + 1 MAINTENANCE vehicles
  await vehicle(vehicleRepo, { operatorId: OP_A, status: 'AVAILABLE' })
  await vehicle(vehicleRepo, { operatorId: OP_A, status: 'AVAILABLE' })
  await vehicle(vehicleRepo, { operatorId: OP_A, status: 'MAINTENANCE' })
  // OP_B: 1 AVAILABLE vehicle
  await vehicle(vehicleRepo, { operatorId: OP_B, status: 'AVAILABLE' })
  // OP_A bookings: upcoming CONFIRMED + upcoming ACTIVE + past COMPLETED + CANCELLED
  await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({ operatorId: OP_A, status: 'CONFIRMED', startAt: FUTURE }),
  )
  await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({ operatorId: OP_A, status: 'ACTIVE', startAt: FUTURE }),
  )
  await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({ operatorId: OP_A, status: 'COMPLETED', startAt: PAST }),
  )
  await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({ operatorId: OP_A, status: 'CANCELLED', startAt: FUTURE }),
  )
  // OP_B booking: 1 upcoming CONFIRMED
  await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({ operatorId: OP_B, status: 'CONFIRMED', startAt: FUTURE }),
  )
  return { vehicleRepo, bookingRepo }
}

function mount(
  vehicleRepo: InMemoryVehicleRepository,
  bookingRepo: InMemoryBookingRepository,
  role: UserRole,
  operatorId?: string,
) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  const service = new OverviewService(new InMemoryOverviewRepository(vehicleRepo, bookingRepo))
  app.route('/', createOverviewRoutes(service))
  return app
}

describe('GET /dashboard/overview — auth', () => {
  it('401 when unauthenticated', async () => {
    const { vehicleRepo, bookingRepo } = await seeded()
    const app = new Hono()
    app.route(
      '/',
      createOverviewRoutes(
        new OverviewService(new InMemoryOverviewRepository(vehicleRepo, bookingRepo)),
      ),
    )
    expect((await app.request('/dashboard/overview')).status).toBe(401)
  })

  it('403 for a RENTER (operator-private)', async () => {
    const { vehicleRepo, bookingRepo } = await seeded()
    const app = mount(vehicleRepo, bookingRepo, 'RENTER')
    expect((await app.request('/dashboard/overview')).status).toBe(403)
  })

  it('403 for a PARTNER (3rd-party API caller)', async () => {
    const { vehicleRepo, bookingRepo } = await seeded()
    const app = mount(vehicleRepo, bookingRepo, 'PARTNER')
    expect((await app.request('/dashboard/overview')).status).toBe(403)
  })
})

describe('InMemoryOverviewRepository — repo-layer seal (defence-in-depth)', () => {
  it.each(['PARTNER', 'RENTER'] as const)(
    'throws ForbiddenError for %s even if the route gate were bypassed',
    async (role) => {
      const { vehicleRepo, bookingRepo } = await seeded()
      const repo = new InMemoryOverviewRepository(vehicleRepo, bookingRepo)
      const ctx = { userId: `${role}-user`, role }
      await expect(repo.getOperatorOverview(ctx, FUTURE)).rejects.toThrow(ForbiddenError)
    },
  )
})

describe('GET /dashboard/overview — operator scoping', () => {
  it('scopes counts to the calling operator (OP_A)', async () => {
    const { vehicleRepo, bookingRepo } = await seeded()
    const res = await mount(vehicleRepo, bookingRepo, 'OPERATOR_OWNER', OP_A).request(
      '/dashboard/overview',
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    // totalBookings excludes CANCELLED: CONFIRMED + ACTIVE + COMPLETED = 3
    // activeVehicles: AVAILABLE only = 2 (MAINTENANCE excluded)
    // upcomingBookings: CONFIRMED + ACTIVE with future startAt = 2
    expect(data).toEqual({ totalBookings: 3, activeVehicles: 2, upcomingBookings: 2 })
  })

  it('does not leak another operator into OP_B counts', async () => {
    const { vehicleRepo, bookingRepo } = await seeded()
    const res = await mount(vehicleRepo, bookingRepo, 'OPERATOR_STAFF', OP_B).request(
      '/dashboard/overview',
    )
    const { data } = await res.json()
    expect(data).toEqual({ totalBookings: 1, activeVehicles: 1, upcomingBookings: 1 })
  })

  it('aggregates across all operators for a bypass role (PLATFORM_ADMIN)', async () => {
    const { vehicleRepo, bookingRepo } = await seeded()
    const res = await mount(vehicleRepo, bookingRepo, 'PLATFORM_ADMIN').request(
      '/dashboard/overview',
    )
    const { data } = await res.json()
    // OP_A (3 bookings, 2 vehicles, 2 upcoming) + OP_B (1, 1, 1)
    expect(data).toEqual({ totalBookings: 4, activeVehicles: 3, upcomingBookings: 3 })
  })

  it('fails closed to zeros for an OPERATOR_* caller missing operatorId', async () => {
    const { vehicleRepo, bookingRepo } = await seeded()
    const res = await mount(vehicleRepo, bookingRepo, 'OPERATOR_OWNER').request(
      '/dashboard/overview',
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toEqual({ totalBookings: 0, activeVehicles: 0, upcomingBookings: 0 })
  })
})
