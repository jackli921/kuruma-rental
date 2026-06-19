import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { Booking, Vehicle } from '../../src/repositories/types'
import { AvailabilityService } from '../../src/services/availability'
import { bookingInput } from '../helpers/booking'

let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let availabilityRepo: InMemoryAvailabilityRepository
let service: AvailabilityService

async function seedVehicle(overrides: Partial<Vehicle> = {}): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    name: 'Toyota Corolla',
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    bufferMinutes: 30,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    // #916: default fixtures road-legal so the §5.2 gate doesn't hide them;
    // gate-specific tests pass expired/null docs via overrides.
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...overrides,
  })
}

async function seedBooking(vehicleId: string, overrides: Partial<Booking> = {}): Promise<Booking> {
  const endAt = overrides.endAt ?? new Date('2026-06-01T14:00:00Z')
  const effectiveEndAt = overrides.effectiveEndAt ?? new Date(endAt.getTime() + 30 * 60 * 1000)
  return bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      assignedVehicleId: vehicleId,
      startAt: new Date('2026-06-01T10:00:00Z'),
      status: 'CONFIRMED',
      ...overrides,
      endAt,
      effectiveEndAt,
    }),
  )
}

// The query window overlaps the seeded 10:00-14:00(+buffer) booking.
const FROM = new Date('2026-06-01T12:00:00Z')
const TO = new Date('2026-06-01T16:00:00Z')

beforeEach(() => {
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  service = new AvailabilityService(availabilityRepo)
})

describe('AvailabilityService.checkVehicleAvailability', () => {
  it('redacts a conflict to only its time window for a non-staff viewer', async () => {
    const vehicle = await seedVehicle()
    await seedBooking(vehicle.id, { renterId: 'other-renter', notes: 'secret internal note' })

    const result = await service.checkVehicleAvailability(vehicle.id, FROM, TO, 'RENTER')

    expect(result.kind).toBe('unavailable')
    if (result.kind !== 'unavailable') throw new Error('expected unavailable')
    expect(result.conflicts).toHaveLength(1)
    expect(Object.keys(result.conflicts[0]!)).toEqual(['startAt', 'effectiveEndAt'])
  })

  it('returns full conflict rows for a platform-staff viewer (PLATFORM_ADMIN after #487)', async () => {
    const vehicle = await seedVehicle()
    const booking = await seedBooking(vehicle.id, { notes: 'secret internal note' })

    const result = await service.checkVehicleAvailability(vehicle.id, FROM, TO, 'PLATFORM_ADMIN')

    expect(result.kind).toBe('unavailable')
    if (result.kind !== 'unavailable') throw new Error('expected unavailable')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ id: booking.id, notes: 'secret internal note' })
  })

  it('redacts conflicts for a legacy STAFF viewer — platform access revoked by #487', async () => {
    const vehicle = await seedVehicle()
    await seedBooking(vehicle.id, { notes: 'secret internal note' })

    const result = await service.checkVehicleAvailability(vehicle.id, FROM, TO, 'STAFF')

    expect(result.kind).toBe('unavailable')
    if (result.kind !== 'unavailable') throw new Error('expected unavailable')
    expect(result.conflicts).toHaveLength(1)
    expect(Object.keys(result.conflicts[0]!)).toEqual(['startAt', 'effectiveEndAt'])
  })

  it('returns available with the vehicle when the window is free', async () => {
    const vehicle = await seedVehicle()

    const result = await service.checkVehicleAvailability(vehicle.id, FROM, TO, 'RENTER')

    expect(result).toEqual({ kind: 'available', vehicle })
  })

  it('returns not_found for an unknown vehicle id', async () => {
    const result = await service.checkVehicleAvailability('nonexistent', FROM, TO, 'STAFF')

    expect(result).toEqual({ kind: 'not_found' })
  })
})
