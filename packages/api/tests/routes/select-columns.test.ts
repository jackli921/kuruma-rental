import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryStatsRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { seededOperatorRepo } from '../helpers/operator'

async function createTestApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const klass = await vehicleClassRepo.create({
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
  return {
    app: createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      statsRepo,
      vehicleClassRepo,
      operatorRepo: seededOperatorRepo(),
    }),
    classId: klass.id,
  }
}

const VEHICLE_FIELDS = [
  'id',
  'operatorId',
  'classId',
  'name',
  'description',
  'photos',
  'seats',
  'transmission',
  'fuelType',
  'licensePlate',
  'status',
  'bufferMinutes',
  'minRentalHours',
  'maxRentalHours',
  'advanceBookingHours',
  'make',
  'model',
  'year',
  'color',
  'dailyRateJpy',
  'hourlyRateJpy',
  'shakenExpiryDate',
  'insuranceExpiryDate',
  'createdAt',
  'updatedAt',
] as const

const BOOKING_FIELDS = [
  'id',
  'renterId',
  'classId',
  'vehicleId',
  'startAt',
  'endAt',
  'effectiveEndAt',
  'status',
  'source',
  'externalId',
  'notes',
  'totalPrice',
  'cancellationFee',
  'cancelledAt',
  'idempotencyKey',
  'createdAt',
  'updatedAt',
] as const

describe('API responses contain only expected fields', () => {
  it('GET /vehicles returns vehicles with exact field set', async () => {
    const { app, classId } = await createTestApp()
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })

    await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        classId,
        name: 'Test Car',
        description: 'Test',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })

    const res = await app.request('/vehicles', { headers: staffHeaders })
    const body = await res.json()
    const vehicle = body.data[0]

    for (const field of VEHICLE_FIELDS) {
      expect(vehicle).toHaveProperty(field)
    }
    // No extra fields beyond what we expect
    expect(Object.keys(vehicle).sort()).toEqual([...VEHICLE_FIELDS].sort())
  })

  it('GET /vehicles/:id returns vehicle with exact field set', async () => {
    const { app, classId } = await createTestApp()
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })

    const createRes = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        classId,
        name: 'Test Car',
        description: 'Test',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })
    const created = await createRes.json()

    const res = await app.request(`/vehicles/${created.data.id}`, { headers: staffHeaders })
    const body = await res.json()

    for (const field of VEHICLE_FIELDS) {
      expect(body.data).toHaveProperty(field)
    }
    expect(Object.keys(body.data).sort()).toEqual([...VEHICLE_FIELDS].sort())
  })

  it('GET /bookings returns bookings with exact field set', async () => {
    const { app, classId } = await createTestApp()
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })
    const renterHeaders = await authHeaders({ sub: 'renter-user', role: 'RENTER' })

    // Create a vehicle first (STAFF)
    const vRes = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        classId,
        name: 'Test Car',
        description: 'Test',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })
    const vehicle = await vRes.json()

    // Create a booking (RENTER — renterId derived from JWT sub)
    await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...renterHeaders },
      body: JSON.stringify({
        classId,
        vehicleId: vehicle.data.id,
        startAt: '2026-05-01T10:00:00Z',
        endAt: '2026-05-03T10:00:00Z',
        source: 'DIRECT',
      }),
    })

    const res = await app.request('/bookings', { headers: staffHeaders })
    const body = await res.json()
    const booking = body.data[0]

    for (const field of BOOKING_FIELDS) {
      expect(booking).toHaveProperty(field)
    }
    expect(Object.keys(booking).sort()).toEqual([...BOOKING_FIELDS].sort())
  })
})
