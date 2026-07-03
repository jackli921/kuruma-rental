import { seedId } from '@kuruma/shared/db/seed-id'
import { beforeEach, describe, expect, it } from 'vitest'
import { PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryAddOnRepository } from '../repositories/in-memory/add-on'
import { InMemoryAvailabilityRepository } from '../repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryInsuranceOptionRepository } from '../repositories/in-memory/insurance-option'
import { InMemoryLocationRepository } from '../repositories/in-memory/location'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryStorefrontRepository } from '../repositories/in-memory/storefront'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../repositories/in-memory/vehicle-block'
import { InMemoryVehicleClassRepository } from '../repositories/in-memory/vehicle-class'
import type { AddOn, InsuranceOption, Location, Operator, Vehicle, VehicleClass } from '../stores'
import { StorefrontDetailService } from './storefront-detail'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

let operatorRepo: InMemoryOperatorRepository
let locationRepo: InMemoryLocationRepository
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let classRepo: InMemoryVehicleClassRepository
let insuranceRepo: InMemoryInsuranceOptionRepository
let addOnRepo: InMemoryAddOnRepository
let service: StorefrontDetailService

beforeEach(() => {
  operatorRepo = new InMemoryOperatorRepository()
  locationRepo = new InMemoryLocationRepository()
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  classRepo = new InMemoryVehicleClassRepository()
  insuranceRepo = new InMemoryInsuranceOptionRepository()
  addOnRepo = new InMemoryAddOnRepository()
  const storefrontRepo = new InMemoryStorefrontRepository(locationRepo, operatorRepo)
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    operatorRepo,
  )
  service = new StorefrontDetailService(
    storefrontRepo,
    availabilityRepo,
    classRepo,
    insuranceRepo,
    addOnRepo,
  )
})

function makeInsurance(
  overrides: Partial<Omit<InsuranceOption, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<InsuranceOption> {
  return insuranceRepo.create({
    operatorId: 'op_a',
    name: 'CDW',
    description: null,
    dailyPriceJpy: 1500,
    deductibleJpy: null,
    status: 'ACTIVE',
    ...overrides,
  })
}

function makeAddOn(
  overrides: Partial<Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<AddOn> {
  return addOnRepo.create({
    operatorId: 'op_a',
    name: 'Baby Seat',
    description: null,
    templateId: null,
    descriptionOverride: null,
    nameI18n: null,
    priceJpy: 1500,
    status: 'ACTIVE',
    ...overrides,
  })
}

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
    photos: ['https://cdn/yaris.jpg'],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 300 あ 12-34',
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: 800,
    shakenExpiryDate: '2027-03-31',
    insuranceExpiryDate: '2027-03-31',
    ...overrides,
  })
}

function bookOverlapping(vehicleId: string, classId: string) {
  return bookingRepo.create(SYSTEM_CONTEXT, {
    operatorId: 'op_a',
    renterId: 'u1',
    classId,
    requestedVehicleId: vehicleId,
    assignedVehicleId: vehicleId,
    pickupLocationId: 'loc_namba',
    dropoffLocationId: 'loc_namba',
    startAt: new Date('2026-08-01T09:00:00Z'),
    endAt: new Date('2026-08-01T12:00:00Z'),
    effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: `bk-${vehicleId}`,
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
  })
}

