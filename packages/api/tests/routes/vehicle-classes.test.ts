import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryVehicleClassRepository } from '../../src/repositories/in-memory'
import { createVehicleClassRoutes } from '../../src/routes/vehicle-classes'
import { VehicleClassService } from '../../src/services/vehicle-class'
import { testAuthMiddleware } from '../helpers/auth'

let app: Hono

function validInput() {
  return {
    name: 'Compact',
    slug: 'compact',
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO' as const,
    dailyRateJpy: 5500,
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
    const repo = new InMemoryVehicleClassRepository()
    const service = new VehicleClassService(repo)
    app = new Hono()
    app.use('*', testAuthMiddleware('staff-user', 'STAFF'))
    app.route('/', createVehicleClassRoutes(service))
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

    it('rejects when both rates missing', async () => {
      const res = await createClass({
        ...validInput(),
        slug: 'no-rate',
        dailyRateJpy: undefined as unknown as number,
      })
      expect(res.status).toBe(400)
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

    it('returns 400 when both rates nullified', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyRateJpy: null, hourlyRateJpy: null }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /vehicle-classes/:id', () => {
    it('archives the class', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.status).toBe('ARCHIVED')
    })

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/vehicle-classes/missing', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })

  describe('Authorization', () => {
    it('RENTER can GET vehicle classes', async () => {
      const renterApp = new Hono()
      const repo = new InMemoryVehicleClassRepository()
      const service = new VehicleClassService(repo)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route('/', createVehicleClassRoutes(service))
      const res = await renterApp.request('/vehicle-classes')
      expect(res.status).toBe(200)
    })

    it('RENTER gets 403 on POST', async () => {
      const renterApp = new Hono()
      const repo = new InMemoryVehicleClassRepository()
      const service = new VehicleClassService(repo)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route('/', createVehicleClassRoutes(service))
      const res = await renterApp.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validInput()),
      })
      expect(res.status).toBe(403)
    })
  })
})
