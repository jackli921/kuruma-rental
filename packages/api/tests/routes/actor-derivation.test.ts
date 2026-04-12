import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

function futureDate(hoursFromNow: number): string {
  const d = new Date()
  d.setHours(d.getHours() + hoursFromNow)
  return d.toISOString()
}

function createTestApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  return { app: createApp({ vehicleRepo, bookingRepo, availabilityRepo }), vehicleRepo }
}

describe('actor derivation from JWT', () => {
  it('POST /bookings uses JWT sub as renterId, ignores body.renterId', async () => {
    const { app, vehicleRepo } = createTestApp()
    const headers = await authHeaders({ sub: 'real-user-id', role: 'RENTER' })

    const vehicle = await vehicleRepo.create({
      name: 'Test Car',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
    })

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        vehicleId: vehicle.id,
        renterId: 'attacker-trying-to-spoof',
        startAt: futureDate(24),
        endAt: futureDate(48),
        source: 'DIRECT',
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    // Booking must use JWT sub, not the spoofed body.renterId
    expect(body.data.renterId).toBe('real-user-id')
  })

  it('POST /bookings/:id/cancel requires booking ownership', async () => {
    const { app, vehicleRepo } = createTestApp()
    const ownerHeaders = await authHeaders({ sub: 'owner-user', role: 'RENTER' })
    const attackerHeaders = await authHeaders({ sub: 'attacker-user', role: 'RENTER' })

    const vehicle = await vehicleRepo.create({
      name: 'Test Car',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
    })

    // Create booking as owner
    const createRes = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ownerHeaders },
      body: JSON.stringify({
        vehicleId: vehicle.id,
        startAt: futureDate(24),
        endAt: futureDate(48),
        source: 'DIRECT',
      }),
    })
    const booking = await createRes.json()

    // Attacker tries to cancel
    const cancelRes = await app.request(`/bookings/${booking.data.id}/cancel`, {
      method: 'POST',
      headers: attackerHeaders,
    })
    expect(cancelRes.status).toBe(403)
  })

  it('RENTER cannot create vehicles (role gate)', async () => {
    const { app } = createTestApp()
    const renterHeaders = await authHeaders({ sub: 'renter-user', role: 'RENTER' })

    const res = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...renterHeaders },
      body: JSON.stringify({
        name: 'Hacked Car',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 0,
      }),
    })
    expect(res.status).toBe(403)
  })

  it('STAFF can create vehicles', async () => {
    const { app } = createTestApp()
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })

    const res = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...staffHeaders },
      body: JSON.stringify({
        name: 'Staff Car',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 8000,
      }),
    })
    expect(res.status).toBe(201)
  })

  it('STAFF can cancel any booking', async () => {
    const { app, vehicleRepo } = createTestApp()
    const renterHeaders = await authHeaders({ sub: 'renter-user', role: 'RENTER' })
    const staffHeaders = await authHeaders({ sub: 'staff-user', role: 'STAFF' })

    const vehicle = await vehicleRepo.create({
      name: 'Test Car',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
    })

    const createRes = await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...renterHeaders },
      body: JSON.stringify({
        vehicleId: vehicle.id,
        startAt: futureDate(24),
        endAt: futureDate(48),
        source: 'DIRECT',
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
