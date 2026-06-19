import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryStatsRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'
import { TEST_OPERATOR_ID, seededOperatorRepo } from '../helpers/operator'

const TEST_API_KEY = 'test-stats-key'

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
    vehicleRepo,
    bookingRepo,
    classId: klass.id,
  }
}

beforeAll(() => {
  process.env.STATS_API_KEY = TEST_API_KEY
})

describe('GET /stats', () => {
  it('returns 401 without API key', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/stats')

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('returns 401 with wrong API key', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/stats', {
      headers: { 'X-API-Key': 'wrong-key' },
    })

    expect(res.status).toBe(401)
  })

  it('returns 200 with all zeros for empty stores', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/stats', {
      headers: { 'X-API-Key': TEST_API_KEY },
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      success: true,
      data: {
        totalBookings: 0,
        activeVehicles: 0,
        totalCustomers: 0,
        unreadMessages: 0,
      },
    })
  })

  it('returns correct counts after creating vehicles and bookings', async () => {
    const { app, bookingRepo, classId } = await createTestApp()
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })

    // Create 3 vehicles (2 AVAILABLE, 1 will be soft-deleted)
    await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        operatorId: TEST_OPERATOR_ID,
        classId,
        name: 'Toyota Prius',
        description: 'Hybrid',
        seats: 5,
        transmission: 'AUTO',
        fuelType: 'Hybrid',
        dailyRateJpy: 9000,
        shakenExpiryDate: '2099-06-15',
        insuranceExpiryDate: '2099-01-01',
      }),
    })
    await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        operatorId: TEST_OPERATOR_ID,
        classId,
        name: 'Honda Fit',
        description: 'Compact',
        seats: 5,
        transmission: 'AUTO',
        fuelType: 'Gasoline',
        dailyRateJpy: 7500,
        shakenExpiryDate: '2099-06-15',
        insuranceExpiryDate: '2099-01-01',
      }),
    })
    const maintenanceRes = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        operatorId: TEST_OPERATOR_ID,
        classId,
        name: 'Suzuki Swift',
        description: 'Under repair',
        seats: 5,
        transmission: 'MANUAL',
        fuelType: 'Gasoline',
        dailyRateJpy: 6500,
        shakenExpiryDate: '2099-06-15',
        insuranceExpiryDate: '2099-01-01',
      }),
    })
    const maintenanceBody = await maintenanceRes.json()
    await app.request(`/vehicles/${maintenanceBody.data.id}`, {
      method: 'DELETE',
      headers: staffHeaders,
    })

    // Seed 2 bookings on the available vehicle. The stats endpoint only counts
    // booking rows (status/source/dates don't affect the count), so seed via the
    // repo directly — distinct date windows keep the no-overlap exclusion happy.
    const vehiclesRes = await app.request('/vehicles', { headers: staffHeaders })
    const vehiclesBody = await vehiclesRes.json()
    const availableVehicle = vehiclesBody.data.find(
      (v: { status: string }) => v.status === 'AVAILABLE',
    )

    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        classId,
        assignedVehicleId: availableVehicle.id,
        startAt: new Date('2026-05-01T10:00:00Z'),
        endAt: new Date('2026-05-03T10:00:00Z'),
        source: 'DIRECT',
      }),
    )
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        classId,
        assignedVehicleId: availableVehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-03T10:00:00Z'),
        source: 'TRIP_COM',
      }),
    )

    const res = await app.request('/stats', {
      headers: { 'X-API-Key': TEST_API_KEY },
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      success: true,
      data: {
        totalBookings: 2,
        activeVehicles: 2,
        totalCustomers: 0,
        unreadMessages: 0,
      },
    })
  })
})