async function okData(result: Awaited<ReturnType<StorefrontDetailService['getDetail']>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`)
  return result.data
}

describe('StorefrontDetailService.getDetail (#391)', () => {
  it('returns 404 for an unknown locationId', async () => {
    const result = await service.getDetail(PUBLIC_CONTEXT, {
      locationId: 'loc_missing',
      from: FROM,
      to: TO,
    })

    expect(result).toEqual({ ok: false, error: expect.any(String), status: 404 })
  })

  it('returns 404 for an ARCHIVED location (a closed store is not browsable)', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const closed = await makeLocation({ operatorId: op.id, name: 'Closed', status: 'ARCHIVED' })

    const result = await service.getDetail(PUBLIC_CONTEXT, {
      locationId: closed.id,
      from: FROM,
      to: TO,
    })

    expect(result).toEqual({ ok: false, error: expect.any(String), status: 404 })
  })

  it('returns the storefront with an empty vehicle list (200) when the known store is full', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const only = await makeVehicle({
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: namba.id,
    })
    await bookOverlapping(only.id, compact.id)

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    expect(data.storefront).toEqual({
      locationId: namba.id,
      operatorId: op.id,
      name: 'Namba',
      address: '1-1 Namba, Osaka',
      operatorName: 'Best Car Rental',
      operatingHours: { openTime: '09:00', closeTime: '20:00' },
      turnaroundMinutes: 60,
    })
    expect(data.vehicles).toEqual([])
  })

  it('exposes the owning operatorId on the storefront summary (#1085 slice 5)', async () => {
    // Pins the producer line that copies storefront.operatorId across, so a
    // future refactor that drops or renames the field fails here BEFORE the
    // web RatingBadge silently stops fetching the operator aggregate.
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    expect(data.storefront.operatorId).toBe(op.id)
  })

  it('exposes the vehicle classId on each available vehicle (#1085 slice 5)', async () => {
    // Classed and classless vehicles MUST both pin: an UI badge fetch keys
    // off classId and renders nothing when null. A regression that null-fills
    // a classed vehicle, or drops the field, must fail here.
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const classed = await makeVehicle({
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: namba.id,
      name: 'Yaris',
    })
    const classless = await makeVehicle({
      operatorId: op.id,
      classId: null,
      pickupLocationId: namba.id,
      name: 'Free Spirit',
    })

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    const byId = new Map(data.vehicles.map((v) => [v.id, v]))
    expect(byId.get(classed.id)?.classId).toBe(compact.id)
    expect(byId.get(classless.id)?.classId).toBeNull()
  })

  it('surfaces the location turnaround minutes on the storefront summary (#551)', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id })
    const namba = await makeLocation({
      operatorId: op.id,
      name: 'Namba',
      defaultTurnaroundMinutes: 90,
    })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    expect(data.storefront.turnaroundMinutes).toBe(90)
  })

  it('lists only AVAILABLE, non-overlapping vehicles — excludes MAINTENANCE and booked', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const base = { operatorId: op.id, classId: compact.id, pickupLocationId: namba.id }
    const free = await makeVehicle(base)
    await makeVehicle({ ...base, status: 'MAINTENANCE' })
    const booked = await makeVehicle(base)
    await bookOverlapping(booked.id, compact.id)

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    expect(data.vehicles.map((v) => v.id)).toEqual([free.id])
  })

  it('projects renter-safe fields only — no operator internals leak', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    const vehicle = data.vehicles[0]
    expect(vehicle).toMatchObject({
      name: 'Toyota Yaris',
      make: 'Toyota',
      acrissCode: 'CCAR',
      classLabel: 'Compact',
      dailyRateJpy: 8000,
      hourlyRateJpy: 800,
    })
    expect(vehicle).not.toHaveProperty('shakenExpiryDate')
    expect(vehicle).not.toHaveProperty('insuranceExpiryDate')
    expect(vehicle).not.toHaveProperty('bufferMinutes')
    expect(vehicle).not.toHaveProperty('licensePlate')
    expect(vehicle).not.toHaveProperty('operatorId')
  })

  it('resolves effective luggage: vehicle override wins, null falls back to class (#457)', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({
      operatorId: op.id,
      name: 'Compact',
      luggageCapacity: 2,
      luggageSize: 'MEDIUM',
    })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    await makeVehicle({
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: namba.id,
      name: 'Override',
      licensePlate: 'OVERRIDE-1',
      luggageCapacity: 4,
      luggageSize: 'LARGE',
    })
    await makeVehicle({
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: namba.id,
      name: 'Fallback',
      licensePlate: 'FALLBACK-1',
      luggageCapacity: null,
      luggageSize: null,
    })

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )
    const byName = new Map(data.vehicles.map((v) => [v.name, v]))
    expect(byName.get('Override')).toMatchObject({ luggageCapacity: 4, luggageSize: 'LARGE' })
    expect(byName.get('Fallback')).toMatchObject({ luggageCapacity: 2, luggageSize: 'MEDIUM' })
  })

  it('class filter narrows the vehicle list to the requested ACRISS code', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, name: 'Compact', acrissCode: 'CCAR' })
    const van = await makeClass({ operatorId: op.id, name: 'Minivan', acrissCode: 'MVAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const yaris = await makeVehicle({
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: namba.id,
    })
    await makeVehicle({ operatorId: op.id, classId: van.id, pickupLocationId: namba.id })

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, {
        locationId: namba.id,
        from: FROM,
        to: TO,
        classes: ['CCAR'],
      }),
    )

    expect(data.vehicles.map((v) => v.id)).toEqual([yaris.id])
  })

  it('caps a page at the limit and resumes from the cursor without overlap', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const base = { operatorId: op.id, classId: compact.id, pickupLocationId: namba.id }
    await makeVehicle({ ...base, name: 'Car A' })
    await makeVehicle({ ...base, name: 'Car B' })
    await makeVehicle({ ...base, name: 'Car C' })

    const page1 = await okData(
      await service.getDetail(PUBLIC_CONTEXT, {
        locationId: namba.id,
        from: FROM,
        to: TO,
        limit: 2,
      }),
    )
    expect(page1.vehicles.map((v) => v.name)).toEqual(['Car A', 'Car B'])
    const cursor = page1.nextCursor
    if (cursor === null) throw new Error('expected a nextCursor for page 1')

    const page2 = await okData(
      await service.getDetail(PUBLIC_CONTEXT, {
        locationId: namba.id,
        from: FROM,
        to: TO,
        limit: 2,
        cursor,
      }),
    )
    expect(page2.vehicles.map((v) => v.name)).toEqual(['Car C'])
    expect(page2.nextCursor).toBeNull()
  })

  it('rejects a malformed cursor with a 400 instead of throwing (public-input guard)', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })

    // '%%%' is not valid base64 -> atob() throws; a known store with a bad
    // cursor must be a 400, not a 500.
    const result = await service.getDetail(PUBLIC_CONTEXT, {
      locationId: namba.id,
      from: FROM,
      to: TO,
      cursor: '%%%',
    })

    if (result.ok) throw new Error('expected a failure result for a malformed cursor')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/cursor/i)
  })
})

describe('getInsuranceOptions', () => {
  it('returns the location operator ACTIVE options in a renter-safe projection', async () => {
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })
    await makeInsurance({
      operatorId: op.id,
      name: 'CDW',
      description: 'Collision damage waiver',
      dailyPriceJpy: 1500,
      deductibleJpy: 50000,
    })

    const result = await service.getInsuranceOptions(PUBLIC_CONTEXT, loc.id)

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data).toEqual([
      {
        id: expect.any(String),
        name: 'CDW',
        description: 'Collision damage waiver',
        dailyPriceJpy: 1500,
        deductibleJpy: 50000,
      },
    ])
  })

  it('excludes ARCHIVED options', async () => {
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })
    await makeInsurance({ operatorId: op.id, name: 'Active CDW', dailyPriceJpy: 1000 })
    const archived = await makeInsurance({ operatorId: op.id, name: 'Old CDW', dailyPriceJpy: 800 })
    await insuranceRepo.archive(SYSTEM_CONTEXT, archived.id)

    const result = await service.getInsuranceOptions(PUBLIC_CONTEXT, loc.id)

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data.map((o) => o.name)).toEqual(['Active CDW'])
  })

  it('returns ONLY the location operator options, never another operator', async () => {
    const opA = await makeOperator('Op A', 'op-a')
    const opB = await makeOperator('Op B', 'op-b')
    const locA = await makeLocation({ operatorId: opA.id, name: 'Namba' })
    await makeInsurance({ operatorId: opA.id, name: 'A-CDW', dailyPriceJpy: 1000 })
    await makeInsurance({ operatorId: opB.id, name: 'B-CDW', dailyPriceJpy: 2000 })

    const result = await service.getInsuranceOptions(PUBLIC_CONTEXT, locA.id)

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data.map((o) => o.name)).toEqual(['A-CDW'])
  })

  it('returns an empty list when the operator has no options', async () => {
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })

    const result = await service.getInsuranceOptions(PUBLIC_CONTEXT, loc.id)

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data).toEqual([])
  })

  it('404s for an unknown location', async () => {
    const result = await service.getInsuranceOptions(PUBLIC_CONTEXT, crypto.randomUUID())
    expect(result).toEqual({ ok: false, error: 'Storefront not found', status: 404 })
  })

  it('404s for an archived location', async () => {
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })
    await locationRepo.archive(SYSTEM_CONTEXT, loc.id)

    const result = await service.getInsuranceOptions(PUBLIC_CONTEXT, loc.id)
    expect(result).toEqual({ ok: false, error: 'Storefront not found', status: 404 })
  })
})

describe('getAddOns', () => {
  it('returns the location operator ACTIVE add-ons in a renter-safe projection', async () => {
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })
    await makeAddOn({
      operatorId: op.id,
      name: 'Baby Seat',
      description: 'Rear-facing infant seat',
      priceJpy: 1500,
    })

    const result = await service.getAddOns(PUBLIC_CONTEXT, loc.id, 'en')

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data).toEqual([
      {
        id: expect.any(String),
        name: 'Baby Seat',
        description: 'Rear-facing infant seat',
        priceJpy: 1500,
      },
    ])
  })

  it('exposes exactly the whitelisted keys — no operator-internal columns leak (#532)', async () => {
    // Public, unauthenticated surface (tourists + Trip.com). A future refactor
    // to `return options` / `...spread` would silently leak operatorId/status/
    // timestamps; lock the projection to the customer-facing whitelist.
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })
    await makeAddOn({ operatorId: op.id, name: 'Baby Seat', priceJpy: 1500 })

    const result = await service.getAddOns(PUBLIC_CONTEXT, loc.id, 'en')

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data).toHaveLength(1)
    expect(Object.keys(result.data[0] ?? {}).sort()).toEqual([
      'description',
      'id',
      'name',
      'priceJpy',
    ])
  })

  it('resolves a templated add-on name/description to the renter locale (#385)', async () => {
    // The default in-memory repo seeds the curated template catalog, so an add-on
    // referencing tmpl_child_seat carries the ja/zh bundles at read time.
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })
    await makeAddOn({
      operatorId: op.id,
      name: 'Child seat', // legacy column — must NOT win over the template
      templateId: seedId('tmpl_child_seat'),
      priceJpy: 1500,
    })

    const result = await service.getAddOns(PUBLIC_CONTEXT, loc.id, 'ja')

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data[0]?.name).toBe('チャイルドシート')
    expect(result.data[0]?.description).toBe(
      '後ろ向きまたはブースターシート。受け取り時に取り付けます。',
    )
  })

  it('excludes ARCHIVED add-ons', async () => {
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })
    await makeAddOn({ operatorId: op.id, name: 'Active Seat', priceJpy: 1000 })
    const archived = await makeAddOn({ operatorId: op.id, name: 'Old Seat', priceJpy: 800 })
    await addOnRepo.archive(SYSTEM_CONTEXT, archived.id)

    const result = await service.getAddOns(PUBLIC_CONTEXT, loc.id, 'en')

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data.map((o) => o.name)).toEqual(['Active Seat'])
  })

  it('returns ONLY the location operator add-ons, never another operator', async () => {
    const opA = await makeOperator('Op A', 'op-a')
    const opB = await makeOperator('Op B', 'op-b')
    const locA = await makeLocation({ operatorId: opA.id, name: 'Namba' })
    await makeAddOn({ operatorId: opA.id, name: 'A-Seat', priceJpy: 1000 })
    await makeAddOn({ operatorId: opB.id, name: 'B-Seat', priceJpy: 2000 })

    const result = await service.getAddOns(PUBLIC_CONTEXT, locA.id, 'en')

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data.map((o) => o.name)).toEqual(['A-Seat'])
  })

  it('returns an empty list when the operator has no add-ons', async () => {
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })

    const result = await service.getAddOns(PUBLIC_CONTEXT, loc.id, 'en')

    if (!result.ok) throw new Error('expected ok result')
    expect(result.data).toEqual([])
  })

  it('404s for an unknown location', async () => {
    const result = await service.getAddOns(PUBLIC_CONTEXT, crypto.randomUUID(), 'en')
    expect(result).toEqual({ ok: false, error: 'Storefront not found', status: 404 })
  })

  it('404s for an archived location', async () => {
    const op = await makeOperator('Op A', 'op-a')
    const loc = await makeLocation({ operatorId: op.id })
    await locationRepo.archive(SYSTEM_CONTEXT, loc.id)

    const result = await service.getAddOns(PUBLIC_CONTEXT, loc.id, 'en')
    expect(result).toEqual({ ok: false, error: 'Storefront not found', status: 404 })
  })
})
