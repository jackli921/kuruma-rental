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
        body: JSON.stringify({ photos: ['https://example.com/new1.jpg', 'https://example.com/new2.jpg'] }),
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data.photos).toEqual(['https://example.com/new1.jpg', 'https://example.com/new2.jpg'])
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
