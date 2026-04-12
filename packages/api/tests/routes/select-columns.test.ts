import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryStatsRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'

function createTestApp() {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
  return createApp({ vehicleRepo, bookingRepo, availabilityRepo, statsRepo })
}

const VEHICLE_FIELDS = [
  'id',
  'name',
  'description',
  'photos',
  'seats',
  'transmission',
  'fuelType',
  'status',
  'bufferMinutes',
  'minRentalHours',
  'maxRentalHours',
  'advanceBookingHours',
  'dailyRateJpy',
  'hourlyRateJpy',
  'createdAt',
  'updatedAt',
] as const

const BOOKING_FIELDS = [
  'id',
  'renterId',
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
    const app = createTestApp()

    await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Car',
        description: 'Test',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })

    const res = await app.request('/vehicles')
    const body = await res.json()
    const vehicle = body.data[0]

    for (const field of VEHICLE_FIELDS) {
      expect(vehicle).toHaveProperty(field)
    }
    // No extra fields beyond what we expect
    expect(Object.keys(vehicle).sort()).toEqual([...VEHICLE_FIELDS].sort())
  })

  it('GET /vehicles/:id returns vehicle with exact field set', async () => {
    const app = createTestApp()

    const createRes = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Car',
        description: 'Test',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })
    const created = await createRes.json()

    const res = await app.request(`/vehicles/${created.data.id}`)
    const body = await res.json()

    for (const field of VEHICLE_FIELDS) {
      expect(body.data).toHaveProperty(field)
    }
    expect(Object.keys(body.data).sort()).toEqual([...VEHICLE_FIELDS].sort())
  })

  it('GET /bookings returns bookings with exact field set', async () => {
    const app = createTestApp()

    // Create a vehicle first
    const vRes = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Car',
        description: 'Test',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })
    const vehicle = await vRes.json()

    await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        renterId: 'user-1',
        vehicleId: vehicle.data.id,
        startAt: '2026-05-01T10:00:00Z',
        endAt: '2026-05-03T10:00:00Z',
        source: 'DIRECT',
      }),
    })

    const res = await app.request('/bookings')
    const body = await res.json()
    const booking = body.data[0]

    for (const field of BOOKING_FIELDS) {
      expect(booking).toHaveProperty(field)
    }
    expect(Object.keys(booking).sort()).toEqual([...BOOKING_FIELDS].sort())
  })
})
