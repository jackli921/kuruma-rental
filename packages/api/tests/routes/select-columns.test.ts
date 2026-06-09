import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryLocationRepository,
  InMemoryStatsRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { TEST_OPERATOR_ID, seededOperatorRepo } from '../helpers/operator'

async function createTestApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const locationRepo = new InMemoryLocationRepository()
  const klass = await vehicleClassRepo.create({
    operatorId: TEST_OPERATOR_ID,
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    sortOrder: 0,
    status: 'ACTIVE',
  })
  // #392: booking create derives operatorId from the vehicle and validates the
  // pickup/dropoff against the SAME operator's locations. Seed one under
  // TEST_OPERATOR_ID so the POST /bookings flow has a valid location to resolve.
  const location = await locationRepo.create({
    operatorId: TEST_OPERATOR_ID,
    name: 'Namba HQ',
    address: '1-1 Namba, Chuo-ku, Osaka',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
  })
  return {
    app: createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      statsRepo,
      vehicleClassRepo,
      locationRepo,
      operatorRepo: seededOperatorRepo(),
    }),
    classId: klass.id,
    locationId: location.id,
  }
}

const VEHICLE_FIELDS = [
  'id',
  'operatorId',
  'classId',
  'pickupLocationId',
  'name',
  'description',
  'photos',
  'seats',
  'luggageCapacity',
  'luggageSize',
  'transmission',
  'fuelType',
  'licensePlate',
  'status',
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
  'operatorId',
  'renterId',
  'classId',
  'requestedVehicleId',
  'assignedVehicleId',
  'pickupLocationId',
  'dropoffLocationId',
  'startAt',
  'endAt',
  'effectiveEndAt',
  'status',
  'source',
  'fulfillmentMode',
  'bookingCode',
  'insuranceOptionId',
  'insuranceSnapshot',
  'feeSnapshot',
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
        operatorId: TEST_OPERATOR_ID,
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
        operatorId: TEST_OPERATOR_ID,
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
    const { app, classId, locationId } = await createTestApp()
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })
    const renterHeaders = await authHeaders({ sub: 'renter-user', role: 'RENTER' })

    // Create a vehicle first (STAFF)
    const vRes = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        operatorId: TEST_OPERATOR_ID,
        classId,
        pickupLocationId: locationId, // #392: the car must live where it's booked
        name: 'Test Car',
        description: 'Test',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })
    const vehicle = await vRes.json()

    // Create a booking (RENTER — renterId derived from JWT sub). #392: the
    // renter books a concrete vehicle (requestedVehicleId) and names pickup/
    // dropoff locations; the server derives operatorId/classId/assignedVehicleId.
    await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...renterHeaders },
      body: JSON.stringify({
        requestedVehicleId: vehicle.data.id,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
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
