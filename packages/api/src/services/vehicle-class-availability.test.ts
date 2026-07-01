import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryAvailabilityRepository } from '../repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../repositories/in-memory/vehicle-block'
import { InMemoryVehicleClassRepository } from '../repositories/in-memory/vehicle-class'
import { VehicleClassAvailabilityService } from './vehicle-class-availability'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')
const SLUG = 'compact'

let classRepo: InMemoryVehicleClassRepository
let vehicleRepo: InMemoryVehicleRepository
let operatorRepo: InMemoryOperatorRepository
let service: VehicleClassAvailabilityService

beforeEach(() => {
  classRepo = new InMemoryVehicleClassRepository()
  vehicleRepo = new InMemoryVehicleRepository()
  operatorRepo = new InMemoryOperatorRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    new InMemoryBookingRepository(),
    new InMemoryVehicleBlockRepository(),
    operatorRepo,
  )
  service = new VehicleClassAvailabilityService(
    classRepo,
    vehicleRepo,
    availabilityRepo,
    operatorRepo,
  )
})

function seedOperator(name: string, slug: string) {
  return operatorRepo.create({ name, slug, preAuthHandoffUrl: null })
}

function seedClass(operatorId: string) {
  return classRepo.create({
    operatorId,
    name: 'Compact',
    slug: SLUG,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: 'CCAR',
    sortOrder: 0,
    status: 'ACTIVE',
  })
}

function seedVehicle(operatorId: string, classId: string) {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId,
    classId,
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
  })
}

// #1224: a soft-deactivated operator is off the platform, so its cars count toward
// NEITHER totalCars NOR availableCars — the two stay consistent with /availability,
// which drops them at the repo seam. Without this reconcile, totalCars would keep
// counting a car that can never be booked.
describe('VehicleClassAvailabilityService — operator deactivation (#1224)', () => {
  it('counts only active operators’ vehicles in both totalCars and availableCars', async () => {
    const active = await seedOperator('Active Cars', 'active-cars')
    const gone = await seedOperator('Gone Cars', 'gone-cars')
    const vc = await seedClass(active.id)
    const activeVehicle = await seedVehicle(active.id, vc.id)
    const goneVehicle = await seedVehicle(gone.id, vc.id)
    await operatorRepo.update(gone.id, { deactivatedAt: new Date(), updatedAt: new Date() })

    const result = await service.getAvailabilityForClass(SYSTEM_CONTEXT, SLUG, FROM, TO)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.data.totalCars).toBe(1)
    expect(result.data.availableCars).toBe(1)
    expect(result.data.sampleAvailableVehicleIds).toContain(activeVehicle.id)
    expect(result.data.sampleAvailableVehicleIds).not.toContain(goneVehicle.id)
  })

  it('reports 0/0 for a class whose only vehicles belong to a deactivated operator', async () => {
    const gone = await seedOperator('Gone Cars', 'gone-cars')
    const vc = await seedClass(gone.id)
    await seedVehicle(gone.id, vc.id)
    await operatorRepo.update(gone.id, { deactivatedAt: new Date(), updatedAt: new Date() })

    const result = await service.getAvailabilityForClass(SYSTEM_CONTEXT, SLUG, FROM, TO)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.data.totalCars).toBe(0)
    expect(result.data.availableCars).toBe(0)
    expect(result.data.sampleAvailableVehicleIds).toEqual([])
  })
})
