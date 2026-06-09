import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { type UserRole, toCallerContext } from '../../src/middleware/auth'
import {
  InMemoryMaintenanceLogRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { RunInTransaction } from '../../src/repositories/types'
import { createVehicleRoutes } from '../../src/routes/vehicles'
import { MaintenanceService } from '../../src/services/maintenance'
import { testAuthMiddleware } from '../helpers/auth'
import { TEST_OPERATOR_ID, testResolveWriteOperatorId } from '../helpers/operator'

let app: Hono

function validVehicleInput() {
  return {
    // #407: a STAFF/ADMIN create must name its target operator explicitly now
    // that sole-operator inference is retired (mirrors the web admin picker).
    operatorId: TEST_OPERATOR_ID,
    name: 'Toyota Corolla',
    seats: 5,
    transmission: 'AUTO' as const,
    bufferMinutes: 60,
    licensePlate: null,
    // #48: at least one rate is required by the validator and the
    // vehicles_pricing_at_least_one DB CHECK.
    dailyRateJpy: 8000,
  }
}

async function createVehicle(input = validVehicleInput()) {
  return app.request('/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

describe('Vehicle CRUD Routes', () => {
  beforeEach(() => {
    const repo = new InMemoryVehicleRepository()
    const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
    const runInTransaction: RunInTransaction = async (fn) =>
      fn({ vehicleRepo: repo, maintenanceLogRepo })
    const maintenanceService = new MaintenanceService(repo, maintenanceLogRepo, runInTransaction)
    app = new Hono()
    app.use('*', testAuthMiddleware('staff-user', 'STAFF'))
    app.route('/', createVehicleRoutes(repo, maintenanceService, testResolveWriteOperatorId()))
  })

  describe('GET /vehicles', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/vehicles')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual([])
    })

    it('returns created vehicles', async () => {
      await createVehicle()
      await createVehicle({
        ...validVehicleInput(),
        name: 'Honda Civic',
      })

      const res = await app.request('/vehicles')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.data[0].name).toBe('Toyota Corolla')
      expect(body.data[1].name).toBe('Honda Civic')
    })

    it('excludes RETIRED vehicles by default', async () => {
      await createVehicle()
      const createRes = await createVehicle({
        ...validVehicleInput(),
        name: 'Retired Car',
      })
      const created = await createRes.json()

      await app.request(`/vehicles/${created.data.id}`, { method: 'DELETE' })

      const res = await app.request('/vehicles')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].name).toBe('Toyota Corolla')
    })

    it('returns RETIRED vehicles when filtered by status=RETIRED', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()
      await app.request(`/vehicles/${created.data.id}`, { method: 'DELETE' })

      const res = await app.request('/vehicles?status=RETIRED')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].status).toBe('RETIRED')
    })

    it('paginates with limit and offset', async () => {
      await createVehicle({ ...validVehicleInput(), name: 'Car A' })
      await createVehicle({ ...validVehicleInput(), name: 'Car B' })
      await createVehicle({ ...validVehicleInput(), name: 'Car C' })

      const res = await app.request('/vehicles?limit=2&offset=0')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.total).toBe(3)
      expect(body.limit).toBe(2)
      expect(body.offset).toBe(0)
    })

    it('returns second page with offset', async () => {
      await createVehicle({ ...validVehicleInput(), name: 'Car A' })
      await createVehicle({ ...validVehicleInput(), name: 'Car B' })
      await createVehicle({ ...validVehicleInput(), name: 'Car C' })

      const res = await app.request('/vehicles?limit=2&offset=2')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].name).toBe('Car C')
      expect(body.total).toBe(3)
    })

    it('filters by explicit status query param', async () => {
      await createVehicle()
      const createRes = await createVehicle({
        ...validVehicleInput(),
        name: 'Retired Car',
      })
      const created = await createRes.json()

      await app.request(`/vehicles/${created.data.id}`, { method: 'DELETE' })

      const res = await app.request('/vehicles?status=RETIRED')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].name).toBe('Retired Car')
      expect(body.data[0].status).toBe('RETIRED')
    })
  })

  describe('POST /vehicles', () => {
    it('creates a vehicle with valid input and returns 201', async () => {
      const res = await createVehicle()

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.name).toBe('Toyota Corolla')
      expect(body.data.seats).toBe(5)
      expect(body.data.transmission).toBe('AUTO')
      expect(body.data.status).toBe('AVAILABLE')
      expect(body.data.description).toBeNull()
      expect(body.data.fuelType).toBeNull()
      expect(body.data.licensePlate).toBeNull()
      expect(body.data.minRentalHours).toBeNull()
      expect(body.data.maxRentalHours).toBeNull()
      expect(body.data.advanceBookingHours).toBeNull()
      expect(body.data.dailyRateJpy).toBe(8000)
      expect(body.data.hourlyRateJpy).toBeNull()
      expect(body.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(body.data.createdAt).toBeDefined()
      expect(body.data.updatedAt).toBeDefined()
    })

    it('rejects invalid input with missing name and returns 400', async () => {
      const res = await app.request('/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seats: 5,
          transmission: 'AUTO',
        }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBeDefined()
    })

    it('creates a vehicle with photos and returns them', async () => {
      const photos = ['https://example.com/car1.jpg', 'https://example.com/car2.jpg']
      const res = await createVehicle({ ...validVehicleInput(), photos })

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.data.photos).toEqual(photos)
    })

    it('defaults photos to empty array when not provided', async () => {
      const res = await createVehicle()

      const body = await res.json()
      expect(body.data.photos).toEqual([])
    })

    it('rejects invalid transmission value', async () => {
      const res = await app.request('/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validVehicleInput(),
          transmission: 'CVT',
        }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('creates a vehicle with licensePlate', async () => {
      const res = await createVehicle({
        ...validVehicleInput(),
        licensePlate: '品川 500 あ 1234',
      })

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.licensePlate).toBe('品川 500 あ 1234')
    })

    it('defaults licensePlate to null when not provided', async () => {
      const { licensePlate: _, ...inputWithoutPlate } = validVehicleInput()
      const res = await createVehicle(inputWithoutPlate)

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.licensePlate).toBeNull()
    })
  })

  describe('GET /vehicles/:id', () => {
    it('returns a specific vehicle', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`)

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe(created.data.id)
      expect(body.data.name).toBe('Toyota Corolla')
    })

    it('returns 404 for nonexistent vehicle', async () => {
      const res = await app.request('/vehicles/nonexistent-id')

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Vehicle not found')
    })
  })

  describe('PATCH /vehicles/:id', () => {
    it('updates fields on an existing vehicle', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name', seats: 7 }),
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.name).toBe('Updated Name')
      expect(body.data.seats).toBe(7)
      // Unchanged fields preserved
      expect(body.data.transmission).toBe('AUTO')
    })

    it('a name-only PATCH preserves existing photos (issue #432)', async () => {
      // Regression: .partial() kept the base .default()s, so a name-only patch
      // parsed as { name, photos: [] } and wiped photos on write.
      const photos = ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']
      const createRes = await createVehicle({ ...validVehicleInput(), photos })
      const created = await createRes.json()
      expect(created.data.photos).toEqual(photos)

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.name).toBe('Renamed')
      expect(body.data.photos).toEqual(photos)
    })

    it('updates licensePlate via PATCH', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licensePlate: 'ABC-1234' }),
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.licensePlate).toBe('ABC-1234')
    })

    it('clears licensePlate to null via PATCH', async () => {
      const createRes = await createVehicle({
        ...validVehicleInput(),
        licensePlate: '品川 500 あ 1234',
      })
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licensePlate: null }),
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.licensePlate).toBeNull()
    })

    it('returns 404 for nonexistent vehicle', async () => {
      const res = await app.request('/vehicles/nonexistent-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      })

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Vehicle not found')
    })

    it('updates photos on an existing vehicle', async () => {
      const createRes = await createVehicle({
        ...validVehicleInput(),
        photos: ['https://example.com/old.jpg'],
      })
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photos: ['https://example.com/new1.jpg', 'https://example.com/new2.jpg'],
        }),
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data.photos).toEqual([
        'https://example.com/new1.jpg',
        'https://example.com/new2.jpg',
      ])
    })

    it('rejects update where minRentalHours exceeds maxRentalHours', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minRentalHours: 10, maxRentalHours: 5 }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error.maxRentalHours[0]).toContain('greater than or equal')
    })

    it('rejects PATCH with only minRentalHours exceeding existing maxRentalHours', async () => {
      const createRes = await createVehicle({
        ...validVehicleInput(),
        minRentalHours: 2,
        maxRentalHours: 10,
      })
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minRentalHours: 20 }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error.maxRentalHours[0]).toContain('greater than or equal')
    })

    it('accepts PATCH with only maxRentalHours still valid against existing min', async () => {
      const createRes = await createVehicle({
        ...validVehicleInput(),
        minRentalHours: 2,
        maxRentalHours: 10,
      })
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxRentalHours: 15 }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.maxRentalHours).toBe(15)
      expect(body.data.minRentalHours).toBe(2)
    })

    it('accepts PATCH with equal minRentalHours and maxRentalHours', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minRentalHours: 5, maxRentalHours: 5 }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.minRentalHours).toBe(5)
      expect(body.data.maxRentalHours).toBe(5)
    })

    it('rejects PATCH that nullifies the only rate on a vehicle', async () => {
      // Vehicle created with only dailyRateJpy — nullifying it leaves no rate.
      const createRes = await createVehicle({
        ...validVehicleInput(),
        dailyRateJpy: 8000,
        hourlyRateJpy: null,
      })
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyRateJpy: null }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toMatch(/rate/i)
    })

    it('allows nullifying one rate when the other remains set', async () => {
      const createRes = await createVehicle({
        ...validVehicleInput(),
        dailyRateJpy: 8000,
        hourlyRateJpy: 1200,
      })
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyRateJpy: null }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.dailyRateJpy).toBeNull()
      expect(body.data.hourlyRateJpy).toBe(1200)
    })

    it('rejects invalid update data', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seats: -5 }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
    })

    // #457: a per-vehicle luggage override is nullable. Submitting explicit null
    // must clear it (so the vehicle falls back to its class default); omitting the
    // keys must leave the override untouched.
    it('clears the luggage override when explicit null is sent', async () => {
      const createRes = await createVehicle({
        ...validVehicleInput(),
        luggageCapacity: 4,
        luggageSize: 'LARGE',
      })
      const created = await createRes.json()
      expect(created.data.luggageCapacity).toBe(4)
      expect(created.data.luggageSize).toBe('LARGE')

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ luggageCapacity: null, luggageSize: null }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.luggageCapacity).toBeNull()
      expect(body.data.luggageSize).toBeNull()
    })

    it('leaves the luggage override untouched when the keys are absent', async () => {
      const createRes = await createVehicle({
        ...validVehicleInput(),
        luggageCapacity: 3,
        luggageSize: 'MEDIUM',
      })
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Car' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.name).toBe('Renamed Car')
      expect(body.data.luggageCapacity).toBe(3)
      expect(body.data.luggageSize).toBe('MEDIUM')
    })
  })

  describe('PATCH /vehicles/:id/status (issue #51)', () => {
    async function patchStatus(id: string, status: string, reason?: string) {
      return app.request(`/vehicles/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(reason != null ? { reason } : {}) }),
      })
    }

    it('flips AVAILABLE → MAINTENANCE and returns the updated vehicle', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await patchStatus(created.data.id, 'MAINTENANCE', 'Scheduled service')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('MAINTENANCE')
      expect(body.data.id).toBe(created.data.id)
    })

    it('round-trips MAINTENANCE → AVAILABLE', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      await patchStatus(created.data.id, 'MAINTENANCE', 'Quick check')
      const res = await patchStatus(created.data.id, 'AVAILABLE')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.status).toBe('AVAILABLE')
    })

    it('allows un-retiring: RETIRED → AVAILABLE', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      await patchStatus(created.data.id, 'RETIRED')
      const res = await patchStatus(created.data.id, 'AVAILABLE')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.status).toBe('AVAILABLE')
    })

    it('advances updatedAt on a status change', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()
      const before = created.data.updatedAt

      // Ensure at least 1 ms delta so the InMemoryVehicleRepository
      // timestamp is guaranteed to advance on systems with 1 ms clock resolution.
      await new Promise((r) => setTimeout(r, 2))
      const res = await patchStatus(created.data.id, 'MAINTENANCE', 'Timing test')
      const body = await res.json()

      expect(new Date(body.data.updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime())
    })

    it('returns 404 for nonexistent vehicle', async () => {
      const res = await patchStatus('nonexistent-id', 'MAINTENANCE', 'Does not matter')

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Vehicle not found')
    })

    it('rejects unknown status with 400', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await patchStatus(created.data.id, 'BROKEN')

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('rejects missing status body with 400', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('does not touch fields other than status', async () => {
      const createRes = await createVehicle({
        ...validVehicleInput(),
        name: 'Keep Me',
        dailyRateJpy: 12345,
      })
      const created = await createRes.json()

      await patchStatus(created.data.id, 'MAINTENANCE', 'Field preservation test')

      const getRes = await app.request(`/vehicles/${created.data.id}`)
      const getBody = await getRes.json()
      expect(getBody.data.name).toBe('Keep Me')
      expect(getBody.data.dailyRateJpy).toBe(12345)
      expect(getBody.data.status).toBe('MAINTENANCE')
    })
  })

  describe('DELETE /vehicles/:id', () => {
    it('soft deletes by setting status to RETIRED', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await app.request(`/vehicles/${created.data.id}`, {
        method: 'DELETE',
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('RETIRED')

      // Verify via GET that the vehicle is now RETIRED
      const getRes = await app.request(`/vehicles/${created.data.id}`)
      const getBody = await getRes.json()
      expect(getBody.data.status).toBe('RETIRED')
    })

    it('returns 404 for nonexistent vehicle', async () => {
      const res = await app.request('/vehicles/nonexistent-id', {
        method: 'DELETE',
      })

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Vehicle not found')
    })
  })

  // Issue #329: the repo-layer ForbiddenError must surface as a 403 from
  // the global error handler, not a 500. This simulates a future route
  // that forgets its STAFF_ROLES gate by mounting a custom handler that
  // calls the repo directly with a RENTER ctx. Before the typed-error
  // mapping, this path would have returned 500 (Internal server error).
  describe('ForbiddenError → 403 mapping', () => {
    it('bypassed route-level gate still returns 403 from the repo guard', async () => {
      const repo = new InMemoryVehicleRepository()
      const renterApp = new Hono()
      setupGlobalHandlers(renterApp)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      // Simulate a route that forgot its STAFF_ROLES check: goes straight
      // to the repo with the caller's ctx. The repo guard must stop it.
      renterApp.post('/leaky-create', async (c) => {
        const ctx = toCallerContext({ id: 'renter-user', role: 'RENTER' })
        const vehicle = await repo.create(ctx, {
          classId: null,
          name: 'Leaked',
          description: null,
          photos: [],
          seats: 4,
          transmission: 'AUTO' as const,
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
        return c.json({ success: true, data: vehicle })
      })

      const res = await renterApp.request('/leaky-create', { method: 'POST' })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body).toEqual({ success: false, error: 'Forbidden' })
    })
  })

  // #397: tenant-scoped operators must be able to manage their OWN fleet.
  // The route gate was STAFF_ROLES (operators excluded -> 403 wall); it must
  // widen to FLEET_WRITE_ROLES. Tenant isolation is still enforced downstream
  // by the repo's operator predicate (other-tenant reads -> not found -> 404).
  describe('Operator write-scope (#397)', () => {
    const OP_A = 'operator-aaaaaaaa'
    const OP_B = 'operator-bbbbbbbb'

    function mountFor(
      repo: InMemoryVehicleRepository,
      role: UserRole,
      operatorId?: string,
      resolve = testResolveWriteOperatorId(),
    ) {
      const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
      const runInTransaction: RunInTransaction = async (fn) =>
        fn({ vehicleRepo: repo, maintenanceLogRepo })
      const maintenanceService = new MaintenanceService(repo, maintenanceLogRepo, runInTransaction)
      const a = new Hono()
      setupGlobalHandlers(a)
      a.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
      a.route('/', createVehicleRoutes(repo, maintenanceService, resolve))
      return a
    }

    async function post(app: Hono, input = validVehicleInput()) {
      return app.request('/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    }

    it('lets an OPERATOR_OWNER create a vehicle stamped with its own operatorId', async () => {
      const repo = new InMemoryVehicleRepository()
      const res = await post(mountFor(repo, 'OPERATOR_OWNER', OP_A))

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.operatorId).toBe(OP_A)
      expect(body.data.name).toBe('Toyota Corolla')
    })

    it('lets an OPERATOR_STAFF create a vehicle', async () => {
      const repo = new InMemoryVehicleRepository()
      const res = await post(mountFor(repo, 'OPERATOR_STAFF', OP_A))

      expect(res.status).toBe(201)
      expect((await res.json()).data.operatorId).toBe(OP_A)
    })

    it('lets an OPERATOR_OWNER update its own vehicle', async () => {
      const repo = new InMemoryVehicleRepository()
      const ownerApp = mountFor(repo, 'OPERATOR_OWNER', OP_A)
      const created = await (await post(ownerApp)).json()

      const res = await ownerApp.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed by owner' }),
      })

      expect(res.status).toBe(200)
      expect((await res.json()).data.name).toBe('Renamed by owner')
    })

    it("returns 404 when an OPERATOR_OWNER mutates another operator's vehicle", async () => {
      const repo = new InMemoryVehicleRepository()
      const created = await (await post(mountFor(repo, 'OPERATOR_OWNER', OP_A))).json()
      const intruder = mountFor(repo, 'OPERATOR_OWNER', OP_B)

      const patch = await intruder.request(`/vehicles/${created.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hijacked' }),
      })
      expect(patch.status).toBe(404)

      const del = await intruder.request(`/vehicles/${created.data.id}`, { method: 'DELETE' })
      expect(del.status).toBe(404)
    })

    it('returns 403 (fail-closed) for an OPERATOR_OWNER missing its operatorId', async () => {
      const repo = new InMemoryVehicleRepository()
      const res = await post(mountFor(repo, 'OPERATOR_OWNER'))

      expect(res.status).toBe(403)
    })
  })

  // #401/#407: a non-operator caller (PLATFORM_ADMIN / legacy STAFF / ADMIN) must
  // name the target operator explicitly. Sole-operator inference is retired, so a
  // create that omits operatorId is a 422 — there is no silent default.
  describe('Non-operator write-operator resolution (#401)', () => {
    const SOME_OPERATOR = 'op_explicit_target'

    function mountStaff(repo: InMemoryVehicleRepository, resolve = testResolveWriteOperatorId()) {
      const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
      const runInTransaction: RunInTransaction = async (fn) =>
        fn({ vehicleRepo: repo, maintenanceLogRepo })
      const maintenanceService = new MaintenanceService(repo, maintenanceLogRepo, runInTransaction)
      const a = new Hono()
      setupGlobalHandlers(a)
      a.use('*', testAuthMiddleware('staff-user', 'STAFF'))
      a.route('/', createVehicleRoutes(repo, maintenanceService, resolve))
      return a
    }

    function postVehicle(a: Hono, input: Record<string, unknown> = validVehicleInput()) {
      return a.request('/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    }

    it('rejects a STAFF create that omits operatorId, but stamps an explicit one (#407)', async () => {
      const repo = new InMemoryVehicleRepository()

      // Inference is retired: omitting operatorId is now a 422.
      // (JSON.stringify drops the undefined key, so the body truly omits it.)
      const omitted = await postVehicle(mountStaff(repo), {
        ...validVehicleInput(),
        operatorId: undefined,
      })
      expect(omitted.status).toBe(422)

      // An explicit operatorId is honoured and stamped on the created row.
      const stamped = await postVehicle(mountStaff(repo), {
        ...validVehicleInput(),
        operatorId: SOME_OPERATOR,
      })
      expect(stamped.status).toBe(201)
      expect((await stamped.json()).data.operatorId).toBe(SOME_OPERATOR)
    })

    it('honours an explicit operatorId in the body even when inference is ambiguous', async () => {
      const repo = new InMemoryVehicleRepository()
      const res = await postVehicle(mountStaff(repo, testResolveWriteOperatorId(null)), {
        ...validVehicleInput(),
        operatorId: SOME_OPERATOR,
      })

      expect(res.status).toBe(201)
      expect((await res.json()).data.operatorId).toBe(SOME_OPERATOR)
    })

    it('rejects with 422 when a non-operator create omits operatorId', async () => {
      const repo = new InMemoryVehicleRepository()
      const res = await postVehicle(mountStaff(repo), {
        ...validVehicleInput(),
        operatorId: undefined,
      })

      expect(res.status).toBe(422)
    })
  })
})
