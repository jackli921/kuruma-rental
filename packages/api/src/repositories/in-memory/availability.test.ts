import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { Booking, Vehicle } from '../../stores'
import { InMemoryAvailabilityRepository } from './availability'
import { InMemoryBookingRepository } from './booking'
import { InMemoryVehicleRepository } from './vehicle'
import { InMemoryVehicleBlockRepository } from './vehicle-block'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let vehicleBlockRepo: InMemoryVehicleBlockRepository
let availabilityRepo: InMemoryAvailabilityRepository

beforeEach(() => {
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  vehicleBlockRepo = new InMemoryVehicleBlockRepository()
  availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo, vehicleBlockRepo)
})

function makeVehicle(
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
    // Road-legal by default (well after TO) so the storefront-filter tests below
    // exercise filtering, not the #916 compliance gate. The gate has its own
    // describe block, which overrides these per case.
    shakenExpiryDate: '2027-01-01',
    insuranceExpiryDate: '2027-01-01',
    ...overrides,
  })
}

describe('InMemoryAvailabilityRepository.findAvailableVehicles — storefront filters (#391)', () => {
  it('with { locationId } returns only vehicles at that storefront', async () => {
    const osaka = await makeVehicle({ pickupLocationId: 'loc_osaka' })
    await makeVehicle({ pickupLocationId: 'loc_kyoto' })
    await makeVehicle({ pickupLocationId: null })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: 'loc_osaka',
    })

    expect(result.map((v) => v.id)).toEqual([osaka.id])
  })

  it('with { locationIds } returns only vehicles at those storefronts (#651 §1c)', async () => {
    const osaka = await makeVehicle({ pickupLocationId: 'loc_osaka' })
    const kyoto = await makeVehicle({ pickupLocationId: 'loc_kyoto' })
    await makeVehicle({ pickupLocationId: 'loc_nara' })
    await makeVehicle({ pickupLocationId: null })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationIds: ['loc_osaka', 'loc_kyoto'],
    })

    expect(result.map((v) => v.id).sort()).toEqual([osaka.id, kyoto.id].sort())
  })

  it('with { locationIds: [] } returns no vehicles (empty region matches nothing)', async () => {
    await makeVehicle({ pickupLocationId: 'loc_osaka' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, { locationIds: [] })

    expect(result).toEqual([])
  })

  it('with { classId } narrows to that ACRISS class within the location', async () => {
    const compact = await makeVehicle({ classId: 'class_compact', pickupLocationId: 'loc_osaka' })
    await makeVehicle({ classId: 'class_van', pickupLocationId: 'loc_osaka' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: 'loc_osaka',
      classId: 'class_compact',
    })

    expect(result.map((v) => v.id)).toEqual([compact.id])
  })

  it('with { operatorId } returns only that operator’s vehicles', async () => {
    const opA = await makeVehicle({ operatorId: 'op_a', pickupLocationId: 'loc_osaka' })
    await makeVehicle({ operatorId: 'op_b', pickupLocationId: 'loc_kyoto' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, { operatorId: 'op_a' })

    expect(result.map((v) => v.id)).toEqual([opA.id])
  })

  it('with no filter returns every available vehicle (backward compatible)', async () => {
    await makeVehicle({ pickupLocationId: 'loc_osaka' })
    await makeVehicle({ pickupLocationId: 'loc_kyoto' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result).toHaveLength(2)
  })

  it('composes the location filter with overlap exclusion', async () => {
    const booked = await makeVehicle({ pickupLocationId: 'loc_osaka' })
    const free = await makeVehicle({ pickupLocationId: 'loc_osaka' })
    await bookingRepo.create(SYSTEM_CONTEXT, {
      operatorId: 'op_a',
      renterId: 'u1',
      classId: 'class_compact',
      requestedVehicleId: booked.id,
      assignedVehicleId: booked.id,
      pickupLocationId: 'loc_osaka',
      dropoffLocationId: 'loc_osaka',
      startAt: new Date('2026-08-01T09:00:00Z'),
      endAt: new Date('2026-08-01T12:00:00Z'),
      effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      fulfillmentMode: 'SPECIFIC',
      bookingCode: `bk-${booked.id}`,
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

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: 'loc_osaka',
    })

    expect(result.map((v) => v.id)).toEqual([free.id])
  })
})

// §5.2 (#916): the road-legal gate hides a car whose shaken OR insurance is not
// valid through the requested `to` JST date — the same clock as direct/create.
// TO is 2026-08-01T14:00Z → JST 2026-08-01, so a doc dated 2026-08-01 is valid
// THROUGH `to` (boundary allowed) and 2026-07-31 is not.
describe('InMemoryAvailabilityRepository.findAvailableVehicles — compliance gate (#916)', () => {
  it('excludes a vehicle whose shaken expires before the requested return date', async () => {
    const current = await makeVehicle({})
    await makeVehicle({ shakenExpiryDate: '2026-07-31' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result.map((v) => v.id)).toEqual([current.id])
  })

  it('excludes a vehicle with no recorded insurance date (UNKNOWN)', async () => {
    const current = await makeVehicle({})
    await makeVehicle({ insuranceExpiryDate: null })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result.map((v) => v.id)).toEqual([current.id])
  })

  it('includes a vehicle whose documents are valid exactly through the return date', async () => {
    const boundary = await makeVehicle({
      shakenExpiryDate: '2026-08-01',
      insuranceExpiryDate: '2026-08-01',
    })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result.map((v) => v.id)).toEqual([boundary.id])
  })
})

