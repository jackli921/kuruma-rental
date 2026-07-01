import { beforeEach, describe, expect, it } from 'vitest'
import { PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryAvailabilityRepository } from '../repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryClassRatePlanRepository } from '../repositories/in-memory/class-rate-plan'
import { InMemoryLocationRepository } from '../repositories/in-memory/location'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryRegionRepository } from '../repositories/in-memory/region'
import { InMemoryStorefrontRepository } from '../repositories/in-memory/storefront'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../repositories/in-memory/vehicle-block'
import { InMemoryVehicleClassRepository } from '../repositories/in-memory/vehicle-class'
import type { AvailabilityFilters, AvailabilityRepository } from '../repositories/types'
import type { ClassRatePlan, Location, Operator, Region, Vehicle, VehicleClass } from '../stores'
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
let classRatePlanRepo: InMemoryClassRatePlanRepository
let service: FlatSearchService

beforeEach(() => {
  operatorRepo = new InMemoryOperatorRepository()
  locationRepo = new InMemoryLocationRepository()
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  classRepo = new InMemoryVehicleClassRepository()
  classRatePlanRepo = new InMemoryClassRatePlanRepository()
  const storefrontRepo = new InMemoryStorefrontRepository(locationRepo, operatorRepo)
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    operatorRepo,
  )
  const regionRepo = new InMemoryRegionRepository(REGIONS)
  service = new FlatSearchService(
    storefrontRepo,
    availabilityRepo,
    classRepo,
    regionRepo,
    classRatePlanRepo,
  )
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
  countClassCapacity(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    from: Date,
    to: Date,
    asOf: Date,
  ) {
    return this.inner.countClassCapacity(operatorId, classId, pickupLocationId, from, to, asOf)
  }
  lockComboCapacity(operatorId: string, classId: string, pickupLocationId: string) {
    return this.inner.lockComboCapacity(operatorId, classId, pickupLocationId)
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
      new InMemoryAvailabilityRepository(
        vehicleRepo,
        bookingRepo,
        new InMemoryVehicleBlockRepository(),
        operatorRepo,
      ),
    )
    const scoped = new FlatSearchService(
      new InMemoryStorefrontRepository(locationRepo, operatorRepo),
      recording,
      classRepo,
      new InMemoryRegionRepository(REGIONS),
      classRatePlanRepo,
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

// Drives the CLASS_COMBO producer with controlled supply/demand so the unit under
// test is FlatSearchService's availableCount arithmetic + emit threshold — not the
// repo's road-legal counting (covered by availability.test.ts). Records the asOf
// clock and [from, to) it was queried with so a wrong-arg regression is caught.
class ComboCountsAvailabilityRepository implements AvailabilityRepository {
  capacityAsOf: Date | undefined
  capacityRange: { from: Date; to: Date } | undefined
  demandRange: { from: Date; to: Date } | undefined
  constructor(
    private readonly inner: AvailabilityRepository,
    private readonly byClass: Map<string, { capacity: number; demand: number }>,
  ) {}
  findAvailableVehicles(from: Date, to: Date, filters?: AvailabilityFilters) {
    return this.inner.findAvailableVehicles(from, to, filters)
  }
  checkVehicleAvailability(vehicleId: string, from: Date, to: Date) {
    return this.inner.checkVehicleAvailability(vehicleId, from, to)
  }
  async countClassDemand(
    _operatorId: string,
    classId: string,
    _pickupLocationId: string,
    from: Date,
    to: Date,
  ) {
    this.demandRange = { from, to }
    return this.byClass.get(classId)?.demand ?? 0
  }
  async countClassCapacity(
    _operatorId: string,
    classId: string,
    _pickupLocationId: string,
    from: Date,
    to: Date,
    asOf: Date,
  ) {
    this.capacityAsOf = asOf
    // #1141: capacity now subtracts blocks overlapping the demand window — record
    // it so a wrong-arg regression (missing/swapped window) is caught.
    this.capacityRange = { from, to }
    return this.byClass.get(classId)?.capacity ?? 0
  }
  lockComboCapacity(operatorId: string, classId: string, pickupLocationId: string) {
    return this.inner.lockComboCapacity(operatorId, classId, pickupLocationId)
  }
}

describe('FlatSearchService.search CLASS_COMBO producer (#464)', () => {
  function makeRatePlan(
    overrides: Partial<Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>> = {},
  ) {
    return classRatePlanRepo.create({
      operatorId: 'op_a',
      classId: 'class_compact',
      pickupLocationId: 'loc_namba',
      dayRateJpy: 6000,
      isActive: true,
      label: null,
      ...overrides,
    })
  }

  function serviceWithCounts(byClass: Map<string, { capacity: number; demand: number }>) {
    const repo = new ComboCountsAvailabilityRepository(
      new InMemoryAvailabilityRepository(
        vehicleRepo,
        bookingRepo,
        new InMemoryVehicleBlockRepository(),
        operatorRepo,
      ),
      byClass,
    )
    const service = new FlatSearchService(
      new InMemoryStorefrontRepository(locationRepo, operatorRepo),
      repo,
      classRepo,
      new InMemoryRegionRepository(REGIONS),
      classRatePlanRepo,
    )
    return { repo, service }
  }

  it('surfaces an active rate plan as a CLASS_COMBO card with availableCount = capacity − demand', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    await makeRatePlan({
      operatorId: a.id,
      classId: klass.id,
      pickupLocationId: namba.id,
      dayRateJpy: 6000,
    })
    const { service, repo } = serviceWithCounts(new Map([[klass.id, { capacity: 3, demand: 1 }]]))

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    const combos = data.items.filter((i) => i.kind === 'CLASS_COMBO')

    expect(combos).toHaveLength(1)
    expect(combos[0]).toMatchObject({
      kind: 'CLASS_COMBO',
      classId: klass.id,
      availableCount: 2,
      dailyRateJpy: 6000,
      hourlyRateJpy: null,
      classLabel: 'Compact',
      acrissCode: 'CCAR',
      location: { locationId: namba.id, operatorName: 'A Rentals' },
    })
    // Road-legal supply is asked as-of the return date — parity with the write guard.
    expect(repo.capacityAsOf).toEqual(TO)
    expect(repo.capacityRange).toEqual({ from: FROM, to: TO })
    expect(repo.demandRange).toEqual({ from: FROM, to: TO })
  })

  it('emits no card when demand meets or exceeds capacity (sold out)', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id })
    await makeRatePlan({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    const { service } = serviceWithCounts(new Map([[klass.id, { capacity: 2, demand: 2 }]]))

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    expect(data.items.filter((i) => i.kind === 'CLASS_COMBO')).toEqual([])
  })

  it('drops a combo whose class is not in the requested ACRISS set', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const compact = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const van = await makeClass({ operatorId: a.id, name: 'Minivan', acrissCode: 'MVAR' })
    const namba = await makeLocation({ operatorId: a.id })
    await makeRatePlan({ operatorId: a.id, classId: compact.id, pickupLocationId: namba.id })
    await makeRatePlan({ operatorId: a.id, classId: van.id, pickupLocationId: namba.id })
    const { service } = serviceWithCounts(
      new Map([
        [compact.id, { capacity: 1, demand: 0 }],
        [van.id, { capacity: 1, demand: 0 }],
      ]),
    )

    const data = await ok(
      await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, classes: ['MVAR'] }),
    )
    const combos = data.items.filter((i) => i.kind === 'CLASS_COMBO')
    expect(combos).toHaveLength(1)
    expect(combos[0]?.acrissCode).toBe('MVAR')
  })

  it('merges combo and specific rows into one ordered, cursor-paginated list', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeRatePlan({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    const { service } = serviceWithCounts(new Map([[klass.id, { capacity: 2, demand: 0 }]]))

    const page1 = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, limit: 1 }))
    expect(page1.items).toHaveLength(1)
    const cursor = page1.nextCursor
    if (cursor === null) throw new Error('expected a cursor spanning the combo + specific rows')

    const page2 = await ok(
      await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, limit: 1, cursor }),
    )
    expect(page2.items).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()
    // One SPECIFIC + one CLASS_COMBO surface, with no overlap across the two pages.
    const kinds = [...page1.items, ...page2.items].map((i) => i.kind).sort()
    expect(kinds).toEqual(['CLASS_COMBO', 'SPECIFIC'])
  })

  it('never surfaces a combo whose pickup location is not an active storefront', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    await makeLocation({ operatorId: a.id, name: 'Namba' }) // an active storefront exists,
    // but the plan points at a location that is not one of them (archived / unknown).
    await makeRatePlan({ operatorId: a.id, classId: klass.id, pickupLocationId: 'loc_ghost' })
    const { service } = serviceWithCounts(new Map([[klass.id, { capacity: 5, demand: 0 }]]))

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    expect(data.items.filter((i) => i.kind === 'CLASS_COMBO')).toEqual([])
  })
})
