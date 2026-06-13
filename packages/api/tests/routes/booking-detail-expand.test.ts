import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { RunInTransaction } from '../../src/repositories/types'
import { createBookingRoutes } from '../../src/routes/bookings'
import { BookingService } from '../../src/services/booking'
import type { User, Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'
import { seededOperatorRepo } from '../helpers/operator'

// #549 slice 2: a deep-linked trip-detail page has no list-row data, so the
// single read `GET /bookings/:id?expand=vehicle,renter` must carry the assigned
// vehicle + renter. Crucially it ENRICHES — the renter-safe operator projection
// that findById already attaches (§4h) must survive alongside the new fields.

const OP_A = '00000000-0000-4000-8000-0000000000a0'
const ADMIN = '00000000-0000-4000-8000-0000000000d0'
const RENTER = '00000000-0000-4000-8000-0000000000c1'

const unusedRunInTransaction: RunInTransaction = async () => {
  throw new Error('runInTransaction must not be called by a read')
}

function vehicleData(
  overrides: Partial<Vehicle> = {},
): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: OP_A,
    classId: 'class-1',
    pickupLocationId: 'loc-1',
    name: 'Toyota Aqua',
    description: null,
    photos: ['https://img.example/aqua.jpg'],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...overrides,
  }
}

let service: BookingService
let bookingId: string

function app() {
  const a = new Hono()
  a.use('*', testAuthMiddleware(ADMIN, 'PLATFORM_ADMIN'))
  a.route('/', createBookingRoutes(service))
  return a
}

describe('GET /bookings/:id expand=vehicle,renter', () => {
  beforeEach(async () => {
    const bookingRepo = new InMemoryBookingRepository()
    const vehicleRepo = new InMemoryVehicleRepository()
    const renter: User = {
      id: RENTER,
      name: 'Hanako Tourist',
      email: 'hanako@example.com',
      phone: null,
      language: 'ja',
      country: null,
      role: 'RENTER',
    }
    const userRepo = new InMemoryUserRepository(new Map([[RENTER, renter]]))
    const operatorRepo = seededOperatorRepo(OP_A)

    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleData())
    const booking = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: OP_A,
        renterId: RENTER,
        requestedVehicleId: vehicle.id,
        assignedVehicleId: vehicle.id,
      }),
    )
    bookingId = booking.id

    service = new BookingService(
      bookingRepo,
      unusedRunInTransaction,
      vehicleRepo,
      userRepo,
      undefined,
      undefined,
      operatorRepo,
    )
  })

  it('layers vehicle + renter on top of the operator projection', async () => {
    const res = await app().request(`/bookings/${bookingId}?expand=vehicle,renter`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({
      id: bookingId,
      // The operator block (§4h) must SURVIVE the enrichment, not be replaced.
      operator: { name: 'Test Operator', preAuthHandoffUrl: null },
      vehicle: { name: 'Toyota Aqua', photos: ['https://img.example/aqua.jpg'] },
      renter: { id: RENTER, name: 'Hanako Tourist', email: 'hanako@example.com', language: 'ja' },
    })
  })

  it('still returns the bare booking + operator block without expand', async () => {
    const res = await app().request(`/bookings/${bookingId}`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({
      id: bookingId,
      operator: { name: 'Test Operator', preAuthHandoffUrl: null },
    })
    expect(body.data.vehicle).toBeUndefined()
    expect(body.data.renter).toBeUndefined()
  })
})
