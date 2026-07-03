import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { TEST_OPERATOR_ID } from '../helpers/operator'

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]

// #1260: the default caller is PLATFORM_ADMIN, so every photo write names the
// acting operator via ?operatorId=. All seeded vehicles are owned by
// TEST_OPERATOR_ID. The rate-limit buckets key on the path id + user id (not the
// query), so ?operatorId= leaves limiter behaviour unchanged.
const OP = `operatorId=${TEST_OPERATOR_ID}`

function vehicleInput(overrides?: { photos?: string[] }) {
  return {
    operatorId: TEST_OPERATOR_ID,
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

function jpegForm(): FormData {
  const buf = new Uint8Array(1024)
  buf.set(JPEG_HEADER, 0)
  const file = new File([buf.buffer], 'car.jpg', { type: 'image/jpeg' })
  const form = new FormData()
  form.append('file', file)
  return form
}

function createFakeLimiter(limit: number): RateLimitBinding {
  const counts = new Map<string, number>()
  return {
    async limit({ key }) {
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return { success: next <= limit }
    },
  }
}

function createTestApp(opts?: {
  photoUploadLimiter?: RateLimitBinding
  photoUploadUserLimiter?: RateLimitBinding
}) {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    new InMemoryOperatorRepository(),
  )
  const photoStorage = new InMemoryPhotoStorage()

  return {
    app: createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      photoStorage,
      photoUploadLimiter: opts?.photoUploadLimiter,
      photoUploadUserLimiter: opts?.photoUploadUserLimiter,
    }),
    vehicleRepo,
  }
}

describe('photo upload rate limiting', () => {
  it('returns 429 after exceeding the per-(user, vehicle) limit', async () => {
    const ctx = createTestApp({ photoUploadLimiter: createFakeLimiter(2) })
    const vehicle = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput())
    const headers = await authHeaders()

    const first = await ctx.app.request(`/vehicles/${vehicle.id}/photos?${OP}`, {
      method: 'POST',
      headers,
      body: jpegForm(),
    })
    const second = await ctx.app.request(`/vehicles/${vehicle.id}/photos?${OP}`, {
      method: 'POST',
      headers,
      body: jpegForm(),
    })
    const third = await ctx.app.request(`/vehicles/${vehicle.id}/photos?${OP}`, {
      method: 'POST',
      headers,
      body: jpegForm(),
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(third.status).toBe(429)
  })

  it('keeps separate buckets per (user, vehicle) pair', async () => {
    const ctx = createTestApp({ photoUploadLimiter: createFakeLimiter(1) })
    const v1 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput())
    const v2 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput())
    const headersUserA = await authHeaders({ sub: 'user-a', role: 'PLATFORM_ADMIN' })
    const headersUserB = await authHeaders({ sub: 'user-b', role: 'PLATFORM_ADMIN' })

    const userAv1 = await ctx.app.request(`/vehicles/${v1.id}/photos?${OP}`, {
      method: 'POST',
      headers: headersUserA,
      body: jpegForm(),
    })
    const userAv1Again = await ctx.app.request(`/vehicles/${v1.id}/photos?${OP}`, {
      method: 'POST',
      headers: headersUserA,
      body: jpegForm(),
    })
    const userAv2 = await ctx.app.request(`/vehicles/${v2.id}/photos?${OP}`, {
      method: 'POST',
      headers: headersUserA,
      body: jpegForm(),
    })
    const userBv1 = await ctx.app.request(`/vehicles/${v1.id}/photos?${OP}`, {
      method: 'POST',
      headers: headersUserB,
      body: jpegForm(),
    })

    expect(userAv1.status).toBe(201)
    expect(userAv1Again.status).toBe(429)
    expect(userAv2.status).toBe(201)
    expect(userBv1.status).toBe(201)
  })

  it('bypasses rate limiting when no binding is injected (local dev)', async () => {
    const ctx = createTestApp()
    const vehicle = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput())
    const headers = await authHeaders()

    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.request(`/vehicles/${vehicle.id}/photos?${OP}`, {
        method: 'POST',
        headers,
        body: jpegForm(),
      })
      expect(res.status).toBe(201)
    }
  })

  it('also rate-limits DELETE requests (URL-query shape)', async () => {
    const ctx = createTestApp({ photoUploadLimiter: createFakeLimiter(1) })
    const vehicle = await ctx.vehicleRepo.create(
      SYSTEM_CONTEXT,
      vehicleInput({ photos: ['https://test/a.jpg', 'https://test/b.jpg'] }),
    )
    const headers = await authHeaders()

    const first = await ctx.app.request(
      `/vehicles/${vehicle.id}/photos?url=${encodeURIComponent('https://test/a.jpg')}&${OP}`,
      { method: 'DELETE', headers },
    )
    const second = await ctx.app.request(
      `/vehicles/${vehicle.id}/photos?url=${encodeURIComponent('https://test/b.jpg')}&${OP}`,
      { method: 'DELETE', headers },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
  })

  it('per-user limit caps aggregate uploads across many vehicles', async () => {
    // Without this, a single staff token could rotate vehicle IDs to get
    // fresh per-(user,vehicle) buckets and burst ~500MB/min of R2 writes.
    const ctx = createTestApp({
      photoUploadLimiter: createFakeLimiter(100),
      photoUploadUserLimiter: createFakeLimiter(2),
    })
    const v1 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput())
    const v2 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput())
    const v3 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput())
    const headers = await authHeaders()

    const a = await ctx.app.request(`/vehicles/${v1.id}/photos?${OP}`, {
      method: 'POST',
      headers,
      body: jpegForm(),
    })
    const b = await ctx.app.request(`/vehicles/${v2.id}/photos?${OP}`, {
      method: 'POST',
      headers,
      body: jpegForm(),
    })
    const c = await ctx.app.request(`/vehicles/${v3.id}/photos?${OP}`, {
      method: 'POST',
      headers,
      body: jpegForm(),
    })

    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(c.status).toBe(429)
  })
})
