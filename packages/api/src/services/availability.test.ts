import { describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryAvailabilityRepository } from '../repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../repositories/in-memory/vehicle-block'
import type { Vehicle } from '../stores'
import { AvailabilityService } from './availability'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z') // JST 2026-08-01

function setup() {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const repo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
  )
  const service = new AvailabilityService(repo)
  return { vehicleRepo, service }
}

function makeVehicle(
  vehicleRepo: InMemoryVehicleRepository,
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: 'op_a',
    classId: 'class_compact',
    pickupLocationId: 'loc_osaka',
    name: 'Test Car',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2027-01-01',
    insuranceExpiryDate: '2027-01-01',
    ...overrides,
  })
}

// §5.2 (#916): the direct /availability/:id lookup only checks booking
// conflicts in the repo, so the SERVICE is the single point that also gates on
// road-legality — otherwise an expired car with no bookings returns available.
describe('AvailabilityService.checkVehicleAvailability — compliance gate (#916)', () => {
  it('reports a road-legal, conflict-free vehicle as available', async () => {
    const { vehicleRepo, service } = setup()
    const v = await makeVehicle(vehicleRepo, {})

    const result = await service.checkVehicleAvailability(v.id, FROM, TO, undefined)

    expect(result.kind).toBe('available')
  })

  it('overrides an expired vehicle to unavailable even with no booking conflict', async () => {
    const { vehicleRepo, service } = setup()
    const v = await makeVehicle(vehicleRepo, { shakenExpiryDate: '2026-07-31' })

    const result = await service.checkVehicleAvailability(v.id, FROM, TO, undefined)

    expect(result.kind).toBe('unavailable')
    if (result.kind === 'unavailable') expect(result.conflicts).toEqual([])
  })

  it('treats a vehicle with no insurance date (UNKNOWN) as unavailable', async () => {
    const { vehicleRepo, service } = setup()
    const v = await makeVehicle(vehicleRepo, { insuranceExpiryDate: null })

    const result = await service.checkVehicleAvailability(v.id, FROM, TO, undefined)

    expect(result.kind).toBe('unavailable')
  })
})
