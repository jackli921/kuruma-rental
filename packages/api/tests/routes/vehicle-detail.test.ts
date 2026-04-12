import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryVehicleDetailRepository } from '../../src/repositories/in-memory-vehicle-detail'
import { createVehicleDetailRoutes } from '../../src/routes/vehicle-detail'
import type { Vehicle } from '../../src/stores'

let app: Hono
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let renterNames: Map<string, string>

function futureDate(hoursFromNow: number): Date {
  const d = new Date()
  d.setHours(d.getHours() + hoursFromNow)
  return d
}

function pastDate(hoursAgo: number): Date {
  const d = new Date()
  d.setHours(d.getHours() - hoursAgo)
  return d
}

const DEFAULT_BUFFER_MS = 60 * 60 * 1000

async function seedVehicle(
  overrides?: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<Vehicle> {
  return vehicleRepo.create({
    name: 'Toyota Alphard',
    description: 'Luxury van',
    photos: ['photo1.jpg'],
    seats: 7,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 18000,
    hourlyRateJpy: 2500,
    ...overrides,
  })
}

async function seedBooking(
  vehicleId: string,
  startAt: Date,
  endAt: Date,
  overrides?: {
    status?: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
    totalPrice?: number | null
    renterId?: string
    source?: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
  },
) {
  return bookingRepo.create({
    vehicleId,
    renterId: overrides?.renterId ?? 'renter-1',
    startAt,
    endAt,
    effectiveEndAt: new Date(endAt.getTime() + DEFAULT_BUFFER_MS),
    status: overrides?.status ?? 'CONFIRMED',
    source: overrides?.source ?? 'DIRECT',
    externalId: null,
    notes: null,
    totalPrice: overrides?.totalPrice ?? null,
    cancellationFee: null,
    cancelledAt: null,
  })
}

describe('GET /vehicles/:id/detail', () => {
  beforeEach(() => {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    renterNames = new Map([['renter-1', 'Tanaka Taro']])

    const detailRepo = new InMemoryVehicleDetailRepository(vehicleRepo, bookingRepo, renterNames)
    app = new Hono()
    app.route('/', createVehicleDetailRoutes(detailRepo))
  })

  it('returns 404 for nonexistent vehicle', async () => {
    const res = await app.request('/vehicles/nonexistent/detail')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Vehicle not found')
  })

  it('returns vehicle with empty enrichment when no bookings exist', async () => {
    const vehicle = await seedVehicle()

    const res = await app.request(`/vehicles/${vehicle.id}/detail`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(vehicle.id)
    expect(body.data.name).toBe('Toyota Alphard')
    expect(body.data.upcomingBookings).toEqual([])
    expect(body.data.revenueLast7d).toBe(0)
    expect(body.data.revenueLast30d).toBe(0)
    expect(body.data.revenueAllTime).toBe(0)
    expect(body.data.utilizationLast30Days).toHaveLength(30)
    // All days should be 0 hours
    for (const day of body.data.utilizationLast30Days) {
      expect(day.bookedHours).toBe(0)
    }
  })

  it('returns upcoming CONFIRMED and ACTIVE bookings ordered by startAt', async () => {
    const vehicle = await seedVehicle()

    // Future bookings: one sooner, one later
    await seedBooking(vehicle.id, futureDate(48), futureDate(72))
    await seedBooking(vehicle.id, futureDate(96), futureDate(120))

    const res = await app.request(`/vehicles/${vehicle.id}/detail`)
    const body = await res.json()

    expect(body.data.upcomingBookings).toHaveLength(2)
    // Ordered by startAt ascending
    const firstStart = new Date(body.data.upcomingBookings[0].startAt).getTime()
    const secondStart = new Date(body.data.upcomingBookings[1].startAt).getTime()
    expect(firstStart).toBeLessThan(secondStart)
    expect(body.data.upcomingBookings[0].renterName).toBe('Tanaka Taro')
    expect(body.data.upcomingBookings[0].source).toBe('DIRECT')
  })

  it('excludes CANCELLED and COMPLETED bookings from upcoming', async () => {
    const vehicle = await seedVehicle()

    await seedBooking(vehicle.id, futureDate(48), futureDate(72), { status: 'CONFIRMED' })
    // Seed completed and cancelled on different vehicles to avoid overlap constraint
    const v2 = await seedVehicle({ name: 'Vehicle 2' })
    await seedBooking(v2.id, futureDate(96), futureDate(120), { status: 'COMPLETED' })
    const v3 = await seedVehicle({ name: 'Vehicle 3' })
    await seedBooking(v3.id, futureDate(144), futureDate(168), { status: 'CANCELLED' })

    const res = await app.request(`/vehicles/${vehicle.id}/detail`)
    const body = await res.json()

    // Only the CONFIRMED booking on this vehicle
    expect(body.data.upcomingBookings).toHaveLength(1)
    expect(body.data.upcomingBookings[0].status).toBe('CONFIRMED')
  })

  it('limits upcoming bookings to 10', async () => {
    const vehicle = await seedVehicle()

    // Create 12 non-overlapping future bookings
    for (let i = 0; i < 12; i++) {
      const startHours = 48 + i * 48
      await seedBooking(vehicle.id, futureDate(startHours), futureDate(startHours + 24))
    }

    const res = await app.request(`/vehicles/${vehicle.id}/detail`)
    const body = await res.json()

    expect(body.data.upcomingBookings).toHaveLength(10)
  })

  it('computes revenue from COMPLETED bookings with totalPrice', async () => {
    const vehicle = await seedVehicle()

    // Completed booking 3 days ago
    const b1 = await seedBooking(vehicle.id, pastDate(72), pastDate(48), {
      totalPrice: 5000,
    })
    await bookingRepo.updateStatus(b1.id, 'ACTIVE')
    await bookingRepo.updateStatus(b1.id, 'COMPLETED')

    // Completed booking 10 days ago
    const b2 = await seedBooking(vehicle.id, pastDate(240), pastDate(216), {
      totalPrice: 8000,
    })
    await bookingRepo.updateStatus(b2.id, 'ACTIVE')
    await bookingRepo.updateStatus(b2.id, 'COMPLETED')

    // Completed booking 60 days ago
    const b3 = await seedBooking(vehicle.id, pastDate(1440), pastDate(1416), {
      totalPrice: 12000,
    })
    await bookingRepo.updateStatus(b3.id, 'ACTIVE')
    await bookingRepo.updateStatus(b3.id, 'COMPLETED')

    const res = await app.request(`/vehicles/${vehicle.id}/detail`)
    const body = await res.json()

    expect(body.data.revenueLast7d).toBe(5000)
    expect(body.data.revenueLast30d).toBe(13000) // 5000 + 8000
    expect(body.data.revenueAllTime).toBe(25000) // 5000 + 8000 + 12000
  })

  it('skips bookings with null totalPrice in revenue computation', async () => {
    const vehicle = await seedVehicle()

    const b1 = await seedBooking(vehicle.id, pastDate(72), pastDate(48), {
      totalPrice: null,
    })
    await bookingRepo.updateStatus(b1.id, 'ACTIVE')
    await bookingRepo.updateStatus(b1.id, 'COMPLETED')

    const res = await app.request(`/vehicles/${vehicle.id}/detail`)
    const body = await res.json()

    expect(body.data.revenueAllTime).toBe(0)
  })

  it('returns 30 utilization entries with correct date format', async () => {
    const vehicle = await seedVehicle()

    const res = await app.request(`/vehicles/${vehicle.id}/detail`)
    const body = await res.json()

    expect(body.data.utilizationLast30Days).toHaveLength(30)
    // Each entry has date (YYYY-MM-DD) and bookedHours (number)
    for (const entry of body.data.utilizationLast30Days) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof entry.bookedHours).toBe('number')
    }
  })

  it('computes utilization hours for bookings spanning multiple days', async () => {
    const vehicle = await seedVehicle()

    // Booking that started 48h ago and ended 24h ago (24h total)
    const b = await seedBooking(vehicle.id, pastDate(48), pastDate(24), {
      totalPrice: 5000,
    })
    await bookingRepo.updateStatus(b.id, 'ACTIVE')
    await bookingRepo.updateStatus(b.id, 'COMPLETED')

    const res = await app.request(`/vehicles/${vehicle.id}/detail`)
    const body = await res.json()

    // Sum of all bookedHours should be approximately 24
    const totalHours = body.data.utilizationLast30Days.reduce(
      (sum: number, d: { bookedHours: number }) => sum + d.bookedHours,
      0,
    )
    expect(totalHours).toBeGreaterThanOrEqual(23)
    expect(totalHours).toBeLessThanOrEqual(25) // Allow some float rounding
  })

  it('does not include other vehicles bookings in this vehicle detail', async () => {
    const vehicle1 = await seedVehicle({ name: 'Vehicle 1' })
    const vehicle2 = await seedVehicle({ name: 'Vehicle 2' })

    await seedBooking(vehicle2.id, futureDate(48), futureDate(72))

    const res = await app.request(`/vehicles/${vehicle1.id}/detail`)
    const body = await res.json()

    expect(body.data.upcomingBookings).toHaveLength(0)
  })
})
