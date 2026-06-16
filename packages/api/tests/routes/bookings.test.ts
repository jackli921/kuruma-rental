import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAddOnRepository,
  InMemoryAvailabilityRepository,
  InMemoryBookingEventRepository,
  InMemoryBookingRepository,
  InMemoryClassRatePlanRepository,
  InMemoryFeeScheduleRepository,
  InMemoryInsuranceOptionRepository,
  InMemoryLocationRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryUserRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { RunInTransaction, TransactionRepos } from '../../src/repositories/types'
import { createBookingRoutes } from '../../src/routes/bookings'
import { BookingService } from '../../src/services/booking'
import type { Location, User, Vehicle, VehicleClass } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'

// Slice 6 (#392): a renter books a CONCRETE vehicle chosen in the storefront
// (slice 5). operatorId / classId / assignedVehicleId / pickup turnaround /
// totalPrice are all server-derived from that vehicle — there is no class-only
// booking anymore. The route maps the reshaped validator output to the service's
// CreateBookingInput and the service runs the whole submit in one transaction.

let app: Hono
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let bookingEventRepo: InMemoryBookingEventRepository
let userRepo: InMemoryUserRepository
let vehicleClassRepo: InMemoryVehicleClassRepository
let locationRepo: InMemoryLocationRepository
let insuranceOptionRepo: InMemoryInsuranceOptionRepository
let addOnRepo: InMemoryAddOnRepository
let feeScheduleRepo: InMemoryFeeScheduleRepository
let service: BookingService
let testClassId: string
let locationId: string
let seededVehicleId: string
let seededVehicle2Id: string

const USER1 = '00000000-0000-4000-8000-0000000000a1'
const USER2 = '00000000-0000-4000-8000-0000000000a2'
const OPERATOR = '00000000-0000-4000-8000-0000000000c1'
const OP_USER = '00000000-0000-4000-8000-0000000000d1'

function futureDate(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString()
}

// A concrete-vehicle booking input. Anchor both timestamps to a single `now`
// so the duration is exactly 24h — two Date.now() calls can differ by a few ms,
// which Math.ceil() in pricing rounds up to 2 days.
function validBookingInput(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  const HOUR = 60 * 60 * 1000
  return {
    requestedVehicleId: seededVehicleId,
    pickupLocationId: locationId,
    dropoffLocationId: locationId,
    startAt: new Date(now + 24 * HOUR).toISOString(),
    endAt: new Date(now + 48 * HOUR).toISOString(),
    source: 'DIRECT' as const,
    // #613: a valid renter submit accepts the liability disclaimer at checkout.
    disclaimerAccepted: true,
    ...overrides,
  }
}

async function createBooking(input: Record<string, unknown> = validBookingInput()) {
  return app.request('/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

function vehicleData(
  overrides: Partial<Vehicle> = {},
): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: OPERATOR,
    classId: testClassId,
    pickupLocationId: locationId,
    name: 'Aqua',
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
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...overrides,
  }
}

