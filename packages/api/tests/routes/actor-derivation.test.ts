import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryLocationRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { TEST_OPERATOR_ID, seededOperatorRepo } from '../helpers/operator'

function futureDate(hoursFromNow: number): string {
  const d = new Date()
  d.setHours(d.getHours() + hoursFromNow)
  return d.toISOString()
}

async function createTestApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  // Issue #308: bookings require a classId. Seed a default class that
  // every vehicle in these tests belongs to.
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
  const locationRepo = new InMemoryLocationRepository()
  const location = await locationRepo.create({
    operatorId: TEST_OPERATOR_ID,
    name: 'Namba',
    address: '1-2-3 Namba',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
  } as Parameters<typeof locationRepo.create>[0])
  return {
    app: createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      vehicleClassRepo,
      locationRepo,
      operatorRepo: seededOperatorRepo(),
    }),
    vehicleRepo,
    classId: klass.id,
    locationId: location.id,
  }
}

describe('actor derivation from JWT', () => {
  it('POST /bookings uses JWT sub as renterId, ignores body.renterId', async () => {
    const { app, vehicleRepo, classId, locationId } = await createTestApp()
    const headers = await authHeaders({ sub: 'real-user-id', role: 'RENTER' })

    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: TEST_OPERATOR_ID,
      classId,
      pickupLocationId: locationId,
      name: 'Test Car',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
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

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        requestedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        renterId: 'a0000000-0000-4000-a000-000000000099',
        startAt: futureDate(24),
        endAt: futureDate(48),
        source: 'DIRECT',
        disclaimerAccepted: true,
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    // Booking must use JWT sub, not the spoofed body.renterId
    expect(body.data.renterId).toBe('real-user-id')
  })

  it('POST /bookings/:id/cancel requires booking ownership', async () => {
    const { app, vehicleRepo, classId, locationId } = await createTestApp()
    const ownerHeaders = await authHeaders({ sub: 'owner-user', role: 'RENTER' })
    const attackerHeaders = await authHeaders({ sub: 'attacker-user', role: 'RENTER' })

    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: TEST_OPERATOR_ID,
      classId,
      pickupLocationId: locationId,
      name: 'Test Car',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
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

    // Create booking as owner
    const createRes = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ownerHeaders },
      body: JSON.stringify({
        requestedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: futureDate(24),
        endAt: futureDate(48),
        source: 'DIRECT',
        disclaimerAccepted: true,
      }),
    })
    const booking = await createRes.json()

    // Attacker tries to cancel
    const cancelRes = await app.request(`/bookings/${booking.data.id}/cancel`, {
      method: 'POST',
      headers: attackerHeaders,
    })
    expect(cancelRes.status).toBe(404)
  })

  it('RENTER cannot create vehicles (role gate)', async () => {
    const { app, classId } = await createTestApp()
    const renterHeaders = await authHeaders({ sub: 'renter-user', role: 'RENTER' })

    const res = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...renterHeaders },
      body: JSON.stringify({
        operatorId: TEST_OPERATOR_ID,
        classId,
        name: 'Hacked Car',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 0,
      }),
    })
    expect(res.status).toBe(403)
  })

  it('STAFF can create vehicles', async () => {
    const { app, classId } = await createTestApp()
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })

    const res = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        operatorId: TEST_OPERATOR_ID,
        classId,
        name: 'Staff Car',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })
    expect(res.status).toBe(201)
  })

  it('STAFF can cancel any booking', async () => {
    const { app, vehicleRepo, classId, locationId } = await createTestApp()
    const renterHeaders = await authHeaders({ sub: 'renter-user', role: 'RENTER' })
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })

    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: TEST_OPERATOR_ID,
      classId,
      pickupLocationId: locationId,
      name: 'Test Car',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
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

    const createRes = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...renterHeaders },
      body: JSON.stringify({
        requestedVehicleId: vehicle.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: futureDate(24),
        endAt: futureDate(48),
        source: 'DIRECT',
        disclaimerAccepted: true,
      }),
    })
    const booking = await createRes.json()

    const cancelRes = await app.request(`/bookings/${booking.data.id}/cancel`, {
      method: 'POST',
      headers: staffHeaders,
    })
    expect(cancelRes.status).toBe(200)
  })
})
