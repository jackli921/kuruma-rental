import { describe, expect, it, beforeEach } from 'vitest'
import { setupDbMocks, resetAllTables, seedTable } from '../helpers/mock-db'

setupDbMocks()

import app from '../../src/index'
import {
  bookings as bookingsTable,
  vehicles as vehiclesTable,
} from '@kuruma/shared/db/schema'

describe('Availability Routes', () => {
  beforeEach(() => {
    resetAllTables()
  })

  describe('GET /availability', () => {
    it('returns all available vehicles when no bookings exist', async () => {
      const v1Id = crypto.randomUUID()
      const v2Id = crypto.randomUUID()
      seedTable(vehiclesTable, [
        { ...makeVehicle({ id: v1Id, name: 'Car A' }) },
        { ...makeVehicle({ id: v2Id, name: 'Car B' }) },
      ])

      const res = await app.request(
        '/availability?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)

      const ids = body.data.map((v: { id: string }) => v.id)
      expect(ids).toContain(v1Id)
      expect(ids).toContain(v2Id)
    })

    it('excludes vehicles with overlapping bookings', async () => {
      const vehicleId = crypto.randomUUID()
      seedTable(vehiclesTable, [makeVehicle({ id: vehicleId })])
      seedTable(bookingsTable, [
        makeBooking({
          vehicleId,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T14:00:00Z'),
          status: 'CONFIRMED',
        }),
      ])

      const res = await app.request(
        '/availability?from=2026-06-01T12:00:00Z&to=2026-06-01T16:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })

    it('includes vehicles when no overlap exists', async () => {
      const vehicleId = crypto.randomUUID()
      seedTable(vehiclesTable, [makeVehicle({ id: vehicleId })])
      seedTable(bookingsTable, [
        makeBooking({
          vehicleId,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T14:00:00Z'),
          status: 'CONFIRMED',
        }),
      ])

      // Query well after the booking ends (buffer is 30min default)
      const res = await app.request(
        '/availability?from=2026-06-01T16:00:00Z&to=2026-06-01T20:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(vehicleId)
    })

    it('accounts for buffer time after bookings', async () => {
      const vehicleId = crypto.randomUUID()
      seedTable(vehiclesTable, [makeVehicle({ id: vehicleId, bufferMinutes: 60 })])
      seedTable(bookingsTable, [
        makeBooking({
          vehicleId,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T14:00:00Z'),
          status: 'CONFIRMED',
        }),
      ])

      // 14:30 is within the buffer (14:00 + 60min = 15:00)
      const res1 = await app.request(
        '/availability?from=2026-06-01T14:30:00Z&to=2026-06-01T16:00:00Z',
      )
      const body1 = await res1.json()
      expect(body1.success).toBe(true)
      expect(body1.data).toHaveLength(0)

      // 15:30 is after the buffer ends
      const res2 = await app.request(
        '/availability?from=2026-06-01T15:30:00Z&to=2026-06-01T18:00:00Z',
      )
      const body2 = await res2.json()
      expect(body2.success).toBe(true)
      expect(body2.data).toHaveLength(1)
      expect(body2.data[0].id).toBe(vehicleId)
    })

    it('ignores CANCELLED and COMPLETED bookings', async () => {
      const vehicleId = crypto.randomUUID()
      seedTable(vehiclesTable, [makeVehicle({ id: vehicleId })])
      seedTable(bookingsTable, [
        makeBooking({
          vehicleId,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T14:00:00Z'),
          status: 'CANCELLED',
        }),
        makeBooking({
          vehicleId,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T14:00:00Z'),
          status: 'COMPLETED',
        }),
      ])

      const res = await app.request(
        '/availability?from=2026-06-01T12:00:00Z&to=2026-06-01T16:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(vehicleId)
    })

    it('excludes MAINTENANCE and RETIRED vehicles', async () => {
      const availableId = crypto.randomUUID()
      seedTable(vehiclesTable, [
        makeVehicle({ status: 'MAINTENANCE' }),
        makeVehicle({ status: 'RETIRED' }),
        makeVehicle({ id: availableId, status: 'AVAILABLE' }),
      ])

      const res = await app.request(
        '/availability?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(availableId)
    })

    it('returns 400 for missing query params', async () => {
      const res1 = await app.request('/availability')
      expect(res1.status).toBe(400)

      const body1 = await res1.json()
      expect(body1.success).toBe(false)
      expect(body1.error).toBeDefined()

      const res2 = await app.request('/availability?from=2026-06-01T10:00:00Z')
      expect(res2.status).toBe(400)

      const res3 = await app.request('/availability?to=2026-06-01T14:00:00Z')
      expect(res3.status).toBe(400)
    })

    it('returns 400 when to is before from', async () => {
      const res = await app.request(
        '/availability?from=2026-06-01T14:00:00Z&to=2026-06-01T10:00:00Z',
      )

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBeDefined()
    })
  })

  describe('GET /availability/:vehicleId', () => {
    it('returns available=true when vehicle is free', async () => {
      const vehicleId = crypto.randomUUID()
      seedTable(vehiclesTable, [makeVehicle({ id: vehicleId })])

      const res = await app.request(
        `/availability/${vehicleId}?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z`,
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.available).toBe(true)
      expect(body.data.vehicle.id).toBe(vehicleId)
    })

    it('returns available=false with conflicts when booked', async () => {
      const vehicleId = crypto.randomUUID()
      const bookingId = crypto.randomUUID()
      seedTable(vehiclesTable, [makeVehicle({ id: vehicleId })])
      seedTable(bookingsTable, [
        makeBooking({
          id: bookingId,
          vehicleId,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T14:00:00Z'),
          status: 'CONFIRMED',
        }),
      ])

      const res = await app.request(
        `/availability/${vehicleId}?from=2026-06-01T12:00:00Z&to=2026-06-01T16:00:00Z`,
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.available).toBe(false)
      expect(body.data.vehicle.id).toBe(vehicleId)
      expect(body.data.conflicts).toHaveLength(1)
      expect(body.data.conflicts[0].id).toBe(bookingId)
    })

    it('returns 404 for nonexistent vehicle', async () => {
      const res = await app.request(
        '/availability/nonexistent?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z',
      )

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Vehicle not found')
    })
  })
})

// ---------- Test data factories ----------

function makeVehicle(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: 'Toyota Corolla',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    status: 'AVAILABLE',
    bufferMinutes: 30,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeBooking(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    renterId: 'user1',
    vehicleId: 'v1',
    startAt: new Date('2026-06-01T10:00:00Z'),
    endAt: new Date('2026-06-01T14:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    externalId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
