import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'
import type { Vehicle } from '../../src/stores'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

function vehicleInput(overrides?: Partial<Vehicle>) {
  return {
    name: 'Test Car',
    description: 'A test vehicle',
    photos: [] as string[],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'GASOLINE',
    status: 'AVAILABLE' as const,
    bufferMinutes: 60,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 24,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    ...overrides,
  }
}

function makeFormData(name: string, type: string, sizeBytes: number): FormData {
  const buffer = new ArrayBuffer(sizeBytes)
  const file = new File([buffer], name, { type })
  const form = new FormData()
  form.append('file', file)
  return form
}

function createTestApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const photoStorage = new InMemoryPhotoStorage()

  return {
    app: createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      photoStorage,
    }),
    vehicleRepo,
    photoStorage,
  }
}

describe('POST /vehicles/:id/photos', () => {
  let app: ReturnType<typeof createTestApp>['app']
  let vehicleRepo: InMemoryVehicleRepository
  let vehicleId: string

  beforeEach(async () => {
    const ctx = createTestApp()
    app = ctx.app
    vehicleRepo = ctx.vehicleRepo
    const v = await vehicleRepo.create(vehicleInput())
    vehicleId = v.id
  })

  it('uploads an image and appends URL to vehicle.photos', async () => {
    const headers = await authHeaders()
    const form = makeFormData('car.jpg', 'image/jpeg', 1024)

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.uploaded).toHaveLength(1)
    expect(body.data.uploaded[0]).toContain('vehicles/')

    const updated = await vehicleRepo.findById(vehicleId)
    expect(updated?.photos).toHaveLength(1)
  })

  it('rejects non-image MIME type with 400', async () => {
    const headers = await authHeaders()
    const form = makeFormData('doc.pdf', 'application/pdf', 1024)

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('image')
  })

  it('rejects file larger than 5MB with 400', async () => {
    const headers = await authHeaders()
    const form = makeFormData('huge.jpg', 'image/jpeg', 6 * 1024 * 1024)

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('5MB')
  })

  it('rejects when vehicle already has 10 photos', async () => {
    const photos = Array.from({ length: 10 }, (_, i) => `https://example.com/photo${i}.jpg`)
    await vehicleRepo.update(vehicleId, { photos })

    const headers = await authHeaders()
    const form = makeFormData('extra.jpg', 'image/jpeg', 1024)

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('10')
  })

  it('returns 404 for nonexistent vehicle', async () => {
    const headers = await authHeaders()
    const form = makeFormData('car.jpg', 'image/jpeg', 1024)

    const res = await app.request('/vehicles/nonexistent/photos', {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(404)
  })

  it('returns 403 for RENTER role', async () => {
    const headers = await authHeaders({ sub: 'renter-1', role: 'RENTER' })
    const form = makeFormData('car.jpg', 'image/jpeg', 1024)

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(403)
  })

  it('returns 401 without auth', async () => {
    const form = makeFormData('car.jpg', 'image/jpeg', 1024)

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      body: form,
    })

    expect(res.status).toBe(401)
  })
})

describe('DELETE /vehicles/:id/photos/:photoIdx', () => {
  let app: ReturnType<typeof createTestApp>['app']
  let vehicleRepo: InMemoryVehicleRepository
  let vehicleId: string

  beforeEach(async () => {
    const ctx = createTestApp()
    app = ctx.app
    vehicleRepo = ctx.vehicleRepo
    const v = await vehicleRepo.create(
      vehicleInput({ photos: ['https://test.com/a.jpg', 'https://test.com/b.jpg'] }),
    )
    vehicleId = v.id
  })

  it('deletes a photo by index', async () => {
    const headers = await authHeaders()

    const res = await app.request(`/vehicles/${vehicleId}/photos/0`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe('https://test.com/a.jpg')
    expect(body.data.remaining).toBe(1)

    const updated = await vehicleRepo.findById(vehicleId)
    expect(updated?.photos).toEqual(['https://test.com/b.jpg'])
  })

  it('returns 400 for out-of-range index', async () => {
    const headers = await authHeaders()

    const res = await app.request(`/vehicles/${vehicleId}/photos/5`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(400)
  })

  it('returns 400 for non-numeric index', async () => {
    const headers = await authHeaders()

    const res = await app.request(`/vehicles/${vehicleId}/photos/abc`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent vehicle', async () => {
    const headers = await authHeaders()

    const res = await app.request('/vehicles/nonexistent/photos/0', {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(404)
  })

  it('returns 403 for RENTER role', async () => {
    const headers = await authHeaders({ sub: 'renter-1', role: 'RENTER' })

    const res = await app.request(`/vehicles/${vehicleId}/photos/0`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(403)
  })
})