// #1101: a scheduled block subtracts a car from availability/search exactly like
// a conflicting booking — the in-memory mirror of the Drizzle NOT EXISTS, so the
// guard can't pass unit tests yet fail in prod (must-fix #2).
function makeBlock(vehicleId: string, startAt: Date, endAt: Date) {
  return vehicleBlockRepo.create({
    operatorId: 'op_a',
    vehicleId,
    startAt,
    endAt,
    kind: 'MAINTENANCE',
    reason: 'scheduled service',
    notes: null,
    createdBy: 'user_op',
  })
}

describe('InMemoryAvailabilityRepository — block subtraction (#1101)', () => {
  it('excludes a vehicle whose only conflict is a block overlapping the window', async () => {
    const free = await makeVehicle({})
    const blocked = await makeVehicle({})
    // 09:00–12:00 overlaps the 10:00–14:00 request.
    await makeBlock(blocked.id, new Date('2026-08-01T09:00:00Z'), new Date('2026-08-01T12:00:00Z'))

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result.map((v) => v.id)).toEqual([free.id])
  })

  it('keeps a vehicle whose block is adjacent to the window (half-open, no overlap)', async () => {
    const v = await makeVehicle({})
    // ends exactly at FROM (10:00) → adjacent, not overlapping.
    await makeBlock(v.id, new Date('2026-08-01T06:00:00Z'), FROM)

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result.map((x) => x.id)).toEqual([v.id])
  })

  it('checkVehicleAvailability reports unavailable for a blocked window with NO booking conflicts', async () => {
    const v = await makeVehicle({})
    await makeBlock(v.id, new Date('2026-08-01T09:00:00Z'), new Date('2026-08-01T12:00:00Z'))

    const result = await availabilityRepo.checkVehicleAvailability(v.id, FROM, TO)

    expect(result?.available).toBe(false)
    // a block is not a booking — it flips availability without polluting conflicts.
    expect(result?.conflicts).toEqual([])
  })

  it('checkVehicleAvailability stays available when the block misses the window', async () => {
    const v = await makeVehicle({})
    await makeBlock(v.id, new Date('2026-08-01T15:00:00Z'), new Date('2026-08-01T18:00:00Z'))

    const result = await availabilityRepo.checkVehicleAvailability(v.id, FROM, TO)

    expect(result?.available).toBe(true)
  })
})

