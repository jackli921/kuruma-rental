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

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]

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

function imageBuffer(header: number[], totalSize: number): ArrayBuffer {
  const buf = new Uint8Array(totalSize)
  buf.set(header, 0)
  return buf.buffer
}

function makeFormData(
  name: string,
  type: string,
  sizeBytes: number,
  header: number[] = JPEG_HEADER,
): FormData {
  const file = new File([imageBuffer(header, sizeBytes)], name, { type })
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

  it('rejects SVG (XSS vector) with 400', async () => {
    const headers = await authHeaders()
    const form = makeFormData('icon.svg', 'image/svg+xml', 1024)

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(400)
  })

  it('rejects PNG bytes declared as image/jpeg (content-type spoofing)', async () => {
    const headers = await authHeaders()
    const form = makeFormData('spoof.jpg', 'image/jpeg', 1024, PNG_HEADER)

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('does not match declared Content-Type')
  })

  it('rejects non-image bytes declared as image/jpeg (magic-byte check)', async () => {
    const headers = await authHeaders()
    const form = makeFormData('fake.jpg', 'image/jpeg', 1024, [0x3c, 0x21, 0x44, 0x4f])

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('image format')
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

describe('concurrent upload race on photo cap', () => {
  it('serializes appends so cap cannot be exceeded', async () => {
    const ctx = createTestApp()
    const photos = Array.from({ length: 9 }, (_, i) => `https://example.com/photo${i}.jpg`)
    const v = await ctx.vehicleRepo.create(vehicleInput({ photos }))
    const headers = await authHeaders()

    // Three concurrent single-photo uploads against a vehicle with 9 existing.
    // Exactly one should succeed, two should 400.
    const responses = await Promise.all(
      [0, 1, 2].map(() =>
        ctx.app.request(`/vehicles/${v.id}/photos`, {
          method: 'POST',
          headers,
          body: makeFormData('extra.jpg', 'image/jpeg', 1024),
        }),
      ),
    )

    const statuses = responses.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 400, 400])

    const updated = await ctx.vehicleRepo.findById(v.id)
    expect(updated?.photos).toHaveLength(10)
  })
})

describe('upload → delete round-trip', () => {
  it('upload then delete by URL removes file from storage', async () => {
    const ctx = createTestApp()
    const vehicle = await ctx.vehicleRepo.create(vehicleInput())
    const headers = await authHeaders()

    const form = makeFormData('car.jpg', 'image/jpeg', 1024)
    const uploadRes = await ctx.app.request(`/vehicles/${vehicle.id}/photos`, {
      method: 'POST',
      headers,
      body: form,
    })
    expect(uploadRes.status).toBe(201)
    const uploaded: string = (await uploadRes.json()).data.uploaded[0]

    const deleteRes = await ctx.app.request(
      `/vehicles/${vehicle.id}/photos?url=${encodeURIComponent(uploaded)}`,
      { method: 'DELETE', headers },
    )
    expect(deleteRes.status).toBe(200)

    const updated = await ctx.vehicleRepo.findById(vehicle.id)
    expect(updated?.photos).toEqual([])
  })
})

describe('DELETE /vehicles/:id/photos?url=', () => {
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

  it('deletes a photo by URL', async () => {
    const headers = await authHeaders()

    const res = await app.request(
      `/vehicles/${vehicleId}/photos?url=${encodeURIComponent('https://test.com/a.jpg')}`,
      { method: 'DELETE', headers },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe('https://test.com/a.jpg')
    expect(body.data.remaining).toBe(1)

    const updated = await vehicleRepo.findById(vehicleId)
    expect(updated?.photos).toEqual(['https://test.com/b.jpg'])
  })

  it('returns 400 when url query is missing', async () => {
    const headers = await authHeaders()

    const res = await app.request(`/vehicles/${vehicleId}/photos`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(400)
  })

  it('returns 404 for URL not in vehicle.photos', async () => {
    const headers = await authHeaders()

    const res = await app.request(
      `/vehicles/${vehicleId}/photos?url=${encodeURIComponent('https://test.com/other.jpg')}`,
      { method: 'DELETE', headers },
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 for nonexistent vehicle', async () => {
    const headers = await authHeaders()

    const res = await app.request(
      `/vehicles/nonexistent/photos?url=${encodeURIComponent('https://test.com/a.jpg')}`,
      { method: 'DELETE', headers },
    )

    expect(res.status).toBe(404)
  })

  it('returns 403 for RENTER role', async () => {
    const headers = await authHeaders({ sub: 'renter-1', role: 'RENTER' })

    const res = await app.request(
      `/vehicles/${vehicleId}/photos?url=${encodeURIComponent('https://test.com/a.jpg')}`,
      { method: 'DELETE', headers },
    )

    expect(res.status).toBe(403)
  })
})
