import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { createVehicleRoutes } from '../../src/routes/vehicles'

let app: Hono

function validVehicleInput() {
  return {
    name: 'Toyota Corolla',
    seats: 5,
    transmission: 'AUTO' as const,
    bufferMinutes: 60,
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
    app = new Hono()
    app.route('/', createVehicleRoutes(repo))
  })

  describe('GET /vehicles', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/vehicles')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({ success: true, data: [] })
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

    it('returns all vehicles when no status filter is provided', async () => {
      await createVehicle()
      const createRes = await createVehicle({
        ...validVehicleInput(),
        name: 'Retired Car',
      })
      const created = await createRes.json()

      // Soft-delete the second vehicle to make it RETIRED
      await app.request(`/vehicles/${created.data.id}`, { method: 'DELETE' })

      const res = await app.request('/vehicles')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.data.map((v: { name: string }) => v.name)).toEqual([
        'Toyota Corolla',
        'Retired Car',
      ])
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
      expect(body.data.bufferMinutes).toBe(60)
      expect(body.data.status).toBe('AVAILABLE')
      expect(body.data.description).toBeNull()
      expect(body.data.fuelType).toBeNull()
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
  })

  describe('PATCH /vehicles/:id/status (issue #51)', () => {
    async function patchStatus(id: string, status: string) {
      return app.request(`/vehicles/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    }

    it('flips AVAILABLE → MAINTENANCE and returns the updated vehicle', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      const res = await patchStatus(created.data.id, 'MAINTENANCE')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('MAINTENANCE')
      expect(body.data.id).toBe(created.data.id)
    })

    it('round-trips MAINTENANCE → AVAILABLE', async () => {
      const createRes = await createVehicle()
      const created = await createRes.json()

      await patchStatus(created.data.id, 'MAINTENANCE')
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
      const res = await patchStatus(created.data.id, 'MAINTENANCE')
      const body = await res.json()

      expect(new Date(body.data.updatedAt).getTime()).toBeGreaterThan(
        new Date(before).getTime(),
      )
    })

    it('returns 404 for nonexistent vehicle', async () => {
      const res = await patchStatus('nonexistent-id', 'MAINTENANCE')

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

      await patchStatus(created.data.id, 'MAINTENANCE')

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
})
