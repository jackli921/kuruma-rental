import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryBookingRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createPartnerBookingRoutes } from '../../src/routes/partner-bookings'
import { BookingService } from '../../src/services/booking'
import { PartnerBookingService } from '../../src/services/partner-booking'
import { testAuthMiddleware } from '../helpers/auth'

let vehicleRepo: InMemoryVehicleRepository
let userRepo: InMemoryUserRepository
let vehicleId: string

function appAs(role: 'PARTNER' | 'RENTER' | 'STAFF' = 'PARTNER') {
  const a = new Hono()
  const bookingService = new BookingService(new InMemoryBookingRepository(), vehicleRepo, userRepo)
  const service = new PartnerBookingService(bookingService, userRepo)
  a.use('*', testAuthMiddleware('partner:api-key', role))
  a.route('/', createPartnerBookingRoutes(service))
  return a
}

beforeEach(async () => {
  vehicleRepo = new InMemoryVehicleRepository()
  userRepo = new InMemoryUserRepository()
  const v = await vehicleRepo.create({
    name: 'Test Car',
    description: 'Test',
    photos: [],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'GASOLINE',
    status: 'AVAILABLE' as const,
    bufferMinutes: 0,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 0,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
  })
  vehicleId = v.id
})

const body = (overrides?: Record<string, unknown>) => ({
  vehicleId,
  renterEmail: 'tourist@example.com',
  renterName: 'Tourist Alice',
  renterLanguage: 'en',
  startAt: '2026-05-01T10:00:00Z',
  endAt: '2026-05-02T10:00:00Z',
  externalId: 'TRIP-001',
  ...overrides,
})

describe('POST /external/bookings', () => {
  it('creates a booking with source TRIP_COM for PARTNER role', async () => {
    const res = await appAs('PARTNER').request('/external/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body()),
    })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.source).toBe('TRIP_COM')
    expect(json.data.externalId).toBe('TRIP-001')
  })

  it('rejects RENTER with 403 (API-key-only endpoint)', async () => {
    const res = await appAs('RENTER').request('/external/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body()),
    })
    expect(res.status).toBe(403)
  })

  it('rejects STAFF with 403 too', async () => {
    const res = await appAs('STAFF').request('/external/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body()),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 on missing required field', async () => {
    const res = await appAs('PARTNER').request('/external/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleId, renterName: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 409 when the vehicle is already booked in the time range', async () => {
    const app = appAs('PARTNER')
    const first = await app.request('/external/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body({ externalId: 'TRIP-A' })),
    })
    expect(first.status).toBe(201)

    const second = await app.request('/external/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body({ externalId: 'TRIP-B', renterEmail: 'b@e.com', renterName: 'B' })),
    })
    expect(second.status).toBe(409)
  })
})