// #464: countClassDemand backs slice 2's inventory guard. It counts every
// BLOCKING booking of a class at a location overlapping the requested window —
// SPECIFIC bookings occupying a class car AND floating CLASS_COMBO of that class
// (both carried in bookings.classId) — so demand can be compared to totalCars.
describe('InMemoryAvailabilityRepository.countClassDemand (#464)', () => {
  type NewBooking = Parameters<InMemoryBookingRepository['create']>[1]
  let seq = 0
  function makeBooking(overrides: Partial<NewBooking> = {}): Promise<Booking> {
    seq += 1
    const base: NewBooking = {
      operatorId: 'op_a',
      renterId: 'u1',
      classId: 'class_compact',
      requestedVehicleId: 'veh_1',
      assignedVehicleId: 'veh_1',
      pickupLocationId: 'loc_osaka',
      dropoffLocationId: 'loc_osaka',
      startAt: new Date('2026-08-01T09:00:00Z'),
      endAt: new Date('2026-08-01T12:00:00Z'),
      effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      fulfillmentMode: 'SPECIFIC',
      bookingCode: `bk-${seq}`,
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
    }
    return bookingRepo.create(SYSTEM_CONTEXT, { ...base, ...overrides })
  }
  const demand = () =>
    availabilityRepo.countClassDemand('op_a', 'class_compact', 'loc_osaka', FROM, TO)

  it('counts a SPECIFIC booking of the class at the location overlapping the window', async () => {
    await makeBooking()
    expect(await demand()).toBe(1)
  })

  it('counts a floating CLASS_COMBO (no assigned car) — floats consume class capacity', async () => {
    await makeBooking({
      fulfillmentMode: 'CLASS_COMBO',
      requestedVehicleId: null,
      assignedVehicleId: null,
    })
    expect(await demand()).toBe(1)
  })

  it('sums SPECIFIC occupancy and floating combos of the same class (the invariant)', async () => {
    await makeBooking()
    await makeBooking({
      fulfillmentMode: 'CLASS_COMBO',
      requestedVehicleId: null,
      assignedVehicleId: null,
    })
    expect(await demand()).toBe(2)
  })

  it('excludes a different class', async () => {
    await makeBooking({ classId: 'class_van' })
    expect(await demand()).toBe(0)
  })

  it('excludes a different pickup location (capacity is per-store)', async () => {
    await makeBooking({ pickupLocationId: 'loc_kyoto' })
    expect(await demand()).toBe(0)
  })

  it('excludes a different operator', async () => {
    await makeBooking({ operatorId: 'op_b' })
    expect(await demand()).toBe(0)
  })

  it('excludes a booking whose window does not overlap', async () => {
    await makeBooking({
      startAt: new Date('2026-08-01T15:00:00Z'),
      endAt: new Date('2026-08-01T16:00:00Z'),
      effectiveEndAt: new Date('2026-08-01T16:00:00Z'),
    })
    expect(await demand()).toBe(0)
  })

  it('counts only CONFIRMED/ACTIVE — excludes CANCELLED and COMPLETED', async () => {
    await makeBooking({ status: 'CANCELLED' })
    await makeBooking({ status: 'COMPLETED' })
    await makeBooking({ status: 'ACTIVE' })
    expect(await demand()).toBe(1)
  })
})

