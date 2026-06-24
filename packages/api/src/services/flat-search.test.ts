import { beforeEach, describe, expect, it } from 'vitest'
import { PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryAvailabilityRepository } from '../repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryLocationRepository } from '../repositories/in-memory/location'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryRegionRepository } from '../repositories/in-memory/region'
import { InMemoryStorefrontRepository } from '../repositories/in-memory/storefront'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleClassRepository } from '../repositories/in-memory/vehicle-class'
import type { AvailabilityFilters, AvailabilityRepository } from '../repositories/types'
import type { Location, Operator, Region, Vehicle, VehicleClass } from '../stores'
import { FlatSearchService } from './flat-search'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

// #394: osaka -> osaka_city -> namba; kyoto -> kyoto_city -> kyoto_station.
const reg = (id: string, parentId: string | null): Region => ({
  id,
  parentId,
  nameEn: id,
  nameJa: id,
  nameZh: id,
  sortOrder: 0,
  // #651 2b: geo/taxonomy fields are unused by these tree-walk fixtures → defaults.
  type: null,
  latitude: null,
  longitude: null,
  assignable: false,
  status: 'ACTIVE',
  slug: null,
})
const REGIONS: Region[] = [
  reg('reg_osaka', null),
  reg('reg_osaka_city', 'reg_osaka'),
  reg('reg_namba', 'reg_osaka_city'),
  reg('reg_kyoto', null),
  reg('reg_kyoto_city', 'reg_kyoto'),
  reg('reg_kyoto_station', 'reg_kyoto_city'),
]

let operatorRepo: InMemoryOperatorRepository
let locationRepo: InMemoryLocationRepository
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let classRepo: InMemoryVehicleClassRepository
let service: FlatSearchService

beforeEach(() => {
  operatorRepo = new InMemoryOperatorRepository()
  locationRepo = new InMemoryLocationRepository()
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  classRepo = new InMemoryVehicleClassRepository()
  const storefrontRepo = new InMemoryStorefrontRepository(locationRepo, operatorRepo)
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const regionRepo = new InMemoryRegionRepository(REGIONS)
  service = new FlatSearchService(storefrontRepo, availabilityRepo, classRepo, regionRepo)
})

function makeOperator(name: string, slug: string): Promise<Operator> {
  return operatorRepo.create({ name, slug, preAuthHandoffUrl: null })
}

function makeClass(overrides: Partial<Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>>) {
  return classRepo.create({
    operatorId: 'op_a',
    name: 'Compact',
    slug: `compact-${crypto.randomUUID().slice(0, 8)}`,
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
    ...overrides,
  })
}

function makeLocation(overrides: Partial<Omit<Location, 'id' | 'createdAt' | 'updatedAt'>>) {
  return locationRepo.create({
    operatorId: 'op_a',
    name: 'Namba',
    address: '1-1 Namba, Osaka',
    latitude: 34.6627,
    longitude: 135.5012,
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 60,
    status: 'ACTIVE',
    ...overrides,
  })
}

function makeVehicle(overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>) {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: 'op_a',
    classId: 'class_compact',
    pickupLocationId: 'loc_namba',
    name: 'Toyota Yaris',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 300 A 12-34',
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...overrides,
  })
}

async function ok(result: Awaited<ReturnType<FlatSearchService['search']>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.data
}

// Records the filters handed to the availability port. Scan-bounding (#651 §1c)
// is invisible in the OUTPUT (out-of-region cars are dropped by the location map
// anyway), so the observable is the scope the service requests of its injected
// repository — a legitimate port-contract assertion, not an internal mock.
class RecordingAvailabilityRepository implements AvailabilityRepository {
  lastFilters: AvailabilityFilters | undefined
  constructor(private readonly inner: AvailabilityRepository) {}
  findAvailableVehicles(from: Date, to: Date, filters?: AvailabilityFilters) {
    this.lastFilters = filters
    return this.inner.findAvailableVehicles(from, to, filters)
  }
  checkVehicleAvailability(vehicleId: string, from: Date, to: Date) {
    return this.inner.checkVehicleAvailability(vehicleId, from, to)
  }
  countClassDemand(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    from: Date,
    to: Date,
  ) {
    return this.inner.countClassDemand(operatorId, classId, pickupLocationId, from, to)
  }
  countClassCapacity(operatorId: string, classId: string, pickupLocationId: string, asOf: Date) {
    return this.inner.countClassCapacity(operatorId, classId, pickupLocationId, asOf)
  }
}

