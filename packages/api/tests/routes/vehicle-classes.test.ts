import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createVehicleClassRoutes } from '../../src/routes/vehicle-classes'
import { VehicleClassService } from '../../src/services/vehicle-class'
import { VehicleClassAvailabilityService } from '../../src/services/vehicle-class-availability'
import { testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'
import { TEST_OPERATOR_ID, testResolveWriteOperatorId } from '../helpers/operator'

function buildAvailabilityService(classRepo: InMemoryVehicleClassRepository) {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  return new VehicleClassAvailabilityService(classRepo, vehicleRepo, availabilityRepo)
}

let app: Hono
let classRepo: InMemoryVehicleClassRepository
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository

function makeService() {
  return new VehicleClassService(classRepo, vehicleRepo, bookingRepo)
}

function validInput() {
  return {
    // #407: a STAFF/ADMIN create must name its target operator explicitly now
    // that sole-operator inference is retired (mirrors the web admin picker).
    operatorId: TEST_OPERATOR_ID,
    name: 'Compact',
    slug: 'compact',
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO' as const,
  }
}

async function createClass(input = validInput()) {
  return app.request('/vehicle-classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

describe('Vehicle Class CRUD Routes', () => {
  beforeEach(() => {
    classRepo = new InMemoryVehicleClassRepository()
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    const availabilityService = buildAvailabilityService(classRepo)
    app = new Hono()
    app.use('*', testAuthMiddleware('staff-user', 'STAFF'))
    app.route(
      '/',
      createVehicleClassRoutes(makeService(), availabilityService, testResolveWriteOperatorId()),
    )
  })

  describe('GET /vehicle-classes', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/vehicle-classes')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual([])
    })

    it('returns created classes', async () => {
      await createClass()
      await createClass({ ...validInput(), name: 'SUV', slug: 'suv' })
      const res = await app.request('/vehicle-classes')
      const body = await res.json()
      expect(body.data).toHaveLength(2)
    })

    it('excludes archived classes by default', async () => {
      const createRes = await createClass()
      const { data } = await createRes.json()
      await app.request(`/vehicle-classes/${data.id}`, { method: 'DELETE' })
      const res = await app.request('/vehicle-classes')
      const body = await res.json()
      expect(body.data).toHaveLength(0)
    })
  })

  describe('GET /vehicle-classes/manage (operator owner list, #528)', () => {
    const OP_A = 'operator-aaaaaaaa'
    const OP_B = 'operator-bbbbbbbb'

    function mountFor(repo: InMemoryVehicleClassRepository, role: UserRole, operatorId?: string) {
      const vRepo = new InMemoryVehicleRepository()
      const bRepo = new InMemoryBookingRepository()
      const service = new VehicleClassService(repo, vRepo, bRepo)
      const availabilityService = buildAvailabilityService(repo)
      const a = new Hono()
      setupGlobalHandlers(a)
      a.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
      a.route(
        '/',
        createVehicleClassRoutes(service, availabilityService, testResolveWriteOperatorId()),
      )
      return a
    }

    async function postFor(target: Hono, operatorId: string, slug: string) {
      return target.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validInput(), operatorId, slug }),
      })
    }

    it('includes archived classes when includeArchived=true (the public GET cannot)', async () => {
      const createRes = await createClass()
      const { data } = await createRes.json()
      await app.request(`/vehicle-classes/${data.id}`, { method: 'DELETE' }) // soft-archive

      const res = await app.request('/vehicle-classes/manage?includeArchived=true')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].status).toBe('ARCHIVED')
    })

    it('excludes archived classes by default', async () => {
      const createRes = await createClass()
      const { data } = await createRes.json()
      await app.request(`/vehicle-classes/${data.id}`, { method: 'DELETE' })

      const res = await app.request('/vehicle-classes/manage')
      const body = await res.json()
      expect(body.data).toEqual([])
    })

    it('scopes the list to the caller operator (tenant isolation)', async () => {
      const repo = new InMemoryVehicleClassRepository()
      const staff = mountFor(repo, 'STAFF')
      await postFor(staff, OP_A, 'a-compact')
      await postFor(staff, OP_B, 'b-compact')

      const ownerA = mountFor(repo, 'OPERATOR_OWNER', OP_A)
      const res = await ownerA.request('/vehicle-classes/manage')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].operatorId).toBe(OP_A)
    })
  })

  describe('POST /vehicle-classes', () => {
    it('creates with 201 and returns the class', async () => {
      const res = await createClass()
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.name).toBe('Compact')
      expect(body.data.slug).toBe('compact')
      expect(body.data.seats).toBe(5)
      expect(body.data.id).toBeDefined()
    })

    it('defaults photos to empty array and sortOrder to 0', async () => {
      const res = await createClass()
      const { data } = await res.json()
      expect(data.photos).toEqual([])
      expect(data.sortOrder).toBe(0)
    })

    it('rejects missing required fields', async () => {
      const res = await app.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects duplicate slug with 409', async () => {
      await createClass()
      const res = await createClass()
      expect(res.status).toBe(409)
    })

    it('creates a class without any rate fields (#406 — pricing is vehicle-level)', async () => {
      const res = await createClass({ ...validInput(), slug: 'no-rate' })
      expect(res.status).toBe(201)
      const { data } = await res.json()
      expect(data.slug).toBe('no-rate')
      expect('dailyRateJpy' in data).toBe(false)
      expect('hourlyRateJpy' in data).toBe(false)
    })
  })

  describe('ACRISS code (#388)', () => {
    it('persists acrissCode on create and returns it', async () => {
      const res = await createClass({ ...validInput(), acrissCode: 'CCAR' })
      expect(res.status).toBe(201)
      const { data } = await res.json()
      expect(data.acrissCode).toBe('CCAR')
    })

    it('normalises a lowercase acrissCode to upper-case on create', async () => {
      const res = await createClass({ ...validInput(), slug: 'lc', acrissCode: 'ccar' })
      const { data } = await res.json()
      expect(data.acrissCode).toBe('CCAR')
    })

    it('rejects a malformed acrissCode on create with 400', async () => {
      const res = await createClass({ ...validInput(), slug: 'bad', acrissCode: 'CCARX' })
      expect(res.status).toBe(400)
    })

    it('updates acrissCode via PATCH', async () => {
      const { data: created } = await (await createClass()).json()
      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acrissCode: 'icar' }),
      })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.acrissCode).toBe('ICAR')
    })

    it('nullifies acrissCode via PATCH', async () => {
      const { data: created } = await (
        await createClass({ ...validInput(), acrissCode: 'CCAR' })
      ).json()
      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acrissCode: null }),
      })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.acrissCode).toBeNull()
    })

    it('a PATCH carrying operatorId cannot move the class to another operator', async () => {
      // operatorId is not on the update schema, so the validator strips it.
      // The class keeps its original operator even when a PATCH smuggles one in.
      const { data: created } = await (await createClass()).json()
      const originalOperatorId = created.operatorId
      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorId: 'op_someone_else', name: 'Renamed' }),
      })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.name).toBe('Renamed')
      expect(data.operatorId).toBe(originalOperatorId)
    })

    it('a name-only PATCH preserves existing photos and sortOrder (issue #430)', async () => {
      // Regression: .partial() kept the base .default()s, so a name-only patch
      // parsed as { name, photos: [], sortOrder: 0 } and wiped both columns.
      const photos = ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']
      const { data: created } = await (
        await createClass({ ...validInput(), photos, sortOrder: 9 })
      ).json()
      expect(created.photos).toEqual(photos)
      expect(created.sortOrder).toBe(9)

      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.name).toBe('Renamed')
      expect(data.photos).toEqual(photos)
      expect(data.sortOrder).toBe(9)
    })
  })

  describe('GET /vehicle-classes/:id', () => {
    it('returns the class by ID', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`)
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.slug).toBe('compact')
    })

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/vehicle-classes/nonexistent-id')
      expect(res.status).toBe(404)
    })
  })

  describe('GET /vehicle-classes/by-slug/:slug', () => {
    it('returns the class by slug', async () => {
      await createClass()
      const res = await app.request('/vehicle-classes/by-slug/compact')
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.name).toBe('Compact')
    })

    it('returns 404 for nonexistent slug', async () => {
      const res = await app.request('/vehicle-classes/by-slug/nonexistent')
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /vehicle-classes/:id', () => {
    it('updates fields', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Economy' }),
      })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.name).toBe('Economy')
      expect(data.slug).toBe('compact')
    })

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/vehicle-classes/missing-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 409 for slug collision', async () => {
      await createClass()
      const res2 = await createClass({ ...validInput(), name: 'SUV', slug: 'suv' })
      const { data: suv } = await res2.json()
      const res = await app.request(`/vehicle-classes/${suv.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'compact' }),
      })
      expect(res.status).toBe(409)
    })

    it('accepts a patch with no rate fields — no "at least one rate" gate (#406)', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.name).toBe('Renamed')
    })
  })

  describe('DELETE /vehicle-classes/:id', () => {
    async function makeVehicle(classId: string) {
      return vehicleRepo.create(SYSTEM_CONTEXT, {
        classId,
        name: 'Test Car',
        description: null,
        photos: [],
        seats: 5,
        transmission: 'AUTO',
        fuelType: null,
        licensePlate: null,
        status: 'AVAILABLE',
        bufferMinutes: 0,
        minRentalHours: null,
        maxRentalHours: null,
        advanceBookingHours: null,
        make: null,
        model: null,
        year: null,
        color: null,
        dailyRateJpy: 5000,
        hourlyRateJpy: null,
        shakenExpiryDate: null,
        insuranceExpiryDate: null,
      })
    }

    async function makeBooking(
      vehicleId: string,
      status: 'CONFIRMED' | 'ACTIVE' | 'CANCELLED' | 'COMPLETED',
    ) {
      return bookingRepo.create(
        SYSTEM_CONTEXT,
        bookingInput({
          renterId: 'user-1',
          // #392: archive-blocking keys on the ASSIGNED vehicle; point the
          // fixture at the class member so countActiveForVehicles matches.
          assignedVehicleId: vehicleId,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T14:00:00Z'),
          status,
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
        }),
      )
    }

    it('archives the class when no vehicles or bookings exist', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.status).toBe('ARCHIVED')
    })

    it('archives the class when member vehicles have no active bookings', async () => {
      const { data: created } = await (await createClass()).json()
      await makeVehicle(created.id)
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('returns 409 with CLASS_HAS_ACTIVE_BOOKINGS when a member has a CONFIRMED booking', async () => {
      const { data: created } = await (await createClass()).json()
      const v = await makeVehicle(created.id)
      await makeBooking(v.id, 'CONFIRMED')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.code).toBe('CLASS_HAS_ACTIVE_BOOKINGS')
      expect(body.activeBookingsCount).toBe(1)
    })

    it('returns 409 when a member has an ACTIVE booking', async () => {
      const { data: created } = await (await createClass()).json()
      const v = await makeVehicle(created.id)
      await makeBooking(v.id, 'ACTIVE')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
    })

    it('allows archive when bookings are CANCELLED or COMPLETED', async () => {
      const { data: created } = await (await createClass()).json()
      const v = await makeVehicle(created.id)
      await makeBooking(v.id, 'CANCELLED')
      await makeBooking(v.id, 'COMPLETED')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('counts bookings across multiple member vehicles', async () => {
      const { data: created } = await (await createClass()).json()
      const v1 = await makeVehicle(created.id)
      const v2 = await makeVehicle(created.id)
      await makeBooking(v1.id, 'CONFIRMED')
      await makeBooking(v2.id, 'ACTIVE')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.activeBookingsCount).toBe(2)
    })

    it('blocks archive when a RETIRED member vehicle has an active booking', async () => {
      // A retired car can still have a future CONFIRMED booking — the owner
      // retired the vehicle but hasn't cancelled/reassigned the booking yet.
      // Archiving the class before that is resolved would leave an orphan.
      const { data: created } = await (await createClass()).json()
      const v = await makeVehicle(created.id)
      await makeBooking(v.id, 'CONFIRMED')
      await vehicleRepo.softDelete(SYSTEM_CONTEXT, v.id)
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.activeBookingsCount).toBe(1)
    })

    it('ignores active bookings on vehicles in a different class', async () => {
      const { data: created } = await (await createClass()).json()
      const other = await (await createClass({ ...validInput(), slug: 'suv', name: 'SUV' })).json()
      const v = await makeVehicle(other.data.id)
      await makeBooking(v.id, 'CONFIRMED')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/vehicle-classes/missing', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })

  describe('Authorization', () => {
    it('RENTER can GET vehicle classes', async () => {
      const renterApp = new Hono()
      const localClassRepo = new InMemoryVehicleClassRepository()
      const localVehicleRepo = new InMemoryVehicleRepository()
      const localBookingRepo = new InMemoryBookingRepository()
      const service = new VehicleClassService(localClassRepo, localVehicleRepo, localBookingRepo)
      const availabilityService = buildAvailabilityService(localClassRepo)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route(
        '/',
        createVehicleClassRoutes(service, availabilityService, testResolveWriteOperatorId()),
      )
      const res = await renterApp.request('/vehicle-classes')
      expect(res.status).toBe(200)
    })

    it('RENTER gets 403 on POST', async () => {
      const renterApp = new Hono()
      const localClassRepo = new InMemoryVehicleClassRepository()
      const localVehicleRepo = new InMemoryVehicleRepository()
      const localBookingRepo = new InMemoryBookingRepository()
      const service = new VehicleClassService(localClassRepo, localVehicleRepo, localBookingRepo)
      const availabilityService = buildAvailabilityService(localClassRepo)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route(
        '/',
        createVehicleClassRoutes(service, availabilityService, testResolveWriteOperatorId()),
      )
      const res = await renterApp.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validInput()),
      })
      expect(res.status).toBe(403)
    })
  })

  describe('Cache-Control on public catalog GETs', () => {
    it('sets public, s-maxage=60 on GET /vehicle-classes', async () => {
      const res = await app.request('/vehicle-classes')
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=60')
    })

    it('sets public, s-maxage=60 on GET /vehicle-classes/by-slug/:slug', async () => {
      await createClass()
      const res = await app.request('/vehicle-classes/by-slug/compact')
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=60')
    })

    it('does NOT set public cache on 404 by-slug — negative responses would pin missing slugs at the edge', async () => {
      const res = await app.request('/vehicle-classes/by-slug/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.headers.get('Cache-Control')).toBeNull()
    })

    it('sets a shorter s-maxage=10 on /:slug/availability — time-range queries change faster', async () => {
      await createClass()
      const res = await app.request(
        '/vehicle-classes/compact/availability?from=2026-05-01T00:00:00Z&to=2026-05-02T00:00:00Z',
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=10')
    })

    it('does NOT set cache on writes — PATCH has no Cache-Control (must not be cached at the edge)', async () => {
      const createRes = await createClass()
      const { data } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBeNull()
    })
  })

  // #397: operators must manage their OWN classes. Route gate widens from
  // STAFF_ROLES to FLEET_WRITE_ROLES; tenant isolation stays enforced by the
  // service's caller-scoped findById (other-tenant edits -> 404).
  describe('Operator write-scope (#397)', () => {
    const OP_A = 'operator-aaaaaaaa'
    const OP_B = 'operator-bbbbbbbb'

    function mountFor(repo: InMemoryVehicleClassRepository, role: UserRole, operatorId?: string) {
      const vRepo = new InMemoryVehicleRepository()
      const bRepo = new InMemoryBookingRepository()
      const service = new VehicleClassService(repo, vRepo, bRepo)
      const availabilityService = buildAvailabilityService(repo)
      const a = new Hono()
      setupGlobalHandlers(a)
      a.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
      a.route(
        '/',
        createVehicleClassRoutes(service, availabilityService, testResolveWriteOperatorId()),
      )
      return a
    }

    async function post(app: Hono, input = validInput()) {
      return app.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    }

    it('lets an OPERATOR_OWNER create a class stamped with its own operatorId', async () => {
      const repo = new InMemoryVehicleClassRepository()
      const res = await post(mountFor(repo, 'OPERATOR_OWNER', OP_A))

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.data.operatorId).toBe(OP_A)
      expect(body.data.name).toBe('Compact')
    })

    it('lets an OPERATOR_STAFF create a class', async () => {
      const repo = new InMemoryVehicleClassRepository()
      const res = await post(mountFor(repo, 'OPERATOR_STAFF', OP_A))

      expect(res.status).toBe(201)
      expect((await res.json()).data.operatorId).toBe(OP_A)
    })

    it('lets an OPERATOR_OWNER update its own class', async () => {
      const repo = new InMemoryVehicleClassRepository()
      const ownerApp = mountFor(repo, 'OPERATOR_OWNER', OP_A)
      const created = await (await post(ownerApp)).json()

      const res = await ownerApp.request(`/vehicle-classes/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed by owner' }),
      })

      expect(res.status).toBe(200)
      expect((await res.json()).data.name).toBe('Renamed by owner')
    })

    it("returns 404 when an OPERATOR_OWNER mutates another operator's class", async () => {
      const repo = new InMemoryVehicleClassRepository()
      const created = await (await post(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
      const intruder = mountFor(repo, 'OPERATOR_OWNER', OP_B)

      const patch = await intruder.request(`/vehicle-classes/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hijacked' }),
      })
      expect(patch.status).toBe(404)

      const del = await intruder.request(`/vehicle-classes/${created.data.id}`, {
        method: 'DELETE',
      })
      expect(del.status).toBe(404)
    })

    it('returns 403 (fail-closed) for an OPERATOR_OWNER missing its operatorId', async () => {
      const repo = new InMemoryVehicleClassRepository()
      const res = await post(mountFor(repo, 'OPERATOR_OWNER'))

      expect(res.status).toBe(403)
    })
  })
})
