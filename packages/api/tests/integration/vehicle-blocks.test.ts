import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { vehicleBlocks } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgConstraintName, pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleAvailabilityRepository,
  DrizzleVehicleBlockRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { VehicleBlockService } from '../../src/services/vehicle-block'
import type { Vehicle } from '../../src/stores'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupLocations,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// #1101 slice 1: proves the DB-level guarantees of vehicle_blocks against REAL
// Postgres — the `vehicle_blocks_no_overlap` GiST EXCLUDE (block-vs-block) and the
// `vehicle_blocks_end_after_start` CHECK. These objects are snapshot-invisible
// (custom migration 0076), so only a real-pg test exercises them.

const vehicleRepo = new DrizzleVehicleRepository(db)

const T0 = new Date('2026-09-01T00:00:00Z')
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000)

let classId: string
let locationId: string
let vehicleA: string
let vehicleB: string
const createdVehicleIds: string[] = []
const createdClassIds: string[] = []
const createdLocationIds: string[] = []
const createdBlockIds: string[] = []

async function insertBlock(overrides: {
  vehicleId: string
  startAt: Date
  endAt: Date
}): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(vehicleBlocks).values({
    id,
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    vehicleId: overrides.vehicleId,
    startAt: overrides.startAt,
    endAt: overrides.endAt,
    kind: 'MAINTENANCE',
    reason: 'scheduled service',
    notes: null,
    createdBy: 'system',
  })
  createdBlockIds.push(id)
  return id
}

/** Captures the Postgres error a failing write throws. Drizzle + postgres-js
 * wraps the raw PostgresError under `err.cause`, so we read code/constraint via
 * the shared pg-errors helpers (which check both paths). */
async function captureError(
  fn: () => Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await fn()
  } catch (err) {
    return { code: pgErrorCode(err), constraint: pgConstraintName(err) }
  }
  throw new Error('expected the write to throw, but it succeeded')
}

beforeAll(async () => {
  const klass = await seedVehicleClass('block')
  classId = klass.id
  createdClassIds.push(klass.id)
  const location = await seedLocation('block')
  locationId = location.id
  createdLocationIds.push(location.id)

  const mk = (name: string): Promise<Vehicle> =>
    vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      classId,
      pickupLocationId: locationId,
      name,
      description: null,
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    })
  vehicleA = (await mk('Block Car A')).id
  vehicleB = (await mk('Block Car B')).id
  createdVehicleIds.push(vehicleA, vehicleB)
})

afterEach(async () => {
  if (createdBlockIds.length > 0) {
    await db.delete(vehicleBlocks).where(inArray(vehicleBlocks.id, createdBlockIds))
    createdBlockIds.length = 0
  }
})

afterAll(async () => {
  await cleanupVehicles(createdVehicleIds)
  await cleanupVehicleClasses(createdClassIds)
  await cleanupLocations(createdLocationIds)
})

describe('vehicle_blocks DB constraints', () => {
  it('accepts a well-formed block', async () => {
    const id = await insertBlock({ vehicleId: vehicleA, startAt: hours(0), endAt: hours(48) })
    expect(id).toMatch(/[0-9a-f-]{36}/)
  })

  it('rejects a second block overlapping the same vehicle (23P01 vehicle_blocks_no_overlap)', async () => {
    await insertBlock({ vehicleId: vehicleA, startAt: hours(0), endAt: hours(48) })
    const err = await captureError(() =>
      insertBlock({ vehicleId: vehicleA, startAt: hours(24), endAt: hours(72) }),
    )
    expect(err.code).toBe('23P01')
    expect(err.constraint).toBe('vehicle_blocks_no_overlap')
  })

  it('rejects endAt <= startAt (23514 vehicle_blocks_end_after_start)', async () => {
    const err = await captureError(() =>
      insertBlock({ vehicleId: vehicleA, startAt: hours(10), endAt: hours(10) }),
    )
    expect(err.code).toBe('23514')
    expect(err.constraint).toBe('vehicle_blocks_end_after_start')
  })

  it('allows back-to-back blocks (half-open [start,end) — adjacent does not overlap)', async () => {
    await insertBlock({ vehicleId: vehicleA, startAt: hours(0), endAt: hours(24) })
    const id = await insertBlock({ vehicleId: vehicleA, startAt: hours(24), endAt: hours(48) })
    expect(id).toBeTruthy()
  })

  it('allows the same window on a different vehicle (key is per-vehicle)', async () => {
    await insertBlock({ vehicleId: vehicleA, startAt: hours(0), endAt: hours(48) })
    const id = await insertBlock({ vehicleId: vehicleB, startAt: hours(0), endAt: hours(48) })
    expect(id).toBeTruthy()
  })
})