describe('FlatSearchService.search (#458)', () => {
  it('returns exactly the mappable available SPECIFIC vehicles across operators', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const b = await makeOperator('B Rentals', 'b')
    const classA = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const classB = await makeClass({ operatorId: b.id, name: 'Minivan', acrissCode: 'MVAR' })
    const namba = await makeLocation({
      operatorId: a.id,
      name: 'Namba',
      latitude: 34.6627,
      longitude: 135.5012,
    })
    const umeda = await makeLocation({
      operatorId: b.id,
      name: 'Umeda',
      latitude: 34.7025,
      longitude: 135.4959,
    })

    await makeVehicle({ operatorId: a.id, classId: classA.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: a.id, classId: classA.id, pickupLocationId: namba.id })
    await makeVehicle({
      operatorId: b.id,
      classId: classB.id,
      pickupLocationId: umeda.id,
      name: 'Toyota Alphard',
    })
    // Dropped: not available (MAINTENANCE) and not mappable (no pickupLocationId).
    await makeVehicle({
      operatorId: a.id,
      classId: classA.id,
      pickupLocationId: namba.id,
      status: 'MAINTENANCE',
    })
    await makeVehicle({ operatorId: a.id, classId: classA.id, pickupLocationId: null })

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))

    expect(data.items).toHaveLength(3)
    expect(data.items.every((i) => i.kind === 'SPECIFIC')).toBe(true)
    expect(data.nextCursor).toBeNull()
  })

  it('joins operatorName + real coords onto each item location', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR', name: 'Compact' })
    const namba = await makeLocation({
      operatorId: a.id,
      name: 'Namba',
      latitude: 34.6627,
      longitude: 135.5012,
    })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    const item = data.items[0]
    if (!item || item.kind !== 'SPECIFIC') throw new Error('expected a SPECIFIC item')

    expect(item.location).toMatchObject({
      locationId: namba.id,
      operatorId: a.id,
      operatorName: 'A Rentals',
      name: 'Namba',
      latitude: 34.6627,
      longitude: 135.5012,
    })
    expect(item.acrissCode).toBe('CCAR')
    expect(item.classLabel).toBe('Compact')
    expect(item.vehicleId).toBeTruthy()
  })

  it('never exposes the licence plate (renter-safe projection, #458 D3)', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    for (const item of data.items) {
      expect('licensePlate' in item).toBe(false)
    }
  })

  it('degrades a not-yet-geocoded location to null coords (still listed)', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const loc = await makeLocation({ operatorId: a.id, latitude: null, longitude: null })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: loc.id })

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    expect(data.items).toHaveLength(1)
    expect(data.items[0]?.location.latitude).toBeNull()
    expect(data.items[0]?.location.longitude).toBeNull()
  })

  it('orders items by [operatorName, locationName, vehicleId] for deterministic paging', async () => {
    const b = await makeOperator('B Rentals', 'b')
    const a = await makeOperator('A Rentals', 'a')
    const classA = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const classB = await makeClass({ operatorId: b.id, acrissCode: 'CCAR' })
    const aNamba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    const bUmeda = await makeLocation({
      operatorId: b.id,
      name: 'Umeda',
      latitude: 34.7,
      longitude: 135.49,
    })
    await makeVehicle({ operatorId: b.id, classId: classB.id, pickupLocationId: bUmeda.id })
    await makeVehicle({ operatorId: a.id, classId: classA.id, pickupLocationId: aNamba.id })

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    expect(data.items.map((i) => i.location.operatorName)).toEqual(['A Rentals', 'B Rentals'])
  })

  it('class filter keeps only items whose ACRISS code is requested', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const compact = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const van = await makeClass({ operatorId: a.id, name: 'Minivan', acrissCode: 'MVAR' })
    const namba = await makeLocation({ operatorId: a.id })
    await makeVehicle({ operatorId: a.id, classId: compact.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: a.id, classId: van.id, pickupLocationId: namba.id })

    const data = await ok(
      await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, classes: ['CCAR'] }),
    )
    expect(data.items).toHaveLength(1)
    expect(data.items[0]?.acrissCode).toBe('CCAR')
  })

  it('caps a page at the limit and resumes from the cursor without overlap', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })

    const page1 = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, limit: 2 }))
    expect(page1.items).toHaveLength(2)
    const cursor = page1.nextCursor
    if (cursor === null) throw new Error('expected a nextCursor for page 1')

    const page2 = await ok(
      await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, limit: 2, cursor }),
    )
    expect(page2.items).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()
    const ids = new Set(
      [...page1.items, ...page2.items].map((i) => i.kind === 'SPECIFIC' && i.vehicleId),
    )
    expect(ids.size).toBe(3)
  })

  it('rejects a malformed cursor with a 400 instead of throwing', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })

    const result = await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, cursor: '%%%' })
    if (result.ok) throw new Error('expected a failure result for a malformed cursor')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/cursor/i)
  })
})

describe('FlatSearchService.search region filter (#394)', () => {
  async function seedTwoRegions() {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba', regionId: 'reg_namba' })
    const kyoto = await makeLocation({
      operatorId: a.id,
      name: 'Kyoto Station',
      regionId: 'reg_kyoto_station',
    })
    await makeVehicle({
      operatorId: a.id,
      classId: klass.id,
      pickupLocationId: namba.id,
      name: 'Osaka Car',
    })
    await makeVehicle({
      operatorId: a.id,
      classId: klass.id,
      pickupLocationId: kyoto.id,
      name: 'Kyoto Car',
    })
  }

  it('narrows the flat results to a selected prefecture (node + descendants)', async () => {
    await seedTwoRegions()
    const data = await ok(
      await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, regionId: 'reg_osaka' }),
    )
    expect(data.items.map((i) => (i.kind === 'SPECIFIC' ? i.name : null))).toEqual(['Osaka Car'])
  })

  it('bounds the availability scan to the in-region storefronts, not the whole fleet (#651 §1c)', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba', regionId: 'reg_namba' })
    const kyoto = await makeLocation({
      operatorId: a.id,
      name: 'Kyoto Station',
      regionId: 'reg_kyoto_station',
    })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: kyoto.id })

    const recording = new RecordingAvailabilityRepository(
      new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo),
    )
    const scoped = new FlatSearchService(
      new InMemoryStorefrontRepository(locationRepo, operatorRepo),
      recording,
      classRepo,
      new InMemoryRegionRepository(REGIONS),
    )

    await scoped.search(PUBLIC_CONTEXT, { from: FROM, to: TO, regionId: 'reg_osaka' })

    expect(recording.lastFilters?.locationIds).toEqual([namba.id])
  })

  it('returns nothing for an unknown regionId (not the whole catalog)', async () => {
    await seedTwoRegions()
    const data = await ok(
      await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, regionId: 'reg_nope' }),
    )
    expect(data.items).toEqual([])
  })
})