// #464 slice 2d.2: countClassCapacity is the road-legal supply side of the
// combo guard. It must count only what the assign gate will accept — i.e.
// status === 'AVAILABLE'. RETIRED (permanent exit) and MAINTENANCE (temporary,
// unassignable) both fail that gate, so neither counts: counting a car the
// assign step rejects is a guaranteed combo overbook at pickup (#1193).
describe('InMemoryAvailabilityRepository.countClassCapacity (#464 slice 2d.2)', () => {
  const capacity = () =>
    availabilityRepo.countClassCapacity('op_a', 'class_compact', 'loc_osaka', FROM, TO, TO)

  it('counts an AVAILABLE road-legal vehicle in (op, class, loc)', async () => {
    await makeVehicle({})
    expect(await capacity()).toBe(1)
  })

  it('excludes a MAINTENANCE vehicle (unassignable — assign gate rejects non-AVAILABLE, #1193)', async () => {
    await makeVehicle({ status: 'MAINTENANCE' })
    expect(await capacity()).toBe(0)
  })

  it('excludes a RETIRED vehicle (permanent fleet exit)', async () => {
    await makeVehicle({ status: 'RETIRED' })
    expect(await capacity()).toBe(0)
  })

  it('excludes a vehicle whose shaken expires before the requested return date', async () => {
    await makeVehicle({ shakenExpiryDate: '2026-07-31' })
    expect(await capacity()).toBe(0)
  })

  it('excludes a vehicle whose insurance expires before the requested return date', async () => {
    await makeVehicle({ insuranceExpiryDate: '2026-07-31' })
    expect(await capacity()).toBe(0)
  })

  it('counts a vehicle whose docs lapse on the same JST day as the return (valid THROUGH)', async () => {
    // TO is 2026-08-01T14:00Z → 2026-08-01 JST. A cert printed 2026-08-01 is
    // valid THROUGH that day — same rule as findAvailableVehicles + #916.
    await makeVehicle({ shakenExpiryDate: '2026-08-01', insuranceExpiryDate: '2026-08-01' })
    expect(await capacity()).toBe(1)
  })

  it('excludes a vehicle with a NULL shaken date (UNKNOWN ≠ current)', async () => {
    await makeVehicle({ shakenExpiryDate: null })
    expect(await capacity()).toBe(0)
  })

  it('excludes vehicles in a different operator / class / location', async () => {
    await makeVehicle({ operatorId: 'op_b' })
    await makeVehicle({ classId: 'class_van' })
    await makeVehicle({ pickupLocationId: 'loc_kyoto' })
    expect(await capacity()).toBe(0)
  })

  it('excludes a vehicle with null pickupLocationId (no class store, no class supply)', async () => {
    await makeVehicle({ pickupLocationId: null })
    expect(await capacity()).toBe(0)
  })

  // #1141: a road-legal car scheduled off for the demand window is not real
  // supply. Without this subtraction the combo guard sees inflated capacity and
  // admits a float with no car to assign — the overbook only surfaces at
  // operator-assign time. Mirrors findAvailableVehicles' block subtraction.
  it('subtracts a vehicle whose block overlaps the demand window', async () => {
    await makeVehicle({}) // free
    const blocked = await makeVehicle({})
    // 09:00–12:00 overlaps the [10:00, 14:00) request window.
    await makeBlock(blocked.id, new Date('2026-08-01T09:00:00Z'), new Date('2026-08-01T12:00:00Z'))
    expect(await capacity()).toBe(1)
  })

  it('keeps a vehicle whose block is adjacent to the window (half-open, no overlap)', async () => {
    const v = await makeVehicle({})
    // ends exactly at FROM (10:00) → adjacent, not overlapping.
    await makeBlock(v.id, new Date('2026-08-01T06:00:00Z'), FROM)
    expect(await capacity()).toBe(1)
  })

  it('keeps a vehicle whose block misses the window entirely', async () => {
    await makeVehicle({})
    const v = await makeVehicle({})
    await makeBlock(v.id, new Date('2026-08-01T15:00:00Z'), new Date('2026-08-01T18:00:00Z'))
    expect(await capacity()).toBe(2)
  })
})

describe('InMemoryAvailabilityRepository.lockComboCapacity (#464 slice 2d.4)', () => {
  beforeEach(() => {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    vehicleBlockRepo = new InMemoryVehicleBlockRepository()
    availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo,
      bookingRepo,
      vehicleBlockRepo,
    )
  })

  // The combo submit holds this lock around demand → capacity → insert so a
  // parallel CLASS_COMBO submit on the same triple can't read demand BEFORE
  // the first submit's insert lands and double-book a class. Test: a second
  // acquire on the same key must wait until the first releases — Postgres'
  // pg_advisory_xact_lock semantics, modeled per-key in single-threaded JS.
  it('serializes per-key acquires: the second waits until the first releases', async () => {
    const order: string[] = []
    const release1 = await availabilityRepo.lockComboCapacity('op', 'cls', 'loc')
    order.push('acquired-1')

    const second = (async () => {
      const release2 = await availabilityRepo.lockComboCapacity('op', 'cls', 'loc')
      order.push('acquired-2')
      release2()
    })()

    // Give the event loop a tick — `second` MUST still be waiting because lock 1 is held.
    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(['acquired-1'])

    release1()
    await second
    expect(order).toEqual(['acquired-1', 'acquired-2'])
  })

  it('does not serialize across different keys', async () => {
    const release1 = await availabilityRepo.lockComboCapacity('op', 'cls', 'loc-A')
    // A different (op, class, loc) triple — must acquire independently and
    // without waiting for the first holder.
    const release2 = await availabilityRepo.lockComboCapacity('op', 'cls', 'loc-B')
    release1()
    release2()
    expect(true).toBe(true) // both acquires returned without deadlock
  })
})
