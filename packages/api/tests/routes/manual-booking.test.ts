import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryAvailabilityRepository } from '../../src/repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { InMemoryVehicleClassRepository } from '../../src/repositories/in-memory/vehicle-class'
import type { User, Vehicle, VehicleClass } from '../../src/stores'

const AUTH_SECRET = 'test-secret-for-manual-booking-tests'

async function createTestToken(user: { id: string; role: string }): Promise<string> {
  const key = new TextEncoder().encode(AUTH_SECRET)
  return new SignJWT({ sub: user.id, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
}

function makeTestVehicle(overrides?: Partial<Vehicle>): Vehicle {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    classId: null,
    name: 'Test Car',
    description: null,
    photos: [],
    seats: 4,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'TEST-001',
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: 2,
    maxRentalHours: 168,
    advanceBookingHours: 24,
    make: 'Toyota',
    model: 'Corolla',
    year: 2024,
    color: 'White',
    dailyRateJpy: 8000,
    hourlyRateJpy: 1500,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeRenter(id: string): User {
  return {
    id,
    name: 'Test Renter',
    email: `renter-${id}@test.local`,
    phone: null,
    language: 'en',
    role: 'RENTER',
  }
}

describe('Manual booking (staff/admin renterId override + advance rule skip)', () => {
  let vehicleRepo: InMemoryVehicleRepository
  let bookingRepo: InMemoryBookingRepository
  let userStore: Map<string, User>
  let app: ReturnType<typeof createApp>
  let vehicle: Vehicle
  let testClassId: string

  beforeEach(async () => {
    process.env.AUTH_SECRET = AUTH_SECRET

    const vehicleClassRepo = new InMemoryVehicleClassRepository()
    const klass: VehicleClass = await vehicleClassRepo.create({
      name: 'Compact',
      slug: 'compact',
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    testClassId = klass.id

    const vehicleStore = new Map<string, Vehicle>()
    vehicle = makeTestVehicle({ classId: testClassId })
    vehicleStore.set(vehicle.id, vehicle)

    vehicleRepo = new InMemoryVehicleRepository(vehicleStore)
    bookingRepo = new InMemoryBookingRepository()
    userStore = new Map<string, User>()
    const userRepo = new InMemoryUserRepository(userStore)
    const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)

    app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, userRepo, vehicleClassRepo })
  })

  it('staff can create booking with custom renterId', async () => {
    const staffId = crypto.randomUUID()
    const customerId = crypto.randomUUID()
    userStore.set(customerId, makeRenter(customerId))
    const token = await createTestToken({ id: staffId, role: 'STAFF' })

    // Start 48 hours from now to satisfy advance booking rule
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        classId: testClassId,
        vehicleId: vehicle.id,
        renterId: customerId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      success: boolean
      data: { renterId: string; source: string }
    }
    expect(body.success).toBe(true)
    // The booking should use the custom renterId, not the staff user's id
    expect(body.data.renterId).toBe(customerId)
    expect(body.data.renterId).not.toBe(staffId)
  })

  it('renter cannot specify renterId — booking uses JWT user id', async () => {
    const renterId = crypto.randomUUID()
    const attackerRenterId = crypto.randomUUID()
    const token = await createTestToken({ id: renterId, role: 'RENTER' })

    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        classId: testClassId,
        vehicleId: vehicle.id,
        renterId: attackerRenterId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'DIRECT',
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { success: boolean; data: { renterId: string } }
    expect(body.success).toBe(true)
    // Renter role should NOT be able to impersonate — booking uses JWT user.id
    expect(body.data.renterId).toBe(renterId)
    expect(body.data.renterId).not.toBe(attackerRenterId)
  })

  it('manual booking skips advance booking rule', async () => {
    const staffId = crypto.randomUUID()
    const token = await createTestToken({ id: staffId, role: 'STAFF' })

    // Start 1 hour from now — violates the 24h advance booking rule
    const startAt = new Date(Date.now() + 1 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        classId: testClassId,
        vehicleId: vehicle.id,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    // Should succeed even though advance booking rule would block it
    expect(res.status).toBe(201)
    const body = (await res.json()) as { success: boolean; data: { source: string } }
    expect(body.success).toBe(true)
    expect(body.data.source).toBe('MANUAL')
  })

  it('manual booking still enforces min rental duration', async () => {
    const staffId = crypto.randomUUID()
    const token = await createTestToken({ id: staffId, role: 'STAFF' })

    // Duration = 30 minutes, below minRentalHours (2h)
    const startAt = new Date(Date.now() + 1 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 30 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        classId: testClassId,
        vehicleId: vehicle.id,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { success: boolean; code: string }
    expect(body.success).toBe(false)
    expect(body.code).toBe('RENTAL_RULE_MIN_DURATION')
  })

  it('renter cannot bypass advance booking rule by sending source=MANUAL', async () => {
    // Uses the default vehicle from beforeEach which has advanceBookingHours: 24
    const renterToken = await createTestToken({ id: 'renter-1', role: 'RENTER' })

    // Start 1h from now — should fail advance booking check (requires 24h)
    const startAt = new Date(Date.now() + 1 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${renterToken}`,
      },
      body: JSON.stringify({
        classId: testClassId,
        vehicleId: vehicle.id,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    // Source should be forced to DIRECT for renters, so advance rule applies
    expect(res.status).toBe(400)
    const body = (await res.json()) as { success: boolean; code: string }
    expect(body.success).toBe(false)
    expect(body.code).toBe('RENTAL_RULE_ADVANCE_BOOKING')
  })

  it('rejects manual booking when target renterId does not exist', async () => {
    const staffId = crypto.randomUUID()
    const token = await createTestToken({ id: staffId, role: 'STAFF' })
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        classId: testClassId,
        vehicleId: vehicle.id,
        renterId: crypto.randomUUID(), // unknown user
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('Renter not found')
  })

  it('rejects manual booking when target user is not a RENTER', async () => {
    const staffId = crypto.randomUUID()
    const otherStaffId = crypto.randomUUID()
    userStore.set(otherStaffId, { ...makeRenter(otherStaffId), role: 'STAFF' })
    const token = await createTestToken({ id: staffId, role: 'STAFF' })
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        classId: testClassId,
        vehicleId: vehicle.id,
        renterId: otherStaffId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        source: 'MANUAL',
      }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('not a renter')
  })
})
