import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import type { UserRole } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'
import type { Vehicle } from '../../src/stores'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { TEST_OPERATOR_ID } from '../helpers/operator'

// #1477 drift guard. Every vehicle WRITE route must admit the FLEET_WRITE tier
// (platform base + tenant operators), never the narrower platform STAFF tier.
// #1406 was an accidental retighten of the photo routes from FLEET_WRITE_ROLES
// back to STAFF_ROLES; the gate `FLEET_WRITE_ROLES.has(user.role)` is hand-copied
// into ~6 vehicle write handlers with nothing structural keeping them in sync, so
// that desync shipped with no test going red. This pins the tier from BOTH sides:
//   - an operator (OPERATOR_OWNER / OPERATOR_STAFF = FLEET_WRITE \ STAFF) must NOT
//     be forbidden -> catches a retighten to STAFF_ROLES (the #1406 regression);
//   - a renter (outside FLEET_WRITE) MUST be forbidden -> catches gate removal or
//     a widen to any authenticated caller.
// The role gate runs BEFORE body validation in every handler, so a minimal request
// exercises it. We assert only the auth boundary (401/403), never the downstream
// 2xx/400/404 the request would otherwise reach.

interface WriteRoute {
  readonly name: string
  readonly method: 'POST' | 'PATCH' | 'DELETE'
  readonly path: (vehicleId: string) => string
  /** Multipart photo POST vs JSON body — only affects reaching PAST the gate. */
  readonly multipart?: boolean
}

const WRITE_ROUTES: readonly WriteRoute[] = [
  { name: 'POST /vehicles', method: 'POST', path: () => '/vehicles' },
  { name: 'PATCH /vehicles/bulk-status', method: 'PATCH', path: () => '/vehicles/bulk-status' },
  { name: 'PATCH /vehicles/:id', method: 'PATCH', path: (id) => `/vehicles/${id}` },
  { name: 'PATCH /vehicles/:id/status', method: 'PATCH', path: (id) => `/vehicles/${id}/status` },
  { name: 'DELETE /vehicles/:id', method: 'DELETE', path: (id) => `/vehicles/${id}` },
  {
    name: 'POST /vehicles/:id/photos',
    method: 'POST',
    path: (id) => `/vehicles/${id}/photos`,
    multipart: true,
  },
  { name: 'DELETE /vehicles/:id/photos', method: 'DELETE', path: (id) => `/vehicles/${id}/photos` },
]

// FLEET_WRITE_ROLES \ STAFF_ROLES: the tenant operators a retighten-to-STAFF
// would wrongly lock out. PLATFORM_ADMIN is in BOTH sets, so it can't witness the
// drift and is deliberately omitted from the admitted list.
const FLEET_WRITE_ONLY_ROLES: readonly UserRole[] = ['OPERATOR_OWNER', 'OPERATOR_STAFF']

function vehicleInput(): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: TEST_OPERATOR_ID,
    name: 'Guard Car',
    description: 'seeded for the role-gate drift guard',
    photos: [],
    seats: 4,
    transmission: 'AUTO',
    fuelType: 'GASOLINE',
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 24,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
  }
}

function makeApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    new InMemoryOperatorRepository(),
  )
  return {
    app: createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      photoStorage: new InMemoryPhotoStorage(),
    }),
    vehicleRepo,
  }
}

describe('vehicle write routes share one role gate (#1477 drift guard)', () => {
  let app: ReturnType<typeof makeApp>['app']
  let vehicleId: string

  beforeEach(async () => {
    const ctx = makeApp()
    app = ctx.app
    // A real vehicle owned by TEST_OPERATOR_ID, so an admitted operator clears
    // ownership too and the ONLY 403 source left is the role gate under test.
    const v = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput())
    vehicleId = v.id
  })

  async function call(route: WriteRoute, role: UserRole, operatorId?: string): Promise<number> {
    const auth = await authHeaders(
      operatorId ? { sub: `u-${role}`, role, operatorId } : { sub: `u-${role}`, role },
    )
    // Operators act within their own tenant; the default PLATFORM_ADMIN reader
    // would need ?operatorId=, but these callers are already tenant-bound.
    const init: RequestInit =
      route.method === 'DELETE'
        ? { method: route.method, headers: auth }
        : route.multipart
          ? { method: route.method, headers: auth, body: new FormData() }
          : {
              method: route.method,
              headers: { ...auth, 'content-type': 'application/json' },
              body: '{}',
            }
    const res = await app.request(route.path(vehicleId), init)
    return res.status
  }

  for (const route of WRITE_ROUTES) {
    for (const role of FLEET_WRITE_ONLY_ROLES) {
      it(`admits ${role} to ${route.name} (not 401/403)`, async () => {
        const status = await call(route, role, TEST_OPERATOR_ID)
        expect(status).not.toBe(403)
        expect(status).not.toBe(401)
      })
    }

    it(`forbids RENTER from ${route.name} (403)`, async () => {
      const status = await call(route, 'RENTER')
      expect(status).toBe(403)
    })
  }
})