describe('Booking Routes', () => {
  beforeEach(async () => {
    const userStore = new Map<string, User>()
    userStore.set(USER1, {
      id: USER1,
      name: 'Test Renter',
      email: 'renter@example.com',
      phone: null,
      language: 'en',
      country: null,
      role: 'RENTER',
    })
    userStore.set(USER2, {
      id: USER2,
      name: 'Second Renter',
      email: 'renter2@example.com',
      phone: null,
      language: 'ja',
      country: null,
      role: 'RENTER',
    })
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    bookingEventRepo = new InMemoryBookingEventRepository()
    userRepo = new InMemoryUserRepository(userStore)
    vehicleClassRepo = new InMemoryVehicleClassRepository()
    locationRepo = new InMemoryLocationRepository()
    insuranceOptionRepo = new InMemoryInsuranceOptionRepository()
    addOnRepo = new InMemoryAddOnRepository()
    feeScheduleRepo = new InMemoryFeeScheduleRepository()

    const klass: VehicleClass = await vehicleClassRepo.create({
      operatorId: OPERATOR,
      name: 'Compact',
      slug: 'compact',
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      // Non-null ACRISS code: substitution's same-class check compares codes.
      acrissCode: 'ECMR',
      sortOrder: 0,
      status: 'ACTIVE',
    })
    testClassId = klass.id

    const location = await locationRepo.create({
      operatorId: OPERATOR,
      name: 'Osaka Namba',
      address: '1-2-3 Namba',
      operatingHours: null,
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes: 2880,
      status: 'ACTIVE',
    } as Omit<Location, 'id' | 'createdAt' | 'updatedAt'>)
    locationId = location.id

    // Two concrete vehicles in the same class / operator / pickup location so
    // tests can exercise per-vehicle conflict, expand projection, substitution.
    const v1 = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleData({ name: 'Aqua 01' }))
    const v2 = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleData({ name: 'Aqua 02' }))
    seededVehicleId = v1.id
    seededVehicle2Id = v2.id

    const repos: TransactionRepos = {
      vehicleRepo,
      maintenanceLogRepo: new InMemoryMaintenanceLogRepository(),
      bookingRepo,
      bookingEventRepo,
      locationRepo,
      insuranceOptionRepo,
      addOnRepo,
      feeScheduleRepo,
      availabilityRepo: new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo),
      classRatePlanRepo: new InMemoryClassRatePlanRepository(),
      acquireClassCapacityLock: async () => {},
    }
    const runInTransaction: RunInTransaction = async (fn) => fn(repos)

    service = new BookingService(
      bookingRepo,
      runInTransaction,
      vehicleRepo,
      userRepo,
      vehicleClassRepo,
    )
    app = new Hono()
    // PLATFORM_ADMIN with USER1 identity — mirrors pre-auth test data.
    app.use('*', testAuthMiddleware(USER1, 'PLATFORM_ADMIN'))
    app.route('/', createBookingRoutes(service))
  })

  describe('GET /bookings', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/bookings')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({ success: true, data: [], nextCursor: null })
    })

    it('returns created bookings', async () => {
      await createBooking()
      await createBooking(validBookingInput({ requestedVehicleId: seededVehicle2Id }))

      const res = await app.request('/bookings')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
    })

    it('filters by status', async () => {
      await createBooking()

      const res = await app.request('/bookings?status=CONFIRMED')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].status).toBe('CONFIRMED')
    })

    it('filters by status returning empty when no match', async () => {
      await createBooking()

      const res = await app.request('/bookings?status=ACTIVE')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })

    it('filters by vehicleId (the assigned vehicle)', async () => {
      await createBooking()
      await createBooking(validBookingInput({ requestedVehicleId: seededVehicle2Id }))

      const res = await app.request(`/bookings?vehicleId=${seededVehicleId}`)
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].assignedVehicleId).toBe(seededVehicleId)
    })

    it('filters by renterId', async () => {
      // Create one booking via route (gets USER1 from JWT context)
      await createBooking()
      // Seed a second booking directly for USER2 (bypasses JWT).
      await bookingRepo.create(
        SYSTEM_CONTEXT,
        bookingInput({
          operatorId: OPERATOR,
          classId: testClassId,
          renterId: USER2,
          requestedVehicleId: seededVehicle2Id,
          assignedVehicleId: seededVehicle2Id,
          pickupLocationId: locationId,
          dropoffLocationId: locationId,
        }),
      )

      const res = await app.request(`/bookings?renterId=${USER1}`)
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].renterId).toBe(USER1)
    })

    it('filters by renterId returning empty when no match', async () => {
      await createBooking()

      const res = await app.request('/bookings?renterId=nonexistent')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })

    it('RENTER only sees own bookings, not other users', async () => {
      // USER1 creates a booking (default app user)
      await createBooking()

      // USER2 creates a booking via a separate app instance, on a 2nd vehicle.
      const app2 = new Hono()
      app2.use('*', testAuthMiddleware(USER2, 'ADMIN'))
      app2.route('/', createBookingRoutes(service))
      await app2.request('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBookingInput({ requestedVehicleId: seededVehicle2Id })),
      })

      // Query as RENTER — should only see own bookings.
      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware(USER1, 'RENTER'))
      renterApp.route('/', createBookingRoutes(service))

      const res = await renterApp.request('/bookings')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].renterId).toBe(USER1)
    })

    it('filters by date range returning bookings that overlap', async () => {
      await createBooking()

      const from = futureDate(30)
      const to = futureDate(60)
      const res = await app.request(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
    })

    it('filters by date range excluding non-overlapping bookings', async () => {
      await createBooking()

      // Query range far past this booking's window AND its turnaround tail.
      const from = futureDate(200)
      const to = futureDate(224)
      const res = await app.request(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })

    it('combines date range with status filter', async () => {
      await createBooking()
      await createBooking(validBookingInput({ requestedVehicleId: seededVehicle2Id }))

      // Cancel one
      const listRes = await app.request('/bookings')
      const allBookings = await listRes.json()
      await app.request(`/bookings/${allBookings.data[0].id}/cancel`, { method: 'POST' })

      const from = futureDate(20)
      const to = futureDate(50)
      const res = await app.request(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=CONFIRMED`,
      )
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].status).toBe('CONFIRMED')
    })

    it('returns 400 when from is provided without to', async () => {
      const res = await app.request(`/bookings?from=${encodeURIComponent(futureDate(1))}`)
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error).toContain('"to"')
    })

    it('returns 400 for invalid date strings', async () => {
      const res = await app.request('/bookings?from=not-a-date&to=also-bad')
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error).toContain('valid ISO dates')
    })

    it('returns 400 when to is before from', async () => {
      const from = futureDate(48)
      const to = futureDate(24)
      const res = await app.request(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error).toContain('"to" must be after "from"')
    })

    it('returns bookings with vehicle data when expand=vehicle', async () => {
      const corolla = await vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleData({
          name: 'Toyota Corolla',
          description: 'A reliable sedan',
          photos: ['photo1.jpg', 'photo2.jpg'],
          fuelType: 'Gasoline',
          dailyRateJpy: 10000,
        }),
      )

      await createBooking(validBookingInput({ requestedVehicleId: corolla.id }))

      const res = await app.request('/bookings?expand=vehicle')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].vehicle).toBeDefined()
      expect(body.data[0].vehicle.name).toBe('Toyota Corolla')
      expect(body.data[0].vehicle.photos).toEqual(['photo1.jpg', 'photo2.jpg'])
    })

    it('returns bookings without vehicle data when expand is not set', async () => {
      await createBooking()

      const res = await app.request('/bookings')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].vehicle).toBeUndefined()
    })

    it('returns bookings with renter data when expand=renter', async () => {
      await createBooking()

      const res = await app.request('/bookings?expand=renter')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].renter).toEqual({
        id: USER1,
        name: 'Test Renter',
        email: 'renter@example.com',
        language: 'en',
      })
    })

    it('returns bookings without renter data when expand is not set', async () => {
      await createBooking()

      const res = await app.request('/bookings')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].renter).toBeUndefined()
    })

    it('returns correct renter for each booking when expand=renter', async () => {
      // Create via route (renterId comes from JWT = USER1)
      await createBooking()
      // Seed directly for USER2 on a 2nd vehicle.
      await bookingRepo.create(
        SYSTEM_CONTEXT,
        bookingInput({
          operatorId: OPERATOR,
          classId: testClassId,
          renterId: USER2,
          requestedVehicleId: seededVehicle2Id,
          assignedVehicleId: seededVehicle2Id,
          pickupLocationId: locationId,
          dropoffLocationId: locationId,
        }),
      )

      const res = await app.request('/bookings?expand=renter')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)

      const byRenter = new Map(body.data.map((b: { renterId: string }) => [b.renterId, b]))
      expect(byRenter.get(USER1).renter.name).toBe('Test Renter')
      expect(byRenter.get(USER2).renter.name).toBe('Second Renter')
      expect(byRenter.get(USER2).renter.language).toBe('ja')
    })

    it('returns bookings with both vehicle and renter data when expand=vehicle,renter', async () => {
      const corolla = await vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleData({ name: 'Toyota Corolla', photos: ['c1.jpg'] }),
      )
      await createBooking(validBookingInput({ requestedVehicleId: corolla.id }))

      const res = await app.request('/bookings?expand=vehicle,renter')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].vehicle).toEqual({ name: 'Toyota Corolla', photos: ['c1.jpg'] })
      expect(body.data[0].renter).toEqual({
        id: USER1,
        name: 'Test Renter',
        email: 'renter@example.com',
        language: 'en',
      })
    })
  })

  describe('GET /bookings — cursor pagination', () => {
    // Each booking is on the SAME vehicle but in a non-overlapping window
    // (100h apart > 48h window + 48h turnaround) so none conflict.
    async function createNBookings(n: number) {
      const ids: string[] = []
      for (let i = 0; i < n; i++) {
        const res = await app.request('/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            validBookingInput({
              startAt: futureDate(24 + i * 100),
              endAt: futureDate(48 + i * 100),
            }),
          ),
        })
        const body = await res.json()
        ids.push(body.data.id)
      }
      return ids
    }

    it('returns at most limit items and a nextCursor when more exist', async () => {
      await createNBookings(5)

      const res = await app.request('/bookings?limit=2')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.nextCursor).toBeDefined()
      expect(typeof body.nextCursor).toBe('string')
    })

    it('returns nextCursor null when no more results', async () => {
      await createNBookings(2)

      const res = await app.request('/bookings?limit=10')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.nextCursor).toBeNull()
    })

    it('pages through all results using nextCursor', async () => {
      await createNBookings(5)

      const res1 = await app.request('/bookings?limit=2')
      const body1 = await res1.json()
      expect(body1.data).toHaveLength(2)
      expect(body1.nextCursor).toBeDefined()

      const res2 = await app.request(`/bookings?limit=2&cursor=${body1.nextCursor}`)
      const body2 = await res2.json()
      expect(body2.data).toHaveLength(2)
      expect(body2.nextCursor).toBeDefined()

      const res3 = await app.request(`/bookings?limit=2&cursor=${body2.nextCursor}`)
      const body3 = await res3.json()
      expect(body3.data).toHaveLength(1)
      expect(body3.nextCursor).toBeNull()

      const allIds = [
        ...body1.data.map((b: { id: string }) => b.id),
        ...body2.data.map((b: { id: string }) => b.id),
        ...body3.data.map((b: { id: string }) => b.id),
      ]
      expect(new Set(allIds).size).toBe(5)
    })

    it('combines pagination with status filter', async () => {
      await createNBookings(3)
      const allRes = await app.request('/bookings')
      const allBody = await allRes.json()
      const firstId = allBody.data[0].id
      await app.request(`/bookings/${firstId}/cancel`, { method: 'POST' })

      const res = await app.request('/bookings?status=CONFIRMED&limit=10')
      const body = await res.json()

      expect(body.data).toHaveLength(2)
      expect(body.data.every((b: { status: string }) => b.status === 'CONFIRMED')).toBe(true)
      expect(body.nextCursor).toBeNull()
    })

    it('defaults to 20 items when no limit specified', async () => {
      const res = await app.request('/bookings')
      const body = await res.json()

      expect(body.nextCursor).toBeNull()
    })

    it('rejects limit > 100', async () => {
      const res = await app.request('/bookings?limit=200')
      expect(res.status).toBe(400)
    })

    it('rejects limit < 1', async () => {
      const res = await app.request('/bookings?limit=0')
      expect(res.status).toBe(400)
    })
  })

  describe('POST /bookings', () => {
    it('creates a booking for a concrete vehicle: 201, server-derived fields, CONFIRMED', async () => {
      const res = await createBooking(validBookingInput())

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.data.requestedVehicleId).toBe(seededVehicleId)
      expect(body.data.assignedVehicleId).toBe(seededVehicleId) // server-derived = requested
      expect(body.data.classId).toBe(testClassId)
      expect(body.data.operatorId).toBe(OPERATOR)
      expect(body.data.status).toBe('CONFIRMED')
      // Priced off the vehicle (8000/day x 1 day), non-null on submit (#429).
      expect(body.data.totalPrice).toBe(8000)
      expect(typeof body.data.bookingCode).toBe('string')
      expect(body.data.bookingCode.length).toBeGreaterThan(0)
    })

    // #464 slice 1: the validator accepts the CLASS_COMBO contract, but combo
    // creation (inventory guard + rate-plan pricing) lands in slice 2. Until then
    // the route rejects it explicitly rather than silently mis-handling a car-less
    // body — proving the discriminator is wired end-to-end through the route.
    it('rejects a CLASS_COMBO booking with 501 NOT_IMPLEMENTED (slice 1)', async () => {
      const { requestedVehicleId: _drop, ...rest } = validBookingInput()
      const res = await createBooking({
        ...rest,
        fulfillmentMode: 'CLASS_COMBO',
        classId: testClassId,
      })

      expect(res.status).toBe(501)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.code).toBe('NOT_IMPLEMENTED')
    })

    // #613 consent gate keys on RENTER role; the default test app authenticates
    // as ADMIN (staff), so these mount a renter-authed app over the same service.
    function renterRequest(input: Record<string, unknown>) {
      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware(USER1, 'RENTER'))
      renterApp.route('/', createBookingRoutes(service))
      return renterApp.request('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    }

    it('rejects a renter booking without disclaimer consent: 400 CONSENT_REQUIRED (#613)', async () => {
      const res = await renterRequest(validBookingInput({ disclaimerAccepted: false }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.code).toBe('CONSENT_REQUIRED')
      expect(body.error).toMatch(/disclaimer/i)
    })

    it('stamps the consent (acknowledgedAt + terms version) on an accepted renter booking (#613)', async () => {
      const res = await renterRequest(validBookingInput())

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.data.disclaimerTermsVersion).toBe('2026-06-13')
      // Server-stamped timestamp, not a client value — present and ISO-parseable.
      expect(typeof body.data.disclaimerAcknowledgedAt).toBe('string')
      expect(Number.isNaN(Date.parse(body.data.disclaimerAcknowledgedAt))).toBe(false)
    })

    it('exempts a staff/admin booking from the consent gate; leaves stamps null (#613)', async () => {
      // Default app is ADMIN: a manual booking needs no renter consent and the
      // disclaimer columns stay null (no renter acknowledgement was captured).
      const res = await createBooking(validBookingInput({ disclaimerAccepted: false }))

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.data.disclaimerAcknowledgedAt).toBeNull()
      expect(body.data.disclaimerTermsVersion).toBeNull()
    })

    it('rejects an unknown requestedVehicleId with 400', async () => {
      const res = await createBooking(
        validBookingInput({ requestedVehicleId: '00000000-0000-4000-8000-0000000000fe' }),
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/vehicle not found/i)
    })

    it('rejects a booking on a non-AVAILABLE vehicle with 400', async () => {
      const maintenance = await vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleData({ name: 'In Shop', status: 'MAINTENANCE' }),
      )
      const res = await createBooking(validBookingInput({ requestedVehicleId: maintenance.id }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/not available/i)
    })

    it('rejects a pickup location that is not the vehicle’s storefront with 400 (#392)', async () => {
      // Same operator, different location — a forged body must not book a car
      // away from where it lives.
      const other = await locationRepo.create({
        operatorId: OPERATOR,
        name: 'Umeda Annex',
        address: '9-9-9 Umeda',
        operatingHours: null,
        timezone: 'Asia/Tokyo',
        defaultTurnaroundMinutes: 1440,
        status: 'ACTIVE',
      } as Omit<Location, 'id' | 'createdAt' | 'updatedAt'>)

      const res = await createBooking(
        validBookingInput({ pickupLocationId: other.id, dropoffLocationId: other.id }),
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/pickup location does not match/i)
    })

    it('creates a booking with valid input and returns 201 with status CONFIRMED', async () => {
      const res = await createBooking(validBookingInput())

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.assignedVehicleId).toBe(seededVehicleId)
      expect(body.data.renterId).toBe(USER1)
      expect(body.data.status).toBe('CONFIRMED')
      expect(body.data.source).toBe('DIRECT')
      expect(body.data.externalId).toBeNull()
      expect(body.data.notes).toBeNull()
      expect(body.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(body.data.createdAt).toBeDefined()
      expect(body.data.updatedAt).toBeDefined()
    })

    it('rejects input missing requestedVehicleId and returns 400', async () => {
      const res = await app.request('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickupLocationId: locationId,
          dropoffLocationId: locationId,
          startAt: futureDate(24),
          endAt: futureDate(48),
        }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBeDefined()
    })

    it('rejects non-UUID requestedVehicleId with 400', async () => {
      const res = await createBooking(validBookingInput({ requestedVehicleId: 'not-a-uuid' }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error.requestedVehicleId[0]).toContain('UUID')
    })

    it('rejects invalid status string in PATCH /bookings/:id/status', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'BANANA' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('rejects endAt before startAt and returns 400', async () => {
      const res = await createBooking(
        validBookingInput({ startAt: futureDate(48), endAt: futureDate(24) }),
      )

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 409 when the new booking overlaps an existing CONFIRMED booking on the same vehicle', async () => {
      const first = await createBooking(validBookingInput())
      expect(first.status).toBe(201)

      const second = await createBooking(
        validBookingInput({ startAt: futureDate(36), endAt: futureDate(60) }),
      )

      expect(second.status).toBe(409)

      const body = await second.json()
      expect(body.success).toBe(false)
      expect(body.error).toMatch(/already booked/i)
    })

    it('allows overlapping booking on a different vehicle', async () => {
      const first = await createBooking(validBookingInput())
      expect(first.status).toBe(201)

      const res = await createBooking(validBookingInput({ requestedVehicleId: seededVehicle2Id }))
      expect(res.status).toBe(201)
    })

    it('allows a new booking once the conflicting one is CANCELLED', async () => {
      const first = await createBooking(validBookingInput())
      const created = await first.json()

      await app.request(`/bookings/${created.data.id}/cancel`, { method: 'POST' })

      const res = await createBooking(validBookingInput())
      expect(res.status).toBe(201)
    })

    // Issue #65: per-vehicle rental rules. Shared helper logic is unit-tested
    // in packages/shared/tests/lib/rental-rules.test.ts — these tests verify
    // the API route wires the helper correctly and returns the structured
    // error envelope the web client depends on.
    describe('rental rules enforcement', () => {
      async function seedVehicleWithRules(rules: {
        minRentalHours?: number | null
        maxRentalHours?: number | null
        advanceBookingHours?: number | null
      }) {
        const vehicle = await vehicleRepo.create(
          SYSTEM_CONTEXT,
          vehicleData({
            name: 'Toyota Alphard',
            seats: 7,
            fuelType: 'Hybrid',
            minRentalHours: rules.minRentalHours ?? null,
            maxRentalHours: rules.maxRentalHours ?? null,
            advanceBookingHours: rules.advanceBookingHours ?? null,
            dailyRateJpy: 18000,
            hourlyRateJpy: 2500,
          }),
        )
        return vehicle.id
      }

      it('rejects a 2h booking on a vehicle with min 6h', async () => {
        const vehicleId = await seedVehicleWithRules({ minRentalHours: 6 })

        const res = await createBooking(
          validBookingInput({
            requestedVehicleId: vehicleId,
            startAt: futureDate(48),
            endAt: futureDate(50),
          }),
        )

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.success).toBe(false)
        expect(body.code).toBe('RENTAL_RULE_MIN_DURATION')
        expect(body.details).toMatchObject({ required: 6 })
      })

      it('rejects a 100h booking on a vehicle with max 72h', async () => {
        const vehicleId = await seedVehicleWithRules({ maxRentalHours: 72 })

        const res = await createBooking(
          validBookingInput({
            requestedVehicleId: vehicleId,
            startAt: futureDate(48),
            endAt: futureDate(148),
          }),
        )

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.success).toBe(false)
        expect(body.code).toBe('RENTAL_RULE_MAX_DURATION')
        expect(body.details).toMatchObject({ required: 72 })
      })

      it('rejects a same-day booking on a vehicle requiring 24h advance', async () => {
        const vehicleId = await seedVehicleWithRules({ advanceBookingHours: 24 })

        const res = await createBooking(
          validBookingInput({
            requestedVehicleId: vehicleId,
            startAt: futureDate(2),
            endAt: futureDate(26),
          }),
        )

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.success).toBe(false)
        expect(body.code).toBe('RENTAL_RULE_ADVANCE_BOOKING')
        expect(body.details).toMatchObject({ required: 24 })
      })

      it('accepts a compliant booking on a vehicle with all three rules', async () => {
        const vehicleId = await seedVehicleWithRules({
          minRentalHours: 6,
          maxRentalHours: 240,
          advanceBookingHours: 24,
        })

        const res = await createBooking(
          validBookingInput({
            requestedVehicleId: vehicleId,
            startAt: futureDate(48),
            endAt: futureDate(96),
          }),
        )

        expect(res.status).toBe(201)
      })

      it('accepts a booking on a vehicle with no rules set', async () => {
        const vehicleId = await seedVehicleWithRules({})

        const res = await createBooking(
          validBookingInput({
            requestedVehicleId: vehicleId,
            startAt: futureDate(2),
            endAt: futureDate(3),
          }),
        )

        expect(res.status).toBe(201)
      })
    })

    describe('idempotency key', () => {
      it('returns 200 with the same booking when duplicate key is sent', async () => {
        const idempotencyKey = crypto.randomUUID()
        const input = validBookingInput({ idempotencyKey })

        const first = await createBooking(input)
        expect(first.status).toBe(201)
        const firstBody = await first.json()

        const second = await createBooking(input)
        expect(second.status).toBe(200)
        const secondBody = await second.json()

        expect(secondBody.data.id).toBe(firstBody.data.id)
      })

      it('creates distinct bookings when different keys are sent', async () => {
        const first = await createBooking(
          validBookingInput({
            idempotencyKey: crypto.randomUUID(),
            requestedVehicleId: seededVehicleId,
          }),
        )
        expect(first.status).toBe(201)
        const firstBody = await first.json()

        const second = await createBooking(
          validBookingInput({
            idempotencyKey: crypto.randomUUID(),
            requestedVehicleId: seededVehicle2Id,
          }),
        )
        expect(second.status).toBe(201)
        const secondBody = await second.json()

        expect(secondBody.data.id).not.toBe(firstBody.data.id)
      })

      it('creates booking without idempotency key for backward compatibility', async () => {
        const res = await createBooking(validBookingInput())
        expect(res.status).toBe(201)

        const body = await res.json()
        expect(body.data.idempotencyKey).toBeNull()
      })

      it('returns 200 when concurrent duplicate key hits unique constraint', async () => {
        const idempotencyKey = crypto.randomUUID()
        const input = validBookingInput({ idempotencyKey })

        // Simulate race: both requests pass findByIdempotencyKey check,
        // then both attempt create. Second one hits the unique constraint.
        const [r1, r2] = await Promise.all([
          createBooking(input),
          createBooking({ ...input, requestedVehicleId: seededVehicle2Id }),
        ])

        const statuses = [r1.status, r2.status].sort()
        expect(statuses).toEqual([200, 201])

        const b1 = await r1.json()
        const b2 = await r2.json()
        expect(b1.data.id).toBe(b2.data.id)
      })
    })

    // Issue #74: server-side pricing. Clients must not be able to propose a
    // totalPrice — the route always computes it from the vehicle's rates.
    describe('server-side pricing', () => {
      it('ignores client-supplied totalPrice and persists server calculation', async () => {
        // Vehicle: 10,000 JPY/day. 24h booking → server computes 10,000.
        const vehicleId = (
          await vehicleRepo.create(
            SYSTEM_CONTEXT,
            vehicleData({ name: 'Priced', dailyRateJpy: 10000 }),
          )
        ).id

        const res = await createBooking(
          // Use validBookingInput's single-`now` anchored 24h window. Overriding
          // with two separate futureDate() calls reintroduces the few-ms gap that
          // Math.ceil() in pricing rounds up to 2 days (see the helper comment).
          validBookingInput({
            requestedVehicleId: vehicleId,
            totalPrice: 1, // attacker-controlled — must be stripped + ignored
          }),
        )

        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.success).toBe(true)
        expect(body.data.totalPrice).toBe(10000)
      })
    })
  })

  describe('GET /bookings/:id', () => {
    it('returns a specific booking', async () => {
      const createRes = await createBooking(validBookingInput())
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}`)

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe(created.data.id)
      expect(body.data.assignedVehicleId).toBe(seededVehicleId)
    })

    it('returns 404 for a valid-but-nonexistent booking id', async () => {
      const res = await app.request('/bookings/00000000-0000-4000-8000-00000000bbbb')

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Booking not found')
    })

    it('returns 400 for a malformed (non-uuid) booking id', async () => {
      const res = await app.request('/bookings/nonexistent-id')

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('id must be a valid uuid')
    })
  })

  describe('PATCH /bookings/:id/status', () => {
    it('transitions CONFIRMED to ACTIVE', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('ACTIVE')
      expect(body.data.id).toBe(created.data.id)
    })

    it('rejects invalid transition CONFIRMED to COMPLETED', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('Invalid status transition')
    })

    it('rejects transition from terminal state CANCELLED', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      await app.request(`/bookings/${created.data.id}/cancel`, { method: 'POST' })

      const res = await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('Invalid status transition')
    })

    it('returns 404 for nonexistent booking', async () => {
      const res = await app.request('/bookings/00000000-0000-4000-8000-00000000bbbb/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Booking not found')
    })

    it('forbids a RENTER from advancing status on their own booking (403, #643)', async () => {
      // Booking is owned by USER1 (the renter), so row-scoping admits the call —
      // a 403 can therefore only come from the function-level role gate, not from
      // ownership. Pickup/return (CONFIRMED -> ACTIVE -> COMPLETED) are physical
      // operator events; a renter must not self-advance via the raw API.
      const created = await (await createBooking()).json()

      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware(USER1, 'RENTER'))
      renterApp.route('/', createBookingRoutes(service))

      const res = await renterApp.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.success).toBe(false)

      // The transition must not have been applied — proves the gate blocks the
      // action, not just the response code.
      const after = await (await app.request(`/bookings/${created.data.id}`)).json()
      expect(after.data.status).toBe('CONFIRMED')
    })
  })

  describe('POST /bookings/:id/cancel', () => {
    it('cancels a CONFIRMED booking', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/cancel`, { method: 'POST' })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('CANCELLED')
      expect(body.data.id).toBe(created.data.id)
    })

    it('rejects cancelling an already COMPLETED booking with 409', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })
      await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })

      const res = await app.request(`/bookings/${created.data.id}/cancel`, { method: 'POST' })

      expect(res.status).toBe(409)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('Only CONFIRMED bookings can be cancelled')
    })

    it('returns 404 for nonexistent booking', async () => {
      const res = await app.request('/bookings/00000000-0000-4000-8000-00000000bbbb/cancel', {
        method: 'POST',
      })

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Booking not found')
    })

    // Cancellation fee tiers. The vehicle's 10,000 JPY/day rate gives the 24h
    // booking a deterministic 10,000 totalPrice. Anchor `now` once per test:
    // separate futureDate() calls drift a few ms and Math.ceil(hours/24) rounds
    // a 24h+ε duration up to 2 days, doubling totalPrice and derived fees.
    function bookingWindow(startHours: number, endHours: number) {
      const now = Date.now()
      const HOUR = 60 * 60 * 1000
      return {
        startAt: new Date(now + startHours * HOUR).toISOString(),
        endAt: new Date(now + endHours * HOUR).toISOString(),
      }
    }
    async function seedPricedVehicle() {
      const vehicle = await vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleData({ name: 'Priced Vehicle', dailyRateJpy: 10000 }),
      )
      return vehicle.id
    }

    it('returns FREE tier and 0 fee when cancelling 72h+ before pickup', async () => {
      const vehicleId = await seedPricedVehicle()
      const createRes = await createBooking(
        validBookingInput({ requestedVehicleId: vehicleId, ...bookingWindow(96, 120) }),
      )
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/cancel`, { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.status).toBe('CANCELLED')
      expect(body.data.cancellationFee).toBe(0)
      // JSON-serialized over the wire → ISO-8601 timestamp string, not a Date.
      expect(body.data.cancelledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(body.cancellation.tier).toBe('FREE')
      expect(body.cancellation.feePercentage).toBe(0)
      expect(body.cancellation.refundAmount).toBe(10000)
    })

    it('returns LOW tier and 30% fee when cancelling 48-72h before pickup', async () => {
      const vehicleId = await seedPricedVehicle()
      const createRes = await createBooking(
        validBookingInput({ requestedVehicleId: vehicleId, ...bookingWindow(60, 84) }),
      )
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/cancel`, { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.cancellationFee).toBe(3000)
      expect(body.cancellation.tier).toBe('LOW')
      expect(body.cancellation.feePercentage).toBe(0.3)
    })

    it('returns FULL tier and 100% fee when cancelling < 24h before pickup', async () => {
      const vehicleId = await seedPricedVehicle()
      const createRes = await createBooking(
        validBookingInput({ requestedVehicleId: vehicleId, ...bookingWindow(12, 36) }),
      )
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/cancel`, { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.cancellationFee).toBe(10000)
      expect(body.cancellation.tier).toBe('FULL')
      expect(body.cancellation.feePercentage).toBe(1)
      expect(body.cancellation.refundAmount).toBe(0)
    })
  })

  describe('POST /bookings/:id/substitute', () => {
    // An OPERATOR_OWNER app scoped to the booking's operator tenant.
    function operatorApp() {
      const opApp = new Hono()
      opApp.use('*', testAuthMiddleware(OP_USER, 'OPERATOR_OWNER', OPERATOR))
      opApp.route('/', createBookingRoutes(service))
      return opApp
    }

    it('forbids a renter from substituting (403)', async () => {
      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware(USER1, 'RENTER'))
      renterApp.route('/', createBookingRoutes(service))

      const res = await renterApp.request(`/bookings/${crypto.randomUUID()}/substitute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVehicleId: seededVehicle2Id }),
      })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 404 when an operator substitutes a nonexistent booking', async () => {
      const res = await operatorApp().request(`/bookings/${crypto.randomUUID()}/substitute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVehicleId: seededVehicle2Id }),
      })

      expect(res.status).toBe(404)
    })

    it('reassigns the vehicle (200) and preserves the renter-requested vehicle', async () => {
      const createRes = await createBooking(validBookingInput())
      const created = await createRes.json()

      const res = await operatorApp().request(`/bookings/${created.data.id}/substitute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVehicleId: seededVehicle2Id, reason: 'Original in shop' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.assignedVehicleId).toBe(seededVehicle2Id)
      // Audit trail keeps the renter's original choice.
      expect(body.data.requestedVehicleId).toBe(seededVehicleId)
    })

    it('rejects a non-UUID newVehicleId with 400', async () => {
      const createRes = await createBooking(validBookingInput())
      const created = await createRes.json()

      const res = await operatorApp().request(`/bookings/${created.data.id}/substitute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVehicleId: 'not-a-uuid' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })
  })

  // #647: the booking-write authorization model as an executable table. Each row
  // is one (role, route) -> outcome cell of the policy documented in
  // docs/architecture/booking-authz.md: status advance is management-wide
  // (operators + platform staff/admin); substitution and its candidate feed are
  // operator-only (choosing which car serves a booking is a fleet-ownership
  // decision). The matrix is the single source for the asymmetry — a future
  // change that "aligns" the gates turns exactly the offending row red.
  describe('booking-write authorization model (#647)', () => {
    function operatorApp() {
      const a = new Hono()
      a.use('*', testAuthMiddleware(OP_USER, 'OPERATOR_OWNER', OPERATOR))
      a.route('/', createBookingRoutes(service))
      return a
    }
    function renterApp() {
      const a = new Hono()
      a.use('*', testAuthMiddleware(USER1, 'RENTER'))
      a.route('/', createBookingRoutes(service))
      return a
    }
    async function freshBookingId(): Promise<string> {
      const res = await createBooking(validBookingInput())
      const body = await res.json()
      return body.data.id as string
    }

    // `gate` is the authorization outcome only: 'deny' MUST 403 at the route gate
    // before any business logic; 'allow' MUST pass the gate (any non-403 — the
    // 200/400/404 business result is covered by the dedicated route tests above).
    // Coupling an authz assertion to vehicle-availability would make the policy
    // test brittle, so we assert the gate decision, nothing more.
    const MODEL: ReadonlyArray<{
      label: string
      app: () => Hono
      method: string
      path: (id: string) => string
      body?: Record<string, unknown>
      gate: 'allow' | 'deny'
    }> = [
      // PATCH /status — management-wide (operators + platform staff/admin)
      {
        label: 'ADMIN (management) is allowed status advance',
        app: () => app,
        method: 'PATCH',
        path: (id) => `/bookings/${id}/status`,
        body: { status: 'ACTIVE' },
        gate: 'allow',
      },
      {
        label: 'OPERATOR is allowed status advance',
        app: operatorApp,
        method: 'PATCH',
        path: (id) => `/bookings/${id}/status`,
        body: { status: 'ACTIVE' },
        gate: 'allow',
      },
      {
        label: 'RENTER is denied status advance on own booking',
        app: renterApp,
        method: 'PATCH',
        path: (id) => `/bookings/${id}/status`,
        body: { status: 'ACTIVE' },
        gate: 'deny',
      },
      // POST /substitute — operator-only (fleet-ownership decision)
      {
        label: 'ADMIN (management) is denied substitute',
        app: () => app,
        method: 'POST',
        path: (id) => `/bookings/${id}/substitute`,
        body: { newVehicleId: seededVehicle2Id },
        gate: 'deny',
      },
      {
        label: 'OPERATOR is allowed substitute',
        app: operatorApp,
        method: 'POST',
        path: (id) => `/bookings/${id}/substitute`,
        body: { newVehicleId: seededVehicle2Id },
        gate: 'allow',
      },
      {
        label: 'RENTER is denied substitute',
        app: renterApp,
        method: 'POST',
        path: (id) => `/bookings/${id}/substitute`,
        body: { newVehicleId: seededVehicle2Id },
        gate: 'deny',
      },
      // GET /substitution-candidates — operator-only (inherits substitute's gate)
      {
        label: 'ADMIN (management) is denied candidate list',
        app: () => app,
        method: 'GET',
        path: (id) => `/bookings/${id}/substitution-candidates`,
        gate: 'deny',
      },
      {
        label: 'OPERATOR is allowed candidate list',
        app: operatorApp,
        method: 'GET',
        path: (id) => `/bookings/${id}/substitution-candidates`,
        gate: 'allow',
      },
      {
        label: 'RENTER is denied candidate list',
        app: renterApp,
        method: 'GET',
        path: (id) => `/bookings/${id}/substitution-candidates`,
        gate: 'deny',
      },
    ]

    it.each(MODEL)('$label ($gate)', async ({ app: makeApp, method, path, body, gate }) => {
      const id = await freshBookingId()
      const res = await makeApp().request(path(id), {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (gate === 'deny') {
        expect(res.status).toBe(403)
      } else {
        expect(res.status).not.toBe(403)
      }
    })
  })

  describe('GET /bookings/:id/substitution-candidates', () => {
    // An OPERATOR_OWNER app scoped to the booking's operator tenant.
    function operatorApp() {
      const opApp = new Hono()
      opApp.use('*', testAuthMiddleware(OP_USER, 'OPERATOR_OWNER', OPERATOR))
      opApp.route('/', createBookingRoutes(service))
      return opApp
    }

    // A CONFIRMED booking assigned to v1 (seededVehicleId); its only same-class
    // same-location AVAILABLE peer is v2 (seededVehicle2Id).
    async function bookingOnV1(): Promise<string> {
      const createRes = await createBooking(validBookingInput())
      const created = await createRes.json()
      return created.data.id as string
    }

    function candidateIds(body: { data: Array<{ id: string }> }): string[] {
      return body.data.map((v) => v.id)
    }

    it('forbids a renter (403)', async () => {
      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware(USER1, 'RENTER'))
      renterApp.route('/', createBookingRoutes(service))

      const res = await renterApp.request(
        `/bookings/${crypto.randomUUID()}/substitution-candidates`,
      )

      expect(res.status).toBe(403)
      expect((await res.json()).success).toBe(false)
    })

    it('returns 404 for a nonexistent / cross-tenant booking', async () => {
      const res = await operatorApp().request(
        `/bookings/${crypto.randomUUID()}/substitution-candidates`,
      )

      expect(res.status).toBe(404)
    })

    it('lists same-store same-ACRISS AVAILABLE vehicles, excluding the assigned vehicle', async () => {
      const bookingId = await bookingOnV1()

      const res = await operatorApp().request(`/bookings/${bookingId}/substitution-candidates`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      // v2 only — the assigned v1 is excluded so the operator can't "substitute" the same car.
      expect(candidateIds(body)).toEqual([seededVehicle2Id])
    })

    it('excludes a vehicle at a different pickup location', async () => {
      const kyoto = await locationRepo.create({
        operatorId: OPERATOR,
        name: 'Kyoto',
        address: '9-9-9 Kyoto',
        operatingHours: null,
        timezone: 'Asia/Tokyo',
        defaultTurnaroundMinutes: 2880,
        status: 'ACTIVE',
      } as Omit<Location, 'id' | 'createdAt' | 'updatedAt'>)
      await vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleData({ name: 'Aqua Kyoto', pickupLocationId: kyoto.id }),
      )
      const bookingId = await bookingOnV1()

      const res = await operatorApp().request(`/bookings/${bookingId}/substitution-candidates`)
      const body = await res.json()

      expect(candidateIds(body)).toEqual([seededVehicle2Id])
    })

    it('excludes a vehicle of a different ACRISS class', async () => {
      const suvClass = await vehicleClassRepo.create({
        operatorId: OPERATOR,
        name: 'SUV',
        slug: 'suv',
        description: null,
        photos: [],
        seats: 7,
        luggageCapacity: 4,
        transmission: 'AUTO',
        fuelType: null,
        acrissCode: 'IFAR',
        sortOrder: 1,
        status: 'ACTIVE',
      })
      await vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleData({ name: 'Harrier', classId: suvClass.id }),
      )
      const bookingId = await bookingOnV1()

      const res = await operatorApp().request(`/bookings/${bookingId}/substitution-candidates`)
      const body = await res.json()

      expect(candidateIds(body)).toEqual([seededVehicle2Id])
    })

    it('excludes a non-AVAILABLE vehicle', async () => {
      await vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleData({ name: 'Aqua 03 (in shop)', status: 'MAINTENANCE' }),
      )
      const bookingId = await bookingOnV1()

      const res = await operatorApp().request(`/bookings/${bookingId}/substitution-candidates`)
      const body = await res.json()

      expect(candidateIds(body)).toEqual([seededVehicle2Id])
    })
  })
})