// #1101 slice 2: proves the Drizzle availability subtraction against REAL Postgres
// — a road-legal, available car drops out of findAvailableVehicles +
// checkVehicleAvailability the moment a block overlaps the requested window
// (the NOT EXISTS vehicle_blocks predicate). Scoped to a dedicated class +
// location so the global scan isolates exactly the seeded car.
describe('vehicle_blocks availability subtraction', () => {
  const availabilityRepo = new DrizzleAvailabilityRepository(db)
  const blockRepo = new DrizzleVehicleBlockRepository(db)

  const WIN_FROM = hours(100)
  const WIN_TO = hours(124)

  let avClassId: string
  let avLocationId: string
  let roadLegalVehicle: string
  const avVehicleIds: string[] = []
  const avClassIds: string[] = []
  const avLocationIds: string[] = []
  const avBlockIds: string[] = []

  const scope = () => ({
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: avClassId,
    locationId: avLocationId,
  })

  beforeAll(async () => {
    const klass = await seedVehicleClass('block-av')
    avClassId = klass.id
    avClassIds.push(klass.id)
    const location = await seedLocation('block-av')
    avLocationId = location.id
    avLocationIds.push(location.id)
    // Road-legal THROUGH the window (both certs well past WIN_TO) so the #916
    // compliance gate doesn't exclude it — isolating the block effect.
    roadLegalVehicle = (
      await vehicleRepo.create(SYSTEM_CONTEXT, {
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        classId: avClassId,
        pickupLocationId: avLocationId,
        name: 'Road Legal Block Car',
        description: null,
        seats: 5,
        transmission: 'AUTO',
        fuelType: null,
        licensePlate: null,
        status: 'AVAILABLE',
        minRentalHours: null,
        maxRentalHours: null,
        advanceBookingHours: null,
        dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
        shakenExpiryDate: '2027-01-01',
        insuranceExpiryDate: '2027-01-01',
      })
    ).id
    avVehicleIds.push(roadLegalVehicle)
  })

  afterEach(async () => {
    if (avBlockIds.length > 0) {
      await db.delete(vehicleBlocks).where(inArray(vehicleBlocks.id, avBlockIds))
      avBlockIds.length = 0
    }
  })

  afterAll(async () => {
    await cleanupVehicles(avVehicleIds)
    await cleanupVehicleClasses(avClassIds)
    await cleanupLocations(avLocationIds)
  })

  async function blockWindow(startAt: Date, endAt: Date): Promise<void> {
    const block = await blockRepo.create({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      vehicleId: roadLegalVehicle,
      startAt,
      endAt,
      kind: 'MAINTENANCE',
      reason: 'scheduled service',
      notes: null,
      createdBy: 'system',
    })
    avBlockIds.push(block.id)
  }

  it('lists the road-legal car when nothing blocks the window', async () => {
    const result = await availabilityRepo.findAvailableVehicles(WIN_FROM, WIN_TO, scope())
    expect(result.map((v) => v.id)).toContain(roadLegalVehicle)
  })

  it('drops the car from findAvailableVehicles when a block overlaps the window', async () => {
    await blockWindow(hours(110), hours(130))
    const result = await availabilityRepo.findAvailableVehicles(WIN_FROM, WIN_TO, scope())
    expect(result.map((v) => v.id)).not.toContain(roadLegalVehicle)
  })

  it('keeps the car listed when the block is adjacent (half-open, no overlap)', async () => {
    // ends exactly at WIN_FROM → adjacent, not overlapping.
    await blockWindow(hours(76), WIN_FROM)
    const result = await availabilityRepo.findAvailableVehicles(WIN_FROM, WIN_TO, scope())
    expect(result.map((v) => v.id)).toContain(roadLegalVehicle)
  })

  it('flips checkVehicleAvailability to unavailable for a blocked window (block is not a booking)', async () => {
    const before = await availabilityRepo.checkVehicleAvailability(
      roadLegalVehicle,
      WIN_FROM,
      WIN_TO,
    )
    expect(before?.available).toBe(true)

    await blockWindow(hours(110), hours(130))

    const after = await availabilityRepo.checkVehicleAvailability(
      roadLegalVehicle,
      WIN_FROM,
      WIN_TO,
    )
    expect(after?.available).toBe(false)
    // a block flips availability without polluting the booking conflicts list.
    expect(after?.conflicts).toEqual([])
  })
})

// #1101 slice 5: the full service path against REAL Postgres. The unit tests use
// the InMemory overlap mirror; this proves DrizzleVehicleBlockRepository.create
// actually bubbles the GiST 23P01 in the shape VehicleBlockService maps to a 409
// (VEHICLE_BLOCK_OVERLAP). vehicleA persists from the first beforeAll; the
// top-level afterEach cleans every block this describe creates.
describe('VehicleBlockService against Postgres', () => {
  const service = new VehicleBlockService(vehicleRepo, new DrizzleVehicleBlockRepository(db))

  function input(startAt: Date, endAt: Date) {
    return {
      kind: 'MAINTENANCE' as const,
      reason: 'scheduled service',
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    }
  }

  it('persists a block with operatorId derived from the vehicle', async () => {
    const result = await service.createBlock(
      SYSTEM_CONTEXT,
      vehicleA,
      input(hours(200), hours(208)),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      createdBlockIds.push(result.block.id)
      expect(result.block.operatorId).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
      expect(result.block.createdBy).toBe(SYSTEM_CONTEXT.userId)
    }
  })

  it('maps the GiST 23P01 to 409 VEHICLE_BLOCK_OVERLAP on an overlapping window', async () => {
    const first = await service.createBlock(SYSTEM_CONTEXT, vehicleA, input(hours(300), hours(320)))
    if (!first.ok) throw new Error('setup block should have been created')
    createdBlockIds.push(first.block.id)

    const overlap = await service.createBlock(
      SYSTEM_CONTEXT,
      vehicleA,
      input(hours(310), hours(330)),
    )

    expect(overlap).toMatchObject({ ok: false, status: 409, code: 'VEHICLE_BLOCK_OVERLAP' })
  })
})
