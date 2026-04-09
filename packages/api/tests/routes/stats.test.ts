import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryBookingRepository, InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { InMemoryStatsRepository } from '../../src/repositories/in-memory'
import { InMemoryAvailabilityRepository } from '../../src/repositories/in-memory'

function createTestApp() {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)

  return {
    app: createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      statsRepo,
    }),
    vehicleRepo,
    bookingRepo,
  }
}

describe('GET /stats', () => {
  it('returns 200 with all zeros for empty stores', async () => {
    const { app } = createTestApp()
    const res = await app.request('/stats')

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
    const { app } = createTestApp()

    // Create 3 vehicles (2 AVAILABLE, 1 MAINTENANCE)
    await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Toyota Prius',
        description: 'Hybrid',
        seats: 5,
        transmission: 'AUTO',
        fuelType: 'Hybrid',
      }),
    })
    await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Honda Fit',
        description: 'Compact',
        seats: 5,
        transmission: 'AUTO',
        fuelType: 'Gasoline',
      }),
    })
    const maintenanceRes = await app.request('/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Suzuki Swift',
        description: 'Under repair',
        seats: 5,
        transmission: 'MANUAL',
        fuelType: 'Gasoline',
      }),
    })
    const maintenanceBody = await maintenanceRes.json()
    // soft-delete → RETIRED (removes from AVAILABLE count)
    await app.request(`/vehicles/${maintenanceBody.data.id}`, {
      method: 'DELETE',
    })

    // Create 2 bookings
    const vehiclesRes = await app.request('/vehicles')
    const vehiclesBody = await vehiclesRes.json()
    const availableVehicle = vehiclesBody.data.find(
      (v: { status: string }) => v.status === 'AVAILABLE',
    )

    await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        renterId: 'user-1',
        vehicleId: availableVehicle.id,
        startAt: '2026-05-01T10:00:00Z',
        endAt: '2026-05-03T10:00:00Z',
        source: 'DIRECT',
      }),
    })
    await app.request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        renterId: 'user-2',
        vehicleId: availableVehicle.id,
        startAt: '2026-06-01T10:00:00Z',
        endAt: '2026-06-03T10:00:00Z',
        source: 'TRIP_COM',
      }),
    })

    const res = await app.request('/stats')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      success: true,
      data: {
        totalBookings: 2,
        activeVehicles: 2,
        totalCustomers: 0, // InMemory has no users table
        unreadMessages: 0,
      },
    })
  })
})
